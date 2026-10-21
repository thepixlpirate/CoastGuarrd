import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Inbox, Loader2, Search } from 'lucide-react';
import { usePoll } from '../lib/usePoll';
import type { RequestItem, UserSummary } from '../types';
import { Empty, Pager, Segmented, Stat } from '../components/ui';
import RequestCard from '../components/RequestCard';
import { Alert } from '../components/Fields';

interface Resp {
  total: number;
  page: number;
  pageSize: number;
  rows: RequestItem[];
  summary: { total: number; available: number; unwatched: number; nobody: number; pending: number };
  byUser: { id: string | null; name: string | null; n: number; unwatched: number }[];
  seerrConnected: boolean;
}

type Filter = 'all' | 'unwatched' | 'nobody' | 'watched' | 'pending';

export default function Requests() {
  const [filter, setFilter] = useState<Filter>('all');
  const [type, setType] = useState('all');
  const [user, setUser] = useState('');
  const [q, setQ] = useState('');
  const [qd, setQd] = useState('');
  const [page, setPage] = useState(1);
  const { data: users } = usePoll<UserSummary[]>('/api/users');
  useEffect(() => {
    const t = setTimeout(() => setQd(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(1), [filter, type, user, qd]);
  const { data, error } = usePoll<Resp>(`/api/requests?filter=${filter}&type=${type}&user=${user}&q=${encodeURIComponent(qd)}&page=${page}`, 60_000);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Requests</h1>
          <p>Everything asked for in Seerr — and whether the person who asked actually watched it.</p>
        </div>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {!data && !error && <Loader2 className="spin" />}
      {data && !data.seerrConnected && data.summary.total === 0 && (
        <Empty icon={<Inbox />} title="Seerr isn’t connected">
          Connect Seerr in <Link to="/settings">Settings</Link> to see who requested what.
        </Empty>
      )}
      {data && (data.seerrConnected || data.summary.total > 0) && (
        <>
          <div className="grid grid-3" style={{ marginBottom: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))' }}>
            <Stat label="Requests" value={data.summary.total} sub={`${data.summary.pending ?? 0} waiting for approval`} />
            <Stat label="Available" value={data.summary.available ?? 0} />
            <Stat label="Requester never watched" value={<span style={{ color: data.summary.unwatched ? 'var(--amber)' : undefined }}>{data.summary.unwatched ?? 0}</span>} sub="Available, but not watched by whoever asked" />
            <Stat label="Nobody watched" value={data.summary.nobody ?? 0} sub="Good candidates for cleanup" />
          </div>
          <div className="filters">
            <div className="search">
              <Search />
              <input className="input" placeholder="Search titles…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <select className="select" value={user} onChange={(e) => setUser(e.target.value)} aria-label="Requested by">
              <option value="">Anyone</option>
              {users?.filter((u) => u.requests > 0).map((u) => (
                <option key={u.id} value={u.id}>{u.name} ({u.requests})</option>
              ))}
            </select>
            <select className="select" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
              <option value="all">Movies & shows</option>
              <option value="movie">Movies</option>
              <option value="tv">Shows</option>
            </select>
          </div>
          <div className="filters">
            <Segmented
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'unwatched', label: 'Requester didn’t watch' },
                { value: 'nobody', label: 'Nobody watched' },
                { value: 'watched', label: 'Watched' },
                { value: 'pending', label: 'Pending' },
              ]}
            />
          </div>
          {data.rows.length === 0 ? (
            <Empty icon={<Inbox />} title="Nothing here">No requests match these filters.</Empty>
          ) : (
            <div className="req-grid">
              {data.rows.map((r) => (
                <RequestCard key={r.id} r={r} />
              ))}
            </div>
          )}
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}
