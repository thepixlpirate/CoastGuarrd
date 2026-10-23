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
  const tx = db.transaction((rows: unknown[][]) => {
    for (const r of rows) {
      const [date, userId, itemId, itemType, itemName, method, client, device, duration] = r as string[];
      const uid = String(userId ?? '').replace(/-/g, '');
      if (!uid || !itemId) {
        current.skipped++;
        continue;
      }
      const started = parseLocal(String(date));
      const secs = Number(duration) || 0;
      if (hasLive.get(uid, String(itemId).replace(/-/g, ''), started + secs * 1000 + SLACK_MS, started - SLACK_MS)) {
        current.skipped++; // CoastGuarrd already recorded this play live
        continue;
      }
      const ep = itemType === 'Episode' ? splitEpisodeName(String(itemName)) : null;
      const out = insert.run(
        uid,
        users.get(uid) ?? 'Unknown',
        String(itemId).replace(/-/g, ''),
        String(itemType ?? 'Unknown'),
        ep?.title ?? String(itemName ?? ''),
        ep?.series ?? null,
        ep?.season ?? null,
        ep?.episode ?? null,
        started,
        started + secs * 1000,
        started + secs * 1000,
        secs * 1000,
        method ? String(method).replace(/\s*\(.*\)$/, '') : null,
        client ?? null,
        device ?? null,
      );
      if (out.changes) current.imported++;
      else current.skipped++;
    }
  });
  for (let i = 0; i < res.results.length; i += 1000) tx(res.results.slice(i, i + 1000));
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
          if (hasLive.get(u.id, it.Id, last + SLACK_MS, startAt - SLACK_MS)) {
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
      const usedPlugin = await viaPlugin();
      if (!usedPlugin) await viaPlayedItems();
      current.message =
        current.method === 'plugin'
          ? `Imported ${current.imported.toLocaleString()} plays from the Playback Reporting plugin.`
          : `Imported ${current.imported.toLocaleString()} watched items (last-watched dates only — install Jellyfin's Playback Reporting plugin for full history).`;
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
