import { useEffect, useState } from 'react';
import { Check, Film, Hand, Loader2, Tv } from 'lucide-react';
import { api, get } from '../api';
import { Alert } from '../components/Fields';

interface Row {
  id: number;
  title: string;
  year: number | null;
  kind: string;
  daysLeft: number;
  reason: string | null;
  hasPoster: boolean;
}

function NAME_KEY() {
  return 'cg-family-name';
}

/** No sign-in needed: the secret link is the key. */
export default function PublicLeaving({ token }: { token: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const [asking, setAsking] = useState<Row | null>(null);
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem(NAME_KEY()) ?? '';
    } catch {
      return '';
    }
  });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Set<number>>(new Set());
  const [formError, setFormError] = useState('');

  useEffect(() => {
    get<{ rows: Row[] }>(`/api/public/leaving/${encodeURIComponent(token)}`)
      .then((r) => setRows(r.rows))
      .catch((e) => setError((e as Error).message));
  }, [token]);

  const send = async () => {
    if (!asking) return;
    setBusy(true);
    setFormError('');
    try {
      await api(`/api/public/leaving/${encodeURIComponent(token)}/keep`, { method: 'POST', body: { id: asking.id, name, message } });
      try {
        localStorage.setItem(NAME_KEY(), name);
      } catch {
        /* private mode */
      }
      setSent(new Set([...sent, asking.id]));
      setAsking(null);
      setMessage('');
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="backdrop" style={{ minHeight: '100%' }}>
      <div className="public-wrap">
        <div className="row" style={{ gap: 12, marginBottom: 18 }}>
          <img src="/logo.png" alt="" width={48} height={48} />
          <div>
            <div className="grad-text" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22 }}>Leaving soon</div>
            <div className="muted small">These haven’t been watched in a while and will be removed from the server. Want one kept? Tap “Keep it”.</div>
          </div>
        </div>
        {error && <Alert kind="error">{error}</Alert>}
        {!rows && !error && <Loader2 className="spin" />}
        {rows && rows.length === 0 && <div className="card muted">Nothing is leaving right now. 🎉</div>}
        <div className="public-grid">
          {rows?.map((r) => (
            <div key={r.id} className="card public-card">
              <div className="public-poster">
                {r.hasPoster ? <img src={`/api/public/poster/${encodeURIComponent(token)}/${r.id}`} alt="" loading="lazy" /> : r.kind === 'show' ? <Tv /> : <Film />}
              </div>
              <div style={{ padding: 12 }}>
                <div style={{ fontWeight: 600, lineHeight: 1.25 }}>{r.title}{r.year ? ` (${r.year})` : ''}</div>
                <div className="small" style={{ color: r.daysLeft <= 3 ? 'var(--red)' : 'var(--amber)', marginTop: 4 }}>
                  {r.daysLeft <= 0 ? 'Leaving today' : `Leaving in ${r.daysLeft} day${r.daysLeft === 1 ? '' : 's'}`}
                </div>
                {sent.has(r.id) ? (
                  <div className="small row" style={{ gap: 6, marginTop: 10, color: 'var(--teal-strong)' }}><Check size={15} /> Request sent</div>
                ) : (
                  <button className="btn btn-sm btn-teal" style={{ marginTop: 10, width: '100%' }} onClick={() => setAsking(r)}>
                    <Hand /> Keep it
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      {asking && (
        <div className="modal-back" onClick={() => setAsking(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Ask to keep">
            <h3 style={{ marginBottom: 6 }}>Keep “{asking.title}”?</h3>
            <p className="muted small" style={{ marginTop: 0 }}>The server owner will see your request.</p>
            <label className="label">Your name</label>
            <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus />
            <label className="label" style={{ marginTop: 12 }}>Anything to add? (optional)</label>
            <input className="input" value={message} maxLength={300} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. I’m halfway through it" />
            {formError && <div style={{ marginTop: 12 }}><Alert kind="error">{formError}</Alert></div>}
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn" onClick={() => setAsking(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => void send()}>
                {busy ? <Loader2 className="spin" /> : <Hand />} Send request
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
