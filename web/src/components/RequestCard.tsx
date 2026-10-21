import { Link } from 'react-router-dom';
import { CheckCircle2, CircleDashed, Eye, EyeOff } from 'lucide-react';
import type { RequestItem } from '../types';
import { timeAgo } from '../lib/format';
import { TmdbPoster } from './ui';

export default function RequestCard({ r, showUser = true }: { r: RequestItem; showUser?: boolean }) {
  const watched = r.requester.plays > 0;
  const statusClass = r.status === 'Declined' || r.status === 'Failed' ? 'badge-bad' : r.status === 'Pending' ? 'badge-warn' : r.available ? 'badge-ok' : 'badge-purple';
  return (
    <div className="card req-card">
      <TmdbPoster path={r.poster} type={r.type} size="md" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="cell-main" style={{ fontWeight: 600, fontSize: 15.5 }} title={r.title}>{r.title}</div>
        <div className="cell-sub">
          {r.type === 'tv' ? 'Show' : 'Movie'}
          {r.year ? ` · ${r.year}` : ''}
          {r.seasons.length ? ` · season${r.seasons.length > 1 ? 's' : ''} ${r.seasons.join(', ')}` : ''}
          {r.is4k ? ' · 4K' : ''}
        </div>
        <div className="chips" style={{ marginTop: 8 }}>
          <span className={`badge ${statusClass}`}>{r.available ? r.mediaStatus : r.status}</span>
        </div>
        <div className="small" style={{ marginTop: 8, color: 'var(--text-dim)' }}>
          {showUser && (
            <>
              {r.requestedBy.id ? <Link to={`/users/${r.requestedBy.id}`}>{r.requestedBy.name}</Link> : r.requestedBy.name} ·{' '}
            </>
          )}
          requested {timeAgo(r.createdAt)}
        </div>
        {r.available && (
          <div className="row small" style={{ gap: 6, marginTop: 6, color: watched ? 'var(--teal-strong)' : 'var(--amber)' }}>
            {watched ? (r.requester.completed ? <CheckCircle2 size={14} /> : <Eye size={14} />) : <EyeOff size={14} />}
            {watched
              ? `${showUser ? 'Requester watched' : 'Watched'} ${r.requester.completed ? 'it' : 'some of it'} · ${timeAgo(r.requester.lastAt)}`
              : `${showUser ? 'Requester hasn’t' : 'Hasn’t'} watched it yet`}
          </div>
        )}
        {r.available && (
          <div className="row small faint" style={{ gap: 6, marginTop: 2 }}>
            <CircleDashed size={14} />
            {r.otherViewers ? `${r.otherViewers} other ${r.otherViewers === 1 ? 'person' : 'people'} watched` : 'Nobody else has watched'}
          </div>
        )}
      </div>
    </div>
  );
}
