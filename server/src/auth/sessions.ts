import type { FastifyReply, FastifyRequest } from 'fastify';
import { getDb } from '../db/index.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { clientIp, isHttps } from '../lib/ip.js';
import { getSetting } from '../lib/settings.js';

export const SESSION_COOKIE = 'cg_session';

export interface SessionUser {
  id: number;
  username: string;
  role: string;
  totpEnabled: boolean;
  sessionId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

export function createSession(req: FastifyRequest, reply: FastifyReply, userId: number, remember: boolean) {
  const sec = getSetting('security');
  const token = randomToken(32);
  const now = Date.now();
  const ttl = remember ? sec.rememberDays * 86_400_000 : sec.sessionHours * 3_600_000;
  const ip = clientIp(req);
  getDb()
    .prepare(
      `INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, ip, user_agent, remember)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(sha256(token), userId, now, now + ttl, now, ip, String(req.headers['user-agent'] ?? '').slice(0, 300), remember ? 1 : 0);
  getDb().prepare('UPDATE users SET last_login_at = ?, last_login_ip = ? WHERE id = ?').run(now, ip, userId);

  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: isHttps(req),
    // Without "remember me" the cookie disappears when the browser closes.
    ...(remember ? { maxAge: Math.floor(ttl / 1000) } : {}),
  });
}

export function destroySession(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[SESSION_COOKIE];
  if (token) getDb().prepare('DELETE FROM sessions WHERE id = ?').run(sha256(token));
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Looks up the session cookie and attaches the signed-in user to the request. */
export function loadSession(req: FastifyRequest): SessionUser | undefined {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return undefined;
  const id = sha256(token);
  const row = getDb()
    .prepare(
      `SELECT s.id AS sid, s.expires_at, s.last_seen_at, u.id, u.username, u.role, u.totp_enabled
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    )
    .get(id) as
    | { sid: string; expires_at: number; last_seen_at: number; id: number; username: string; role: string; totp_enabled: number }
    | undefined;
  if (!row) return undefined;
  const now = Date.now();
  if (row.expires_at < now) {
    getDb().prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return undefined;
  }
  // Only write "last seen" once a minute to keep the database quiet.
  if (now - row.last_seen_at > 60_000) {
    getDb().prepare('UPDATE sessions SET last_seen_at = ?, ip = ? WHERE id = ?').run(now, clientIp(req), id);
  }
  return { id: row.id, username: row.username, role: row.role, totpEnabled: !!row.totp_enabled, sessionId: row.sid };
}

export function purgeExpired() {
  const now = Date.now();
  const db = getDb();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM login_challenges WHERE expires_at < ?').run(now);
  // Keep 90 days of sign-in attempts for the security page.
  db.prepare('DELETE FROM login_attempts WHERE at < ?').run(now - 90 * 86_400_000);
}
