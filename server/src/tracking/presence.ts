import { getDb } from '../db/index.js';
import { lookupIp, type GeoResult } from '../geo/index.js';
import { normalizeIp } from '../lib/ip.js';

/** Strips the port from Jellyfin's RemoteEndPoint ("1.2.3.4:5678" or "[::1]:80"). */
export function endpointIp(endpoint?: string | null): string {
  if (!endpoint) return '';
  let e = endpoint.trim();
  const bracket = e.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracket) return normalizeIp(bracket[1]);
  // IPv4 with port
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(e)) e = e.slice(0, e.lastIndexOf(':'));
  return normalizeIp(e);
}

export interface IpRecord {
  geo: GeoResult;
  isNew: boolean;
}

/** Notes that a person connected from an address. */
export function recordIp(userId: string, ip: string, at: number): IpRecord {
  const geo = lookupIp(ip);
  if (!ip) return { geo, isNew: false };
  const db = getDb();
  const existing = db.prepare('SELECT last_seen_at FROM user_ips WHERE user_id = ? AND ip = ?').get(userId, ip) as
    | { last_seen_at: number }
    | undefined;
  if (existing) {
    // Only bump the counter when a new visit starts (30+ minutes since last seen).
    db.prepare(
      `UPDATE user_ips SET last_seen_at = MAX(last_seen_at, ?), times = times + (CASE WHEN ? - last_seen_at > 1800000 THEN 1 ELSE 0 END),
         country = COALESCE(?, country), country_code = COALESCE(?, country_code), region = COALESCE(?, region),
         city = COALESCE(?, city), lat = COALESCE(?, lat), lon = COALESCE(?, lon)
       WHERE user_id = ? AND ip = ?`,
    ).run(at, at, geo.country, geo.countryCode, geo.region, geo.city, geo.lat, geo.lon, userId, ip);
    return { geo, isNew: false };
  }
  db.prepare(
    `INSERT INTO user_ips (user_id, ip, first_seen_at, last_seen_at, times, is_local, country, country_code, region, city, lat, lon)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(userId, ip, at, at, geo.isLocal ? 1 : 0, geo.country, geo.countryCode, geo.region, geo.city, geo.lat, geo.lon);
  return { geo, isNew: true };
}

/** Notes that a person used a device. Returns true the first time. */
export function recordDevice(
  userId: string,
  d: { id?: string; name?: string; client?: string; version?: string; ip?: string },
  at: number,
): boolean {
  if (!d.id) return false;
  const db = getDb();
  const existed = !!db.prepare('SELECT 1 FROM devices WHERE device_id = ? AND user_id = ?').get(d.id, userId);
  db
    .prepare(
      `INSERT INTO devices (device_id, user_id, name, client, client_version, first_seen_at, last_seen_at, last_ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(device_id, user_id) DO UPDATE SET
         name = COALESCE(excluded.name, name), client = COALESCE(excluded.client, client),
         client_version = COALESCE(excluded.client_version, client_version),
         last_seen_at = MAX(last_seen_at, excluded.last_seen_at), last_ip = COALESCE(excluded.last_ip, last_ip)`,
    )
    .run(d.id, userId, d.name ?? null, d.client ?? null, d.version ?? null, at, at, d.ip || null);
  return !existed;
}

export function deviceCount(userId: string): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM devices WHERE user_id = ?').get(userId) as { n: number }).n;
}
