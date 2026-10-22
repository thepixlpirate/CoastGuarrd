import { getDb } from '../db/index.js';

export interface SecuritySettings {
  /** Failed sign-ins allowed from one address (or for one username) inside the window. */
  maxFailures: number;
  /** How far back failed sign-ins are counted, in minutes. */
  windowMinutes: number;
  /** How long an address or username stays locked, in minutes. */
  lockoutMinutes: number;
  /** Normal session length, in hours. */
  sessionHours: number;
  /** Session length when "Remember me" is ticked, in days. */
  rememberDays: number;
  /**
   * Read the visitor's real address from proxy headers (Cloudflare's
   * CF-Connecting-IP, X-Forwarded-For). Only honoured when the request
   * arrives from a private/local network address, such as a tunnel container.
   */
  trustProxyHeaders: boolean;
}

export interface GeneralSettings {
  /** While on, CoastGuarrd only shows what it would flag or move — it never changes anything. */
  previewMode: boolean;
  /** Setup wizard has been finished. */
  setupComplete: boolean;
  /** Optional downloads folder (inside the container) for leftover-download checks. */
  downloadsPath: string;
}

export interface RuleToggle {
  enabled: boolean;
  severity: 'info' | 'warning' | 'critical';
}

export interface TrackingSettings {
  /** How often Jellyfin is asked what's playing, in seconds. */
  pollSeconds: number;
  /** Look up locations for internet addresses using the offline database. */
  geoEnabled: boolean;
  /** Download / refresh the free DB-IP location database automatically each month. */
  geoAutoUpdate: boolean;
  /** Plays shorter than this are dropped as accidental clicks (0 = keep everything). */
  minPlaySeconds: number;
  rules: {
    impossibleTravel: RuleToggle & { kmh: number };
    simultaneousLocations: RuleToggle & { km: number };
    concurrentStreams: RuleToggle & { max: number };
    ipVelocity: RuleToggle & { count: number; hours: number };
    newDevice: RuleToggle;
    newCountry: RuleToggle;
    failedSignIns: RuleToggle & { count: number; minutes: number };
  };
}

export interface CleanupSettings {
  /** Titles with any of these tags (in Radarr/Sonarr/Lidarr or Jellyfin) are never flagged. */
  protectTags: string[];
  /** Never flag anything someone has marked as a favourite. */
  protectFavorites: boolean;
  /** Never flag something requested within this many days. */
  protectRequestedDays: number;
  /** Never flag something added to the library within this many days. */
  protectAddedDays: number;
  /** Libraries that are never touched (e.g. Kids). */
  excludedLibraries: string[];
  /** How often rules are checked, in hours. */
  evaluateHours: number;
  posters: { enabled: boolean; color: 'red' | 'purple' | 'teal' | 'black' };
  collection: { enabled: boolean; name: string };
  arr: { unmonitor: boolean; removeOnDelete: boolean; importExclusion: boolean };
  /** When a title is deleted for good, clear it in Seerr so it can be requested again. */
  seerrReset: boolean;
  /** Allow copying to a recycle bin on a different drive (slow). Off = refuse instead. */
  allowCrossDrive: boolean;
  /** Leftover downloads older than this many days are listed. */
  downloadsAgeDays: number;
}

export interface NotifySettings {
  discord: { enabled: boolean; webhook: string };
  email: { enabled: boolean; host: string; port: number; secure: boolean; user: string; pass: string; from: string; to: string };
  webhook: { enabled: boolean; url: string };
  events: { alerts: 'off' | 'info' | 'warning' | 'critical'; flagged: boolean; moved: boolean; keepRequests: boolean; digest: boolean };
  family: { pageEnabled: boolean; token: string; emailDigest: boolean };
  /** Address people use to reach CoastGuarrd, for links in messages. */
  publicUrl: string;
}

const defaults: { security: SecuritySettings; general: GeneralSettings; tracking: TrackingSettings; cleanup: CleanupSettings; notify: NotifySettings } = {
  cleanup: {
    protectTags: ['keep', 'coastguarrd-keep'],
    protectFavorites: true,
    protectRequestedDays: 30,
    protectAddedDays: 30,
    excludedLibraries: [],
    evaluateHours: 6,
    posters: { enabled: true, color: 'red' },
    collection: { enabled: true, name: 'Leaving Soon' },
    arr: { unmonitor: true, removeOnDelete: true, importExclusion: false },
    seerrReset: true,
    allowCrossDrive: false,
    downloadsAgeDays: 14,
  },
  notify: {
    discord: { enabled: false, webhook: '' },
    email: { enabled: false, host: '', port: 587, secure: false, user: '', pass: '', from: '', to: '' },
    webhook: { enabled: false, url: '' },
    events: { alerts: 'warning', flagged: true, moved: true, keepRequests: true, digest: true },
    family: { pageEnabled: false, token: '', emailDigest: false },
    publicUrl: '',
  },
  tracking: {
    pollSeconds: 10,
    geoEnabled: true,
    geoAutoUpdate: true,
    minPlaySeconds: 0,
    rules: {
      impossibleTravel: { enabled: true, severity: 'critical', kmh: 800 },
      simultaneousLocations: { enabled: true, severity: 'warning', km: 80 },
      concurrentStreams: { enabled: true, severity: 'warning', max: 3 },
      ipVelocity: { enabled: true, severity: 'warning', count: 6, hours: 24 },
      newDevice: { enabled: true, severity: 'info' },
      newCountry: { enabled: true, severity: 'warning' },
      failedSignIns: { enabled: true, severity: 'warning', count: 5, minutes: 30 },
    },
  },
  security: {
    maxFailures: 5,
    windowMinutes: 15,
    lockoutMinutes: 15,
    sessionHours: 12,
    rememberDays: 30,
    trustProxyHeaders: true,
  },
  general: {
    previewMode: true,
    setupComplete: false,
    downloadsPath: '',
  },
};

type Defaults = typeof defaults;
export type DeepPartial<T> = { [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P] };
export type SettingsKey = keyof Defaults;

const cache = new Map<string, unknown>();

export function getSetting<K extends SettingsKey>(key: K): Defaults[K] {
  if (cache.has(key)) return cache.get(key) as Defaults[K];
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  let value: Defaults[K] = { ...defaults[key] };
  if (row) {
    try {
      value = deepMerge(defaults[key], JSON.parse(row.value));
    } catch {
      /* fall back to defaults */
    }
  }
  cache.set(key, value);
  return value;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Merges saved values over defaults, so new options added later get their default. */
function deepMerge<T>(base: T, over: unknown): T {
  if (!isObj(base) || !isObj(over)) return (over === undefined ? base : over) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = k in out && isObj(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

export function setSetting<K extends SettingsKey>(key: K, patch: DeepPartial<Defaults[K]>): Defaults[K] {
  const next = deepMerge(getSetting(key), patch) as Defaults[K];
  getDb()
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    )
    .run(key, JSON.stringify(next));
  cache.set(key, next);
  return next;
}
