import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCheck, Loader2, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { post } from '../api';
import { usePoll } from '../lib/usePoll';
import type { AlertItem, UserSummary } from '../types';
import { Empty, Pager, Segmented } from '../components/ui';
import AlertList from '../components/AlertList';
import { Alert } from '../components/Fields';

interface Resp {
  total: number;
  page: number;
  pageSize: number;
  rows: AlertItem[];
  counts: { open: number; critical: number };
  rules: Record<string, string>;
}

export default function Alerts() {
  const [status, setStatus] = useState('open');
  const [user, setUser] = useState('');
  const [rule, setRule] = useState('');
  const [page, setPage] = useState(1);
  const { data: users } = usePoll<UserSummary[]>('/api/users');
  const { data, error, reload } = usePoll<Resp>(`/api/alerts?status=${status}&user=${user}&rule=${rule}&page=${page}`, 20_000);

  const seenAll = async () => {
    await post('/api/alerts/seen-all');
    await reload();
    window.dispatchEvent(new Event('cg:alerts-changed'));
  };

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ flex: 1 }}>
          <h1>Alerts</h1>
          <p>Account sharing, odd locations, too many streams and other things worth a look.</p>
        </div>
        <Link to="/settings/tracking" className="btn btn-sm">
          <SlidersHorizontal /> Alert rules
        </Link>
        {data && data.counts.open > 0 && status === 'open' && (
          <button className="btn btn-sm btn-teal" onClick={() => void seenAll()}>
            <CheckCheck /> Mark all seen
          </button>
        )}
      </div>
      <div className="filters">
        <Segmented
          value={status}
          onChange={(v) => (setStatus(v), setPage(1))}
          options={[
            { value: 'open', label: `Open${data ? ` (${data.counts.open})` : ''}` },
            { value: 'seen', label: 'Seen' },
            { value: 'dismissed', label: 'Not a problem' },
            { value: 'all', label: 'All' },
          ]}
        />
        <select className="select" value={user} onChange={(e) => (setUser(e.target.value), setPage(1))} aria-label="Person">
          <option value="">Everyone</option>
          {users?.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
        <select className="select" value={rule} onChange={(e) => (setRule(e.target.value), setPage(1))} aria-label="Type">
          <option value="">Every type</option>
          {data &&
            Object.entries(data.rules).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
        </select>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {!data && !error && <Loader2 className="spin" />}
      {data && data.rows.length === 0 && (
        <Empty icon={<ShieldCheck />} title={status === 'open' ? 'All clear' : 'Nothing here'}>
          {status === 'open' ? 'No open alerts. CoastGuarrd keeps watching and will flag anything unusual.' : 'No alerts match these filters.'}
        </Empty>
      )}
      {data && data.rows.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <AlertList
            alerts={data.rows}
            onChange={() => {
              void reload();
              window.dispatchEvent(new Event('cg:alerts-changed'));
            }}
          />
        </div>
      )}
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </div>
  );
}
