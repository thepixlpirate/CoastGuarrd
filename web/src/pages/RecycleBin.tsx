import { useState } from 'react';
import { ArchiveRestore, Download, FolderOpen, HardDrive, History, Loader2, Trash2, X } from 'lucide-react';
import { post } from '../api';
import { usePoll } from '../lib/usePoll';
import { fmtBytes, fmtDateTime, plural, timeAgo } from '../lib/format';
import type { BinRow } from '../types';
import { Empty, Stat } from '../components/ui';
import { Alert } from '../components/Fields';

type Tab = 'bin' | 'downloads' | 'history';

interface BinResp {
  rows: BinRow[];
  totalBytes: number;
  drives: { path: string; total: number; free: number; binBytes: number }[];
}

function ConfirmEmpty({ count, bytes, onClose, onDone }: { count: number; bytes: number; onClose: () => void; onDone: (m: string) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    setBusy(true);
    try {
      const r = await post<{ deleted: number; errors: string[] }>('/api/recycle/empty', { confirm: 'EMPTY' });
      onDone(`Deleted ${plural(r.deleted, 'title')} for good.${r.errors.length ? ` ${r.errors.length} couldn’t be deleted: ${r.errors[0]}` : ''}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Empty recycle bin">
        <div className="row" style={{ marginBottom: 6 }}>
          <h3 style={{ flex: 1 }}>Empty the recycle bin?</h3>
          <button className="btn btn-ghost icon-btn" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <p className="muted">This permanently deletes {plural(count, 'title')} ({fmtBytes(bytes)}). It can’t be undone.</p>
        <label className="label">Type EMPTY to confirm</label>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} autoFocus autoCapitalize="characters" />
        {error && <div style={{ marginTop: 12 }}><Alert kind="error">{error}</Alert></div>}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-danger" disabled={busy || text !== 'EMPTY'} onClick={() => void go()}>
            {busy ? <Loader2 className="spin" /> : <Trash2 />} Delete forever
          </button>
        </div>
      </div>
    </div>
  );
}

function BinTab() {
  const { data, reload } = usePoll<BinResp>('/api/recycle', 30_000);
  const [busy, setBusy] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [emptying, setEmptying] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const act = async (row: BinRow, action: 'restore' | 'delete') => {
    setBusy(row.id);
    setMsg(null);
    try {
      await post(`/api/recycle/${row.id}/${action}`, action === 'delete' ? { confirm: true } : {});
      setMsg({ ok: true, text: action === 'restore' ? `“${row.title}” is back where it was. Radarr/Sonarr and Jellyfin have been told.` : `“${row.title}” was deleted for good.` });
      await reload();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(null);
      setConfirmId(null);
    }
  };

  if (!data) return <Loader2 className="spin" />;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="grid grid-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))' }}>
        <Stat label="In the bin" value={data.rows.length} />
        <Stat label="Space you can free" value={fmtBytes(data.totalBytes)} />
        {data.drives.map((d) => (
          <Stat key={d.path} label="Drive free space" value={fmtBytes(d.free)} sub={`of ${fmtBytes(d.total)} · ${fmtBytes(d.binBytes)} in this bin`} icon={<HardDrive size={16} color="var(--purple-strong)" />} />
        ))}
      </div>
      {msg && <Alert kind={msg.ok ? 'ok' : 'error'}>{msg.text}</Alert>}
      {data.rows.length === 0 ? (
        <Empty icon={<Trash2 />} title="The recycle bin is empty">Titles land here when their Leaving Soon countdown ends. Nothing is ever deleted unless you do it here.</Empty>
      ) : (
        <>
          <div className="row">
            <div className="spacer" />
            <button className="btn btn-danger" onClick={() => setEmptying(true)}><Trash2 /> Empty recycle bin</button>
          </div>
          <div className="card" style={{ padding: 4 }}>
            {data.rows.map((r) => (
              <div key={r.id} className="lib-row" style={{ alignItems: 'flex-start' }}>
                <div className="svc-icon" style={{ background: 'var(--surface-2)', color: 'var(--text-dim)' }}>
                  {r.kind === 'download' ? <Download size={18} /> : <FolderOpen size={18} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="cell-main" style={{ fontWeight: 600 }}>{r.title}{r.year ? ` (${r.year})` : ''}</div>
                  <div className="cell-sub">{fmtBytes(r.size_bytes)} · moved {timeAgo(r.moved_at)}{r.rule_name ? ` · ${r.rule_name}` : ''}</div>
                  <div className="cell-sub mono" title={r.original_path}>From {r.original_path}</div>
                </div>
                <div className="row row-wrap" style={{ gap: 6, justifyContent: 'flex-end' }}>
                  {busy === r.id ? (
                    <Loader2 className="spin" />
                  ) : confirmId === r.id ? (
                    <>
                      <span className="small muted">Delete for good?</span>
                      <button className="btn btn-sm btn-danger" onClick={() => void act(r, 'delete')}>Delete</button>
                      <button className="btn btn-sm btn-ghost icon-btn" onClick={() => setConfirmId(null)} aria-label="Cancel"><X /></button>
                    </>
                  ) : (
                    <>
                      <button className="btn btn-sm btn-teal" onClick={() => void act(r, 'restore')}><ArchiveRestore /> Restore</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setConfirmId(r.id)}><Trash2 /> Delete forever</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {emptying && (
        <ConfirmEmpty
          count={data.rows.length}
          bytes={data.totalBytes}
          onClose={() => setEmptying(false)}
          onDone={(m) => {
            setEmptying(false);
            setMsg({ ok: true, text: m });
            void reload();
          }}
        />
      )}
    </div>
  );
}

function DownloadsTab() {
  const { data, reload } = usePoll<{ path: string; ageDays: number; rows: { name: string; size: number; modifiedAt: number }[] }>('/api/downloads/leftovers');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!data) return <Loader2 className="spin" />;
  if (!data.path) return <Empty icon={<Download />} title="No downloads folder set">Pick your downloads folder in Settings → General to see leftover downloads here.</Empty>;
  return (
    <div className="stack" style={{ gap: 14 }}>
      <p className="muted small" style={{ margin: 0 }}>
        Things in <code>{data.path}</code> untouched for more than {data.ageDays} days. Usually these are leftovers that never made it into your library — but check that nothing is still seeding before moving.
      </p>
      {msg && <Alert kind={msg.ok ? 'ok' : 'error'}>{msg.text}</Alert>}
      {data.rows.length === 0 ? (
        <Empty icon={<Download />} title="No leftovers">Nothing old is sitting in your downloads folder.</Empty>
      ) : (
        <div className="card" style={{ padding: 4 }}>
          {data.rows.map((r) => (
            <div key={r.name} className="lib-row">
              <Download size={18} color="var(--text-dim)" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="cell-main mono" style={{ fontWeight: 500 }} title={r.name}>{r.name}</div>
                <div className="cell-sub">{fmtBytes(r.size)} · last changed {timeAgo(r.modifiedAt)}</div>
              </div>
              <button
                className="btn btn-sm btn-ghost"
                disabled={busy === r.name}
                onClick={async () => {
                  setBusy(r.name);
                  try {
                    await post('/api/downloads/leftovers/move', { name: r.name });
                    setMsg({ ok: true, text: `Moved “${r.name}” to the recycle bin.` });
                    await reload();
                  } catch (err) {
                    setMsg({ ok: false, text: (err as Error).message });
                  } finally {
                    setBusy('');
                  }
                }}
              >
                {busy === r.name ? <Loader2 className="spin" /> : <Trash2 />} Move to bin
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const ACTIONS: Record<string, string> = {
  flagged: 'Flagged',
  'flagged (preview)': 'Flagged (preview)',
  unflagged: 'Un-flagged',
  kept: 'Kept',
  extended: 'Given more time',
  moved: 'Moved to recycle bin',
  restored: 'Restored',
  deleted: 'Deleted forever',
  gone: 'Removed outside CoastGuarrd',
};

function HistoryTab() {
  const { data } = usePoll<{ id: number; at: number; title: string | null; action: string; detail: string | null }[]>('/api/recycle/history');
  if (!data) return <Loader2 className="spin" />;
  if (!data.length) return <Empty icon={<History />} title="Nothing yet">Every flag, keep, move, restore and delete is listed here.</Empty>;
  return (
    <div className="card">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>What happened</th>
              <th>Title</th>
              <th className="hide-mobile">Details</th>
            </tr>
          </thead>
          <tbody>
            {data.map((h) => {
              let detail = h.detail ?? '';
              try {
                const d = JSON.parse(detail) as Record<string, unknown>;
                detail = [d.rule && `Rule: ${d.rule}`, d.reason, d.days !== undefined && (d.days === null ? 'Forever' : `${d.days} days`), d.to && `To ${d.to}`].filter(Boolean).join(' · ');
              } catch {
                /* plain text */
              }
              return (
                <tr key={h.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(h.at)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span className={`badge ${h.action === 'deleted' ? 'badge-bad' : h.action === 'moved' ? 'badge-warn' : h.action === 'restored' || h.action === 'kept' ? 'badge-ok' : ''}`}>{ACTIONS[h.action] ?? h.action}</span>
                  </td>
                  <td>{h.title ?? '—'}</td>
                  <td className="hide-mobile faint small">{detail}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function RecycleBin() {
  const [tab, setTab] = useState<Tab>('bin');
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Recycle bin</h1>
          <p>Removed titles wait here, on the same drive, until you restore them or delete them yourself. CoastGuarrd never empties this on its own.</p>
        </div>
      </div>
      <div className="tabs">
        <button className={tab === 'bin' ? 'active' : ''} onClick={() => setTab('bin')}><Trash2 /> In the bin</button>
        <button className={tab === 'downloads' ? 'active' : ''} onClick={() => setTab('downloads')}><Download /> Leftover downloads</button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><History /> History</button>
      </div>
      {tab === 'bin' && <BinTab />}
      {tab === 'downloads' && <DownloadsTab />}
      {tab === 'history' && <HistoryTab />}
    </div>
  );
}
