import path from 'node:path';
import { getDb } from '../db/index.js';
import { jellyfinReady, jf, type JfItem } from '../jellyfin/client.js';
import { arr, arrReady, arrTags, type ArrArtist, type ArrMovie, type ArrSeries } from '../services/arr.js';
import { setState } from '../lib/state.js';
import { diskUsage, toLocal } from './locate.js';

/**
 * Builds one list of everything in the library by merging Jellyfin with
 * Radarr (movies), Sonarr (shows) and Lidarr (music artists).
 */

interface Item {
  key: string;
  kind: 'movie' | 'show' | 'music';
  jf_id: string | null;
  title: string;
  sort_title: string | null;
  year: number | null;
  library: string | null;
  path: string | null;
  path_service: string | null;
  size_bytes: number | null;
  added_at: number | null;
  tmdb_id: number | null;
  tvdb_id: number | null;
  imdb_id: string | null;
  genres: string[];
  tags: string[];
  rating: number | null;
  official_rating: string | null;
  ended: number | null;
  arr_service: string | null;
  arr_id: number | null;
  arr_monitored: number | null;
  favorite_of: string[];
}

type JfLibItem = JfItem & {
  Path?: string;
  DateCreated?: string;
  ProviderIds?: Record<string, string>;
  Genres?: string[];
  Tags?: string[];
  CommunityRating?: number;
  OfficialRating?: string;
  SortName?: string;
  Status?: string;
};

const KIND: Record<string, Item['kind']> = { Movie: 'movie', Series: 'show', MusicArtist: 'music' };

async function jfItemsForUserOrAll(q: string, userId?: string) {
  const out: JfLibItem[] = [];
  for (let start = 0; start < 200_000; start += 500) {
    const page = await jf<{ Items: JfLibItem[]; TotalRecordCount: number }>(`/Items?${q}${userId ? `&userId=${userId}` : ''}&StartIndex=${start}&Limit=500`, { timeoutMs: 60_000 });
    out.push(...(page.Items ?? []));
    if ((page.Items ?? []).length < 500) break;
  }
  return out;
}

function baseName(p?: string | null) {
  return p ? path.basename(p.replace(/\\/g, '/').replace(/\/+$/, '')).toLowerCase() : '';
}

let running: Promise<{ items: number }> | null = null;

export function syncLibrary(): Promise<{ items: number }> {
  if (running) return running;
  running = doSync().finally(() => {
    running = null;
  });
  return running;
}

async function doSync(): Promise<{ items: number }> {
  const items = new Map<string, Item>();
  const byTmdb = new Map<string, Item>();
  const byTvdb = new Map<number, Item>();
  const byBase = new Map<string, Item>();
  const byName = new Map<string, Item>();

  // ---- Jellyfin -------------------------------------------------------
  if (jellyfinReady()) {
    const libs = await jf<{ Name: string; ItemId: string; CollectionType?: string }[]>('/Library/VirtualFolders');
    const fields = 'ProviderIds,Path,DateCreated,Genres,Tags,CommunityRating,OfficialRating,ProductionYear,SortName,Status';
    for (const lib of libs) {
      const ct = (lib.CollectionType ?? '').toLowerCase();
      const types = ct === 'movies' ? 'Movie' : ct === 'tvshows' ? 'Series' : ct === 'music' ? 'MusicArtist' : ct ? '' : 'Movie,Series';
      if (!types) continue;
      const list = await jfItemsForUserOrAll(`ParentId=${lib.ItemId}&Recursive=true&IncludeItemTypes=${types}&Fields=${fields}&EnableImages=false`);
      for (const i of list) {
        const kind = KIND[i.Type];
        if (!kind) continue;
        const p = i.ProviderIds ?? {};
        const it: Item = {
          key: `jf:${i.Id}`,
          kind,
          jf_id: i.Id,
          title: i.Name,
          sort_title: i.SortName ?? null,
          year: i.ProductionYear ?? null,
          library: lib.Name,
          path: i.Path ?? null,
          path_service: i.Path ? 'jellyfin' : null,
          size_bytes: null,
          added_at: i.DateCreated ? Date.parse(i.DateCreated) : null,
          tmdb_id: Number(p.Tmdb) || null,
          tvdb_id: Number(p.Tvdb) || null,
          imdb_id: p.Imdb ?? null,
          genres: i.Genres ?? [],
          tags: (i.Tags ?? []).map((t) => t.toLowerCase()),
          rating: i.CommunityRating ?? null,
          official_rating: i.OfficialRating ?? null,
          ended: i.Status ? (i.Status === 'Ended' ? 1 : 0) : null,
          arr_service: null,
          arr_id: null,
          arr_monitored: null,
          favorite_of: [],
        };
        items.set(it.key, it);
        if (it.tmdb_id) byTmdb.set(`${kind}:${it.tmdb_id}`, it);
        if (it.tvdb_id && kind === 'show') byTvdb.set(it.tvdb_id, it);
        if (it.path) byBase.set(`${kind}:${baseName(kind === 'movie' ? path.dirname(it.path) : it.path)}`, it);
        if (kind === 'music') byName.set(it.title.toLowerCase(), it);
      }
    }

    // Favourites, per person.
    const users = getDb().prepare('SELECT id, name FROM media_users WHERE removed = 0').all() as { id: string; name: string }[];
    for (const u of users) {
      try {
        const favs = await jfItemsForUserOrAll('Recursive=true&Filters=IsFavorite&IncludeItemTypes=Movie,Series,MusicArtist&EnableImages=false', u.id);
        for (const f of favs) items.get(`jf:${f.Id}`)?.favorite_of.push(u.name);
      } catch {
        /* older servers: skip favourites */
      }
    }
  }

  // ---- Radarr ---------------------------------------------------------
  if (arrReady('radarr')) {
    const tags = await arrTags('radarr');
    const movies = await arr<ArrMovie[]>('radarr', '/movie', { timeoutMs: 120_000 });
    for (const m of movies) {
      const match = (m.tmdbId && byTmdb.get(`movie:${m.tmdbId}`)) || byBase.get(`movie:${baseName(m.path)}`);
      if (!match && !m.hasFile) continue;
      const it: Item = match ?? {
        key: `radarr:${m.id}`, kind: 'movie', jf_id: null, title: m.title, sort_title: m.sortTitle ?? null, year: m.year ?? null, library: null,
        path: null, path_service: null, size_bytes: null, added_at: m.added ? Date.parse(m.added) : null, tmdb_id: m.tmdbId ?? null, tvdb_id: null,
        imdb_id: m.imdbId ?? null, genres: m.genres ?? [], tags: [], rating: m.ratings?.tmdb?.value ?? m.ratings?.imdb?.value ?? null, official_rating: null,
        ended: null, arr_service: null, arr_id: null, arr_monitored: null, favorite_of: [],
      };
      it.arr_service = 'radarr';
      it.arr_id = m.id;
      it.arr_monitored = m.monitored ? 1 : 0;
      if (m.path) {
        it.path = m.path;
        it.path_service = 'radarr';
      }
      if (m.sizeOnDisk != null) it.size_bytes = m.sizeOnDisk;
      it.tags = [...new Set([...it.tags, ...(m.tags ?? []).map((t) => tags.get(t) ?? String(t))])];
      if (!it.added_at && m.added) it.added_at = Date.parse(m.added);
      if (!it.tmdb_id && m.tmdbId) it.tmdb_id = m.tmdbId;
      items.set(it.key, it);
    }
  }

  // ---- Sonarr ---------------------------------------------------------
  if (arrReady('sonarr')) {
    const tags = await arrTags('sonarr');
    const series = await arr<ArrSeries[]>('sonarr', '/series', { timeoutMs: 120_000 });
    for (const s of series) {
      const match = (s.tvdbId && byTvdb.get(s.tvdbId)) || (s.tmdbId && byTmdb.get(`show:${s.tmdbId}`)) || byBase.get(`show:${baseName(s.path)}`);
      if (!match && !s.statistics?.episodeFileCount) continue;
      const it: Item = match ?? {
        key: `sonarr:${s.id}`, kind: 'show', jf_id: null, title: s.title, sort_title: s.sortTitle ?? null, year: s.year ?? null, library: null,
        path: null, path_service: null, size_bytes: null, added_at: s.added ? Date.parse(s.added) : null, tmdb_id: s.tmdbId ?? null, tvdb_id: s.tvdbId ?? null,
        imdb_id: s.imdbId ?? null, genres: s.genres ?? [], tags: [], rating: s.ratings?.value ?? null, official_rating: null,
        ended: null, arr_service: null, arr_id: null, arr_monitored: null, favorite_of: [],
      };
      it.arr_service = 'sonarr';
      it.arr_id = s.id;
      it.arr_monitored = s.monitored ? 1 : 0;
      if (s.path) {
        it.path = s.path;
        it.path_service = 'sonarr';
      }
      if (s.statistics?.sizeOnDisk != null) it.size_bytes = s.statistics.sizeOnDisk;
      it.tags = [...new Set([...it.tags, ...(s.tags ?? []).map((t) => tags.get(t) ?? String(t))])];
      if (s.ended != null || s.status) it.ended = s.ended || s.status === 'ended' ? 1 : 0;
      if (!it.tmdb_id && s.tmdbId) it.tmdb_id = s.tmdbId;
      if (!it.tvdb_id && s.tvdbId) it.tvdb_id = s.tvdbId;
      items.set(it.key, it);
    }
  }

  // ---- Lidarr (optional) ---------------------------------------------
  if (arrReady('lidarr')) {
    const tags = await arrTags('lidarr');
    const artists = await arr<ArrArtist[]>('lidarr', '/artist', { timeoutMs: 120_000 });
    for (const a of artists) {
      const match = byName.get(a.artistName.toLowerCase());
      if (!match && !a.statistics?.sizeOnDisk) continue;
      const it: Item = match ?? {
        key: `lidarr:${a.id}`, kind: 'music', jf_id: null, title: a.artistName, sort_title: a.sortName ?? null, year: null, library: null,
        path: null, path_service: null, size_bytes: null, added_at: a.added ? Date.parse(a.added) : null, tmdb_id: null, tvdb_id: null,
        imdb_id: null, genres: a.genres ?? [], tags: [], rating: a.ratings?.value ?? null, official_rating: null,
        ended: null, arr_service: null, arr_id: null, arr_monitored: null, favorite_of: [],
      };
      it.arr_service = 'lidarr';
      it.arr_id = a.id;
      it.arr_monitored = a.monitored ? 1 : 0;
      if (a.path) {
        it.path = a.path;
        it.path_service = 'lidarr';
      }
      if (a.statistics?.sizeOnDisk != null) it.size_bytes = a.statistics.sizeOnDisk;
      it.tags = [...new Set([...it.tags, ...(a.tags ?? []).map((t) => tags.get(t) ?? String(t))])];
      items.set(it.key, it);
    }
  }

  // ---- Save -----------------------------------------------------------
  const db = getDb();
  const now = Date.now();
  const sizes = new Map(
    (db.prepare('SELECT key, size_bytes, size_checked_at FROM media_items').all() as { key: string; size_bytes: number | null; size_checked_at: number | null }[]).map((r) => [r.key, r]),
  );
  // Work out sizes on disk for titles no *arr app reports (cached for a week).
  let budget = 300;
  for (const it of items.values()) {
    if (it.size_bytes != null || !it.path) continue;
    const prev = sizes.get(it.key);
    if (prev?.size_bytes != null && prev.size_checked_at && now - prev.size_checked_at < 7 * 86_400_000) {
      it.size_bytes = prev.size_bytes;
      continue;
    }
    if (budget-- <= 0) continue;
    const loc = toLocal(it.path, it.path_service);
    if (loc) it.size_bytes = diskUsage(it.kind === 'movie' && path.extname(loc.local) ? loc.local : loc.local);
  }

  const upsert = db.prepare(
    `INSERT INTO media_items (key, kind, jf_id, title, sort_title, year, library, path, path_service, size_bytes, size_checked_at, added_at,
       tmdb_id, tvdb_id, imdb_id, genres, tags, rating, official_rating, ended, arr_service, arr_id, arr_monitored, favorite_of, seen_at)
     VALUES (@key, @kind, @jf_id, @title, @sort_title, @year, @library, @path, @path_service, @size_bytes, @size_checked_at, @added_at,
       @tmdb_id, @tvdb_id, @imdb_id, @genres, @tags, @rating, @official_rating, @ended, @arr_service, @arr_id, @arr_monitored, @favorite_of, @seen_at)
     ON CONFLICT(key) DO UPDATE SET kind = excluded.kind, jf_id = excluded.jf_id, title = excluded.title, sort_title = excluded.sort_title,
       year = excluded.year, library = excluded.library, path = excluded.path, path_service = excluded.path_service,
       size_bytes = excluded.size_bytes, size_checked_at = COALESCE(excluded.size_checked_at, size_checked_at), added_at = excluded.added_at,
       tmdb_id = excluded.tmdb_id, tvdb_id = excluded.tvdb_id, imdb_id = excluded.imdb_id, genres = excluded.genres, tags = excluded.tags,
       rating = excluded.rating, official_rating = excluded.official_rating, ended = excluded.ended, arr_service = excluded.arr_service,
       arr_id = excluded.arr_id, arr_monitored = excluded.arr_monitored, favorite_of = excluded.favorite_of, seen_at = excluded.seen_at`,
  );
  const existing = (db.prepare('SELECT COUNT(*) AS n FROM media_items').get() as { n: number }).n;
  // Safety: if every app came back empty, don't wipe the list (and its flags) — something is probably offline.
  const safeToPrune = items.size > 0 || existing === 0;
  const tx = db.transaction(() => {
    for (const it of items.values()) {
      const checked = it.arr_service || it.size_bytes == null ? null : now;
      upsert.run({ ...it, size_checked_at: checked, genres: JSON.stringify(it.genres), tags: JSON.stringify(it.tags), favorite_of: JSON.stringify(it.favorite_of), seen_at: now });
    }
    // Titles that are gone from every app.
    const gone = safeToPrune ? (db.prepare('SELECT key, title FROM media_items WHERE seen_at < ?').all(now) as { key: string; title: string }[]) : [];
    for (const g of gone) {
      const flagged = db.prepare('SELECT id FROM flags WHERE item_key = ?').get(g.key);
      if (flagged) {
        db.prepare('DELETE FROM flags WHERE item_key = ?').run(g.key);
        db.prepare('INSERT INTO cleanup_log (at, item_key, title, action, detail) VALUES (?, ?, ?, ?, ?)').run(now, g.key, g.title, 'gone', 'Removed outside CoastGuarrd');
      }
      db.prepare('DELETE FROM media_items WHERE key = ?').run(g.key);
    }
  });
  tx();
  setState('library:lastSync', { at: now, items: items.size });
  return { items: items.size };
}
