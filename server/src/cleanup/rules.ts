import { getDb } from '../db/index.js';
import { getSetting } from '../lib/settings.js';
import { diskUsedPercent, toLocal } from './locate.js';

/**
 * Cleanup rules — Maintainerr/Janitorr style. A rule says which titles count
 * as unwatched (e.g. "nobody has watched it in 180 days and it was added
 * more than 90 days ago"). Matching titles are flagged, shown as Leaving
 * Soon, and after the grace period moved to the recycle bin.
 */

export type Kind = 'movie' | 'show' | 'music';
export type Op = 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'is' | 'contains' | 'notContains';

export interface Condition {
  field: string;
  op: Op;
  value: number | string | boolean;
}

export interface RuleConfig {
  libraries: string[];
  match: 'all' | 'any';
  conditions: Condition[];
  graceDays: number;
  /** Banner wording after "Marked for removal in X days". */
  reason: string;
}

export interface Rule {
  id: number;
  name: string;
  enabled: boolean;
  kind: Kind;
  position: number;
  config: RuleConfig;
}

export interface MediaRow {
  key: string;
  kind: Kind;
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
  genres: string;
  tags: string;
  rating: number | null;
  official_rating: string | null;
  ended: number | null;
  arr_service: string | null;
  arr_id: number | null;
  arr_monitored: number | null;
  favorite_of: string;
}

/** Everything a rule can look at for one title. */
export interface Facts {
  lastWatchedAt: number | null;
  plays: number;
  viewers: number;
  requested: boolean;
  requestedAt: number | null;
  requestedBy: string | null;
  requesterWatched: boolean | null;
  genres: string[];
  tags: string[];
  favoriteOf: string[];
  diskUsed: number | null;
}

type FieldType = 'number' | 'bool' | 'text';

interface FieldDef {
  label: string;
  type: FieldType;
  unit?: string;
  help: string;
  get: (m: MediaRow, f: Facts, now: number) => number | boolean | string[] | string | null;
}

const DAY = 86_400_000;
const days = (ts: number | null, now: number) => (ts == null ? null : Math.floor((now - ts) / DAY));

export const FIELDS: Record<string, FieldDef> = {
  lastWatchedDays: {
    label: 'Days since anyone watched',
    type: 'number',
    unit: 'days',
    help: 'Titles nobody has ever watched count as “forever”.',
    get: (_m, f, now) => (f.lastWatchedAt == null ? Number.POSITIVE_INFINITY : days(f.lastWatchedAt, now)),
  },
  neverWatched: { label: 'Never watched by anyone', type: 'bool', help: 'Not a single play, ever.', get: (_m, f) => f.plays === 0 },
  addedDays: { label: 'Days since added', type: 'number', unit: 'days', help: 'How long it has been in the library.', get: (m, _f, now) => days(m.added_at, now) },
  plays: { label: 'Number of plays', type: 'number', help: 'Total plays by everyone.', get: (_m, f) => f.plays },
  viewers: { label: 'Number of people who watched', type: 'number', help: 'Different people who played it.', get: (_m, f) => f.viewers },
  requested: { label: 'Was requested in Seerr', type: 'bool', help: 'Someone asked for it.', get: (_m, f) => f.requested },
  requestedDays: { label: 'Days since requested', type: 'number', unit: 'days', help: 'Only applies to requested titles.', get: (_m, f, now) => days(f.requestedAt, now) },
  requesterWatched: { label: 'Person who requested it watched it', type: 'bool', help: 'Only applies to requested titles.', get: (_m, f) => f.requesterWatched },
  sizeGb: { label: 'Size on disk', type: 'number', unit: 'GB', help: 'From Radarr/Sonarr/Lidarr, or measured on disk.', get: (m) => (m.size_bytes == null ? null : m.size_bytes / 1024 ** 3) },
  diskUsed: { label: 'Drive is this full', type: 'number', unit: '%', help: 'How full the drive holding it is — clean up only when space runs low.', get: (_m, f) => f.diskUsed },
  rating: { label: 'Rating (0–10)', type: 'number', help: 'Community rating.', get: (m) => m.rating },
  year: { label: 'Release year', type: 'number', help: 'Year it came out.', get: (m) => m.year },
  genre: { label: 'Genre', type: 'text', help: 'e.g. Horror', get: (_m, f) => f.genres },
  tag: { label: 'Tag', type: 'text', help: 'Tags from Radarr/Sonarr/Lidarr or Jellyfin.', get: (_m, f) => f.tags },
  favorited: { label: 'Someone’s favourite', type: 'bool', help: 'Marked as a favourite in Jellyfin.', get: (_m, f) => f.favoriteOf.length > 0 },
  monitored: { label: 'Monitored in Radarr/Sonarr', type: 'bool', help: 'Only for titles managed by an *arr app.', get: (m) => (m.arr_monitored == null ? null : !!m.arr_monitored) },
  ended: { label: 'Show has ended', type: 'bool', help: 'Shows only.', get: (m) => (m.ended == null ? null : !!m.ended) },
};

export function fieldList() {
  return Object.entries(FIELDS).map(([id, f]) => ({ id, label: f.label, type: f.type, unit: f.unit ?? null, help: f.help }));
}

function test(def: FieldDef, raw: ReturnType<FieldDef['get']>, op: Op, value: Condition['value']): boolean {
  if (raw == null) return false;
  if (def.type === 'bool') return raw === (value === true || value === 'true');
  if (def.type === 'text') {
    const list = (Array.isArray(raw) ? raw : [String(raw)]).map((s) => s.toLowerCase());
    const v = String(value).trim().toLowerCase();
    const has = list.some((s) => s === v);
    return op === 'notContains' ? !has : has;
  }
  const n = raw as number;
  const v = Number(value);
  switch (op) {
    case 'gt':
      return n > v;
    case 'gte':
      return n >= v;
    case 'lt':
      return n < v;
    case 'lte':
      return n <= v;
    case 'eq':
      return n === v;
    default:
      return false;
  }
}

function describe(def: FieldDef, raw: ReturnType<FieldDef['get']>): string {
  if (raw === Number.POSITIVE_INFINITY) return 'never';
  if (raw == null) return 'unknown';
  if (typeof raw === 'boolean') return raw ? 'yes' : 'no';
  if (Array.isArray(raw)) return raw.join(', ') || 'none';
  if (typeof raw === 'number') return `${def.unit === 'GB' ? raw.toFixed(1) : Math.round(raw * 10) / 10}${def.unit ? ` ${def.unit}` : ''}`;
  return String(raw);
}

// ---------------------------------------------------------------------------
// Facts for every title, worked out in a few bulk queries
// ---------------------------------------------------------------------------

export function loadItems(): MediaRow[] {
  return getDb().prepare('SELECT * FROM media_items ORDER BY COALESCE(sort_title, title)').all() as MediaRow[];
}

export function buildFacts(items: MediaRow[]): Map<string, Facts> {
  const db = getDb();
  type Agg = { k: string; last: number; n: number; users: number };
  const byItem = new Map((db.prepare('SELECT item_id AS k, MAX(last_seen_at) AS last, COUNT(*) AS n, COUNT(DISTINCT user_id) AS users FROM plays GROUP BY item_id').all() as Agg[]).map((r) => [r.k, r]));
  const bySeries = new Map((db.prepare('SELECT series_id AS k, MAX(last_seen_at) AS last, COUNT(*) AS n, COUNT(DISTINCT user_id) AS users FROM plays WHERE series_id IS NOT NULL GROUP BY series_id').all() as Agg[]).map((r) => [r.k, r]));
  const bySeriesName = new Map(
    (db.prepare(`SELECT LOWER(series_name) AS k, MAX(last_seen_at) AS last, COUNT(*) AS n, COUNT(DISTINCT user_id) AS users FROM plays WHERE item_type = 'Episode' AND series_id IS NULL AND series_name IS NOT NULL GROUP BY LOWER(series_name)`).all() as Agg[]).map((r) => [r.k, r]),
  );
  const byArtist = new Map((db.prepare('SELECT LOWER(artist_name) AS k, MAX(last_seen_at) AS last, COUNT(*) AS n, COUNT(DISTINCT user_id) AS users FROM plays WHERE artist_name IS NOT NULL GROUP BY LOWER(artist_name)').all() as Agg[]).map((r) => [r.k, r]));
  // Users who watched each title (to answer "did the requester watch it").
  const watchers = new Map<string, Set<string>>();
  for (const r of db.prepare(`SELECT DISTINCT user_id, item_id, series_id, LOWER(series_name) AS sname FROM plays`).all() as { user_id: string; item_id: string; series_id: string | null; sname: string | null }[]) {
    for (const k of [r.item_id, r.series_id, r.sname ? `name:${r.sname}` : null]) {
      if (!k) continue;
      let s = watchers.get(k);
      if (!s) watchers.set(k, (s = new Set()));
      s.add(r.user_id);
    }
  }
  type Req = { jf: string | null; tmdb: number | null; type: string; at: number; by: string | null; byName: string | null };
  const reqs = db.prepare('SELECT jellyfin_media_id AS jf, tmdb_id AS tmdb, type, created_at AS at, requested_by_jf AS by, requested_by_name AS byName FROM requests WHERE status != 3 ORDER BY created_at').all() as Req[];
  const reqByJf = new Map<string, Req>();
  const reqByTmdb = new Map<string, Req>();
  for (const r of reqs) {
    if (r.jf) reqByJf.set(r.jf, r);
    if (r.tmdb) reqByTmdb.set(`${r.type === 'tv' ? 'show' : 'movie'}:${r.tmdb}`, r);
  }

  const diskCache = new Map<string, number | null>();
  const out = new Map<string, Facts>();
  for (const m of items) {
    let agg: Agg | undefined;
    if (m.kind === 'movie') agg = m.jf_id ? byItem.get(m.jf_id) : undefined;
    else if (m.kind === 'show') agg = (m.jf_id && bySeries.get(m.jf_id)) || bySeriesName.get(m.title.toLowerCase());
    else agg = byArtist.get(m.title.toLowerCase());
    // Combine id-based and name-based plays for shows (imported history may only have names).
    if (m.kind === 'show' && m.jf_id && bySeries.get(m.jf_id) && bySeriesName.get(m.title.toLowerCase())) {
      const a = bySeries.get(m.jf_id)!;
      const b = bySeriesName.get(m.title.toLowerCase())!;
      agg = { k: a.k, last: Math.max(a.last, b.last), n: a.n + b.n, users: Math.max(a.users, b.users) };
    }
    const req = (m.jf_id && reqByJf.get(m.jf_id)) || (m.tmdb_id ? reqByTmdb.get(`${m.kind}:${m.tmdb_id}`) : undefined);
    let requesterWatched: boolean | null = null;
    if (req?.by) {
      const ids = [m.jf_id, m.kind === 'show' ? `name:${m.title.toLowerCase()}` : null].filter(Boolean) as string[];
      requesterWatched = ids.some((k) => watchers.get(k)?.has(req.by!));
    }
    let diskUsed: number | null = null;
    if (m.path) {
      const loc = toLocal(m.path, m.path_service);
      if (loc) {
        const rootKey = loc.root.local_path;
        if (!diskCache.has(rootKey)) diskCache.set(rootKey, diskUsedPercent(rootKey));
        diskUsed = diskCache.get(rootKey) ?? null;
      }
    }
    out.set(m.key, {
      lastWatchedAt: agg?.last ?? null,
      plays: agg?.n ?? 0,
      viewers: agg?.users ?? 0,
      requested: !!req,
      requestedAt: req?.at ?? null,
      requestedBy: req?.byName ?? null,
      requesterWatched,
      genres: JSON.parse(m.genres) as string[],
      tags: JSON.parse(m.tags) as string[],
      favoriteOf: JSON.parse(m.favorite_of) as string[],
      diskUsed,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

export interface MatchDetail {
  field: string;
  label: string;
  actual: string;
}

export function matchRule(rule: { kind: Kind; config: RuleConfig }, m: MediaRow, f: Facts, now = Date.now()): MatchDetail[] | null {
  if (m.kind !== rule.kind) return null;
  const c = rule.config;
  if (c.libraries.length && (!m.library || !c.libraries.includes(m.library))) return null;
  if (!c.conditions.length) return null;
  const details: MatchDetail[] = [];
  const results = c.conditions.map((cond) => {
    const def = FIELDS[cond.field];
    if (!def) return false;
    const raw = def.get(m, f, now);
    const ok = test(def, raw, cond.op, cond.value);
    if (ok) details.push({ field: cond.field, label: def.label, actual: describe(def, raw) });
    return ok;
  });
  const pass = c.match === 'any' ? results.some(Boolean) : results.every(Boolean);
  return pass ? details : null;
}

/** Why a title must not be flagged, or null if it may be. */
export function protectedReason(m: MediaRow, f: Facts, now = Date.now()): string | null {
  const s = getSetting('cleanup');
  const ex = getDb().prepare('SELECT until FROM exclusions WHERE item_key = ?').get(m.key) as { until: number | null } | undefined;
  if (ex && (ex.until == null || ex.until > now)) return ex.until == null ? 'Kept forever' : `Kept until ${new Date(ex.until).toLocaleDateString()}`;
  if (m.library && s.excludedLibraries.includes(m.library)) return `In the protected “${m.library}” library`;
  const tag = f.tags.find((t) => s.protectTags.map((x) => x.toLowerCase()).includes(t));
  if (tag) return `Has the “${tag}” tag`;
  if (s.protectFavorites && f.favoriteOf.length) return `Favourite of ${f.favoriteOf.join(', ')}`;
  if (s.protectRequestedDays > 0 && f.requestedAt && now - f.requestedAt < s.protectRequestedDays * DAY) return `Requested in the last ${s.protectRequestedDays} days`;
  if (s.protectAddedDays > 0 && m.added_at && now - m.added_at < s.protectAddedDays * DAY) return `Added in the last ${s.protectAddedDays} days`;
  return null;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export function listRules(): Rule[] {
  return (getDb().prepare('SELECT * FROM cleanup_rules ORDER BY position, id').all() as { id: number; name: string; enabled: number; kind: Kind; position: number; config: string }[]).map((r) => ({
    id: r.id,
    name: r.name,
    enabled: !!r.enabled,
    kind: r.kind,
    position: r.position,
    config: { libraries: [], match: 'all', conditions: [], graceDays: 14, reason: 'due to not being watched', ...(JSON.parse(r.config) as Partial<RuleConfig>) },
  }));
}

/** Starter rules created the first time cleanup is opened (all switched off). */
export function seedRules() {
  const db = getDb();
  if ((db.prepare('SELECT COUNT(*) AS n FROM cleanup_rules').get() as { n: number }).n > 0) return;
  const now = Date.now();
  const add = db.prepare('INSERT INTO cleanup_rules (name, enabled, kind, config, position, created_at, updated_at) VALUES (?, 0, ?, ?, ?, ?, ?)');
  const starters: [string, Kind, RuleConfig][] = [
    [
      'Movies nobody watches',
      'movie',
      { libraries: [], match: 'all', graceDays: 14, reason: 'due to not being watched', conditions: [{ field: 'lastWatchedDays', op: 'gt', value: 365 }, { field: 'addedDays', op: 'gt', value: 180 }] },
    ],
    [
      'Requested but never watched',
      'movie',
      { libraries: [], match: 'all', graceDays: 14, reason: 'because it was never watched', conditions: [{ field: 'requested', op: 'is', value: true }, { field: 'requesterWatched', op: 'is', value: false }, { field: 'requestedDays', op: 'gt', value: 90 }] },
    ],
    [
      'Shows nobody has touched',
      'show',
      { libraries: [], match: 'all', graceDays: 21, reason: 'due to not being watched', conditions: [{ field: 'lastWatchedDays', op: 'gt', value: 365 }, { field: 'addedDays', op: 'gt', value: 180 }] },
    ],
  ];
  starters.forEach(([name, kind, cfg], i) => add.run(name, kind, JSON.stringify(cfg), i, now, now));
}
