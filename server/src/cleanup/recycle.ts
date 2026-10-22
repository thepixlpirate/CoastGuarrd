import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../db/index.js';
import { getSetting } from '../lib/settings.js';
import { jf, jellyfinReady } from '../jellyfin/client.js';
import { arrReady, removeEntry, rescan, setMonitored, type ArrId } from '../services/arr.js';
import { connectionFor } from '../services/store.js';
import { httpJson, joinUrl } from '../services/http.js';
import { nearestExisting, suggestRecyclePath, isInside } from '../storage/paths.js';
import { diskUsage, toLocal } from './locate.js';
import { backupPath, restorePoster } from './posters.js';
import type { MediaRow } from './rules.js';

/**
 * The recycle bin. Titles are only ever MOVED here — never deleted — and
 * only a person pressing "Delete forever" or "Empty recycle bin" removes
 * them for good. No timer or rule in CoastGuarrd can do that.
 */

export function logCleanup(itemKey: string | null, title: string | null, action: string, detail?: unknown) {
  getDb()
    .prepare('INSERT INTO cleanup_log (at, item_key, title, action, detail) VALUES (?, ?, ?, ?, ?)')
    .run(Date.now(), itemKey, title, action, detail === undefined ? null : typeof detail === 'string' ? detail : JSON.stringify(detail));
}

function sameDrive(a: string, b: string): boolean {
  const pa = nearestExisting(a);
  const pb = nearestExisting(b);
  if (!pa || !pb) return false;
  return fs.statSync(pa).dev === fs.statSync(pb).dev;
}

/** Removes empty folders left behind inside a recycle bin. */
function tidyEmpty(dir: string) {
  try {
    let cur = dir;
    while (cur.includes('.coastguarrd-recycle') && !cur.endsWith('.coastguarrd-recycle') && fs.existsSync(cur) && fs.readdirSync(cur).length === 0) {
      fs.rmdirSync(cur);
      cur = path.dirname(cur);
    }
  } catch {
    /* ignore */
  }
}

function uniqueDest(dest: string): string {
  if (!fs.existsSync(dest)) return dest;
  return `${dest} (${new Date().toISOString().replace(/[:.]/g, '-')})`;
}

function moveEntry(src: string, dest: string, allowCopy: boolean) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(src, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV' || !allowCopy) throw err;
    fs.cpSync(src, dest, { recursive: true, preserveTimestamps: true, errorOnExist: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
}

async function refreshJellyfin() {
  if (jellyfinReady()) await jf('/Library/Refresh', { method: 'POST' }).catch(() => undefined);
}

export interface MovePlan {
  /** Folder or file to move. */
  sources: string[];
  /** Where in the recycle bin they go (folder). */
  dest: string;
  /** The original location (folder) used to put things back. */
  originalDir: string;
  /** True when individual files are moved out of a shared folder. */
  filesOnly: boolean;
  recycleRoot: string;
}

/** Works out exactly what would be moved, without touching anything. */
export function planMove(item: Pick<MediaRow, 'kind' | 'path' | 'path_service' | 'title'>): MovePlan {
  if (!item.path) throw new Error('No file location is known for this title.');
  const loc = toLocal(item.path, item.path_service);
  if (!loc) throw new Error(`CoastGuarrd can’t find “${item.path}” on disk. Match this folder in Settings → Folders & recycle bins.`);
  const root = loc.root;
  const recycleRoot = root.recycle_path || suggestRecyclePath(root.local_path);
  if (!recycleRoot) throw new Error('No recycle bin is set for this folder.');
  let target = loc.local;
  if (!fs.existsSync(target)) throw new Error(`The files aren’t where expected: ${target}`);
  let filesOnly = false;
  let sources = [target];
  let originalDir = path.dirname(target);
  const st = fs.statSync(target);
  if (st.isFile()) {
    const dir = path.dirname(target);
    if (path.resolve(dir) === path.resolve(root.local_path)) {
      // Movie file sits loose in the library folder: move it plus its sidecar files (same name, other extensions).
      const stem = path.basename(target, path.extname(target));
      sources = fs.readdirSync(dir).filter((f) => f === path.basename(target) || f.startsWith(stem + '.') || f.startsWith(stem + '-')).map((f) => path.join(dir, f));
      filesOnly = true;
      originalDir = dir;
    } else {
      // Movie in its own folder: move the whole folder.
      target = dir;
      sources = [dir];
      originalDir = path.dirname(dir);
    }
  }
  if (sources.some((s) => path.resolve(s) === path.resolve(root.local_path))) throw new Error('Refusing to move a whole library folder.');
  const rel = path.relative(root.local_path, filesOnly ? path.join(originalDir, path.basename(sources[0], path.extname(sources[0]))) : sources[0]);
  const libName = path.basename(root.local_path);
  const dest = uniqueDest(path.join(recycleRoot, libName, rel));
  if (isInside(dest, root.local_path)) throw new Error('The recycle bin is inside the media folder — pick another location in Settings.');
  return { sources, dest, originalDir, filesOnly, recycleRoot };
}

/** Moves a flagged (or any) title into the recycle bin. */
export async function moveToBin(item: MediaRow, ruleName: string | null): Promise<number> {
  const s = getSetting('cleanup');
  const plan = planMove(item);
  if (!sameDrive(plan.sources[0], plan.recycleRoot) && !s.allowCrossDrive) {
    throw new Error('The recycle bin is on a different drive, so this would copy the whole title. Pick a bin on the same drive, or allow copying in Settings → Cleanup.');
  }
  const size = item.size_bytes ?? plan.sources.reduce((n, src) => n + diskUsage(src), 0);

  // 1. Put the original poster back so no bannered artwork travels with the files.
  if (item.jf_id) await restorePoster(item.jf_id, true).catch(() => undefined);

  // 2. Stop Radarr/Sonarr/Lidarr from downloading it again.
  let wasMonitored: number | null = null;
  const arrId = item.arr_service as ArrId | null;
  if (arrId && item.arr_id && arrReady(arrId) && s.arr.unmonitor) {
    wasMonitored = (await setMonitored(arrId, item.arr_id, false)) ? 1 : 0;
  }

  // 3. Move.
  try {
    if (plan.filesOnly) {
      fs.mkdirSync(plan.dest, { recursive: true });
      for (const src of plan.sources) moveEntry(src, path.join(plan.dest, path.basename(src)), s.allowCrossDrive);
    } else {
      moveEntry(plan.sources[0], plan.dest, s.allowCrossDrive);
    }
  } catch (err) {
    if (arrId && item.arr_id && wasMonitored) await setMonitored(arrId, item.arr_id, true).catch(() => undefined);
    throw new Error(`Couldn’t move the files: ${(err as Error).message}`);
  }

  const db = getDb();
  const id = db
    .prepare(
      `INSERT INTO recycle_bin (item_key, jf_id, kind, title, year, original_path, recycle_path, size_bytes, moved_at, rule_name, arr_service, arr_id,
         was_monitored, tmdb_id, tvdb_id, poster_backup, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      item.key, item.jf_id, item.kind, item.title, item.year, plan.filesOnly ? plan.originalDir : plan.sources[0], plan.dest, size, Date.now(), ruleName,
      item.arr_service, item.arr_id, wasMonitored, item.tmdb_id, item.tvdb_id, item.jf_id && fs.existsSync(backupPath(item.jf_id)) ? backupPath(item.jf_id) : null,
      plan.filesOnly ? JSON.stringify({ files: plan.sources.map((f) => path.basename(f)) }) : null,
    ).lastInsertRowid as number;
  db.prepare('DELETE FROM flags WHERE item_key = ?').run(item.key);
  db.prepare('DELETE FROM media_items WHERE key = ?').run(item.key);
  logCleanup(item.key, item.title, 'moved', { to: plan.dest, rule: ruleName });

  // 4. Let the apps notice.
  if (arrId && item.arr_id && arrReady(arrId)) await rescan(arrId, item.arr_id).catch(() => undefined);
  await refreshJellyfin();
  return id;
}

interface BinRow {
  id: number;
  item_key: string | null;
  jf_id: string | null;
  kind: string;
  title: string;
  original_path: string;
  recycle_path: string;
  arr_service: string | null;
  arr_id: number | null;
  was_monitored: number | null;
  tmdb_id: number | null;
  poster_backup: string | null;
  status: string;
  note: string | null;
}

function binRow(id: number): BinRow {
  const r = getDb().prepare('SELECT * FROM recycle_bin WHERE id = ?').get(id) as BinRow | undefined;
  if (!r) throw new Error('Not found in the recycle bin.');
  if (r.status !== 'in_bin') throw new Error('This title is no longer in the recycle bin.');
  return r;
}

/** Puts a title back exactly where it came from. */
export async function restoreFromBin(id: number) {
  const r = binRow(id);
  if (!fs.existsSync(r.recycle_path)) throw new Error(`The files are missing from the recycle bin (${r.recycle_path}).`);
  const files = r.note ? (JSON.parse(r.note) as { files?: string[] }).files : undefined;
  if (files) {
    for (const f of files) if (fs.existsSync(path.join(r.original_path, f))) throw new Error(`Something already exists at ${path.join(r.original_path, f)}.`);
    for (const f of files) moveEntry(path.join(r.recycle_path, f), path.join(r.original_path, f), true);
    fs.rmSync(r.recycle_path, { recursive: true, force: true });
  } else {
    if (fs.existsSync(r.original_path)) throw new Error(`Something already exists at ${r.original_path}.`);
    moveEntry(r.recycle_path, r.original_path, true);
  }
  const arrId = r.arr_service as ArrId | null;
  if (arrId && r.arr_id && arrReady(arrId)) {
    if (r.was_monitored) await setMonitored(arrId, r.arr_id, true).catch(() => undefined);
    await rescan(arrId, r.arr_id).catch(() => undefined);
  }
  if (r.poster_backup) fs.rmSync(r.poster_backup, { force: true });
  // Don't flag it again straight away: keep it for 30 days.
  if (r.item_key) {
    getDb()
      .prepare('INSERT OR REPLACE INTO exclusions (item_key, title, until, reason, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(r.item_key, r.title, Date.now() + 30 * 86_400_000, 'Restored from the recycle bin', Date.now());
  }
  tidyEmpty(path.dirname(r.recycle_path));
  getDb().prepare(`UPDATE recycle_bin SET status = 'restored', finished_at = ? WHERE id = ?`).run(Date.now(), id);
  logCleanup(r.item_key, r.title, 'restored');
  await refreshJellyfin();
}

async function resetInSeerr(kind: string, tmdbId: number) {
  const c = connectionFor('seerr');
  if (!c) return;
  const type = kind === 'show' ? 'tv' : 'movie';
  const info = await httpJson<{ mediaInfo?: { id?: number } }>(joinUrl(c.url, `/api/v1/${type}/${tmdbId}`), { headers: { 'X-Api-Key': c.apiKey } });
  if (info.mediaInfo?.id) await httpJson(joinUrl(c.url, `/api/v1/media/${info.mediaInfo.id}`), { method: 'DELETE', headers: { 'X-Api-Key': c.apiKey } });
}

/** Permanently deletes one title from the recycle bin. Only ever called from a button press. */
export async function deleteForever(id: number) {
  const r = binRow(id);
  const s = getSetting('cleanup');
  const binRoot = path.dirname(path.dirname(r.recycle_path));
  // Safety: only ever delete inside a CoastGuarrd recycle bin.
  if (!r.recycle_path.includes('.coastguarrd-recycle') && !getDb().prepare('SELECT 1 FROM library_folders WHERE ? LIKE recycle_path || \'%\'').get(r.recycle_path)) {
    throw new Error(`Refusing to delete ${r.recycle_path}: it isn’t inside a recycle bin.`);
  }
  fs.rmSync(r.recycle_path, { recursive: true, force: true });
  // Tidy empty parent folders inside the bin.
  try {
    let parent = path.dirname(r.recycle_path);
    while (parent.length > binRoot.length && fs.readdirSync(parent).length === 0) {
      fs.rmdirSync(parent);
      parent = path.dirname(parent);
    }
  } catch {
    /* ignore */
  }
  const notes: string[] = [];
  const arrId = r.arr_service as ArrId | null;
  if (arrId && r.arr_id && s.arr.removeOnDelete && arrReady(arrId)) {
    await removeEntry(arrId, r.arr_id, s.arr.importExclusion).then(
      () => notes.push(`removed from ${arrId}`),
      (e) => notes.push(`${arrId}: ${(e as Error).message}`),
    );
  }
  if (r.tmdb_id && s.seerrReset && (r.kind === 'movie' || r.kind === 'show')) {
    await resetInSeerr(r.kind, r.tmdb_id).then(
      () => notes.push('cleared in Seerr'),
      (e) => notes.push(`Seerr: ${(e as Error).message}`),
    );
  }
  if (r.poster_backup) fs.rmSync(r.poster_backup, { force: true });
  getDb().prepare(`UPDATE recycle_bin SET status = 'deleted', finished_at = ?, note = ? WHERE id = ?`).run(Date.now(), notes.join('; ') || null, id);
  logCleanup(r.item_key, r.title, 'deleted', notes.join('; '));
}

// ---------------------------------------------------------------------------
// Leftover downloads
// ---------------------------------------------------------------------------

export function leftoverDownloads(): { name: string; path: string; size: number; modifiedAt: number }[] {
  const s = getSetting('cleanup');
  const dir = getSetting('general').downloadsPath;
  if (!dir || !fs.existsSync(dir)) return [];
  const cutoff = Date.now() - s.downloadsAgeDays * 86_400_000;
  const out: { name: string; path: string; size: number; modifiedAt: number }[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const p = path.join(dir, name);
    let st: fs.Stats;
    try {
      st = fs.statSync(p);
    } catch {
      continue;
    }
    if (st.mtimeMs > cutoff) continue;
    out.push({ name, path: p, size: diskUsage(p, { files: 20_000 }), modifiedAt: st.mtimeMs });
  }
  return out.sort((a, b) => b.size - a.size).slice(0, 200);
}

export function moveDownloadToBin(name: string): number {
  const dir = getSetting('general').downloadsPath;
  if (!dir) throw new Error('No downloads folder is set.');
  const src = path.join(dir, name);
  if (path.dirname(path.resolve(src)) !== path.resolve(dir) || !fs.existsSync(src)) throw new Error('That download wasn’t found.');
  const recycleRoot = suggestRecyclePath(dir);
  const dest = uniqueDest(path.join(recycleRoot, path.basename(dir), name));
  if (!sameDrive(src, recycleRoot) && !getSetting('cleanup').allowCrossDrive) throw new Error('The recycle bin would be on a different drive.');
  const size = diskUsage(src);
  moveEntry(src, dest, getSetting('cleanup').allowCrossDrive);
  const id = getDb()
    .prepare(`INSERT INTO recycle_bin (kind, title, original_path, recycle_path, size_bytes, moved_at, rule_name) VALUES ('download', ?, ?, ?, ?, ?, 'Leftover download')`)
    .run(name, src, dest, size, Date.now()).lastInsertRowid as number;
  logCleanup(null, name, 'moved', { to: dest, rule: 'Leftover download' });
  return id;
}
