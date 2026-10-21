import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { burnPasswordCheck, hashPassword, randomToken, sha256, verifyPassword, verifyTotp } from '../lib/crypto.js';
import { clientIp } from '../lib/ip.js';
import { audit } from '../lib/audit.js';
import { getSetting } from '../lib/settings.js';
import { createSession, destroySession } from './sessions.js';
import { lockoutRemaining, recordAttempt } from './lockout.js';

const GENERIC_FAIL = 'Incorrect username or password.';

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters.')
  .max(200, 'Password is too long.');

function userCount(): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
}

export async function authRoutes(app: FastifyInstance) {
  /** What the login screen needs to know before showing anything. */
  app.get('/api/auth/status', async (req) => {
    const general = getSetting('general');
    return {
      needsAccount: userCount() === 0,
      setupComplete: general.setupComplete,
      user: req.user ? { username: req.user.username, role: req.user.role, totpEnabled: req.user.totpEnabled } : null,
    };
  });

  /** First run only: creates the admin account. */
  app.post('/api/auth/register', async (req, reply) => {
    const body = z
      .object({
        username: z.string().trim().min(3, 'Username must be at least 3 characters.').max(64).regex(/^[\w.@-]+$/, 'Use letters, numbers, dots, dashes or underscores.'),
        password: passwordSchema,
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message });

    const db = getDb();
    const hash = await hashPassword(body.data.password);
    // Re-check inside a transaction so two requests can't both create the first account.
    const created = db.transaction(() => {
      if (userCount() > 0) return null;
      return db
        .prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)')
        .run(body.data.username, hash, 'admin', Date.now()).lastInsertRowid as number;
    })();
    if (!created) return reply.code(409).send({ error: 'An account already exists.' });

    const ip = clientIp(req);
    audit('account.created', { userId: created, ip, detail: { username: body.data.username } });
    recordAttempt(ip, body.data.username, true, 'register');
    createSession(req, reply, created, false);
    return { ok: true };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = z
      .object({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(200), remember: z.boolean().optional() })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: GENERIC_FAIL });
    const { username, password, remember = false } = body.data;
    const ip = clientIp(req);

    const locked = lockoutRemaining(ip, username);
    if (locked > 0) {
      return reply.code(429).send({ error: `Too many failed attempts. Try again in ${Math.ceil(locked / 60)} minute(s).`, retryAfter: locked });
    }

    const user = getDb()
      .prepare('SELECT id, password_hash, totp_enabled FROM users WHERE username = ?')
      .get(username) as { id: number; password_hash: string; totp_enabled: number } | undefined;

    if (!user) {
      await burnPasswordCheck(password);
      recordAttempt(ip, username, false, 'unknown user');
      return reply.code(401).send({ error: GENERIC_FAIL });
    }
    if (!(await verifyPassword(password, user.password_hash))) {
      recordAttempt(ip, username, false, 'bad password');
      audit('login.failed', { userId: user.id, ip });
      return reply.code(401).send({ error: GENERIC_FAIL });
    }

    if (user.totp_enabled) {
      // Password was right; now ask for the authenticator code.
      const token = randomToken(24);
      getDb()
        .prepare('INSERT INTO login_challenges (id, user_id, remember, expires_at) VALUES (?, ?, ?, ?)')
        .run(sha256(token), user.id, remember ? 1 : 0, Date.now() + 5 * 60_000);
      return { twoFactorRequired: true, challenge: token };
    }

    recordAttempt(ip, username, true);
    audit('login.success', { userId: user.id, ip });
    createSession(req, reply, user.id, remember);
    return { ok: true };
  });

  app.post('/api/auth/login/2fa', async (req, reply) => {
    const body = z.object({ challenge: z.string().min(10).max(100), code: z.string().min(6).max(10) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Enter the 6-digit code.' });
    const ip = clientIp(req);
    const db = getDb();
    const ch = db
      .prepare(
        `SELECT c.id, c.user_id, c.remember, c.expires_at, c.attempts, u.username, u.totp_secret, u.totp_last_step
         FROM login_challenges c JOIN users u ON u.id = c.user_id WHERE c.id = ?`,
      )
      .get(sha256(body.data.challenge)) as
      | { id: string; user_id: number; remember: number; expires_at: number; attempts: number; username: string; totp_secret: string; totp_last_step: number | null }
      | undefined;

    if (!ch || ch.expires_at < Date.now()) {
      return reply.code(401).send({ error: 'That sign-in expired. Please start again.', restart: true });
    }
    const locked = lockoutRemaining(ip, ch.username);
    if (locked > 0) {
      db.prepare('DELETE FROM login_challenges WHERE id = ?').run(ch.id);
      return reply.code(429).send({ error: `Too many failed attempts. Try again in ${Math.ceil(locked / 60)} minute(s).`, restart: true });
    }

    const step = verifyTotp(ch.totp_secret, body.data.code, ch.totp_last_step);
    if (step == null) {
      recordAttempt(ip, ch.username, false, 'bad 2fa code');
      const attempts = ch.attempts + 1;
      if (attempts >= 5) {
        db.prepare('DELETE FROM login_challenges WHERE id = ?').run(ch.id);
        return reply.code(401).send({ error: 'Too many wrong codes. Please sign in again.', restart: true });
      }
      db.prepare('UPDATE login_challenges SET attempts = ? WHERE id = ?').run(attempts, ch.id);
      return reply.code(401).send({ error: 'That code is not right. Check your authenticator app and try again.' });
    }

    db.prepare('DELETE FROM login_challenges WHERE id = ?').run(ch.id);
    db.prepare('UPDATE users SET totp_last_step = ? WHERE id = ?').run(step, ch.user_id);
    recordAttempt(ip, ch.username, true);
    audit('login.success', { userId: ch.user_id, ip, detail: { twoFactor: true } });
    createSession(req, reply, ch.user_id, !!ch.remember);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.user) audit('logout', { userId: req.user.id, ip: clientIp(req) });
    destroySession(req, reply);
    return { ok: true };
  });
}
