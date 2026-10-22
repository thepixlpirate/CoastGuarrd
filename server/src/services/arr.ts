import { httpJson, joinUrl } from './http.js';
import { connectionFor } from './store.js';

export type ArrId = 'radarr' | 'sonarr' | 'lidarr';
const API: Record<ArrId, string> = { radarr: '/api/v3', sonarr: '/api/v3', lidarr: '/api/v1' };

export function arrReady(id: ArrId): boolean {
  return !!connectionFor(id);
}

export async function arr<T>(id: ArrId, path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const c = connectionFor(id);
  if (!c) throw new Error(`${id} is not connected.`);
  return httpJson<T>(joinUrl(c.url, API[id] + path), {
    timeoutMs: 30_000,
    ...init,
    headers: { 'X-Api-Key': c.apiKey, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) },
  });
}

export interface ArrMovie {
  id: number;
  title: string;
  sortTitle?: string;
  year?: number;
  tmdbId?: number;
  imdbId?: string;
  path?: string;
  sizeOnDisk?: number;
  monitored?: boolean;
  added?: string;
  tags?: number[];
  genres?: string[];
  hasFile?: boolean;
  ratings?: { imdb?: { value?: number }; tmdb?: { value?: number }; value?: number };
}

export interface ArrSeries {
  id: number;
  title: string;
  sortTitle?: string;
  year?: number;
  tvdbId?: number;
  tmdbId?: number;
  imdbId?: string;
  path?: string;
  monitored?: boolean;
  added?: string;
  tags?: number[];
  genres?: string[];
  status?: string;
  ended?: boolean;
  ratings?: { value?: number };
  statistics?: { sizeOnDisk?: number; episodeFileCount?: number };
  seasons?: { seasonNumber: number; monitored: boolean }[];
}

export interface ArrArtist {
  id: number;
  artistName: string;
  sortName?: string;
  path?: string;
  monitored?: boolean;
  added?: string;
  tags?: number[];
  genres?: string[];
  ratings?: { value?: number };
  statistics?: { sizeOnDisk?: number };
}

export async function arrTags(id: ArrId): Promise<Map<number, string>> {
  const tags = await arr<{ id: number; label: string }[]>(id, '/tag');
  return new Map(tags.map((t) => [t.id, t.label.toLowerCase()]));
}

const ENTITY: Record<ArrId, string> = { radarr: 'movie', sonarr: 'series', lidarr: 'artist' };

/** Turns monitoring on/off. Returns what it was before. */
export async function setMonitored(id: ArrId, itemId: number, monitored: boolean): Promise<boolean> {
  const path = `/${ENTITY[id]}/${itemId}`;
  const item = await arr<Record<string, unknown> & { monitored?: boolean; seasons?: { monitored: boolean }[] }>(id, path);
  const before = !!item.monitored;
  item.monitored = monitored;
  if (id === 'sonarr' && Array.isArray(item.seasons) && !monitored) {
    for (const s of item.seasons) s.monitored = false;
  }
  await arr(id, path, { method: 'PUT', body: JSON.stringify(item) });
  return before;
}

/** Asks the app to look at the files on disk again. */
export async function rescan(id: ArrId, itemId: number) {
  const body =
    id === 'radarr' ? { name: 'RescanMovie', movieId: itemId } : id === 'sonarr' ? { name: 'RescanSeries', seriesId: itemId } : { name: 'RefreshArtist', artistId: itemId };
  await arr(id, '/command', { method: 'POST', body: JSON.stringify(body) });
}

/** Removes the entry from the app (never deletes files — CoastGuarrd handles those). */
export async function removeEntry(id: ArrId, itemId: number, addExclusion: boolean) {
  const excl = id === 'sonarr' ? 'addImportListExclusion' : id === 'radarr' ? 'addImportExclusion' : 'addImportListExclusion';
  await arr(id, `/${ENTITY[id]}/${itemId}?deleteFiles=false&${excl}=${addExclusion}`, { method: 'DELETE' });
}
