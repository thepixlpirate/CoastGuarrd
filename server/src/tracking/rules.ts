import { getDb } from '../db/index.js';
import { distanceKm, placeLabel, type GeoResult } from '../geo/index.js';
import { getSetting, type RuleToggle } from '../lib/settings.js';

export type RuleId =
  | 'impossibleTravel'
  | 'simultaneousLocations'
  | 'concurrentStreams'
  | 'ipVelocity'
  | 'newDevice'
  | 'newCountry'
  | 'failedSignIns';

export const RULE_LABELS: Record<RuleId, string> = {
  impossibleTravel: 'Impossible travel',
  simultaneousLocations: 'Two places at once',
  concurrentStreams: 'Too many streams',
  ipVelocity: 'Many addresses',
  newDevice: 'New device',
  newCountry: 'New country',
  failedSignIns: 'Failed sign-ins',
};

/** How much each unresolved alert lowers a person's trust score (out of 100). */
export const SEVERITY_WEIGHT = { info: 2, warning: 10, critical: 25 } as const;

const DEDUPE_MS = 6 * 3_600_000;

export interface EventCtx {
  userId: string;
  userName: string;
  at: number;
  ip: string;
  geo: GeoResult;
  playId?: number;
}

function rule<K extends keyof ReturnType<typeof getSetting<'tracking'>>['rules']>(k: K) {
  return getSetting('tracking').rules[k];
}

function raise(id: RuleId, cfg: RuleToggle, ctx: { userId?: string | null; userName?: string | null; at: number; playId?: number }, title: string, detail: Record<string, unknown>, dedupe: string) {
  const db = getDb();
  const key = `${id}:${ctx.userId ?? ''}:${dedupe}`;
  const recent = db.prepare('SELECT 1 FROM alerts WHERE dedupe_key = ? AND at > ?').get(key, ctx.at - DEDUPE_MS);
  if (recent) return;
  db.prepare(
    `INSERT INTO alerts (at, user_id, user_name, rule, severity, title, detail, dedupe_key, play_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(ctx.at, ctx.userId ?? null, ctx.userName ?? null, id, cfg.severity, title, JSON.stringify(detail), key, ctx.playId ?? null);
}

interface Located {
  at: number;
  ip: string;
  lat: number | null;
  lon: number | null;
  is_local: number;
  city: string | null;
  region: string | null;
  country: string | null;
}

/** The most recent earlier activity for a person that has a known place. */
function previousLocated(userId: string, before: number, excludePlayId?: number): Located | null {
  const db = getDb();
  const play = db
    .prepare(
      `SELECT last_seen_at AS at, ip, lat, lon, is_local, city, region, country FROM plays
       WHERE user_id = ? AND id != ? AND started_at < ? AND ip IS NOT NULL AND ip != '' AND (lat IS NOT NULL OR is_local = 1)
       ORDER BY last_seen_at DESC LIMIT 1`,
    )
    .get(userId, excludePlayId ?? -1, before) as Located | undefined;
  const sign = db
    .prepare(
      `SELECT at, ip, lat, lon, is_local, city, NULL AS region, country FROM sign_ins
       WHERE user_id = ? AND at < ? AND kind != 'failed' AND ip IS NOT NULL AND (lat IS NOT NULL OR is_local = 1)
       ORDER BY at DESC LIMIT 1`,
    )
    .get(userId, before) as Located | undefined;
  if (!play) return sign ?? null;
  if (!sign) return play;
  return play.at >= sign.at ? play : sign;
}

function checkImpossibleTravel(ctx: EventCtx) {
  const cfg = rule('impossibleTravel');
  if (!cfg.enabled || ctx.geo.isLocal || ctx.geo.lat == null || ctx.geo.lon == null) return;
  const prev = previousLocated(ctx.userId, ctx.at, ctx.playId);
  if (!prev || prev.is_local || prev.lat == null || prev.lon == null || prev.ip === ctx.ip) return;
  const km = distanceKm(prev.lat, prev.lon, ctx.geo.lat, ctx.geo.lon);
  if (km < 100) return; // location databases are fuzzy; ignore short hops
  const hours = Math.max((ctx.at - prev.at) / 3_600_000, 0.05);
  const kmh = km / hours;
  if (kmh <= cfg.kmh) return;
  raise(
    'impossibleTravel',
    cfg,
    ctx,
    `${ctx.userName} appeared ${Math.round(km).toLocaleString()} km away in ${hours < 1 ? `${Math.round(hours * 60)} min` : `${hours.toFixed(1)} hr`}`,
    {
      from: placeLabel(prev),
      to: placeLabel(ctx.geo),
      fromIp: prev.ip,
      toIp: ctx.ip,
      km: Math.round(km),
      hours: Number(hours.toFixed(2)),
      kmh: Math.round(kmh),
    },
    `${prev.ip}>${ctx.ip}`,
  );
}

interface OpenPlay {
  id: number;
  ip: string | null;
  is_local: number;
  lat: number | null;
  lon: number | null;
  city: string | null;
  region: string | null;
  country: string | null;
  device_name: string | null;
  item_name: string;
}

function openPlays(userId: string, now: number): OpenPlay[] {
  return getDb()
    .prepare(
      `SELECT id, ip, is_local, lat, lon, city, region, country, device_name, item_name FROM plays
       WHERE user_id = ? AND stopped_at IS NULL AND source = 'live' AND last_seen_at > ?`,
    )
    .all(userId, now - 3 * 60_000) as OpenPlay[];
}

function checkSimultaneous(ctx: EventCtx) {
  const cfg = rule('simultaneousLocations');
  if (!cfg.enabled || !ctx.ip) return;
  for (const other of openPlays(ctx.userId, ctx.at)) {
    if (other.id === ctx.playId || !other.ip || other.ip === ctx.ip) continue;
    let far = false;
    let km: number | null = null;
    if (!!other.is_local !== ctx.geo.isLocal) {
      far = true; // one stream at home, one from outside
    } else if (!ctx.geo.isLocal && other.lat != null && other.lon != null && ctx.geo.lat != null && ctx.geo.lon != null) {
      km = distanceKm(other.lat, other.lon, ctx.geo.lat, ctx.geo.lon);
      far = km >= cfg.km;
    }
    if (!far) continue;
    const a = placeLabel({ ...other, isLocal: other.is_local });
    const b = placeLabel(ctx.geo);
    raise(
      'simultaneousLocations',
      cfg,
      ctx,
      `${ctx.userName} is streaming from two places at once`,
      { places: [a, b], ips: [other.ip, ctx.ip], km: km == null ? null : Math.round(km), devices: [other.device_name] },
      [other.ip, ctx.ip].sort().join('|'),
    );
  }
}

function checkConcurrent(ctx: EventCtx) {
  const cfg = rule('concurrentStreams');
  if (!cfg.enabled) return;
  const user = getDb().prepare('SELECT stream_limit FROM media_users WHERE id = ?').get(ctx.userId) as { stream_limit: number | null } | undefined;
  const limit = user?.stream_limit ?? cfg.max;
  if (limit <= 0) return;
  const open = openPlays(ctx.userId, ctx.at);
  if (open.length <= limit) return;
  raise(
    'concurrentStreams',
    cfg,
    ctx,
    `${ctx.userName} is running ${open.length} streams at once (limit ${limit})`,
    { count: open.length, limit, titles: open.map((p) => p.item_name), devices: open.map((p) => p.device_name) },
    String(open.length),
  );
}

function checkIpVelocity(ctx: EventCtx) {
  const cfg = rule('ipVelocity');
  if (!cfg.enabled || ctx.geo.isLocal) return;
  const rows = getDb()
    .prepare(`SELECT ip FROM user_ips WHERE user_id = ? AND is_local = 0 AND last_seen_at > ?`)
    .all(ctx.userId, ctx.at - cfg.hours * 3_600_000) as { ip: string }[];
  if (rows.length < cfg.count) return;
  raise(
    'ipVelocity',
    cfg,
    ctx,
    `${ctx.userName} used ${rows.length} different internet addresses in ${cfg.hours} hours`,
    { count: rows.length, hours: cfg.hours, ips: rows.map((r) => r.ip).slice(0, 20) },
    String(Math.floor(ctx.at / (cfg.hours * 3_600_000))),
  );
}

function checkNewCountry(ctx: EventCtx) {
  const cfg = rule('newCountry');
  if (!cfg.enabled || ctx.geo.isLocal || !ctx.geo.countryCode) return;
  const rows = getDb()
    .prepare(`SELECT DISTINCT country_code FROM user_ips WHERE user_id = ? AND ip != ? AND country_code IS NOT NULL`)
    .all(ctx.userId, ctx.ip) as { country_code: string }[];
  if (rows.length === 0 || rows.some((r) => r.country_code === ctx.geo.countryCode)) return;
  raise(
    'newCountry',
    cfg,
    ctx,
    `${ctx.userName} connected from a new country: ${ctx.geo.country}`,
    { country: ctx.geo.country, place: placeLabel(ctx.geo), ip: ctx.ip, knownCountries: rows.map((r) => r.country_code) },
    ctx.geo.countryCode,
  );
}

// ---------------------------------------------------------------------------
// Public hooks
// ---------------------------------------------------------------------------

/** A new stream started. */
export function onPlayStart(ctx: EventCtx) {
  checkConcurrent(ctx);
  checkSimultaneous(ctx);
  checkImpossibleTravel(ctx);
}

/** A person was seen at an address for the first time. */
export function onNewIp(ctx: EventCtx) {
  checkNewCountry(ctx);
  checkIpVelocity(ctx);
}

/** A successful sign-in from Jellyfin's log. */
export function onSignIn(ctx: EventCtx) {
  checkImpossibleTravel(ctx);
}

export function onNewDevice(ctx: EventCtx & { deviceName?: string; client?: string }, hadDevicesBefore: boolean) {
  const cfg = rule('newDevice');
  if (!cfg.enabled || !hadDevicesBefore) return;
  raise(
    'newDevice',
    cfg,
    ctx,
    `${ctx.userName} used a new device: ${[ctx.deviceName, ctx.client].filter(Boolean).join(' · ') || 'unknown'}`,
    { device: ctx.deviceName, client: ctx.client, ip: ctx.ip, place: placeLabel(ctx.geo) },
    `${ctx.deviceName}|${ctx.client}`,
  );
}

export function onFailedSignIn(at: number, ip: string, userName: string | null, userId: string | null) {
  const cfg = rule('failedSignIns');
  if (!cfg.enabled) return;
  const since = at - cfg.minutes * 60_000;
  const n = (getDb().prepare(`SELECT COUNT(*) AS n FROM sign_ins WHERE kind = 'failed' AND ip = ? AND at > ? AND at <= ?`).get(ip, since, at) as { n: number }).n;
  if (n < cfg.count) return;
  raise(
    'failedSignIns',
    cfg,
    { userId, userName, at },
    `${n} failed Jellyfin sign-ins from ${ip}${userName ? ` (trying “${userName}”)` : ''}`,
    { ip, count: n, minutes: cfg.minutes, userName },
    ip,
  );
}

/** Trust score 0–100: lowered by alerts in the last 30 days that weren't marked "not a problem". */
export function trustScores(): Map<string, number> {
  const rows = getDb()
    .prepare(`SELECT user_id, severity, COUNT(*) AS n FROM alerts WHERE user_id IS NOT NULL AND dismissed = 0 AND at > ? GROUP BY user_id, severity`)
    .all(Date.now() - 30 * 86_400_000) as { user_id: string; severity: keyof typeof SEVERITY_WEIGHT; n: number }[];
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.user_id, (out.get(r.user_id) ?? 0) + (SEVERITY_WEIGHT[r.severity] ?? 5) * r.n);
  for (const [k, v] of out) out.set(k, Math.max(0, 100 - v));
  return out;
}
