import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { usePoll } from '../lib/usePoll';
import { fmtBitrate, fmtDateTime, fmtDuration, fmtSpan, flag } from '../lib/format';
import type { AlertItem, Play } from '../types';
import { PlayMethodBadge, Poster, SeverityBadge } from './ui';

/** Side panel with everything known about one play. */
export default function PlayDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const { data } = usePoll<Play & { alerts: AlertItem[] }>(`/api/history/${id}`);
  return (
    <>
      <div className="drawer-back" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Play details">
        <div className="row" style={{ marginBottom: 16 }}>
          <h3 style={{ flex: 1 }}>Play details</h3>
          <button className="btn btn-ghost icon-btn" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        {data && (
          <>
            <div className="row" style={{ gap: 16, alignItems: 'flex-start', marginBottom: 18 }}>
              <Poster id={data.posterId} type={data.itemType} size="lg" />
              <div style={{ minWidth: 0 }}>
                <h2 style={{ fontSize: 20 }}>{data.title}</h2>
                <div className="muted">{data.subtitle}</div>
                <div className="chips" style={{ marginTop: 10 }}>
                  <PlayMethodBadge method={data.playMethod} video={data.transcodeVideo} audio={data.transcodeAudio} />
                  {data.completed && <span className="badge badge-ok">Finished</span>}
                  {data.source !== 'live' && <span className="badge" title="Brought in from Jellyfin's history">Imported</span>}
                  {!data.stoppedAt && <span className="badge badge-purple">Still playing</span>}
                </div>
              </div>
            </div>
            <dl className="kv">
              <dt>Who</dt>
              <dd><Link to={`/users/${data.userId}`}>{data.userName}</Link></dd>
              <dt>Started</dt>
              <dd>{fmtDateTime(data.startedAt)}</dd>
              <dt>Stopped</dt>
              <dd>{data.stoppedAt ? fmtDateTime(data.stoppedAt) : '—'}</dd>
              <dt>Watched for</dt>
              <dd>{fmtSpan(data.watchedMs)}{data.runtimeMs ? ` of ${fmtSpan(data.runtimeMs)}` : ''}</dd>
              {data.source === 'live' && (
                <>
                  <dt>Paused</dt>
                  <dd>{data.pauseCount ? `${data.pauseCount}× · ${fmtSpan(data.pausedMs)}` : 'Never'}</dd>
                  <dt>Stopped at</dt>
                  <dd>{fmtDuration(data.positionMs)}{data.percent != null ? ` (${data.percent}%)` : ''}</dd>
                </>
              )}
              <dt>Device</dt>
              <dd>{data.device ?? '—'}</dd>
              <dt>App</dt>
              <dd>{[data.client, data.clientVersion].filter(Boolean).join(' ') || '—'}</dd>
              <dt>Location</dt>
              <dd>{data.place ? `${flag(data.countryCode)} ${data.place}` : '—'}</dd>
              <dt>Address</dt>
              <dd className="mono">{data.ip ?? '—'}</dd>
              <dt>Quality</dt>
              <dd>{[data.resolution, data.videoCodec?.toUpperCase(), data.audioCodec?.toUpperCase(), data.container?.toUpperCase()].filter(Boolean).join(' · ') || '—'}</dd>
              <dt>Bitrate</dt>
              <dd>{fmtBitrate(data.bitrate)}</dd>
              {data.transcodeReasons.length > 0 && (
                <>
                  <dt>Transcode reason</dt>
                  <dd>{data.transcodeReasons.map((r) => r.replace(/([a-z])([A-Z])/g, '$1 $2')).join(', ')}</dd>
                </>
              )}
            </dl>
            {data.alerts.length > 0 && (
              <>
                <hr className="divider" />
                <h3 style={{ fontSize: 15, marginBottom: 10 }}>Alerts from this play</h3>
                <div className="stack">
                  {data.alerts.map((a) => (
                    <div key={a.id} className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                      <SeverityBadge severity={a.severity} />
                      <span className="small">{a.title}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </aside>
    </>
  );
}
