import { useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Film, Music, Tv, User } from 'lucide-react';

export function Poster({ id, type, size = 'md', alt = '' }: { id?: string | null; type?: string; size?: 'sm' | 'md' | 'lg'; alt?: string }) {
  const [failed, setFailed] = useState(false);
  const Icon = type === 'Episode' || type === 'tv' ? Tv : type === 'Audio' ? Music : Film;
  const square = type === 'Audio';
  return (
    <div className={`poster poster-${size} ${square ? 'poster-square' : ''}`}>
      {id && !failed ? (
        <img src={`/api/img/item/${id}?h=${size === 'lg' ? 450 : 240}`} alt={alt} loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <Icon />
      )}
    </div>
  );
}

export function TmdbPoster({ path, type, size = 'md' }: { path?: string | null; type?: string; size?: 'sm' | 'md' | 'lg' }) {
  const [failed, setFailed] = useState(false);
  const Icon = type === 'tv' ? Tv : Film;
  return (
    <div className={`poster poster-${size}`}>
      {path && !failed ? <img src={`https://image.tmdb.org/t/p/w185${path}`} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <Icon />}
    </div>
  );
}

export function Avatar({ id, name, hasImage, size = 34 }: { id?: string | null; name: string; hasImage?: boolean; size?: number }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="avatar" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {id && hasImage && !failed ? <img src={`/api/img/user/${id}`} alt="" onError={() => setFailed(true)} /> : name ? name.slice(0, 1).toUpperCase() : <User size={size * 0.5} />}
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
      <button className="btn btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
        <ChevronLeft />
      </button>
      <span className="muted small">
        Page {page} of {pages}
      </span>
      <button className="btn btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
        <ChevronRight />
      </button>
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="card coming" style={{ padding: '40px 20px' }}>
      <div className="ring">{icon}</div>
      <h3>{title}</h3>
      {children && <div className="muted" style={{ marginTop: 6, maxWidth: 520, marginInline: 'auto' }}>{children}</div>}
    </div>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  const cls = severity === 'critical' ? 'badge-bad' : severity === 'warning' ? 'badge-warn' : 'badge-purple';
  const label = severity === 'critical' ? 'Critical' : severity === 'warning' ? 'Warning' : 'Info';
  return (
    <span className={`badge ${cls}`}>
      <span className="dot" />
      {label}
    </span>
  );
}

export function TrustMeter({ score }: { score: number }) {
  const color = score >= 80 ? 'var(--teal)' : score >= 50 ? 'var(--amber)' : 'var(--red)';
  return (
    <div className="trust" title={`Trust score ${score} / 100`}>
      <div className="trust-bar">
        <span style={{ width: `${score}%`, background: color }} />
      </div>
      <span className="small" style={{ color: 'var(--text-dim)', minWidth: 26, textAlign: 'right' }}>
        {score}
      </span>
    </div>
  );
}

export function PlayMethodBadge({ method, video, audio }: { method: string | null; video?: boolean; audio?: boolean }) {
  if (method === 'Transcode') {
    const what = video && audio ? 'video + audio' : video ? 'video' : audio ? 'audio' : '';
    return <span className="badge badge-warn" title={what ? `Converting ${what}` : undefined}>Transcode{what ? ` · ${what}` : ''}</span>;
  }
  if (method === 'DirectStream') return <span className="badge badge-purple">Direct stream</span>;
  if (!method) return null;
  return <span className="badge badge-ok">Direct play</span>;
}

export function Stat({ label, value, sub, icon }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="card stat-card">
      <div className="row muted small" style={{ gap: 8 }}>
        {icon}
        {label}
      </div>
      <div className="stat" style={{ marginTop: 8 }}>{value}</div>
      {sub && <div className="small muted">{sub}</div>}
    </div>
  );
}

/** Small segmented control used for filters. */
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} className={value === o.value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
