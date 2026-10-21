import { getDb } from '../db/index.js';
import { jellyfinReady, jfApi, type JfActivity } from '../jellyfin/client.js';
import { lookupIp } from '../geo/index.js';
import { getState, setState } from '../lib/state.js';
import { connectionFor } from '../services/store.js';
import { httpJson, joinUrl } from '../services/http.js';
import { normalizeIp } from '../lib/ip.js';
import net from 'node:net';
import { recordDevice, recordIp, deviceCount } from './presence.js';
import { onFailedSignIn, onNewDevice, onNewIp, onSignIn } from './rules.js';

type Log = { info: (m: string) => void; warn: (m: string) => void; error: (m: unknown) => void };

// ---------------------------------------------------------------------------
// Jellyfin users and devices
// ---------------------------------------------------------------------------

export async function syncUsers() {
  if (!jellyfinReady()) return;
  const users = await jfApi.users();
  const db = getDb();
  const now = Date.now();
  const ids = new Set<string>();
  const tx = db.transaction(() => {
    for (const u of users) {
      ids.add(u.Id);
      db.prepare(
        `INSERT INTO media_users (id, name, is_admin, is_disabled, image_tag, last_login_at, last_activity_at, first_seen_at, removed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, is_admin = excluded.is_admin, is_disabled = excluded.is_disabled,
           image_tag = excluded.image_tag,
           last_login_at = MAX(COALESCE(last_login_at, 0), COALESCE(excluded.last_login_at, 0)),
           last_activity_at = MAX(COALESCE(last_activity_at, 0), COALESCE(excluded.last_activity_at, 0)),
           removed = 0`,
      ).run(
        u.Id,
        u.Name,
        u.Policy?.IsAdministrator ? 1 : 0,
        u.Policy?.IsDisabled ? 1 : 0,
        u.PrimaryImageTag ?? null,
        u.LastLoginDate ? Date.parse(u.LastLoginDate) : null,
        u.LastActivityDate ? Date.parse(u.LastActivityDate) : null,
        now,
      );
    }
    const all = db.prepare('SELECT id FROM media_users WHERE removed = 0').all() as { id: string }[];
    for (const r of all) if (!ids.has(r.id)) db.prepare('UPDATE media_users SET removed = 1 WHERE id = ?').run(r.id);
  });
  tx();
}

export async function syncDevices() {
  if (!jellyfinReady()) return;
  const res = await jfApi.devices();
  const db = getDb();
  const known = new Set((db.prepare('SELECT id FROM media_users').all() as { id: string }[]).map((r) => r.id));
  const tx = db.transaction(() => {
    for (const d of res.Items ?? []) {
      if (!d.LastUserId || !known.has(d.LastUserId)) continue;
      const at = d.DateLastActivity ? Date.parse(d.DateLastActivity) : Date.now();
      recordDevice(d.LastUserId, { id: d.Id, name: d.Name, client: d.AppName, version: d.AppVersion }, at);
    }
  });
  tx();
}

// ---------------------------------------------------------------------------
// Jellyfin activity log → sign-ins
// ---------------------------------------------------------------------------

/** Pulls the first IP address out of a log line like "IP address: 1.2.3.4". */
function findIp(text: string): string {
  const v4 = text.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
  if (v4 && net.isIPv4(v4[1])) return normalizeIp(v4[1]);
  for (const tok of text.split(/[\s,;()[\]]+/)) {
    if (tok.includes(':') && net.isIPv6(tok)) return normalizeIp(tok);
  }
  return '';
}

function classify(e: JfActivity): 'signin' | 'failed' | 'session' | null {
  const t = e.Type.toLowerCase();
  if (t.includes('authenticationsucceeded')) return 'signin';
  if (t.includes('authenticationfailed') || t.includes('userlockedout')) return 'failed';
  if (t === 'sessionstarted') return 'session';
  return null;
}

function processActivity(entries: JfActivity[], live: boolean, log: Log) {
  const db = getDb();
  const users = new Map((db.prepare('SELECT id, name FROM media_users').all() as { id: string; name: string }[]).map((u) => [u.id, u.name]));
  const insert = db.prepare(
    `INSERT OR IGNORE INTO sign_ins (log_id, at, kind, user_id, user_name, ip, is_local, device_name, country, country_code, city, lat, lon, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const e of entries.sort((a, b) => a.Id - b.Id)) {
    const kind = classify(e);
    if (!kind) continue;
    const at = Date.parse(e.Date) || Date.now();
    const text = `${e.ShortOverview ?? ''} ${e.Overview ?? ''} ${e.Name}`;
    const ip = findIp(text);
    const geo = lookupIp(ip);
    const uid = e.UserId && e.UserId !== '00000000000000000000000000000000' ? e.UserId.replace(/-/g, '') : null;
    const userId = uid && users.has(uid) ? uid : e.UserId && users.has(e.UserId) ? e.UserId : null;
    let userName = userId ? users.get(userId)! : null;
    if (!userName && kind === 'failed') {
      // e.g. "Failed login try from admin" / "Failed login attempt by user admin"
      const m = e.Name.match(/\b(?:user|from)\s+["“]?([^"”\s]+)["”]?\s*$/i);
      userName = m ? m[1] : null;
    }
    const device = kind === 'failed' ? null : e.Name.match(/\bfrom\s+(.+)$/i)?.[1]?.trim() ?? null;
    const res = insert.run(e.Id, at, kind, userId, userName, ip || null, geo.isLocal ? 1 : 0, device, geo.country, geo.countryCode, geo.city, geo.lat, geo.lon, e.Name);
    if (!res.changes) continue;
    if (kind === 'signin' && userId) db.prepare('UPDATE media_users SET last_login_at = MAX(COALESCE(last_login_at, 0), ?) WHERE id = ?').run(at, userId);
    if (!live) {
      if (userId && ip) recordIp(userId, ip, at);
      continue;
    }
    try {
      if (kind === 'failed' && ip) onFailedSignIn(at, ip, userName, userId);
      if ((kind === 'signin' || kind === 'session') && userId && userName) {
        const ctx = { userId, userName, at, ip, geo };
        const rec = ip ? recordIp(userId, ip, at) : null;
        if (kind === 'signin') onSignIn(ctx);
        if (rec?.isNew) onNewIp(ctx);
      }
    } catch (err) {
      log.error(err);
    }
  }
}

export async function syncActivityLog(log: Log) {
  if (!jellyfinReady()) return;
  const cursor = getState<{ date: string } | null>('jf:activity', null);
  // First run: read the last 30 days without raising alerts for old events.
  const live = !!cursor;
  const minDate = cursor ? new Date(Date.parse(cursor.date) - 60_000).toISOString() : new Date(Date.now() - 30 * 86_400_000).toISOString();
  let start = 0;
  let newest = cursor?.date ?? minDate;
  for (let page = 0; page < 25; page++) {
    const res = await jfApi.activity(minDate, start, 200);
    const items = res.Items ?? [];
    if (!items.length) break;
    const tx = getDb().transaction(() => processActivity(items, live, log));
    tx();
    for (const i of items) if (i.Date > newest) newest = i.Date;
    start += items.length;
    if (start >= (res.TotalRecordCount ?? 0)) break;
  }
  setState('jf:activity', { date: newest });
}

// ---------------------------------------------------------------------------
// Seerr requests
// ---------------------------------------------------------------------------

interface SeerrUser {
  id: number;
  displayName?: string;
  email?: string;
  jellyfinUserId?: string;
  jellyfinUsername?: string;
}

interface SeerrRequest {
  id: number;
  status: number;
  type: 'movie' | 'tv';
  is4k?: boolean;
  createdAt: string;
  updatedAt?: string;
  media?: { tmdbId?: number; tvdbId?: number; status?: number; jellyfinMediaId?: string; jellyfinMediaId4k?: string; mediaType?: string };
  requestedBy?: SeerrUser;
  seasons?: { seasonNumber: number; status?: number }[];
}

function seerr<T>(path: string): Promise<T> {
  const c = connectionFor('seerr');
  if (!c) throw new Error('Seerr is not connected.');
  return httpJson<T>(joinUrl(c.url, path), { headers: { 'X-Api-Key': c.apiKey }, timeoutMs: 20_000 });
}

export async function syncSeerr(log: Log) {
  if (!connectionFor('seerr')) return;
  const db = getDb();

  // Link Seerr accounts to Jellyfin accounts.
  const users = await seerr<{ results: SeerrUser[] }>('/api/v1/user?take=1000&skip=0');
  const tx1 = db.transaction(() => {
    for (const u of users.results ?? []) {
      if (!u.jellyfinUserId) continue;
      db.prepare('UPDATE media_users SET seerr_user_id = ?, seerr_name = ?, email = COALESCE(?, email) WHERE id = ?').run(
        u.id,
        u.displayName ?? null,
        u.email ?? null,
        u.jellyfinUserId.replace(/-/g, ''),
      );
    }
  });
  tx1();

  // Requests, newest first, until we reach ones we've already seen unchanged.
  const take = 100;
  for (let skip = 0; skip < 10_000; skip += take) {
    const page = await seerr<{ results: SeerrRequest[]; pageInfo?: { results?: number } }>(`/api/v1/request?take=${take}&skip=${skip}&sort=added&filter=all`);
    const rows = page.results ?? [];
    const tx = db.transaction(() => {
      for (const r of rows) {
        const jf = r.is4k ? r.media?.jellyfinMediaId4k ?? r.media?.jellyfinMediaId : r.media?.jellyfinMediaId;
        db.prepare(
          `INSERT INTO requests (id, type, status, media_status, tmdb_id, tvdb_id, jellyfin_media_id, requested_by_seerr, requested_by_name,
             requested_by_jf, is4k, seasons, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET status = excluded.status, media_status = excluded.media_status,
             jellyfin_media_id = excluded.jellyfin_media_id, requested_by_name = excluded.requested_by_name,
             requested_by_jf = excluded.requested_by_jf, seasons = excluded.seasons, updated_at = excluded.updated_at`,
        ).run(
          r.id,
          r.type,
          r.status,
          r.media?.status ?? null,
          r.media?.tmdbId ?? null,
          r.media?.tvdbId ?? null,
          jf ? jf.replace(/-/g, '') : null,
          r.requestedBy?.id ?? null,
          r.requestedBy?.displayName ?? r.requestedBy?.jellyfinUsername ?? null,
          r.requestedBy?.jellyfinUserId ? r.requestedBy.jellyfinUserId.replace(/-/g, '') : null,
          r.is4k ? 1 : 0,
          r.seasons?.length ? JSON.stringify(r.seasons.map((s) => s.seasonNumber)) : null,
          Date.parse(r.createdAt) || Date.now(),
          r.updatedAt ? Date.parse(r.updatedAt) : null,
        );
      }
    });
    tx();
    if (rows.length < take) break;
  }

  // Titles and posters for anything we haven't looked up yet (a few per run).
  const missing = db
    .prepare(
      `SELECT DISTINCT r.type, r.tmdb_id FROM requests r LEFT JOIN seerr_media m ON m.key = r.type || ':' || r.tmdb_id
       WHERE r.tmdb_id IS NOT NULL AND (m.key IS NULL OR (m.title IS NULL AND m.fetched_at < ?)) LIMIT 60`,
    )
    .all(Date.now() - 86_400_000) as { type: string; tmdb_id: number }[];
  for (const m of missing) {
    try {
      const d = await seerr<{ title?: string; name?: string; posterPath?: string; releaseDate?: string; firstAirDate?: string }>(
        `/api/v1/${m.type === 'tv' ? 'tv' : 'movie'}/${m.tmdb_id}`,
      );
      const date = d.releaseDate ?? d.firstAirDate;
      db.prepare('INSERT OR REPLACE INTO seerr_media (key, title, year, poster, fetched_at) VALUES (?, ?, ?, ?, ?)').run(
        `${m.type}:${m.tmdb_id}`,
        d.title ?? d.name ?? null,
        date ? Number(date.slice(0, 4)) : null,
        d.posterPath ?? null,
        Date.now(),
      );
    } catch (err) {
      db.prepare('INSERT OR REPLACE INTO seerr_media (key, title, year, poster, fetched_at) VALUES (?, NULL, NULL, NULL, ?)').run(`${m.type}:${m.tmdb_id}`, Date.now());
      log.warn(`Seerr lookup failed for ${m.type} ${m.tmdb_id}: ${(err as Error).message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

const status: Record<string, { lastOkAt: number | null; lastError: string | null }> = {};

export function syncStatus() {
  return status;
}

async function run(name: string, fn: () => Promise<void>, log: Log) {
  try {
    await fn();
    status[name] = { lastOkAt: Date.now(), lastError: null };
  } catch (err) {
    status[name] = { lastOkAt: status[name]?.lastOkAt ?? null, lastError: (err as Error).message };
    log.warn(`${name} sync failed: ${(err as Error).message}`);
  }
}

export function startSync(log: Log) {
  const every = (name: string, ms: number, fn: () => Promise<void>, firstDelay = 2000) => {
    setTimeout(() => void run(name, fn, log), firstDelay).unref();
    setInterval(() => void run(name, fn, log), ms).unref();
  };
  every('users', 10 * 60_000, syncUsers, 1000);
  every('devices', 15 * 60_000, syncDevices, 4000);
  every('signins', 60_000, () => syncActivityLog(log), 6000);
  every('seerr', 15 * 60_000, () => syncSeerr(log), 8000);
}

/** Runs every sync right away (used after connecting an app). */
export async function syncAllNow(log: Log) {
  await run('users', syncUsers, log);
  await run('devices', syncDevices, log);
  await run('signins', () => syncActivityLog(log), log);
  await run('seerr', () => syncSeerr(log), log);
}

export { onNewDevice, deviceCount };
