import { getDb } from '../db/index.js';
import { getSetting } from '../lib/settings.js';

/**
 * Returns how many seconds this address (or username) is still locked out
 * for, or 0 if sign-in is allowed. A lockout starts once too many failed
 * attempts happen inside the window, and lasts from the most recent failure.
 */
export function lockoutRemaining(ip: string, username?: string): number {
  const sec = getSetting('security');
  const now = Date.now();
  const since = now - Math.max(sec.windowMinutes, sec.lockoutMinutes) * 60_000;
  const db = getDb();

  const check = (column: 'ip' | 'username', value: string) => {
    // Failures since the last successful sign-in from this source.
    const lastSuccess = (db
      .prepare(`SELECT MAX(at) AS at FROM login_attempts WHERE ${column} = ? AND success = 1`)
      .get(value) as { at: number | null }).at ?? 0;
    const rows = db
      .prepare(
        `SELECT at FROM login_attempts WHERE ${column} = ? AND success = 0 AND at > ? AND at > ? ORDER BY at DESC`,
      )
      .all(value, since, lastSuccess) as { at: number }[];
    const inWindow = rows.filter((r) => r.at > rows[0]?.at - sec.windowMinutes * 60_000);
    if (inWindow.length < sec.maxFailures) return 0;
    const until = rows[0].at + sec.lockoutMinutes * 60_000;
    return until > now ? Math.ceil((until - now) / 1000) : 0;
  };

  return Math.max(check('ip', ip), username ? check('username', username.toLowerCase()) : 0);
}

export function recordAttempt(ip: string, username: string | undefined, success: boolean, reason?: string) {
  getDb()
    .prepare('INSERT INTO login_attempts (at, ip, username, success, reason) VALUES (?, ?, ?, ?, ?)')
    .run(Date.now(), ip, username?.toLowerCase() ?? null, success ? 1 : 0, reason ?? null);
}
