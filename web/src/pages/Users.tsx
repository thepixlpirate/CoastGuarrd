import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Search, ShieldAlert, Users as UsersIcon } from 'lucide-react';
import { usePoll } from '../lib/usePoll';
import { fmtHours, timeAgo } from '../lib/format';
import type { UserSummary } from '../types';
import { Avatar, Empty, Segmented, TrustMeter } from '../components/ui';
import { Alert } from '../components/Fields';

type Sort = 'recent' | 'hours' | 'trust' | 'name';

export default function Users() {
  const { data, error } = usePoll<UserSummary[]>('/api/users', 30_000);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('recent');

  const list = useMemo(() => {
    let l = (data ?? []).filter((u) => !q || u.name.toLowerCase().includes(q.toLowerCase()) || u.seerrName?.toLowerCase().includes(q.toLowerCase()));
    l = [...l].sort((a, b) => {
      if (a.removed !== b.removed) return a.removed ? 1 : -1;
      if (sort === 'hours') return b.hours - a.hours;
      if (sort === 'trust') return a.trust - b.trust;
      if (sort === 'name') return a.name.localeCompare(b.name);
      return (b.streamingNow - a.streamingNow) || (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0);
    });
    return l;
  }, [data, q, sort]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Users</h1>
          <p>Everyone with a Jellyfin account. Tap someone to see everything they do.</p>
        </div>
      </div>
      <div className="filters">
        <div className="search">
          <Search />
          <input className="input" placeholder="Find someone…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Segmented
          value={sort}
          onChange={setSort}
          options={[
            { value: 'recent', label: 'Recently active' },
            { value: 'hours', label: 'Most watched' },
            { value: 'trust', label: 'Lowest trust' },
            { value: 'name', label: 'Name' },
          ]}
        />
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {!data && !error && <Loader2 className="spin" />}
      {data && data.length === 0 && (
        <Empty icon={<UsersIcon />} title="No users yet">
          Connect Jellyfin in Settings and everyone with an account will appear here.
        </Empty>
      )}
      {list.length > 0 && (
        <div className="card" style={{ padding: 4 }}>
          <div className="user-row hide-mobile" style={{ borderTop: 0, padding: '8px 14px' }}>
            {['Person', 'Watched', 'Devices', 'Last seen', 'Trust', 'Alerts'].map((h, i) => (
              <span key={h} className={`small faint ${i === 2 || i === 5 ? 'hide-md' : ''}`} style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 11.5 }}>
                {h}
              </span>
            ))}
          </div>
          {list.map((u) => (
            <Link key={u.id} to={`/users/${u.id}`} className="user-row" style={{ opacity: u.removed ? 0.55 : 1 }}>
              <div className="row" style={{ minWidth: 0, gap: 12 }}>
                <Avatar id={u.id} name={u.name} hasImage={u.hasImage} size={38} />
                <div style={{ minWidth: 0 }}>
                  <div className="row user-name-row" style={{ gap: 6 }}>
                    <span className="cell-main" style={{ fontWeight: 600, flexShrink: 0, maxWidth: '100%' }}>{u.name}</span>
                    {u.streamingNow > 0 && <span className="badge badge-ok"><span className="pulse" />{u.streamingNow > 1 ? `${u.streamingNow} streams` : 'Watching'}</span>}
                    {u.isAdmin && <span className="badge badge-purple">Admin</span>}
                    {u.isDisabled && <span className="badge">Disabled</span>}
                    {u.removed && <span className="badge">Deleted</span>}
                  </div>
                  <div className="cell-sub">
                    {u.plays.toLocaleString()} plays{u.requests ? ` · ${u.requests} requests` : ''}
                    <span className="hide-desktop"> · {timeAgo(u.lastActivityAt)}</span>
                  </div>
                </div>
              </div>
              <div className="hide-sm">
                <div>{fmtHours(u.hours)}</div>
                <div className="cell-sub">{u.plays30} in 30 days</div>
              </div>
              <div className="hide-sm hide-md">
                <div>{u.devices}</div>
                <div className="cell-sub">{u.ips} addresses</div>
              </div>
              <div className="hide-sm" style={{ minWidth: 0 }}>
                <div className="cell-main">{timeAgo(u.lastActivityAt)}</div>
                <div className="cell-sub">{u.lastPlace ?? '—'}</div>
              </div>
              <div>
                <TrustMeter score={u.trust} />
              </div>
              <div className="hide-sm hide-md">
                {u.openAlerts > 0 ? (
                  <span className="badge badge-bad"><ShieldAlert size={12} /> {u.openAlerts}</span>
                ) : (
                  <span className="faint small">—</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
      <p className="faint small" style={{ marginTop: 14 }}>
        Trust starts at 100 and drops with each alert in the last 30 days (critical −25, warning −10, info −2). Alerts you mark “not a problem” don’t count.
      </p>
    </div>
  );
}
