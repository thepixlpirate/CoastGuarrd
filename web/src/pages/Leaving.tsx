import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus, Check, Copy, Eye, Flag, Hand, Loader2, ShieldCheck, Trash2, X } from 'lucide-react';
import { post } from '../api';
import { usePoll } from '../lib/usePoll';
import { daysText, fmtBytes, fmtDateTime, plural, timeAgo } from '../lib/format';
import type { EvalResult, FlagView, KeepRequest } from '../types';
import { Empty, Segmented, Stat } from '../components/ui';
import { Alert } from '../components/Fields';

interface Resp {
  preview: boolean;
  rows: FlagView[];
  totalBytes: number;
  keepRequests: KeepRequest[];
  familyLink: string | null;
  lastEvaluation: EvalResult | null;
}

function FlagCard({ f, onDone, onError }: { f: FlagView; onDone: () => void; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<'keep' | 'extend' | 'move' | null>(null);
  const [imgFailed, setImgFailed] = useState(false);
  const act = async (path: string, body: unknown = {}) => {
    setBusy(true);
    try {
      await post(`/api/leaving/${f.id}/${path}`, body);
      onDone();
    } catch (err) {
      onError(`${f.title}: ${(err as Error).message}`);
    } finally {
      setBusy(false);
      setMenu(null);
    }
  };
  const urgent = f.daysLeft <= 3;
  return (
    <div className="card flag-card">
      <div className="flag-poster">
        {f.jfId && !imgFailed ? <img src={`/api/leaving/${f.id}/poster`} alt="" loading="lazy" onError={() => setImgFailed(true)} /> : <div className="poster poster-lg"><Flag /></div>}
      </div>
      <div className="flag-body">
        <div className="row row-wrap" style={{ gap: 6 }}>
          <span className={`badge ${urgent ? 'badge-bad' : 'badge-warn'}`}>{f.daysLeft <= 0 ? 'Moving today' : `${daysText(f.daysLeft)} left`}</span>
          {f.preview && <span className="badge badge-purple">Preview</span>}
          {f.keepRequests && <span className="badge badge-ok"><Hand size={11} /> {f.keepRequests.names} asked to keep</span>}
        </div>
        <div className="cell-main" style={{ fontWeight: 600, fontSize: 16, marginTop: 6 }} title={f.title}>{f.title}{f.year ? ` (${f.year})` : ''}</div>
        <div className="cell-sub">{f.ruleName}{f.library ? ` · ${f.library}` : ''} · {fmtBytes(f.sizeBytes)}</div>
        <div className="small muted" style={{ marginTop: 6 }}>
          {f.lastWatchedAt ? `Last watched ${timeAgo(f.lastWatchedAt)}` : 'Never watched'}
          {f.requestedBy ? ` · requested by ${f.requestedBy}` : ''}
        </div>
        {f.details.length > 0 && (
          <div className="cell-sub" style={{ whiteSpace: 'normal', marginTop: 4 }}>
            {f.details.map((d) => `${d.label}: ${d.actual}`).join(' · ')}
          </div>
        )}
        {f.lastError && <div className="small" style={{ color: 'var(--amber)', marginTop: 6 }}>{f.lastError}</div>}
        <div className="faint small" style={{ marginTop: 6 }}>Moves to the recycle bin {fmtDateTime(f.deleteAt)}</div>
        <div className="row row-wrap" style={{ gap: 6, marginTop: 12 }}>
          {busy ? (
            <Loader2 className="spin" />
          ) : menu === 'keep' ? (
            <>
              <span className="small muted">Keep for</span>
              <button className="btn btn-sm btn-teal" onClick={() => void act('keep', { days: 30 })}>30 days</button>
              <button className="btn btn-sm btn-teal" onClick={() => void act('keep', { days: 90 })}>90 days</button>
              <button className="btn btn-sm btn-teal" onClick={() => void act('keep', { days: null })}>Forever</button>
              <button className="btn btn-sm btn-ghost icon-btn" onClick={() => setMenu(null)} aria-label="Cancel"><X /></button>
            </>
          ) : menu === 'extend' ? (
            <>
              <span className="small muted">Add</span>
              <button className="btn btn-sm" onClick={() => void act('extend', { days: 7 })}>7 days</button>
              <button className="btn btn-sm" onClick={() => void act('extend', { days: 30 })}>30 days</button>
              <button className="btn btn-sm btn-ghost icon-btn" onClick={() => setMenu(null)} aria-label="Cancel"><X /></button>
            </>
          ) : menu === 'move' ? (
            <>
              <span className="small muted">Move to the recycle bin now?</span>
              <button className="btn btn-sm btn-danger" onClick={() => void act('move')}>Yes, move it</button>
              <button className="btn btn-sm btn-ghost icon-btn" onClick={() => setMenu(null)} aria-label="Cancel"><X /></button>
            </>
          ) : (
            <>
              <button className="btn btn-sm btn-teal" onClick={() => setMenu('keep')}><ShieldCheck /> Keep</button>
              <button className="btn btn-sm" onClick={() => setMenu('extend')}><CalendarPlus /> More time</button>
              <button className="btn btn-sm btn-ghost" onClick={() => setMenu('move')}><Trash2 /> Move now</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Leaving() {
  const { data, error, reload } = usePoll<Resp>('/api/leaving', 30_000);
  const [sort, setSort] = useState<'soon' | 'size'>('soon');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const respond = async (id: number, action: 'approve' | 'decline') => {
    await post(`/api/keep-requests/${id}`, { action, days: 90 });
    await reload();
  };

  const rows = data ? [...data.rows].sort((a, b) => (sort === 'size' ? (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0) : a.deleteAt - b.deleteAt)) : [];

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ flex: 1 }}>
          <h1>Leaving soon</h1>
          <p>Titles marked for removal and their countdowns. When a countdown ends, the title moves to the recycle bin — it’s never deleted until you empty the bin.</p>
        </div>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <div style={{ marginBottom: 14 }}><Alert kind={msg.ok ? 'ok' : 'error'}>{msg.text}</Alert></div>}
      {!data && !error && <Loader2 className="spin" />}
      {data && (
        <>
          {data.preview && (
            <div className="preview-banner">
              <Eye />
              <div style={{ flex: 1 }}>
                <strong>Preview mode is on.</strong> <span className="muted">These are what your rules would flag. No posters have changed and nothing will move until you turn preview mode off.</span>
              </div>
              <Link to="/settings/general" className="btn btn-sm hide-mobile">Change</Link>
            </div>
          )}
          <div className="grid grid-3" style={{ marginBottom: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))' }}>
            <Stat label="Marked for removal" value={data.rows.length} />
            <Stat label="Space it would free" value={fmtBytes(data.totalBytes)} />
            <Stat label="Leaving this week" value={data.rows.filter((r) => r.daysLeft <= 7).length} />
            <Stat label="Keep requests" value={<span style={{ color: data.keepRequests.length ? 'var(--teal-strong)' : undefined }}>{data.keepRequests.length}</span>} />
          </div>

          {data.keepRequests.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <h3 style={{ marginBottom: 6 }}>Family asked to keep</h3>
              <div className="list">
                {data.keepRequests.map((k) => (
                  <div key={k.id} className="list-item keep-row">
                    <Hand size={20} color="var(--teal-strong)" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500 }}>{k.name} wants to keep “{k.title}”</div>
                      <div className="cell-sub" style={{ whiteSpace: 'normal' }}>{k.message ? `“${k.message}” · ` : ''}{timeAgo(k.at)}</div>
                    </div>
                    <button className="btn btn-sm btn-teal" onClick={() => void respond(k.id, 'approve')}><Check /> Keep 90 days</button>
                    <button className="btn btn-sm btn-ghost icon-btn" onClick={() => void respond(k.id, 'decline')} aria-label="Decline"><X /></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="filters">
            <Segmented value={sort} onChange={setSort} options={[{ value: 'soon', label: 'Leaving first' }, { value: 'size', label: 'Biggest first' }]} />
            {data.familyLink && (
              <button
                className="btn btn-sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(window.location.origin + data.familyLink).then(() => setMsg({ ok: true, text: 'Family link copied — share it so family can ask to keep titles.' }));
                }}
              >
                <Copy /> Copy family link
              </button>
            )}
            {data.lastEvaluation && <span className="faint small">Rules last checked {timeAgo(data.lastEvaluation.at)}</span>}
          </div>

          {rows.length === 0 ? (
            <Empty icon={<Flag />} title="Nothing is leaving">
              {data.lastEvaluation ? 'No titles match your rules right now.' : 'Set up a rule on the '}
              {!data.lastEvaluation && <Link to="/rules">Rules page</Link>}
              {!data.lastEvaluation && ' and press “Check rules now”.'}
            </Empty>
          ) : (
            <div className="flag-grid">
              {rows.map((f) => (
                <FlagCard key={f.id} f={f} onDone={() => void reload()} onError={(m) => setMsg({ ok: false, text: m })} />
              ))}
            </div>
          )}
          {rows.length > 0 && <p className="faint small" style={{ marginTop: 14 }}>{plural(rows.length, 'title')} · posters show the banner your family sees in Jellyfin{data.preview ? ' (once preview mode is off)' : ''}.</p>}
        </>
      )}
    </div>
  );
}
