import { Link } from 'react-router-dom';
import { Check, Globe2, KeyRound, Laptop, MapPinned, Network, Plane, RotateCcw, Tv2, X } from 'lucide-react';
import { post } from '../api';
import { fmtDateTime } from '../lib/format';
import type { AlertItem } from '../types';
import { SeverityBadge } from './ui';

const ICONS: Record<string, typeof Plane> = {
  impossibleTravel: Plane,
  simultaneousLocations: MapPinned,
  concurrentStreams: Tv2,
  ipVelocity: Network,
  newDevice: Laptop,
  newCountry: Globe2,
  failedSignIns: KeyRound,
};

function details(a: AlertItem): string[] {
  const d = a.detail as Record<string, unknown>;
  switch (a.rule) {
    case 'impossibleTravel':
      return [`${d.from} → ${d.to}`, `${d.fromIp} → ${d.toIp}`, `About ${Number(d.kmh).toLocaleString()} km/h`];
    case 'simultaneousLocations':
      return [(d.places as string[]).join('  ·  '), (d.ips as string[]).join('  ·  ')];
    case 'concurrentStreams':
      return [(d.titles as string[]).join(', '), (d.devices as string[]).filter(Boolean).join(', ')];
    case 'ipVelocity':
      return [(d.ips as string[]).slice(0, 8).join(', ') + ((d.ips as string[]).length > 8 ? '…' : '')];
    case 'newDevice':
      return [`${d.place ?? ''}${d.ip ? ` · ${d.ip}` : ''}`];
    case 'newCountry':
      return [`${d.place} · ${d.ip}`];
    case 'failedSignIns':
      return [`${d.count} tries in ${d.minutes} minutes`];
    default:
      return [];
  }
}

export default function AlertList({ alerts, onChange, showUser = true }: { alerts: AlertItem[]; onChange: () => void; showUser?: boolean }) {
  const act = async (id: number, action: 'seen' | 'dismiss' | 'reopen') => {
    await post(`/api/alerts/${id}`, { action });
    onChange();
  };
  return (
    <div className="list">
      {alerts.map((a) => {
        const Icon = ICONS[a.rule] ?? Globe2;
        const open = !a.acknowledgedAt && !a.dismissed;
        return (
          <div key={a.id} className="alert-row" style={{ opacity: open ? 1 : 0.6 }}>
            <div className={`alert-icon sev-${a.severity}`}>
              <Icon />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="row row-wrap" style={{ gap: 8, marginBottom: 2 }}>
                <SeverityBadge severity={a.severity} />
                <span className="faint small">{a.ruleLabel}</span>
                <span className="faint small">· {fmtDateTime(a.at)}</span>
                {a.dismissed && <span className="badge">Not a problem</span>}
                {!a.dismissed && a.acknowledgedAt && <span className="badge">Seen</span>}
              </div>
              <div style={{ fontWeight: 500 }}>
                {showUser && a.userId ? (
                  <Link to={`/users/${a.userId}`} style={{ color: 'inherit' }}>
                    {a.title}
                  </Link>
                ) : (
                  a.title
                )}
              </div>
              {details(a)
                .filter(Boolean)
                .map((line, i) => (
                  <div key={i} className="cell-sub" style={{ whiteSpace: 'normal' }}>
                    {line}
                  </div>
                ))}
            </div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {open ? (
                <>
                  <button className="btn btn-sm btn-teal" onClick={() => void act(a.id, 'seen')} title="I’ve seen this">
                    <Check /> Seen
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => void act(a.id, 'dismiss')} title="False alarm — don’t count it against their trust score">
                    <X /> Not a problem
                  </button>
                </>
              ) : (
                <button className="btn btn-sm btn-ghost" onClick={() => void act(a.id, 'reopen')} title="Reopen">
                  <RotateCcw />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
