import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ArrowRight, Clock, Eye, History as HistoryIcon, Loader2, ShieldAlert, Users as UsersIcon } from 'lucide-react';
import { get, type GeneralSettings, type ServiceView } from '../api';
import { useAuth } from '../auth';
import { usePoll } from '../lib/usePoll';
import { HOUR_LABELS, fmtHours, plural, timeAgo } from '../lib/format';
import type { Overview } from '../types';
import { ServiceIcon, ServiceStatus } from '../components/ServiceEditor';
import { Poster, SeverityBadge, Stat } from '../components/ui';
import { CHART, ColumnChart, RankBars } from '../components/charts';
import PlayList from '../components/PlayList';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function Dashboard() {
  const { status } = useAuth();
  const { data } = usePoll<Overview>('/api/stats/overview', 20_000);
  const { data: cleanup } = usePoll<{ counts: { items: number; flagged: number; inBin: number; keepRequests: number } }>('/api/cleanup/status', 60_000);
  const [svcs, setSvcs] = useState<ServiceView[]>([]);
  const [general, setGeneral] = useState<GeneralSettings | null>(null);

  useEffect(() => {
    get<ServiceView[]>('/api/services').then(setSvcs).catch(() => undefined);
    get<GeneralSettings>('/api/settings/general').then(setGeneral).catch(() => undefined);
  }, []);

  const problems = svcs.filter((s) => s.enabled && s.lastError);
  const jellyfin = svcs.find((s) => s.id === 'jellyfin');

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>
            {greeting()}, <span className="grad-text">{status?.user?.username}</span>
          </h1>
          <p>Here’s what’s happening on your server.</p>
        </div>
      </div>

      {general?.previewMode && (
        <div className="preview-banner">
          <Eye />
          <div style={{ flex: 1 }}>
            <strong>Preview mode is on.</strong> <span className="muted">Cleanup won’t change posters or move anything until you turn it off.</span>
          </div>
          <Link to="/settings/general" className="btn btn-sm hide-mobile">Change</Link>
        </div>
      )}

      {problems.length > 0 && (
        <div className="card row" style={{ marginBottom: 16, borderColor: 'rgba(251,113,133,.35)' }}>
          <ShieldAlert color="var(--red)" size={20} />
          <div style={{ flex: 1 }} className="small">
            {problems.map((p) => `${p.name}: ${p.lastError}`).join(' · ')}
          </div>
          <Link to="/settings" className="btn btn-sm">Fix</Link>
        </div>
      )}

      {jellyfin && !jellyfin.enabled && (
        <div className="card row" style={{ marginBottom: 16 }}>
          <div style={{ flex: 1 }}>Connect Jellyfin to start tracking what everyone watches.</div>
          <Link to="/settings" className="btn btn-primary btn-sm">Connect</Link>
        </div>
      )}

      {!data && <Loader2 className="spin" />}
      {data && (
        <>
          <div className="grid grid-3" style={{ marginBottom: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))' }}>
            <Link to="/activity" style={{ color: 'inherit', textDecoration: 'none' }}>
              <Stat
                label="Watching now"
                value={data.live.total}
                sub={data.live.total ? `${data.live.transcoding} transcoding` : 'Nobody right now'}
                icon={data.live.total ? <span className="pulse" /> : <Activity size={16} color="var(--purple-strong)" />}
              />
            </Link>
            <Stat label="Today" value={fmtHours(data.today.hours)} sub={plural(data.today.plays, 'play')} icon={<Clock size={16} color="var(--teal-strong)" />} />
            <Stat label="Last 7 days" value={fmtHours(data.week.hours)} sub={`${plural(data.week.viewers, 'person', 'people')} watched`} icon={<UsersIcon size={16} color="var(--purple-strong)" />} />
            <Link to="/alerts" style={{ color: 'inherit', textDecoration: 'none' }}>
              <Stat
                label="Open alerts"
                value={<span style={{ color: data.openAlerts ? 'var(--red)' : undefined }}>{data.openAlerts}</span>}
                sub={data.openAlerts ? 'Tap to review' : 'All clear'}
                icon={<ShieldAlert size={16} color={data.openAlerts ? 'var(--red)' : 'var(--teal-strong)'} />}
              />
            </Link>
          </div>

          {!data.hasData && (
            <div className="card" style={{ marginBottom: 16 }}>
              <h3>No plays recorded yet</h3>
              <p className="card-sub">
                CoastGuarrd records new plays as they happen. To fill in what was watched before, use <Link to="/settings/tracking">Settings → Tracking → Import history</Link>.
              </p>
            </div>
          )}

          <div className="grid grid-2" style={{ marginBottom: 16 }}>
            <div className="card">
              <h3>Hours watched per day</h3>
              <p className="card-sub" style={{ marginTop: 2, marginBottom: 12 }}>Last 30 days</p>
              <ColumnChart
                label="Hours watched per day, last 30 days"
                data={data.daily.map((d) => {
                  const dt = new Date(`${d.day}T12:00:00`);
                  return { label: String(dt.getDate()), tip: dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + ` · ${plural(d.plays, 'play')}`, value: d.hours };
                })}
                tickEvery={5}
                format={fmtHours}
              />
            </div>
            <div className="card">
              <h3>Busiest times of day</h3>
              <p className="card-sub" style={{ marginTop: 2, marginBottom: 12 }}>Hours watched in each hour, last 30 days</p>
              <ColumnChart
                label="Hours watched by hour of day"
                color={CHART.teal}
                data={data.hourOfDay.map((v, h) => ({ label: HOUR_LABELS[h], tip: `${HOUR_LABELS[h]}–${HOUR_LABELS[(h + 1) % 24]}`, value: v }))}
                tickEvery={3}
                format={fmtHours}
              />
            </div>
          </div>

          <div className="grid grid-2" style={{ marginBottom: 16 }}>
            <div className="card">
              <div className="card-head">
                <h3 style={{ flex: 1 }}>Top watchers</h3>
                <Link to="/users" className="small row" style={{ gap: 4 }}>All users <ArrowRight size={14} /></Link>
              </div>
              {data.topUsers.length === 0 ? (
                <div className="faint small">Nothing in the last 30 days.</div>
              ) : (
                <RankBars
                  rows={data.topUsers.map((u) => ({ key: u.id, label: <Link to={`/users/${u.id}`}>{u.name}</Link>, value: u.hours, extra: <span className="faint">· {plural(u.plays, 'play')}</span> }))}
                  format={fmtHours}
                  color={CHART.purple}
                />
              )}
            </div>
            <div className="card">
              <div className="card-head">
                <h3 style={{ flex: 1 }}>Most watched</h3>
                <span className="faint small">30 days</span>
              </div>
              {data.topTitles.length === 0 ? (
                <div className="faint small">Nothing in the last 30 days.</div>
              ) : (
                <div className="list">
                  {data.topTitles.map((t, i) => (
                    <div key={t.id} className="list-item">
                      <span className="faint small" style={{ width: 14 }}>{i + 1}</span>
                      <Poster id={t.posterId} type={t.type} size="sm" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="cell-main" style={{ fontWeight: 500 }}>{t.title}</div>
                        <div className="cell-sub">
                          {plural(t.users, 'person', 'people')} · {plural(t.plays, 'play')}
                        </div>
                      </div>
                      <span className="small muted">{fmtHours(t.hours)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-2" style={{ marginBottom: 16 }}>
            <div className="card" style={{ padding: '16px 4px' }}>
              <div className="card-head" style={{ padding: '0 14px' }}>
                <h3 style={{ flex: 1 }}>Recently watched</h3>
                <Link to="/history" className="small row" style={{ gap: 4 }}><HistoryIcon size={14} /> History</Link>
              </div>
              {data.recent.length === 0 ? <div className="faint small" style={{ padding: '0 14px' }}>Nothing yet.</div> : <PlayList plays={data.recent} compact />}
            </div>
            <div className="stack" style={{ gap: 16, alignContent: 'start' }}>
              {cleanup && (
                <div className="card">
                  <div className="card-head">
                    <h3 style={{ flex: 1 }}>Cleanup</h3>
                    <Link to="/leaving" className="small row" style={{ gap: 4 }}>Leaving Soon <ArrowRight size={14} /></Link>
                  </div>
                  <div className="grid grid-3" style={{ gap: 10, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                    <Link to="/leaving" style={{ color: 'inherit' }}><div className="faint small">Leaving</div><div className="stat" style={{ fontSize: 24 }}>{cleanup.counts.flagged}</div></Link>
                    <Link to="/recycle" style={{ color: 'inherit' }}><div className="faint small">In recycle bin</div><div className="stat" style={{ fontSize: 24 }}>{cleanup.counts.inBin}</div></Link>
                    <Link to="/leaving" style={{ color: 'inherit' }}><div className="faint small">Keep requests</div><div className="stat" style={{ fontSize: 24, color: cleanup.counts.keepRequests ? 'var(--teal-strong)' : undefined }}>{cleanup.counts.keepRequests}</div></Link>
                  </div>
                </div>
              )}
              <div className="card">
                <div className="card-head">
                  <h3 style={{ flex: 1 }}>Latest alerts</h3>
                  <Link to="/alerts" className="small row" style={{ gap: 4 }}>All alerts <ArrowRight size={14} /></Link>
                </div>
                {data.recentAlerts.length === 0 ? (
                  <div className="faint small">Nothing needs your attention.</div>
                ) : (
                  <div className="list">
                    {data.recentAlerts.map((a) => (
                      <div key={a.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                        <SeverityBadge severity={a.severity} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="small">{a.userId ? <Link to={`/users/${a.userId}`} style={{ color: 'inherit' }}>{a.title}</Link> : a.title}</div>
                          <div className="cell-sub">{timeAgo(a.at)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="card">
                <div className="card-head">
                  <h3 style={{ flex: 1 }}>Connections</h3>
                  <Link to="/settings" className="small row" style={{ gap: 4 }}>Manage <ArrowRight size={14} /></Link>
                </div>
                <div className="list">
                  {svcs.map((s) => (
                    <div key={s.id} className="list-item">
                      <ServiceIcon id={s.id} name={s.name} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500 }}>{s.name}</div>
                        <div className="faint small cell-main">{s.enabled ? (s.lastError ? s.lastError : s.lastOkAt ? `v${s.version} · checked ${timeAgo(s.lastOkAt)}` : s.url || 'Not set up') : 'Switched off'}</div>
                      </div>
                      <ServiceStatus s={s} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
