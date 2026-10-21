import { getDb } from '../db/index.js';

/** Records an admin action or security event. */
export function audit(action: string, opts: { userId?: number | null; ip?: string; detail?: unknown } = {}) {
  getDb()
    .prepare('INSERT INTO audit_log (at, user_id, ip, action, detail) VALUES (?, ?, ?, ?, ?)')
    .run(
      Date.now(),
      opts.userId ?? null,
      opts.ip ?? null,
      action,
      opts.detail === undefined ? null : JSON.stringify(opts.detail),
    );
}
