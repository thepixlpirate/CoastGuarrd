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

const defaults: { security: SecuritySettings; general: GeneralSettings } = {
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
      value = { ...defaults[key], ...JSON.parse(row.value) };
    } catch {
      /* fall back to defaults */
    }
  }
  cache.set(key, value);
  return value;
}

export function setSetting<K extends SettingsKey>(key: K, patch: Partial<Defaults[K]>): Defaults[K] {
  const next = { ...getSetting(key), ...patch } as Defaults[K];
  getDb()
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    )
    .run(key, JSON.stringify(next));
  cache.set(key, next);
  return next;
}
