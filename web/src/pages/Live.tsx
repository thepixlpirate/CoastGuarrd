import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, Cpu, Gauge, Loader2, MapPin, MessageSquare, MonitorPlay, Pause, Square, X } from 'lucide-react';
import { post } from '../api';
import { usePoll } from '../lib/usePoll';
import { fmtBitrate, fmtDuration, flag, timeAgo } from '../lib/format';
import type { LiveResponse, LiveStream } from '../types';
import { Avatar, Empty, PlayMethodBadge, Poster, Stat } from '../components/ui';
import { Alert } from '../components/Fields';

function ControlModal({ stream, mode, onClose, onDone }: { stream: LiveStream; mode: 'stop' | 'message'; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState(mode === 'stop' ? '' : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      if (mode === 'stop') await post(`/api/live/${encodeURIComponent(stream.sessionId)}/stop`, { message: text });
      else await post(`/api/live/${encodeURIComponent(stream.sessionId)}/message`, { text });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={mode === 'stop' ? 'Stop stream' : 'Send message'}>
        <div className="row" style={{ marginBottom: 6 }}>
          <h3 style={{ flex: 1 }}>{mode === 'stop' ? 'Stop this stream?' : 'Send a message'}</h3>
          <button className="btn btn-ghost icon-btn" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        <p className="muted small" style={{ marginTop: 0 }}>
          {stream.userName} · {stream.title} on {stream.device ?? 'their device'}
        </p>
        <label className="label">{mode === 'stop' ? 'Message to show them first (optional)' : 'Message'}</label>
        <textarea
          className="input"
          style={{ height: 90, padding: 10, resize: 'vertical' }}
          maxLength={300}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={mode === 'stop' ? 'e.g. Please don’t share your account.' : 'e.g. Server restarting in 5 minutes.'}
          autoFocus
        />
        <div className="hint">Not every Jellyfin app can show messages — most TV and web apps can.</div>
        {error && <div style={{ marginTop: 12 }}><Alert kind="error">{error}</Alert></div>}
        <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className={`btn ${mode === 'stop' ? 'btn-danger' : 'btn-primary'}`} disabled={busy || (mode === 'message' && !text.trim())} onClick={() => void submit()}>
            {busy ? <Loader2 className="spin" /> : mode === 'stop' ? <Square /> : <MessageSquare />}
            {mode === 'stop' ? 'Stop stream' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

function StreamCard({ s, onControl }: { s: LiveStream; onControl: (mode: 'stop' | 'message') => void }) {
  const pct = s.runtimeMs ? Math.min(100, (s.positionMs / s.runtimeMs) * 100) : 0;
  const quality = [s.resolution, s.videoCodec?.toUpperCase(), s.audioCodec?.toUpperCase()].filter(Boolean).join(' · ');
  return (
    <div className="card stream">
      <div className="stream-bg" style={{ backgroundImage: `url(/api/img/item/${s.posterId}?h=200)` }} />
      <div className="stream-body">
        <Poster id={s.posterId} type={s.itemType} size="md" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: 8, marginBottom: 4 }}>
            {s.paused ? <span className="badge"><Pause size={11} /> Paused</span> : <span className="badge badge-ok"><span className="pulse" /> Playing</span>}
            <PlayMethodBadge method={s.playMethod} video={s.transcodeVideo} audio={s.transcodeAudio} />
          </div>
          <div className="stream-title cell-main" title={s.title}>{s.title}</div>
          <div className="cell-sub">{s.subtitle || ' '}</div>
          <div className="progress" style={{ marginTop: 10 }}>
            {s.transcodeProgress != null && <span className="buffer" style={{ width: `${s.transcodeProgress}%` }} />}
            <span style={{ width: `${pct}%` }} />
          </div>
          <div className="row small faint" style={{ justifyContent: 'space-between', marginTop: 4 }}>
            <span>{fmtDuration(s.positionMs)}</span>
            <span>{s.runtimeMs ? fmtDuration(s.runtimeMs) : ''}</span>
          </div>
          <dl className="stream-meta">
            <dt>Device</dt>
            <dd title={`${s.device} · ${s.client} ${s.clientVersion ?? ''}`}>{[s.device, s.client].filter(Boolean).join(' · ') || '—'}</dd>
            <dt>Quality</dt>
            <dd>{quality || '—'}{s.bitrate ? ` · ${fmtBitrate(s.bitrate)}` : ''}</dd>
            {s.playMethod === 'Transcode' && s.transcodeReasons.length > 0 && (
              <>
                <dt>Why</dt>
                <dd title={s.transcodeReasons.join(', ')}>{s.transcodeReasons.map((r) => r.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()).join(', ')}{s.hwAccel && s.hwAccel !== 'none' ? ` · ${s.hwAccel}` : ''}</dd>
              </>
            )}
            <dt>Where</dt>
            <dd>
              {flag(s.countryCode)} {s.place ?? 'Unknown'} {s.ip && <span className="faint mono">· {s.ip}</span>}
            </dd>
          </dl>
        </div>
      </div>
      <div className="stream-foot">
        <Link to={`/users/${s.userId}`} className="row" style={{ gap: 8, color: 'inherit', minWidth: 0, flex: 1 }}>
          <Avatar id={s.userId} name={s.userName} hasImage size={26} />
          <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.userName}</span>
          <span className="faint small" style={{ whiteSpace: 'nowrap' }}>· started {timeAgo(s.startedAt)}</span>
        </Link>
        {s.canControl && (
          <>
            <button className="btn btn-ghost btn-sm icon-btn" title="Send message" aria-label="Send message" onClick={() => onControl('message')}>
              <MessageSquare />
            </button>
            <button className="btn btn-danger btn-sm" onClick={() => onControl('stop')}>
              <Square /> Stop
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function Live() {
  const { data, error, reload } = usePoll<LiveResponse>('/api/live', 5000);
  const [control, setControl] = useState<{ stream: LiveStream; mode: 'stop' | 'message' } | null>(null);
  const [notice, setNotice] = useState('');

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ flex: 1 }}>
          <h1>Live activity</h1>
          <p>Everything playing right now. Updates every few seconds.</p>
        </div>
        {data?.poller.lastOkAt && <span className="faint small row" style={{ gap: 6 }}><span className="pulse" /> Checked {timeAgo(data.poller.lastOkAt)}</span>}
      </div>

      {error && <div style={{ marginBottom: 16 }}><Alert kind="error">{error}</Alert></div>}
      {data?.poller.lastError && <div style={{ marginBottom: 16 }}><Alert kind="warn">Can’t reach Jellyfin right now: {data.poller.lastError}</Alert></div>}
      {notice && <div style={{ marginBottom: 16 }}><Alert kind="ok">{notice}</Alert></div>}

      {!data && !error && <Loader2 className="spin" />}
      {data && (
        <>
          <div className="grid grid-3" style={{ marginBottom: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))' }}>
            <Stat label="Streams" value={data.summary.total} icon={<Activity size={16} color="var(--purple-strong)" />} />
            <Stat label="Direct play" value={data.summary.directPlay} icon={<MonitorPlay size={16} color="var(--teal-strong)" />} />
            <Stat label="Transcoding" value={data.summary.transcoding} sub={data.summary.transcoding ? 'Your server is converting video' : undefined} icon={<Cpu size={16} color="var(--amber)" />} />
            <Stat label="Bandwidth" value={fmtBitrate(data.summary.bandwidth)} icon={<Gauge size={16} color="var(--purple-strong)" />} />
          </div>
          {data.streams.length === 0 ? (
            <Empty icon={<MonitorPlay />} title="Nothing playing right now">
              When someone starts watching, it’ll show up here within a few seconds.
            </Empty>
          ) : (
            <div className="live-grid">
              {data.streams.map((s) => (
                <StreamCard key={s.sessionId + s.itemId} s={s} onControl={(mode) => setControl({ stream: s, mode })} />
              ))}
            </div>
          )}
          {data.streams.some((s) => s.lat != null) && (
            <div className="row small faint" style={{ marginTop: 14, gap: 6 }}>
              <MapPin size={14} /> See where these are coming from on the <Link to="/map">map</Link>.
            </div>
          )}
        </>
      )}

      {control && (
        <ControlModal
          stream={control.stream}
          mode={control.mode}
          onClose={() => setControl(null)}
          onDone={() => {
            setNotice(control.mode === 'stop' ? `Stopped ${control.stream.userName}’s stream.` : `Message sent to ${control.stream.userName}.`);
            setControl(null);
            setTimeout(() => void reload(), 2500);
            setTimeout(() => setNotice(''), 6000);
          }}
        />
      )}
    </div>
  );
}
