import { useState } from 'react';
import type { Play } from '../types';
import { fmtDateTime, fmtSpan, flag, timeAgo } from '../lib/format';
import { PlayMethodBadge, Poster } from './ui';
import PlayDrawer from './PlayDrawer';

/** History rows: a table on desktop, compact rows on phones. Click for details. */
export default function PlayList({ plays, showUser = true, compact = false }: { plays: Play[]; showUser?: boolean; compact?: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  if (compact) {
    return (
      <>
        <div className="list">
          {plays.map((p) => (
            <div key={p.id} className="play-compact" role="button" tabIndex={0} onClick={() => setOpen(p.id)} onKeyDown={(e) => e.key === 'Enter' && setOpen(p.id)}>
              <Poster id={p.posterId} type={p.itemType} size="sm" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="cell-main" style={{ fontWeight: 500 }}>{p.title}</div>
                <div className="cell-sub">
                  {[showUser ? p.userName : null, p.subtitle, p.place ? `${flag(p.countryCode)} ${p.place}` : null].filter(Boolean).join(' · ')}
                </div>
              </div>
              <div style={{ textAlign: 'right', flex: 'none' }}>
                {!p.stoppedAt ? <span className="badge badge-ok">Now</span> : <div className="small muted">{timeAgo(p.startedAt)}</div>}
                <div className="cell-sub">{fmtSpan(p.watchedMs)}</div>
              </div>
            </div>
          ))}
        </div>
        {open != null && <PlayDrawer id={open} onClose={() => setOpen(null)} />}
      </>
    );
  }
  return (
    <>
      <div className="hist-head hist-cols" style={{ display: plays.length ? undefined : 'none' }}>
        <span>Title</span>
        <span className="hide-sm">{showUser ? 'Who' : 'Watched'}</span>
        <span className="hide-sm hide-md">Device</span>
        <span className="hide-sm">Where</span>
        <span>When</span>
      </div>
      <div className="list">
        {plays.map((p) => (
          <div key={p.id} className="hist-row" role="button" tabIndex={0} onClick={() => setOpen(p.id)} onKeyDown={(e) => e.key === 'Enter' && setOpen(p.id)}>
            <Poster id={p.posterId} type={p.itemType} size="sm" />
            <div className="hist-cols">
              <div style={{ minWidth: 0 }}>
                <div className="cell-main" style={{ fontWeight: 500 }}>{p.title}</div>
                <div className="cell-sub">
                  {p.subtitle}
                  <span className="hide-desktop"> · {showUser ? p.userName : fmtSpan(p.watchedMs)}</span>
                </div>
                {p.percent != null && p.source === 'live' && (
                  <div className="mini-progress" title={`${p.percent}% through`}>
                    <span style={{ width: `${p.percent}%` }} />
                  </div>
                )}
              </div>
              <div className="hide-sm" style={{ minWidth: 0 }}>
                <div className="cell-main">{showUser ? p.userName : fmtSpan(p.watchedMs)}</div>
                <div className="cell-sub">{showUser ? fmtSpan(p.watchedMs) : p.completed ? 'Finished' : ''}</div>
              </div>
              <div className="hide-sm hide-md" style={{ minWidth: 0 }}>
                <div className="cell-main">{p.device ?? '—'}</div>
                <div className="cell-sub">
                  {p.client ?? ''} {p.playMethod === 'Transcode' && <PlayMethodBadge method={p.playMethod} />}
                </div>
              </div>
              <div className="hide-sm" style={{ minWidth: 0 }}>
                <div className="cell-main">{p.place ? `${flag(p.countryCode)} ${p.place}` : '—'}</div>
                <div className="cell-sub mono">{p.ip ?? ''}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="small" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(p.startedAt)}</div>
                {!p.stoppedAt && <span className="badge badge-ok" style={{ marginTop: 4 }}>Now</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
      {open != null && <PlayDrawer id={open} onClose={() => setOpen(null)} />}
    </>
  );
}
