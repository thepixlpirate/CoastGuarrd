import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Info, Loader2 } from 'lucide-react';
import { usePoll } from '../lib/usePoll';
import { plural, timeAgo } from '../lib/format';
import type { GeoStatus, UserSummary } from '../types';
import MapView, { esc, type MapPoint } from '../components/MapView';
import { Segmented } from '../components/ui';
import { CHART } from '../components/charts';
import { Alert } from '../components/Fields';

interface MapData {
  points: { lat: number; lon: number; place: string; plays: number; signIns: number; lastAt: number; ips: string[]; users: { id: string; name: string; plays: number; signIns: number }[] }[];
  live: { lat: number; lon: number; userName: string; title: string; place: string }[];
  localPlays: number;
  unknownPlays: number;
  totalPlays: number;
  proxyHint: boolean;
  geo: GeoStatus;
}

export default function MapPage() {
  const [days, setDays] = useState('30');
  const [user, setUser] = useState('');
  const { data: users } = usePoll<UserSummary[]>('/api/users');
  const { data, error } = usePoll<MapData>(`/api/map?days=${days}${user ? `&user=${user}` : ''}`, 15_000);

  const points = useMemo<MapPoint[]>(() => {
    if (!data) return [];
    const pts: MapPoint[] = data.points.map((p) => ({
      lat: p.lat,
      lon: p.lon,
      weight: p.plays + p.signIns,
      color: CHART.purple,
      popup:
        `<div style="font-weight:600;margin-bottom:4px">${esc(p.place)}</div>` +
        `<div style="opacity:.75;margin-bottom:6px">${esc(plural(p.plays, 'play'))}${p.signIns ? ` · ${esc(plural(p.signIns, 'sign-in'))}` : ''} · last ${esc(timeAgo(p.lastAt))}</div>` +
        p.users.map((u) => `<div><a href="/users/${esc(u.id)}">${esc(u.name)}</a> <span style="opacity:.6">${u.plays} plays</span></div>`).join('') +
        `<div style="opacity:.55;margin-top:6px;font-family:ui-monospace,monospace;font-size:11.5px">${p.ips.map(esc).join('<br/>')}</div>`,
    }));
    for (const l of data.live) {
      pts.push({
        lat: l.lat,
        lon: l.lon,
        weight: 1,
        color: CHART.teal,
        pulse: true,
        popup: `<div style="font-weight:600">${esc(l.userName)} is watching now</div><div>${esc(l.title)}</div><div style="opacity:.7">${esc(l.place)}</div>`,
      });
    }
    return pts;
  }, [data]);

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ flex: 1 }}>
          <h1>Map</h1>
          <p>Where people watch and sign in from.</p>
        </div>
      </div>
      <div className="filters">
        <select className="select" value={user} onChange={(e) => setUser(e.target.value)} aria-label="Person">
          <option value="">Everyone</option>
          {users?.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
        <Segmented
          value={days}
          onChange={setDays}
          options={[
            { value: '1', label: '24h' },
            { value: '7', label: '7 days' },
            { value: '30', label: '30 days' },
            { value: '365', label: '1 year' },
            { value: '3650', label: 'All' },
          ]}
        />
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {data && !data.geo.ready && (
        <div style={{ marginBottom: 14 }}>
          <Alert kind="warn">
            The location database isn’t ready yet{data.geo.downloading ? ' — it’s downloading now' : ''}. {data.geo.error ?? ''} You can check it in <Link to="/settings/tracking">Settings → Tracking</Link>.
          </Alert>
        </div>
      )}
      {data?.proxyHint && (
        <div style={{ marginBottom: 14 }}>
          <Alert kind="info">
            Most streams show up as “local network”. If family watch through a Cloudflare tunnel or reverse proxy, Jellyfin may be seeing the tunnel instead of their real address. In Jellyfin, go to Dashboard → Networking and add your tunnel or proxy to <b>Known proxies</b>.
          </Alert>
        </div>
      )}
      {!data && !error && <Loader2 className="spin" />}
      {data && (
        <>
          <div className="map-wrap">
            <MapView points={points} />
            <div className="map-legend">
              <span><i style={{ background: CHART.purple }} /> Past activity (bigger = more)</span>
              <span><i style={{ background: CHART.teal }} /> Watching now</span>
            </div>
          </div>
          <div className="row row-wrap small faint" style={{ marginTop: 10, gap: 14 }}>
            <span className="row" style={{ gap: 6 }}><Info size={14} /> {plural(data.points.length, 'place')} · {plural(data.localPlays, 'play')} at home (not shown){data.unknownPlays ? ` · ${data.unknownPlays} with unknown location` : ''}</span>
            <span>Locations are approximate (city level). IP geolocation by <a href="https://db-ip.com" target="_blank" rel="noreferrer">DB-IP</a>.</span>
          </div>
        </>
      )}
    </div>
  );
}
