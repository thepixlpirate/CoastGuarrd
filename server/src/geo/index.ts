import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import maxmind, { type CityResponse, type Reader } from 'maxmind';
import { config } from '../config.js';
import { isPrivateIp, normalizeIp } from '../lib/ip.js';
import { getSetting } from '../lib/settings.js';
import { getState, setState } from '../lib/state.js';

/**
 * Offline IP → location lookups. Nothing about your users is ever sent to an
 * outside service: a free location database (DB-IP "IP to City Lite",
 * CC BY 4.0) is downloaded once a month and every lookup happens locally.
 * A MaxMind GeoLite2-City.mmdb dropped into the geoip folder is used instead
 * if present.
 */

export interface GeoResult {
  isLocal: boolean;
  country: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
}

const LOCAL: GeoResult = { isLocal: true, country: null, countryCode: null, region: null, city: 'Local network', lat: null, lon: null };
const EMPTY: GeoResult = { isLocal: false, country: null, countryCode: null, region: null, city: null, lat: null, lon: null };

const geoDir = () => path.join(config.dataDir, 'geoip');
const dbipFile = () => path.join(geoDir(), 'dbip-city-lite.mmdb');
const customFile = () => path.join(geoDir(), 'GeoLite2-City.mmdb');

let reader: Reader<CityResponse> | null = null;
let readerSource: 'maxmind' | 'dbip' | null = null;
let downloading: Promise<void> | null = null;
let lastError: string | null = null;
const cache = new Map<string, GeoResult>();

async function openReader() {
  const file = fs.existsSync(customFile()) ? customFile() : fs.existsSync(dbipFile()) ? dbipFile() : null;
  if (!file) {
    reader = null;
    readerSource = null;
    return;
  }
  reader = await maxmind.open<CityResponse>(file, { watchForUpdates: false });
  readerSource = file === customFile() ? 'maxmind' : 'dbip';
  cache.clear();
}

function monthTag(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Downloads this month's DB-IP City Lite database (falls back to last month's). */
export async function updateGeoDatabase(): Promise<void> {
  if (downloading) return downloading;
  downloading = (async () => {
    fs.mkdirSync(geoDir(), { recursive: true });
    const now = new Date();
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    let lastErr = 'unknown error';
    for (const tag of [monthTag(now), monthTag(prev)]) {
      const url = `https://download.db-ip.com/free/dbip-city-lite-${tag}.mmdb.gz`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000) });
        if (!res.ok || !res.body) {
          lastErr = `download failed (${res.status})`;
          continue;
        }
        const tmp = dbipFile() + '.part';
        await pipeline(Readable.fromWeb(res.body as never), zlib.createGunzip(), fs.createWriteStream(tmp));
        // Make sure the file is a readable database before swapping it in.
        await maxmind.open(tmp);
        fs.renameSync(tmp, dbipFile());
        setState('geo:dbip', { month: tag, downloadedAt: Date.now() });
        lastError = null;
        await openReader();
        return;
      } catch (err) {
        lastErr = (err as Error).message;
      }
    }
    lastError = `Could not download the location database: ${lastErr}`;
    throw new Error(lastError);
  })().finally(() => {
    downloading = null;
  });
  return downloading;
}

export async function initGeo(log: (msg: string) => void) {
  try {
    await openReader();
  } catch (err) {
    lastError = (err as Error).message;
  }
  const maybeUpdate = async () => {
    const s = getSetting('tracking');
    if (!s.geoEnabled || !s.geoAutoUpdate || readerSource === 'maxmind') return;
    const info = getState<{ month: string; downloadedAt: number } | null>('geo:dbip', null);
    const stale = !info || info.month !== monthTag(new Date()) || !fs.existsSync(dbipFile());
    if (!stale) return;
    // Retry at most every 6 hours if this month's file isn't published yet.
    const lastTry = getState<number>('geo:lastTry', 0);
    if (info && Date.now() - lastTry < 6 * 3_600_000) return;
    setState('geo:lastTry', Date.now());
    try {
      await updateGeoDatabase();
      log('Location database updated.');
    } catch (err) {
      log((err as Error).message);
    }
  };
  void maybeUpdate();
  setInterval(() => void maybeUpdate(), 6 * 3_600_000).unref();
}

export function lookupIp(rawIp: string | null | undefined): GeoResult {
  const ip = normalizeIp(rawIp);
  if (!ip) return EMPTY;
  if (isPrivateIp(ip)) return LOCAL;
  if (!getSetting('tracking').geoEnabled || !reader) return EMPTY;
  const hit = cache.get(ip);
  if (hit) return hit;
  let result = EMPTY;
  try {
    const r = reader.get(ip);
    if (r) {
      result = {
        isLocal: false,
        country: r.country?.names?.en ?? r.registered_country?.names?.en ?? null,
        countryCode: r.country?.iso_code ?? r.registered_country?.iso_code ?? null,
        region: r.subdivisions?.[0]?.names?.en ?? null,
        city: r.city?.names?.en ?? null,
        lat: r.location?.latitude ?? null,
        lon: r.location?.longitude ?? null,
      };
    }
  } catch {
    result = EMPTY;
  }
  if (cache.size > 5000) cache.clear();
  cache.set(ip, result);
  return result;
}

export function geoStatus() {
  const info = getState<{ month: string; downloadedAt: number } | null>('geo:dbip', null);
  return {
    ready: !!reader,
    source: readerSource,
    month: readerSource === 'dbip' ? info?.month ?? null : null,
    downloadedAt: info?.downloadedAt ?? null,
    downloading: !!downloading,
    error: lastError,
    customPath: customFile(),
  };
}

/** Great-circle distance in km. */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function placeLabel(g: { city?: string | null; region?: string | null; country?: string | null; isLocal?: boolean | number }): string {
  if (g.isLocal) return 'Local network';
  return [g.city, g.region, g.country].filter(Boolean).join(', ') || 'Unknown location';
}
