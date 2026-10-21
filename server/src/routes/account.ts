import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import QRCode from 'qrcode';
import { getDb } from '../db/index.js';
import { hashPassword, newTotpSecret, totpUri, verifyPassword, verifyTotp } from '../lib/crypto.js';
import { clientIp } from '../lib/ip.js';
import { audit } from '../lib/audit.js';
import { getSetting, setSetting } from '../lib/settings.js';
import { passwordSchema } from '../auth/routes.js';

/** Secrets handed out during 2FA setup, kept in memory until confirmed. */
const pendingTotp = new Map<number, { secret: string; expires: number }>();

export async function accountRoutes(app: FastifyInstance) {
  app.post('/api/account/password', async (req, reply) => {
    const body = z.object({ current: z.string().min(1), next: passwordSchema }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message });
    const user = req.user!;
    const row = getDb().prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as { password_hash: string };
    if (!(await verifyPassword(body.data.current, row.password_hash))) {
      return reply.code(400).send({ error: 'Your current password is not right.' });
    }
    getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(body.data.next), user.id);
    // Sign out every other device.
    getDb().prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(user.id, user.sessionId);
    audit('account.password_changed', { userId: user.id, ip: clientIp(req) });
    return { ok: true };
  });

  // ---- Two-factor -------------------------------------------------------

  app.post('/api/account/2fa/begin', async (req) => {
    const user = req.user!;
    const secret = newTotpSecret();
    pendingTotp.set(user.id, { secret, expires: Date.now() + 10 * 60_000 });
    const uri = totpUri(secret, user.username);
    const qr = await QRCode.toDataURL(uri, { margin: 1, width: 240, color: { dark: '#0d0a16', light: '#ffffff' } });
    return { secret, uri, qr };
  });

  app.post('/api/account/2fa/confirm', async (req, reply) => {
    const body = z.object({ code: z.string() }).safeParse(req.body);
    const user = req.user!;
    const pending = pendingTotp.get(user.id);
    if (!pending || pending.expires < Date.now()) return reply.code(400).send({ error: 'Setup timed out. Please start again.' });
    const step = body.success ? verifyTotp(pending.secret, body.data.code) : null;
    if (step == null) return reply.code(400).send({ error: 'That code is not right. Try the newest code in your app.' });
    getDb()
      .prepare('UPDATE users SET totp_secret = ?, totp_enabled = 1, totp_last_step = ? WHERE id = ?')
      .run(pending.secret, step, user.id);
    pendingTotp.delete(user.id);
    audit('account.2fa_enabled', { userId: user.id, ip: clientIp(req) });
    return { ok: true };
  });

  app.post('/api/account/2fa/disable', async (req, reply) => {
    const body = z.object({ password: z.string().min(1), code: z.string() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Enter your password and a code.' });
    const user = req.user!;
    const row = getDb()
      .prepare('SELECT password_hash, totp_secret, totp_last_step FROM users WHERE id = ?')
      .get(user.id) as { password_hash: string; totp_secret: string | null; totp_last_step: number | null };
    if (!(await verifyPassword(body.data.password, row.password_hash))) return reply.code(400).send({ error: 'Your password is not right.' });
    if (!row.totp_secret || verifyTotp(row.totp_secret, body.data.code, row.totp_last_step) == null) {
      return reply.code(400).send({ error: 'That code is not right.' });
    }
    getDb().prepare('UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_last_step = NULL WHERE id = ?').run(user.id);
    audit('account.2fa_disabled', { userId: user.id, ip: clientIp(req) });
    return { ok: true };
  });

  // ---- Sessions ---------------------------------------------------------

  app.get('/api/account/sessions', async (req) => {
    const rows = getDb()
      .prepare('SELECT id, created_at, expires_at, last_seen_at, ip, user_agent, remember FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC')
      .all(req.user!.id) as { id: string; created_at: number; expires_at: number; last_seen_at: number; ip: string; user_agent: string; remember: number }[];
    return rows.map((r) => ({
      id: r.id.slice(0, 16),
      current: r.id === req.user!.sessionId,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      lastSeenAt: r.last_seen_at,
      ip: r.ip,
      userAgent: r.user_agent,
      remember: !!r.remember,
    }));
  });

  app.delete<{ Params: { id: string } }>('/api/account/sessions/:id', async (req, reply) => {
    const prefix = req.params.id.replace(/[^a-f0-9]/g, '');
    if (prefix.length !== 16) return reply.code(400).send({ error: 'Bad session id' });
    getDb().prepare("DELETE FROM sessions WHERE user_id = ? AND substr(id, 1, 16) = ? AND id != ?").run(req.user!.id, prefix, req.user!.sessionId);
    audit('account.session_revoked', { userId: req.user!.id, ip: clientIp(req) });
    return { ok: true };
  });

  app.get('/api/account/login-attempts', async () => {
    return getDb()
      .prepare('SELECT at, ip, username, success, reason FROM login_attempts ORDER BY at DESC LIMIT 100')
      .all();
  });

  // ---- Security settings -------------------------------------------------

  app.get('/api/settings/security', async () => getSetting('security'));

  app.put('/api/settings/security', async (req, reply) => {
    const body = z
      .object({
        maxFailures: z.number().int().min(3).max(50),
        windowMinutes: z.number().int().min(1).max(1440),
        lockoutMinutes: z.number().int().min(1).max(1440),
        sessionHours: z.number().int().min(1).max(168),
        rememberDays: z.number().int().min(1).max(365),
        trustProxyHeaders: z.boolean(),
      })
      .partial()
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message });
    audit('settings.security', { userId: req.user!.id, ip: clientIp(req), detail: body.data });
    return setSetting('security', body.data);
  });
}
