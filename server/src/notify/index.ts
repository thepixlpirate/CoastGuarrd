import nodemailer from 'nodemailer';
import { getSetting, type NotifySettings } from '../lib/settings.js';
import { getDb } from '../db/index.js';

/**
 * Sends messages to Discord, email and/or a generic webhook.
 * Failures never break anything else — they're just logged.
 */

export interface Message {
  title: string;
  text: string;
  /** Short facts shown as a list. */
  fields?: { name: string; value: string }[];
  /** Link to open (made absolute using the public address setting). */
  link?: string;
  severity?: 'info' | 'warning' | 'critical' | 'good';
  event: string;
}

const COLOR = { info: 0x8b5cf6, warning: 0xfbbf24, critical: 0xfb7185, good: 0x2dd4bf };

let log: (m: string) => void = () => undefined;
export function setNotifyLogger(fn: (m: string) => void) {
  log = fn;
}

function absolute(link: string | undefined, s: NotifySettings): string | undefined {
  if (!link) return undefined;
  if (/^https?:\/\//.test(link)) return link;
  return s.publicUrl ? s.publicUrl.replace(/\/+$/, '') + link : undefined;
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function sendDiscord(webhook: string, m: Message, s: NotifySettings) {
  await postJson(webhook, {
    username: 'CoastGuarrd',
    avatar_url: s.publicUrl ? `${s.publicUrl.replace(/\/+$/, '')}/icon-192.png` : undefined,
    embeds: [
      {
        title: m.title.slice(0, 250),
        description: m.text.slice(0, 3900),
        url: absolute(m.link, s),
        color: COLOR[m.severity ?? 'info'],
        fields: (m.fields ?? []).slice(0, 20).map((f) => ({ name: f.name.slice(0, 250), value: f.value.slice(0, 1000) || '—', inline: false })),
        timestamp: new Date().toISOString(),
        footer: { text: 'CoastGuarrd' },
      },
    ],
  });
}

function mailer(s: NotifySettings) {
  return nodemailer.createTransport({
    host: s.email.host,
    port: s.email.port,
    secure: s.email.secure,
    auth: s.email.user ? { user: s.email.user, pass: s.email.pass } : undefined,
  });
}

function esc(t: string) {
  return t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function emailHtml(m: Message, s: NotifySettings) {
  const link = absolute(m.link, s);
  return `<!doctype html><html><body style="margin:0;background:#0b0912;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#ece8f7">
  <div style="max-width:560px;margin:0 auto;padding:28px 20px">
    <div style="font-size:20px;font-weight:700;color:#c4b5fd;margin-bottom:18px">CoastGuarrd</div>
    <div style="background:#13101d;border:1px solid #2f2846;border-radius:14px;padding:22px">
      <div style="font-size:18px;font-weight:600;margin-bottom:8px">${esc(m.title)}</div>
      <div style="color:#a8a1c2;line-height:1.5;white-space:pre-line">${esc(m.text)}</div>
      ${(m.fields ?? []).map((f) => `<div style="margin-top:12px"><div style="color:#6f688c;font-size:12px">${esc(f.name)}</div><div style="white-space:pre-line">${esc(f.value)}</div></div>`).join('')}
      ${link ? `<a href="${esc(link)}" style="display:inline-block;margin-top:18px;background:#8b5cf6;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600">Open</a>` : ''}
    </div>
  </div></body></html>`;
}

export async function sendEmail(to: string, m: Message, s: NotifySettings) {
  await mailer(s).sendMail({
    from: s.email.from || s.email.user,
    to,
    subject: m.title,
    text: `${m.text}\n\n${(m.fields ?? []).map((f) => `${f.name}: ${f.value}`).join('\n')}${absolute(m.link, s) ? `\n\n${absolute(m.link, s)}` : ''}`,
    html: emailHtml(m, s),
  });
}

/** Sends to every switched-on channel. */
export async function notify(m: Message) {
  const s = getSetting('notify');
  const jobs: Promise<void>[] = [];
  if (s.discord.enabled && s.discord.webhook) jobs.push(sendDiscord(s.discord.webhook, m, s).catch((e) => log(`Discord: ${(e as Error).message}`)));
  if (s.email.enabled && s.email.host && s.email.to) jobs.push(sendEmail(s.email.to, m, s).catch((e) => log(`Email: ${(e as Error).message}`)));
  if (s.webhook.enabled && s.webhook.url) {
    jobs.push(postJson(s.webhook.url, { ...m, link: absolute(m.link, s), app: 'CoastGuarrd', at: new Date().toISOString() }).catch((e) => log(`Webhook: ${(e as Error).message}`)));
  }
  await Promise.all(jobs);
}

const SEV_RANK = { info: 1, warning: 2, critical: 3 } as const;

/** Called for every new alert; sends it if it's serious enough. */
export function notifyAlert(a: { title: string; severity: 'info' | 'warning' | 'critical'; rule: string; userId?: string | null; detail: Record<string, unknown> }) {
  const min = getSetting('notify').events.alerts;
  if (min === 'off' || SEV_RANK[a.severity] < SEV_RANK[min]) return;
  const fields = Object.entries(a.detail)
    .filter(([, v]) => v != null && v !== '')
    .slice(0, 6)
    .map(([k, v]) => ({ name: k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()), value: Array.isArray(v) ? v.join(', ') : String(v) }));
  void notify({ title: a.title, text: `New ${a.severity} alert.`, fields, link: a.userId ? `/users/${a.userId}` : '/alerts', severity: a.severity, event: `alert.${a.rule}` });
}

export function familyLink(): string | null {
  const s = getSetting('notify');
  if (!s.family.pageEnabled || !s.family.token) return null;
  return `/public/leaving/${s.family.token}`;
}

/** Everyone in Seerr/Jellyfin with an email address (for the family digest). */
export function familyEmails(): string[] {
  return (getDb().prepare(`SELECT DISTINCT email FROM media_users WHERE removed = 0 AND is_disabled = 0 AND email IS NOT NULL AND email LIKE '%@%'`).all() as { email: string }[]).map((r) => r.email);
}
