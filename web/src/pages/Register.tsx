import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { post } from '../api';
import { useAuth } from '../auth';
import AuthCard from '../components/AuthCard';
import { Alert, Field, PasswordField, StrengthMeter } from '../components/Fields';

export default function Register() {
  const { refresh } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const tooShort = password.length > 0 && password.length < 10;
  const mismatch = confirm.length > 0 && confirm !== password;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError('The passwords do not match.');
    setBusy(true);
    setError('');
    try {
      await post('/api/auth/register', { username, password });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Create your admin account">
      <p className="muted small" style={{ textAlign: 'center', margin: '-10px 0 22px' }}>
        This is the only account that can sign in. Pick a strong password — this page may be reachable from the internet.
      </p>
      <form onSubmit={submit} noValidate>
        <Field label="Username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        <PasswordField label="Password (10+ characters)" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={tooShort} />
        <StrengthMeter password={password} />
        <PasswordField label="Confirm password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={mismatch} />
        {error && <div style={{ marginBottom: 16 }}><Alert kind="error">{error}</Alert></div>}
        <button className="btn btn-primary btn-block btn-auth" disabled={busy || username.length < 3 || password.length < 10 || password !== confirm}>
          {busy ? <Loader2 className="spin" /> : 'Create account'}
        </button>
      </form>
    </AuthCard>
  );
}
