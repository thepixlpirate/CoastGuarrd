import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Clock, Download, Loader2, Search } from 'lucide-react';
import { usePoll } from '../lib/usePoll';
import { fmtHours, plural } from '../lib/format';
import type { Play, UserSummary } from '../types';
import { Empty, Pager, Segmented } from '../components/ui';
import PlayList from '../components/PlayList';
import { Alert } from '../components/Fields';

type Range = 'all' | '1' | '7' | '30' | '90';

export default function History() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const user = params.get('user') ?? '';
  const type = params.get('type') ?? 'all';
  const range = (params.get('range') ?? 'all') as Range;
  const method = params.get('method') ?? '';
  const page = Number(params.get('page') ?? 1);
  const { data: users } = usePoll<UserSummary[]>('/api/users');

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => (q !== (params.get('q') ?? '') ? set('q', q) : undefined), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const url = useMemo(() => {
    const u = new URLSearchParams();
    if (user) u.set('user', user);
    if (type !== 'all') u.set('type', type);
    if (params.get('q')) u.set('q', params.get('q')!);
    if (range !== 'all') u.set('from', String(Date.now() - Number(range) * 86_400_000));
    if (method) u.set('method', method);
    u.set('page', String(page));
    u.set('pageSize', '50');
    return `/api/history?${u}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, type, range, method, page, params.get('q')]);

  const { data, error, loading } = usePoll<{ total: number; hours: number; page: number; pageSize: number; rows: Play[] }>(url, 30_000);

  const exportCsv = () => {
    if (!data) return;
    const head = ['Started', 'Stopped', 'User', 'Title', 'Detail', 'Type', 'Watched (min)', 'Device', 'App', 'Method', 'IP', 'Location'];
    const lines = data.rows.map((p) =>
      [new Date(p.startedAt).toISOString(), p.stoppedAt ? new Date(p.stoppedAt).toISOString() : '', p.userName, p.title, p.subtitle, p.itemType, Math.round(p.watchedMs / 60000), p.device ?? '', p.client ?? '', p.playMethod ?? '', p.ip ?? '', p.place ?? '']
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    );
    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `coastguarrd-history-page-${data.page}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ flex: 1 }}>
          <h1>History</h1>
          <p>Every play, by everyone. Tap a row for the full details.</p>
        </div>
        {data && data.rows.length > 0 && (
          <button className="btn btn-sm hide-mobile" onClick={exportCsv}>
            <Download /> Export this page
          </button>
        )}
      </div>

      <div className="filters">
        <div className="search">
          <Search />
          <input className="input" placeholder="Search titles, people, devices, places…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="select" value={user} onChange={(e) => set('user', e.target.value)} aria-label="Person">
          <option value="">Everyone</option>
          {users?.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
        <select className="select" value={method} onChange={(e) => set('method', e.target.value)} aria-label="Playback">
          <option value="">Any playback</option>
          <option value="direct">Direct play only</option>
          <option value="transcode">Transcodes only</option>
        </select>
      </div>
      <div className="filters">
        <Segmented
          value={type}
          onChange={(v) => set('type', v === 'all' ? '' : v)}
          options={[
            { value: 'all', label: 'All' },
            { value: 'movie', label: 'Movies' },
            { value: 'episode', label: 'TV' },
            { value: 'music', label: 'Music' },
          ]}
        />
        <Segmented
          value={range}
          onChange={(v) => set('range', v === 'all' ? '' : v)}
          options={[
            { value: '1', label: '24h' },
            { value: '7', label: '7 days' },
            { value: '30', label: '30 days' },
            { value: '90', label: '90 days' },
            { value: 'all', label: 'All time' },
          ]}
        />
        {data && (
          <span className="muted small">
            {plural(data.total, 'play')} · {fmtHours(data.hours)} watched
          </span>
        )}
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {loading && !data && <Loader2 className="spin" />}
      {data && data.rows.length === 0 && (
        <Empty icon={<Clock />} title="No plays found">
          {params.toString() ? 'Try clearing some filters.' : 'Plays appear here as people watch. You can also bring in older history from Settings → Tracking.'}
        </Empty>
      )}
      {data && data.rows.length > 0 && (
        <div className="card" style={{ padding: '12px 4px' }}>
          <PlayList plays={data.rows} />
        </div>
      )}
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => set('page', String(p))} />}
    </div>
  );
}
