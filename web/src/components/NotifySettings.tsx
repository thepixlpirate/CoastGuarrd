import { useEffect, useState } from 'react';
import { Copy, Loader2, Mail, MessageSquare, RefreshCw, Save, Send, Users, Webhook } from 'lucide-react';
import { get, post, put } from '../api';
import type { NotifySettings as NS } from '../types';
import { Alert } from './Fields';

function Toggle({ checked, onChange, title, hint }: { checked: boolean; onChange: (v: boolean) => void; title: string; hint?: string }) {
  return (
    <label className="row" style={{ alignItems: 'flex-start', gap: 14, cursor: 'pointer' }}>
      <input type="checkbox" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <div>
        <div style={{ fontWeight: 500 }}>{title}</div>
        {hint && <div className="hint" style={{ marginTop: 2 }}>{hint}</div>}
      </div>
    </label>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text', hint }: { label: string; value: string | number; onChange: (v: string) => void; placeholder?: string; type?: string; hint?: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className="input" type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} autoComplete="off" spellCheck={false} />
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export default function NotifySettings() {
  const [s, setS] = useState<NS | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    get<NS>('/api/settings/notify').then(setS).catch(() => undefined);
  }, []);
  if (!s) return <Loader2 className="spin" />;

  const flash = (ok: boolean, text: string) => {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), 5000);
  };

  const save = async (patch: Partial<NS> = s) => {
    setBusy(true);
    try {
      const next = await put<NS>('/api/settings/notify', patch);
      setS(next);
      flash(true, 'Saved.');
      return next;
    } catch (err) {
      flash(false, (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const test = async (channel: 'discord' | 'email' | 'webhook') => {
    setTesting(channel);
    try {
      await save();
      await post('/api/notify/test', { channel });
      flash(true, 'Test sent — check that it arrived.');
    } catch (err) {
      flash(false, (err as Error).message);
    } finally {
      setTesting('');
    }
  };

  const familyUrl = s.family.token ? `${s.publicUrl || window.location.origin}/public/leaving/${s.family.token}` : '';

  return (
    <div className="stack" style={{ gap: 16, maxWidth: 900 }}>
      <div className="card stack">
        <Field
          label="Address you use to reach CoastGuarrd"
          value={s.publicUrl}
          onChange={(v) => setS({ ...s, publicUrl: v })}
          placeholder="https://coastguarrd.example.com"
          hint="Used for links in messages and emails. Your Cloudflare tunnel address goes here."
        />
      </div>

      <div className="card stack">
        <div className="card-head" style={{ marginBottom: 0 }}>
          <div className="svc-icon" style={{ background: 'rgba(88,101,242,.18)', color: '#a5b4fc' }}><MessageSquare size={20} /></div>
          <div style={{ flex: 1 }}>
            <h3>Discord</h3>
            <p className="card-sub">In Discord: channel settings → Integrations → Webhooks → New webhook → Copy webhook URL.</p>
          </div>
          <input type="checkbox" className="switch" checked={s.discord.enabled} onChange={(e) => setS({ ...s, discord: { ...s.discord, enabled: e.target.checked } })} aria-label="Discord on/off" />
        </div>
        {s.discord.enabled && (
          <>
            <Field label="Webhook address" value={s.discord.webhook} onChange={(v) => setS({ ...s, discord: { ...s.discord, webhook: v } })} placeholder="https://discord.com/api/webhooks/…" />
            <div><button className="btn btn-sm btn-teal" disabled={!!testing} onClick={() => void test('discord')}>{testing === 'discord' ? <Loader2 className="spin" /> : <Send />} Send a test</button></div>
          </>
        )}
      </div>

      <div className="card stack">
        <div className="card-head" style={{ marginBottom: 0 }}>
          <div className="svc-icon" style={{ background: 'var(--teal-soft)', color: 'var(--teal-strong)' }}><Mail size={20} /></div>
          <div style={{ flex: 1 }}>
            <h3>Email</h3>
            <p className="card-sub">For Gmail use smtp.gmail.com, port 587, and an “app password”.</p>
          </div>
          <input type="checkbox" className="switch" checked={s.email.enabled} onChange={(e) => setS({ ...s, email: { ...s.email, enabled: e.target.checked } })} aria-label="Email on/off" />
        </div>
        {s.email.enabled && (
          <>
            <div className="grid grid-2" style={{ gap: 12 }}>
              <Field label="Mail server" value={s.email.host} onChange={(v) => setS({ ...s, email: { ...s.email, host: v } })} placeholder="smtp.gmail.com" />
              <Field label="Port" type="number" value={s.email.port} onChange={(v) => setS({ ...s, email: { ...s.email, port: Number(v) } })} />
              <Field label="Username" value={s.email.user} onChange={(v) => setS({ ...s, email: { ...s.email, user: v } })} />
              <Field label="Password" type="password" value={s.email.pass} onChange={(v) => setS({ ...s, email: { ...s.email, pass: v } })} placeholder={s.hasPass ? 'Saved' : ''} />
              <Field label="Send from" value={s.email.from} onChange={(v) => setS({ ...s, email: { ...s.email, from: v } })} placeholder="CoastGuarrd <you@example.com>" />
              <Field label="Send to (you)" value={s.email.to} onChange={(v) => setS({ ...s, email: { ...s.email, to: v } })} placeholder="you@example.com" />
            </div>
            <Toggle checked={s.email.secure} onChange={(v) => setS({ ...s, email: { ...s.email, secure: v } })} title="Use SSL from the start (port 465)" hint="Leave off for port 587 — it still encrypts." />
            <div><button className="btn btn-sm btn-teal" disabled={!!testing} onClick={() => void test('email')}>{testing === 'email' ? <Loader2 className="spin" /> : <Send />} Send a test</button></div>
          </>
        )}
      </div>

      <div className="card stack">
        <div className="card-head" style={{ marginBottom: 0 }}>
          <div className="svc-icon" style={{ background: 'var(--purple-soft)', color: 'var(--purple-strong)' }}><Webhook size={20} /></div>
          <div style={{ flex: 1 }}>
            <h3>Webhook</h3>
            <p className="card-sub">Sends each message as JSON — works with Home Assistant, ntfy, Gotify bridges and more.</p>
          </div>
          <input type="checkbox" className="switch" checked={s.webhook.enabled} onChange={(e) => setS({ ...s, webhook: { ...s.webhook, enabled: e.target.checked } })} aria-label="Webhook on/off" />
        </div>
        {s.webhook.enabled && (
          <>
            <Field label="Address" value={s.webhook.url} onChange={(v) => setS({ ...s, webhook: { ...s.webhook, url: v } })} placeholder="https://…" />
            <div><button className="btn btn-sm btn-teal" disabled={!!testing} onClick={() => void test('webhook')}>{testing === 'webhook' ? <Loader2 className="spin" /> : <Send />} Send a test</button></div>
          </>
        )}
      </div>

      <div className="card stack">
        <h3>What to send</h3>
        <label className="row small row-wrap" style={{ gap: 8 }}>
          <span>Alerts at or above</span>
          <select className="select" style={{ width: 150, height: 34 }} value={s.events.alerts} onChange={(e) => setS({ ...s, events: { ...s.events, alerts: e.target.value as NS['events']['alerts'] } })}>
            <option value="off">Don’t send alerts</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical only</option>
          </select>
        </label>
        <Toggle checked={s.events.flagged} onChange={(v) => setS({ ...s, events: { ...s.events, flagged: v } })} title="Titles marked for removal" />
        <Toggle checked={s.events.moved} onChange={(v) => setS({ ...s, events: { ...s.events, moved: v } })} title="Titles moved to the recycle bin" />
        <Toggle checked={s.events.keepRequests} onChange={(v) => setS({ ...s, events: { ...s.events, keepRequests: v } })} title="Family asking to keep something" />
        <Toggle checked={s.events.digest} onChange={(v) => setS({ ...s, events: { ...s.events, digest: v } })} title="Weekly summary (Sunday morning)" />
      </div>

      <div className="card stack">
        <div className="card-head" style={{ marginBottom: 0 }}>
          <div className="svc-icon" style={{ background: 'var(--teal-soft)', color: 'var(--teal-strong)' }}><Users size={20} /></div>
          <div style={{ flex: 1 }}>
            <h3>Family “Leaving Soon” page</h3>
            <p className="card-sub">A simple page — no sign-in needed — listing what’s leaving, with a “Keep it” button. Anyone with the secret link can see it.</p>
          </div>
          <input type="checkbox" className="switch" checked={s.family.pageEnabled} onChange={(e) => void save({ family: { ...s.family, pageEnabled: e.target.checked } })} aria-label="Family page on/off" />
        </div>
        {s.family.pageEnabled && familyUrl && (
          <>
            <div className="row" style={{ gap: 8 }}>
              <input className="input mono" readOnly value={familyUrl} onFocus={(e) => e.target.select()} />
              <button className="btn icon-btn" aria-label="Copy link" onClick={() => void navigator.clipboard?.writeText(familyUrl).then(() => flash(true, 'Link copied.'))}><Copy /></button>
              <button
                className="btn icon-btn"
                title="Make a new link (the old one stops working)"
                aria-label="New link"
                onClick={async () => {
                  if (!confirm('Make a new link? The old one will stop working.')) return;
                  setS(await post<NS>('/api/notify/family-token'));
                }}
              >
                <RefreshCw />
              </button>
            </div>
            <Toggle
              checked={s.family.emailDigest}
              onChange={(v) => setS({ ...s, family: { ...s.family, emailDigest: v } })}
              title="Email family the Leaving Soon list each Sunday"
              hint="Goes to everyone with an email address in Seerr. Needs Email set up above."
            />
          </>
        )}
      </div>

      <div className="row">
        <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? <Loader2 className="spin" /> : <Save />} Save notifications
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => void post('/api/notify/digest-now').then(() => flash(true, 'Summary sent.')).catch((e) => flash(false, (e as Error).message))}>
          Send the weekly summary now
        </button>
      </div>
      {msg && <Alert kind={msg.ok ? 'ok' : 'error'}>{msg.text}</Alert>}
    </div>
  );
}
