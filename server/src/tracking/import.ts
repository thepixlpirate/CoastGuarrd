import { getDb } from '../db/index.js';
import { jfApi, TICKS_PER_MS } from '../jellyfin/client.js';
import { setState, getState } from '../lib/state.js';

/**
 * Brings in watch history from before CoastGuarrd was installed.
 *  1. If Jellyfin's "Playback Reporting" plugin is installed, every play it
 *     recorded is imported (with how long each was watched).
 *  2. Otherwise each person's "played" items are imported with their
 *     last-played date (Jellyfin doesn't keep more than that on its own).
 */

export interface ImportStatus {
  running: boolean;
  method: 'plugin' | 'played' | null;
  imported: number;
  skipped: number;
  message: string;
  finishedAt: number | null;
}

let current: ImportStatus = { running: false, method: null, imported: 0, skipped: 0, message: '', finishedAt: null };

export function importStatus(): ImportStatus {
  return current.running ? current : getState<ImportStatus>('import:last', current);
}

/**
 * Plays CoastGuarrd tracked live are already in the table, and Jellyfin's own
 * records include those same plays. An imported play counts as a duplicate when
 * the same person watched the same item at about the same time.
 */
const SLACK_MS = 15 * 60_000;

/** Removes imported plays that overlap a live-tracked play of the same title. Returns how many. */
function removeDuplicates(): number {
  const out = getDb()
    .prepare(
      `DELETE FROM plays
       WHERE source != 'live'
         AND EXISTS (
           SELECT 1 FROM plays l
           WHERE l.source = 'live' AND l.user_id = plays.user_id AND l.item_id = plays.item_id
             AND l.started_at <= plays.last_seen_at + ?
             AND COALESCE(l.stopped_at, l.last_seen_at) >= plays.started_at - ?
         )`,
    )
    .run(SLACK_MS, SLACK_MS);
  return out.changes;
}

/** SQL for "the calendar day (server time zone) this play started on". */
const DAY_SQL = `date(started_at / 1000, 'unixepoch', 'localtime')`;

function dayOf(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

interface PlayRow {
  id: number;
  source: string;
  started_at: number;
  last_seen_at: number;
  stopped_at: number | null;
  position_ms: number;
  watched_ms: number;
  paused_ms: number;
  pause_count: number;
  runtime_ms: number | null;
  completed: number;
}

/**
 * Pause, stop and resume would otherwise show one sitting as several plays
 * (started, watched some, finished). This folds every finished play of the same
 * title by the same person on the same day into one: it keeps the earliest
 * live play (which has the device and place details), adds up the time watched,
 * and takes the furthest point reached. Pass a person and title to tidy only that
 * one; with no arguments it tidies everything. Returns how many plays were folded in.
 */
export function mergeSameDayPlays(only?: { userId: string; itemId: string }): number {
  const db = getDb();
  const groups = db
    .prepare(
      `SELECT user_id, item_id, ${DAY_SQL} AS day FROM plays
       WHERE stopped_at IS NOT NULL ${only ? 'AND user_id = ? AND item_id = ?' : ''}
       GROUP BY user_id, item_id, day HAVING COUNT(*) > 1`,
    )
    .all(...(only ? [only.userId, only.itemId] : [])) as { user_id: string; item_id: string; day: string }[];
  if (!groups.length) return 0;

  const rowsOf = db.prepare(`SELECT * FROM plays WHERE user_id = ? AND item_id = ? AND ${DAY_SQL} = ? AND stopped_at IS NOT NULL ORDER BY started_at, id`);
  const del = db.prepare('DELETE FROM plays WHERE id = ?');
  const repoint = db.prepare('UPDATE alerts SET play_id = ? WHERE play_id = ?');
  const update = db.prepare(
    `UPDATE plays SET started_at = ?, last_seen_at = ?, stopped_at = ?, position_ms = ?, watched_ms = ?,
       paused_ms = ?, pause_count = ?, completed = ? WHERE id = ?`,
  );

  let folded = 0;
  const run = db.transaction(() => {
    for (const g of groups) {
      const rows = rowsOf.all(g.user_id, g.item_id, g.day) as PlayRow[];
      if (rows.length < 2) continue;
      const keep = rows.find((r) => r.source === 'live') ?? rows[0];
      const others = rows.filter((r) => r.id !== keep.id);
      const furthest = Math.max(...rows.map((r) => r.position_ms));
      const runtime = rows.find((r) => r.runtime_ms)?.runtime_ms ?? null;
      const completed = rows.some((r) => r.completed) || (runtime ? furthest >= runtime * 0.9 : false) ? 1 : 0;
      for (const o of others) {
        repoint.run(keep.id, o.id);
        del.run(o.id);
      }
      update.run(
        Math.min(...rows.map((r) => r.started_at)),
        Math.max(...rows.map((r) => r.last_seen_at)),
        Math.max(...rows.map((r) => r.stopped_at ?? r.last_seen_at)),
        furthest,
        rows.reduce((n, r) => n + r.watched_ms, 0),
        rows.reduce((n, r) => n + r.paused_ms, 0),
        rows.reduce((n, r) => n + r.pause_count, 0),
        completed,
        keep.id,
      );
      folded += others.length;
    }
  });
  run();
  return folded;
}

/** Playback Reporting stores local time without a zone, e.g. "2024-03-01 20:15:02.1234567". */
function parseLocal(s: string): number {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return Date.parse(s);
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}

/** "Show Name - s01e02 - Episode Title" → parts. */
function splitEpisodeName(name: string) {
  const m = name.match(/^(.*) - s(\d+)e(\d+) - (.*)$/i);
  return m ? { series: m[1], season: Number(m[2]), episode: Number(m[3]), title: m[4] } : null;
}

async function viaPlugin(): Promise<boolean> {
  const res = await jfApi.playbackReporting(
    'SELECT DateCreated, UserId, ItemId, ItemType, ItemName, PlaybackMethod, ClientName, DeviceName, PlayDuration FROM PlaybackActivity ORDER BY DateCreated',
  );
  if (!res || !Array.isArray(res.results)) return false;
  current.method = 'plugin';
  const db = getDb();
  const users = new Map((db.prepare('SELECT id, name FROM media_users').all() as { id: string; name: string }[]).map((u) => [u.id, u.name]));
  const insert = db.prepare(
    `INSERT OR IGNORE INTO plays (user_id, user_name, item_id, item_type, item_name, series_name, season_number, episode_number,
       started_at, last_seen_at, stopped_at, watched_ms, play_method, client, device_name, source, completed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'import-plugin', 0)`,
  );
  const hasLive = db.prepare(
    `SELECT 1 FROM plays WHERE source = 'live' AND user_id = ? AND item_id = ?
       AND started_at <= ? AND COALESCE(stopped_at, last_seen_at) >= ? LIMIT 1`,
  );
  const hasDay = db.prepare(`SELECT 1 FROM plays WHERE user_id = ? AND item_id = ? AND ${DAY_SQL} = ? LIMIT 1`);

  // Several rows for one title on one day are one sitting: combine them first.
  interface Sitting {
    uid: string;
    itemId: string;
    itemType: string;
    itemName: string;
    method: string | null;
    client: string | null;
    device: string | null;
    started: number;
    end: number;
    ms: number;
  }
  const sittings = new Map<string, Sitting>();
  for (const r of res.results) {
    const [date, userId, itemId, itemType, itemName, method, client, device, duration] = r as string[];
    const uid = String(userId ?? '').replace(/-/g, '');
    if (!uid || !itemId) {
      current.skipped++;
      continue;
    }
    const started = parseLocal(String(date));
    if (!Number.isFinite(started)) {
      current.skipped++;
      continue;
    }
    const ms = (Number(duration) || 0) * 1000;
    const item = String(itemId).replace(/-/g, '');
    const key = `${uid}|${item}|${dayOf(started)}`;
    const have = sittings.get(key);
    if (have) {
      have.started = Math.min(have.started, started);
      have.end = Math.max(have.end, started + ms);
      have.ms += ms;
      current.skipped++; // folded into the first play of that day
    } else {
      sittings.set(key, {
        uid,
        itemId: item,
        itemType: String(itemType ?? 'Unknown'),
        itemName: String(itemName ?? ''),
        method: method ? String(method).replace(/\s*\(.*\)$/, '') : null,
        client: client ?? null,
        device: device ?? null,
        started,
        end: started + ms,
        ms,
      });
    }
  }

  const tx = db.transaction((list: Sitting[]) => {
    for (const x of list) {
      if (hasLive.get(x.uid, x.itemId, x.end + SLACK_MS, x.started - SLACK_MS) || hasDay.get(x.uid, x.itemId, dayOf(x.started))) {
        current.skipped++; // already have this title for this person on this day
        continue;
      }
      const ep = x.itemType === 'Episode' ? splitEpisodeName(x.itemName) : null;
      const out = insert.run(
        x.uid,
        users.get(x.uid) ?? 'Unknown',
        x.itemId,
        x.itemType,
        ep?.title ?? x.itemName,
        ep?.series ?? null,
        ep?.season ?? null,
        ep?.episode ?? null,
        x.started,
        x.end,
        x.end,
        x.ms,
        x.method,
        x.client,
        x.device,
      );
      if (out.changes) current.imported++;
      else current.skipped++;
    }
  });
  const all = [...sittings.values()];
  for (let i = 0; i < all.length; i += 1000) tx(all.slice(i, i + 1000));
  return true;
}

async function viaPlayedItems() {
  current.method = 'played';
  const db = getDb();
  const users = db.prepare('SELECT id, name FROM media_users WHERE removed = 0').all() as { id: string; name: string }[];
  const insert = db.prepare(
    `INSERT OR IGNORE INTO plays (user_id, user_name, item_id, item_type, item_name, series_id, series_name, season_number, episode_number,
       year, runtime_ms, started_at, last_seen_at, stopped_at, watched_ms, position_ms, source, completed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'import-played', 1)`,
  );
  const hasLive = db.prepare(
    `SELECT 1 FROM plays WHERE source = 'live' AND user_id = ? AND item_id = ?
       AND started_at <= ? AND COALESCE(stopped_at, last_seen_at) >= ? LIMIT 1`,
  );
  const hasDay = db.prepare(`SELECT 1 FROM plays WHERE user_id = ? AND item_id = ? AND ${DAY_SQL} = ? LIMIT 1`);
  for (const u of users) {
    current.message = `Reading ${u.name}'s watched items…`;
    for (let start = 0; ; start += 500) {
      const page = await jfApi.playedItems(u.id, start, 500);
      const items = page.Items ?? [];
      const tx = db.transaction(() => {
        for (const it of items) {
          const last = it.UserData?.LastPlayedDate ? Date.parse(it.UserData.LastPlayedDate) : null;
          if (!last) {
            current.skipped++;
            continue;
          }
          const runtime = it.RunTimeTicks ? Math.round(it.RunTimeTicks / TICKS_PER_MS) : 0;
          const startAt = last - runtime;
          if (hasLive.get(u.id, it.Id, last + SLACK_MS, startAt - SLACK_MS) || hasDay.get(u.id, it.Id, dayOf(startAt))) {
            current.skipped++; // CoastGuarrd already recorded this play live
            continue;
          }
          const out = insert.run(
            u.id, u.name, it.Id, it.Type, it.Name, it.SeriesId ?? it.AlbumId ?? null, it.SeriesName ?? it.Album ?? null,
            it.ParentIndexNumber ?? null, it.IndexNumber ?? null, it.ProductionYear ?? null, runtime || null,
            startAt, last, last, runtime, runtime,
          );
          if (out.changes) current.imported++;
          else current.skipped++;
        }
      });
      tx();
      if (items.length < 500) break;
    }
  }
}

export function startImport(log: { error: (m: unknown) => void }): boolean {
  if (current.running) return false;
  current = { running: true, method: null, imported: 0, skipped: 0, message: 'Checking for the Playback Reporting plugin…', finishedAt: null };
  void (async () => {
    try {
      // Clean up duplicates left by earlier imports before bringing in anything new.
      const removed = removeDuplicates();
      // Fold plays of the same title on the same day into one.
      const folded = mergeSameDayPlays();
      const usedPlugin = await viaPlugin();
      if (!usedPlugin) await viaPlayedItems();
      current.message =
        current.method === 'plugin'
          ? `Imported ${current.imported.toLocaleString()} plays from the Playback Reporting plugin.`
          : `Imported ${current.imported.toLocaleString()} watched items (last-watched dates only — install Jellyfin's Playback Reporting plugin for full history).`;
      if (folded > 0) current.message += ` Combined ${folded.toLocaleString()} split-up plays into single entries.`;
      if (removed > 0) current.message += ` Removed ${removed.toLocaleString()} duplicate${removed === 1 ? '' : 's'} of plays CoastGuarrd had already tracked.`;
    } catch (err) {
      log.error(err);
      current.message = `Import stopped: ${(err as Error).message}`;
    } finally {
      current.running = false;
      current.finishedAt = Date.now();
      setState('import:last', current);
    }
  })();
  return true;
}
