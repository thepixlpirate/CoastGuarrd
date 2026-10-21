import { getDb } from '../db/index.js';

/** Small persistent values such as sync cursors. */
export function getState<T>(key: string, fallback: T): T {
  const row = getDb().prepare('SELECT value FROM state WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setState(key: string, value: unknown) {
  getDb()
    .prepare('INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}
