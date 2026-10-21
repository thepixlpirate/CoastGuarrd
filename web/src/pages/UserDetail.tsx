import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Clock, Film, Globe2, Inbox, KeyRound, Laptop, Loader2, LogIn, MonitorPlay, Save, ShieldAlert, StickyNote } from 'lucide-react';
import { put } from '../api';
import { usePoll } from '../lib/usePoll';
import { HOUR_LABELS, fmtDateTime, fmtHours, flag, plural, timeAgo } from '../lib/format';
import type { UserDetail as Detail } from '../types';
import { Avatar, Empty, Poster, Stat, TrustMeter } from '../components/ui';
import { CHART, ColumnChart, RankBars, WeekHeatmap } from '../components/charts';
import PlayList from '../components/PlayList';
import AlertList from '../components/AlertList';
import RequestCard from '../components/RequestCard';
import MapView, { esc } from '../components/MapView';
import { Alert } from '../components/Fields';

type Tab = 'overview' | 'history' | 'signins' | 'devices' | 'requests' | 'alerts' | 'notes';

function Notes({ d, onSaved }: { d: Detail; onSaved: () => void }) {
  const [notes, setNotes] = useState(d.user.notes);
  const [limit, setLimit] = useState<string>(d.user.streamLimit == null ? '' : String(d.user.streamLimit));
  const [msg, setMsg] = useState('');
  const save = async () => {
    await put(`/api/users/${d.user.id}`, { notes, streamLimit: limit === '' ? null : Number(limit) });
    setMsg('Saved.');
    setTimeout(() => setMsg(''), 2000);
    onSaved();
  };
  return (
    <div className="grid grid-2">
      <div className="card">
        <h3 style={{ marginBottom: 10 }}>Notes</h3>
        <textarea className="input" style={{ height: 160, padding: 10, resize: 'vertical' }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything you want to remember about this person — only you can see this." />
      </div>
      <div className="card">
        <h3 style={{ marginBottom: 10 }}>Stream limit</h3>
        <label className="label">How many things they can play at once before an alert</label>
        <input className="input" type="number" min={0} inputMode="numeric" value={limit} placeholder={`Default (${d.defaultStreamLimit})`} onChange={(e) => setLimit(e.target.value)} />
        <div className="hint">Leave blank for the default. 0 turns the check off for this person.</div>
      </div>
      <div className="row">
        <button className="btn btn-teal" onClick={() => void save()}>
          <Save /> Save
        </button>
        {msg && <span className="muted small">{msg}</span>}
      </div>
    </div>
  );
}

export default function UserDetail() {
  const { id } = useParams();
  const { data, error, reload } = usePoll<Detail>(`/api/users/${id}`, 30_000);
  const [tab, setTab] = useState<Tab>('overview');
  useEffect(() => setTab('overview'), [id]);

  const points = useMemo(
    () =>
      (data?.locations ?? [])
        .filter((l) => l.lat != null && l.lon != null)
        .map((l) => ({
          lat: l.lat!,
          lon: l.lon!,
          weight: l.times,
          color: CHART.purple,
          popup: `<b>${esc(l.place)}</b><br/><span style="opacity:.7">${esc(l.ip)}</span><br/>${l.times} visit${l.times === 1 ? '' : 's'} · last ${esc(timeAgo(l.lastSeenAt))}`,
        })),
    [data],
  );

  if (error) return <div className="page"><Alert kind="error">{error}</Alert></div>;
  if (!data) return <div className="page"><Loader2 className="spin" /></div>;
  const { user: u } = data;
  const openAlerts = data.alerts.filter((a) => !a.acknowledgedAt && !a.dismissed).length;
  const countries = new Set(data.locations.filter((l) => l.countryCode).map((l) => l.countryCode)).size;

  const tabs: { id: Tab; label: string; icon: typeof Clock; count?: number }[] = [
    { id: 'overview', label: 'Overview', icon: MonitorPlay },
    { id: 'history', label: 'History', icon: Clock },
    { id: 'signins', label: 'Sign-ins', icon: LogIn, count: data.signIns.length },
    { id: 'devices', label: 'Devices & places', icon: Laptop, count: data.devices.length },
    { id: 'requests', label: 'Requests', icon: Inbox, count: data.requests.length },
    { id: 'alerts', label: 'Alerts', icon: ShieldAlert, count: openAlerts || undefined },
    { id: 'notes', label: 'Notes & limits', icon: StickyNote },
  ];

  return (
    <div className="page">
      <Link to="/users" className="small row" style={{ gap: 4, marginBottom: 14 }}>
        <ArrowLeft size={14} /> All users
      </Link>
      <div className="profile-head">
        <Avatar id={u.id} name={u.name} hasImage={u.hasImage} size={68} />
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="row row-wrap" style={{ gap: 8 }}>
            <h1 style={{ fontSize: 27 }}>{u.name}</h1>
            {u.streamingNow > 0 && <span className="badge badge-ok"><span className="pulse" /> Watching now</span>}
            {u.isAdmin && <span className="badge badge-purple">Admin</span>}
            {u.isDisabled && <span className="badge">Disabled</span>}
            {u.removed && <span className="badge">Deleted from Jellyfin</span>}
          </div>
          <div className="muted small" style={{ marginTop: 4 }}>
            Last active {timeAgo(u.lastActivityAt)} · last sign-in {timeAgo(u.lastLoginAt)}
            {u.seerrName && u.seerrName !== u.name ? ` · Seerr: ${u.seerrName}` : ''}
            {u.email ? ` · ${u.email}` : ''}
          </div>
        </div>
        <div style={{ width: 180 }}>
          <div className="faint small" style={{ marginBottom: 4 }}>Trust score</div>
          <TrustMeter score={u.trust} />
        </div>
      </div>

      <div className="tabs">
        {tabs.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            <t.icon /> {t.label}
            {t.count ? <span className="badge" style={{ padding: '1px 7px' }}>{t.count}</span> : null}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="stack" style={{ gap: 16 }}>
          <div className="grid grid-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))' }}>
            <Stat label="Time watched" value={fmtHours(data.totals.hours)} sub={`${plural(data.totals.plays, 'play')} since ${new Date(u.firstSeenAt).toLocaleDateString()}`} />
            <Stat label="Titles" value={data.totals.titles.toLocaleString()} sub="Movies, shows and albums" />
            <Stat label="Devices" value={data.devices.length} sub={`${data.locations.filter((l) => !l.isLocal).length} internet addresses`} />
            <Stat label="Countries" value={countries || '—'} sub={data.locations.some((l) => l.isLocal) ? 'Also watches at home' : undefined} />
          </div>
          <div className="grid grid-2">
            <div className="card">
              <div className="card-head" style={{ marginBottom: 6 }}>
                <h3>When they watch</h3>
              </div>
              <p className="card-sub" style={{ marginTop: 0, marginBottom: 14 }}>Last 90 days, by day and hour</p>
              <WeekHeatmap week={data.week} label={`${u.name}'s watch time by day and hour`} />
            </div>
            <div className="card">
              <div className="card-head" style={{ marginBottom: 6 }}>
                <h3>Time of day</h3>
              </div>
              <p className="card-sub" style={{ marginTop: 0, marginBottom: 10 }}>Hours watched in each hour, last 90 days</p>
              <ColumnChart
                label="Hours watched by hour of day"
                color={CHART.teal}
                data={data.hourOfDay.map((v, h) => ({ label: HOUR_LABELS[h], tip: `${HOUR_LABELS[h]}–${HOUR_LABELS[(h + 1) % 24]}`, value: v }))}
                tickEvery={3}
                format={(v) => fmtHours(v)}
              />
            </div>
          </div>
          <div className="grid grid-2">
            <div className="card">
              <h3 style={{ marginBottom: 14 }}>Favourite titles</h3>
              {data.topTitles.length === 0 ? (
                <div className="faint small">Nothing watched in the last 90 days.</div>
              ) : (
                <div className="list">
                  {data.topTitles.slice(0, 6).map((t) => (
                    <div key={t.id} className="list-item">
                      <Poster id={t.posterId} type={t.type} size="sm" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="cell-main" style={{ fontWeight: 500 }}>{t.title}</div>
                        <div className="cell-sub">{plural(t.plays, 'play')}</div>
                      </div>
                      <span className="small muted">{fmtHours(t.hours)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="card">
              <h3 style={{ marginBottom: 14 }}>Apps they use</h3>
              {data.platforms.length === 0 ? (
                <div className="faint small">No plays in the last 90 days.</div>
              ) : (
                <RankBars rows={data.platforms.map((p) => ({ key: p.name, label: p.name, value: p.hours, extra: <span className="faint">· {plural(p.plays, 'play')}</span> }))} format={fmtHours} color={CHART.purple} />
              )}
            </div>
          </div>
          {data.recent.length > 0 && (
            <div className="card" style={{ padding: '14px 4px' }}>
              <div className="row" style={{ padding: '0 14px 10px' }}>
                <h3 style={{ flex: 1 }}>Recently watched</h3>
                <button className="btn btn-ghost btn-sm" onClick={() => setTab('history')}>See all</button>
              </div>
              <PlayList plays={data.recent.slice(0, 8)} showUser={false} compact />
            </div>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="card" style={{ padding: '12px 4px' }}>
          {data.recent.length === 0 ? (
            <div className="faint small" style={{ padding: 14 }}>No plays yet.</div>
          ) : (
            <>
              <PlayList plays={data.recent} showUser={false} />
              <div style={{ padding: '12px 14px 4px' }}>
                <Link to={`/history?user=${u.id}`} className="small">Open full history with filters →</Link>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'signins' && (
        <div className="card">
          {data.signIns.length === 0 ? (
            <Empty icon={<KeyRound />} title="No sign-ins recorded yet">CoastGuarrd reads these from Jellyfin’s activity log every minute.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>What</th>
                    <th>Device</th>
                    <th>Where</th>
                    <th>Address</th>
                  </tr>
                </thead>
                <tbody>
                  {data.signIns.map((s) => (
                    <tr key={s.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(s.at)}</td>
                      <td>
                        {s.kind === 'failed' ? <span className="badge badge-bad">Failed</span> : s.kind === 'signin' ? <span className="badge badge-ok">Signed in</span> : <span className="badge">Opened app</span>}
                      </td>
                      <td>{s.device ?? '—'}</td>
                      <td>{s.place ?? '—'}</td>
                      <td className="mono">{s.ip ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'devices' && (
        <div className="stack" style={{ gap: 16 }}>
          {points.length > 0 && (
            <div className="map-wrap" style={{ height: 320, minHeight: 0 }}>
              <MapView points={points} />
            </div>
          )}
          <div className="grid grid-2">
            <div className="card">
              <h3 style={{ marginBottom: 6 }}>Devices</h3>
              <div className="list">
                {data.devices.length === 0 && <div className="faint small">None yet.</div>}
                {data.devices.map((d) => (
                  <div key={d.id} className="list-item">
                    <Laptop size={20} color="var(--purple-strong)" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="cell-main" style={{ fontWeight: 500 }}>{d.name ?? 'Unknown device'}</div>
                      <div className="cell-sub">
                        {[d.client, d.version].filter(Boolean).join(' ')} · first seen {timeAgo(d.firstSeenAt)}
                      </div>
                    </div>
                    <span className="small muted" style={{ whiteSpace: 'nowrap' }}>{timeAgo(d.lastSeenAt)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <h3 style={{ marginBottom: 6 }}>Places & addresses</h3>
              <div className="list">
                {data.locations.length === 0 && <div className="faint small">None yet.</div>}
                {data.locations.map((l) => (
                  <div key={l.ip} className="list-item">
                    <Globe2 size={20} color="var(--teal-strong)" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="cell-main" style={{ fontWeight: 500 }}>{flag(l.countryCode)} {l.place}</div>
                      <div className="cell-sub mono">{l.ip}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="small muted" style={{ whiteSpace: 'nowrap' }}>{timeAgo(l.lastSeenAt)}</div>
                      <div className="cell-sub">{plural(l.times, 'visit')}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'requests' &&
        (data.requests.length === 0 ? (
          <Empty icon={<Film />} title="No requests">Nothing requested through Seerr yet{u.seerrName ? '' : ' — or this person isn’t linked to a Seerr account'}.</Empty>
        ) : (
          <div className="req-grid">
            {data.requests.map((r) => (
              <RequestCard key={r.id} r={r} showUser={false} />
            ))}
          </div>
        ))}

      {tab === 'alerts' &&
        (data.alerts.length === 0 ? (
          <Empty icon={<ShieldAlert />} title="No alerts">Nothing unusual from {u.name}.</Empty>
        ) : (
          <div className="card" style={{ padding: 0 }}>
            <AlertList alerts={data.alerts} onChange={() => void reload()} showUser={false} />
          </div>
        ))}

      {tab === 'notes' && <Notes d={data} onSaved={() => void reload()} />}
    </div>
  );
}
