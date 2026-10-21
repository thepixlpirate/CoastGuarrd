import { useState, type FormEvent } from 'react';
import { ArrowLeft, Loader2, ShieldCheck } from 'lucide-react';
import { ApiError, post } from '../api';
import { useAuth } from '../auth';
import AuthCard from '../components/AuthCard';
import { Alert, Field, OtpInput, PasswordField } from '../components/Fields';

export default function Login() {
  const { refresh } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const signIn = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await post<{ ok?: boolean; twoFactorRequired?: boolean; challenge?: string }>('/api/auth/login', { username, password, remember });
      if (res.twoFactorRequired && res.challenge) {
        setChallenge(res.challenge);
        setCode('');
      } else {
        await refresh();
      }
    } catch (err) {
      setError((err as Error).message);
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value = code) => {
    if (value.length !== 6 || busy) return;
    setBusy(true);
    setError('');
    try {
      await post('/api/auth/login/2fa', { challenge, code: value });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
      setCode('');
      if (err instanceof ApiError && err.data.restart) {
        setChallenge(null);
        setPassword('');
      }
    } finally {
      setBusy(false);
    }
  };

  if (challenge) {
    return (
      <AuthCard title="One-Time Password">
        <div className="row" style={{ justifyContent: 'center', marginBottom: 14, color: 'var(--teal-strong)' }}>
          <ShieldCheck size={34} />
        </div>
        <p className="muted small" style={{ textAlign: 'center', margin: '0 0 18px' }}>
          Enter the 6-digit code from your authenticator app.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
        >
          <OtpInput value={code} onChange={setCode} onComplete={(v) => void verify(v)} disabled={busy} />
          {error && <div style={{ marginBottom: 16 }}><Alert kind="error">{error}</Alert></div>}
          <button className="btn btn-primary btn-block btn-auth" disabled={busy || code.length !== 6}>
            {busy ? <Loader2 className="spin" /> : 'Verify'}
          </button>
        </form>
        <button
          className="btn btn-ghost btn-block"
          style={{ marginTop: 10 }}
          onClick={() => {
            setChallenge(null);
            setPassword('');
            setError('');
          }}
        >
          <ArrowLeft /> Back
        </button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Sign in">
      <form onSubmit={signIn} noValidate>
        <Field label="Username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required error={!!error} />
        <PasswordField label="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required error={!!error} />
        <div className="auth-actions">
          <label className="check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember me
          </label>
        </div>
        {error && <div style={{ marginBottom: 16 }}><Alert kind="error">{error}</Alert></div>}
        <button className="btn btn-primary btn-block btn-auth" disabled={busy || !username || !password}>
          {busy ? <Loader2 className="spin" /> : 'Sign in'}
        </button>
      </form>
    </AuthCard>
  );
}
