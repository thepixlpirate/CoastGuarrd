import { useEffect, useState } from 'react';
import { Laptop, Loader2, LogOut, Save, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import { del, get, post, put, type SecuritySettings } from '../api';
import { useAuth } from '../auth';
import { Alert, OtpInput, passwordScore } from './Fields';

export function timeAgo(ts: number | null | undefined): string {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  return new Date(ts).toLocaleString();
}

export function deviceName(ua: string): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

// ---------------------------------------------------------------------------

export function TwoFactorCard({ compact }: { compact?: boolean }) {
  const { status, refresh } = useAuth();
  const enabled = !!status?.user?.totpEnabled;
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [disabling, setDisabling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const begin = async () => {
    setBusy(true);
    setMsg(null);
    try {
      setSetup(await post<{ secret: string; qr: string }>('/api/account/2fa/begin'));
      setCode('');
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (value = code) => {
    if (value.length !== 6) return;
    setBusy(true);
    try {
      await post('/api/account/2fa/confirm', { code: value });
      setSetup(null);
      setMsg({ ok: true, text: 'Two-factor sign-in is on. You’ll be asked for a code each time you sign in.' });
      await refresh();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      await post('/api/account/2fa/disable', { password, code });
      setDisabling(false);
      setPassword('');
      setCode('');
      setMsg({ ok: true, text: 'Two-factor sign-in is off.' });
      await refresh();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <div className="svc-icon" style={{ background: enabled ? 'var(--teal-soft)' : 'var(--purple-soft)', color: enabled ? 'var(--teal-strong)' : 'var(--purple-strong)' }}>
          {enabled ? <ShieldCheck size={20} /> : <ShieldOff size={20} />}
        </div>
        <div style={{ flex: 1 }}>
          <div className="row" style={{ gap: 8 }}>
            <h3>Two-factor sign-in</h3>
            {enabled ? <span className="badge badge-ok">On</span> : <span className="badge badge-warn">Off</span>}
          </div>
          <p className="card-sub">A 6-digit code from an app like Google Authenticator, Aegis or 1Password, on top of your password.</p>
        </div>
      </div>

      {msg && <div style={{ marginBottom: 14 }}><Alert kind={msg.ok ? 'ok' : 'error'}>{msg.text}</Alert></div>}

      {!enabled && !setup && (
        <button className="btn btn-primary" onClick={() => void begin()} disabled={busy}>
          {busy ? <Loader2 className="spin" /> : <ShieldCheck />} Turn on two-factor
        </button>
      )}

      {setup && (
        <div className="stack">
          <ol className="muted small" style={{ margin: 0, paddingLeft: 18 }}>
            <li>Open your authenticator app and scan this code.</li>
            <li>Type the 6-digit code it shows.</li>
          </ol>
          <div className="row row-wrap" style={{ gap: 20, alignItems: 'center' }}>
            <img src={setup.qr} alt="QR code for your authenticator app" width={compact ? 170 : 200} height={compact ? 170 : 200} style={{ borderRadius: 10 }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="label">Can’t scan? Type this key:</div>
              <code style={{ wordBreak: 'break-all', color: 'var(--teal-strong)' }}>{setup.secret.match(/.{1,4}/g)?.join(' ')}</code>
            </div>
          </div>
          <OtpInput value={code} onChange={setCode} onComplete={(v) => void confirm(v)} disabled={busy} />
          <div className="row">
            <button className="btn btn-ghost" onClick={() => setSetup(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={() => void confirm()} disabled={busy || code.length !== 6}>
              {busy ? <Loader2 className="spin" /> : null} Confirm
            </button>
          </div>
        </div>
      )}

      {enabled && !disabling && (
        <button className="btn btn-ghost" onClick={() => { setDisabling(true); setCode(''); setMsg(null); }}>
          Turn off…
        </button>
      )}
      {enabled && disabling && (
        <div className="stack">
          <div>
            <label className="label">Your password</label>
            <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div>
            <label className="label">A current code from your app</label>
            <OtpInput value={code} onChange={setCode} disabled={busy} />
          </div>
          <div className="row">
            <button className="btn btn-ghost" onClick={() => setDisabling(false)}>Cancel</button>
            <button className="btn btn-danger" onClick={() => void disable()} disabled={busy || !password || code.length !== 6}>
              Turn off two-factor
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function PasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    if (next !== confirm) return setMsg({ ok: false, text: 'The new passwords do not match.' });
    setBusy(true);
    try {
      await post('/api/account/password', { current, next });
      setCurrent('');
      setNext('');
      setConfirm('');
      setMsg({ ok: true, text: 'Password changed. Other devices have been signed out.' });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-head"><h3>Change password</h3></div>
      <div className="stack">
        <div>
          <label className="label">Current password</label>
          <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div>
          <label className="label">New password</label>
          <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          <div className="hint">At least 10 characters. Strength: {['very weak', 'weak', 'okay', 'good', 'strong'][passwordScore(next)]}</div>
        </div>
        <div>
          <label className="label">Confirm new password</label>
          <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        {msg && <Alert kind={msg.ok ? 'ok' : 'error'}>{msg.text}</Alert>}
        <div>
          <button className="btn btn-teal" disabled={busy || !current || next.length < 10 || !confirm} onClick={() => void save()}>
            {busy ? <Loader2 className="spin" /> : <Save />} Change password
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface SessionRow {
  id: string;
  current: boolean;
  createdAt: number;
  lastSeenAt: number;
  ip: string;
  userAgent: string;
  remember: boolean;
}

export function SessionsCard() {
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const load = () => get<SessionRow[]>('/api/account/sessions').then(setRows).catch(() => setRows([]));
  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="card">
      <div className="card-head">
        <h3>Signed-in devices</h3>
      </div>
      {!rows && <Loader2 className="spin" />}
      <div className="list">
        {rows?.map((s) => {
          const mobile = /iPhone|Android|Mobile/.test(s.userAgent);
          return (
            <div key={s.id} className="list-item">
              {mobile ? <Smartphone size={20} color="var(--purple-strong)" /> : <Laptop size={20} color="var(--purple-strong)" />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>
                  {deviceName(s.userAgent)} {s.current && <span className="badge badge-ok" style={{ marginLeft: 6 }}>This device</span>}
                </div>
                <div className="faint small">
                  {s.ip} · active {timeAgo(s.lastSeenAt)}
                </div>
              </div>
              {!s.current && (
                <button className="btn btn-ghost btn-sm" onClick={() => void del(`/api/account/sessions/${s.id}`).then(load)}>
                  <LogOut /> Sign out
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface Attempt {
  at: number;
  ip: string;
  username: string | null;
  success: number;
  reason: string | null;
}

export function LoginAttemptsCard() {
  const [rows, setRows] = useState<Attempt[] | null>(null);
  useEffect(() => {
    get<Attempt[]>('/api/account/login-attempts').then(setRows).catch(() => setRows([]));
  }, []);
  return (
    <div className="card">
      <div className="card-head">
        <h3>Recent sign-in attempts</h3>
      </div>
      {!rows && <Loader2 className="spin" />}
      {rows && rows.length === 0 && <div className="faint small">No attempts yet.</div>}
      {rows && rows.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Result</th>
                <th>Username</th>
                <th>Address</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 30).map((r, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(r.at).toLocaleString()}</td>
                  <td>{r.success ? <span className="badge badge-ok">Success</span> : <span className="badge badge-bad" title={r.reason ?? ''}>Failed</span>}</td>
                  <td>{r.username ?? '—'}</td>
                  <td className="mono">{r.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function LockoutCard() {
  const [s, setS] = useState<SecuritySettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    get<SecuritySettings>('/api/settings/security').then(setS).catch(() => undefined);
  }, []);
  if (!s) return null;

  const num = (key: keyof SecuritySettings, label: string, hint: string) => (
    <div>
      <label className="label">{label}</label>
      <input className="input" type="number" inputMode="numeric" value={s[key] as number} onChange={(e) => setS({ ...s, [key]: Number(e.target.value) })} />
      <div className="hint">{hint}</div>
    </div>
  );

  const save = async () => {
    setBusy(true);
    try {
      setS(await put<SecuritySettings>('/api/settings/security', s));
      setMsg({ ok: true, text: 'Saved.' });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h3>Lockout & sessions</h3>
      </div>
      <div className="grid grid-3" style={{ gap: 14 }}>
        {num('maxFailures', 'Failed tries allowed', 'Before an address is locked out.')}
        {num('windowMinutes', 'Counted over (minutes)', 'How far back failures count.')}
        {num('lockoutMinutes', 'Lockout length (minutes)', 'How long the lock lasts.')}
        {num('sessionHours', 'Normal sign-in lasts (hours)', 'When "Remember me" is off.')}
        {num('rememberDays', '"Remember me" lasts (days)', 'When "Remember me" is on.')}
      </div>
      <hr className="divider" />
      <label className="row" style={{ alignItems: 'flex-start', gap: 14, cursor: 'pointer' }}>
        <input type="checkbox" className="switch" checked={s.trustProxyHeaders} onChange={(e) => setS({ ...s, trustProxyHeaders: e.target.checked })} />
        <div>
          <div style={{ fontWeight: 500 }}>Read real visitor addresses from Cloudflare / reverse proxy</div>
          <div className="hint" style={{ marginTop: 2 }}>
            Keep this on if you reach CoastGuarrd through a Cloudflare tunnel or reverse proxy. It's only trusted when the proxy is on your own network, so outsiders can't fake it.
          </div>
        </div>
      </label>
      {msg && <div style={{ marginTop: 14 }}><Alert kind={msg.ok ? 'ok' : 'error'}>{msg.text}</Alert></div>}
      <div style={{ marginTop: 16 }}>
        <button className="btn btn-teal" disabled={busy} onClick={() => void save()}>
          {busy ? <Loader2 className="spin" /> : <Save />} Save
        </button>
      </div>
    </div>
  );
}
