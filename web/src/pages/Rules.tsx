import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, Library, ListChecks, Loader2, Pencil, Play, Plus, Search, ShieldCheck, Trash2, Undo2 } from 'lucide-react';
import { del, post, put } from '../api';
import { usePoll } from '../lib/usePoll';
import { fmtBytes, fmtDateTime, plural, timeAgo } from '../lib/format';
import type { CleanupRule, EvalResult, FieldDef, MediaItemView, MediaKind } from '../types';
import RuleEditor, { BLANK_RULE } from '../components/RuleEditor';
import { Empty, Pager, Poster, Segmented } from '../components/ui';
import { Alert } from '../components/Fields';

type Tab = 'rules' | 'library' | 'kept';

function describeRule(r: CleanupRule, fields: FieldDef[]) {
  const ops: Record<string, string> = { gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=', is: 'is', contains: 'includes', notContains: 'doesn’t include' };
  return r.config.conditions
    .map((c) => {
      const f = fields.find((x) => x.id === c.field);
      const v = typeof c.value === 'boolean' ? (c.value ? 'yes' : 'no') : `${c.value}${f?.unit ? ` ${f.unit}` : ''}`;
      return `${f?.label ?? c.field} ${ops[c.op] ?? c.op} ${v}`;
    })
    .join(r.config.match === 'all' ? ' and ' : ' or ');
}

function RulesTab({ fields, libraries }: { fields: FieldDef[]; libraries: { library: string; kind: MediaKind }[] }) {
  const { data: rules, reload } = usePoll<CleanupRule[]>('/api/cleanup/rules');
  const { data: status, reload: reloadStatus } = usePoll<{ lastEvaluation: EvalResult | null; previewMode: boolean; library: { at: number; items: number } | null }>('/api/cleanup/status', 30_000);
  const [editing, setEditing] = useState<(typeof BLANK_RULE & { id?: number }) | null>(null);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async () => {
    setRunning(true);
    try {
      const r = await post<EvalResult>('/api/cleanup/run');
      setMsg({ ok: !r.errors.length, text: `Checked ${r.items} titles · ${r.flagged} flagged (${r.newlyFlagged} new, ${r.cleared} cleared).${r.errors.length ? ` Problems: ${r.errors.slice(0, 3).join(' · ')}` : ''}` });
      await reload();
      await reloadStatus();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setRunning(false);
    }
  };

  const move = async (i: number, dir: -1 | 1) => {
    if (!rules) return;
    const ids = rules.map((r) => r.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await post('/api/cleanup/rules/order', { ids });
    await reload();
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      {status?.previewMode && (
        <Alert kind="info">
          Preview mode is on — rules flag titles so you can review them on <Link to="/leaving">Leaving Soon</Link>, but no posters change and nothing is moved. Turn it off in <Link to="/settings/general">Settings → General</Link> when you’re happy.
        </Alert>
      )}
      <div className="row row-wrap">
        <button className="btn btn-primary" onClick={() => setEditing({ ...BLANK_RULE })}>
          <Plus /> New rule
        </button>
        <button className="btn btn-teal" disabled={running} onClick={() => void run()}>
          {running ? <Loader2 className="spin" /> : <Play />} Check rules now
        </button>
        <span className="faint small">
          {status?.lastEvaluation ? `Last checked ${timeAgo(status.lastEvaluation.at)}` : 'Not checked yet'}
          {status?.library ? ` · ${plural(status.library.items, 'title')} in your library` : ''}
        </span>
      </div>
      {msg && <Alert kind={msg.ok ? 'ok' : 'warn'}>{msg.text}</Alert>}
      {!rules && <Loader2 className="spin" />}
      {rules?.length === 0 && <Empty icon={<ListChecks />} title="No rules yet">Create a rule to decide which titles count as unwatched.</Empty>}
      {rules?.map((r, i) => (
        <div key={r.id} className="card rule-card" style={{ opacity: r.enabled ? 1 : 0.7 }}>
          <input
            type="checkbox"
            className="switch"
            checked={r.enabled}
            aria-label={`${r.name} on/off`}
            onChange={async (e) => {
              await put(`/api/cleanup/rules/${r.id}`, { enabled: e.target.checked });
              await reload();
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row row-wrap" style={{ gap: 8 }}>
              <span style={{ fontWeight: 600 }}>{r.name}</span>
              <span className="badge">{r.kind === 'movie' ? 'Movies' : r.kind === 'show' ? 'TV shows' : 'Music'}</span>
              {r.config.libraries.length > 0 && <span className="badge">{r.config.libraries.join(', ')}</span>}
              {r.flagged > 0 && <span className="badge badge-warn">{r.flagged} flagged</span>}
            </div>
            <div className="cell-sub" style={{ whiteSpace: 'normal', marginTop: 4 }}>{describeRule(r, fields)}</div>
            <div className="cell-sub">{r.config.graceDays} days’ warning · banner: “{r.config.reason}”</div>
          </div>
          <div className="row" style={{ gap: 4 }}>
            <button className="btn btn-ghost icon-btn hide-mobile" disabled={i === 0} onClick={() => void move(i, -1)} aria-label="Move up"><ArrowUp /></button>
            <button className="btn btn-ghost icon-btn hide-mobile" disabled={i === rules.length - 1} onClick={() => void move(i, 1)} aria-label="Move down"><ArrowDown /></button>
            <button className="btn btn-ghost icon-btn" onClick={() => setEditing(r)} aria-label="Edit"><Pencil /></button>
            <button
              className="btn btn-ghost icon-btn"
              aria-label="Delete rule"
              onClick={async () => {
                if (!confirm(`Delete the rule “${r.name}”? Titles it flagged will be un-flagged at the next check.`)) return;
                await del(`/api/cleanup/rules/${r.id}`);
                await reload();
              }}
            >
              <Trash2 />
            </button>
          </div>
        </div>
      ))}
      {rules && rules.length > 1 && <p className="faint small">If a title matches more than one rule, the highest rule in this list wins.</p>}
      {editing && (
        <RuleEditor
          rule={editing}
          fields={fields}
          libraries={libraries}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}

function LibraryTab() {
  const [kind, setKind] = useState<'all' | MediaKind>('all');
  const [sort, setSort] = useState('unwatched');
  const [q, setQ] = useState('');
  const [qd, setQd] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQd(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(1), [kind, sort, qd]);
  const { data, reload } = usePoll<{ total: number; page: number; pageSize: number; rows: (MediaItemView & { protectedBy: string | null; flag: { daysLeft: number; preview: boolean } | null })[]; lastSync: { at: number } | null }>(
    `/api/library?kind=${kind}&sort=${sort}&q=${encodeURIComponent(qd)}&page=${page}`,
  );

  const act = async (key: string, path: string, body: unknown) => {
    setBusy(key);
    try {
      await post(`/api/library/${encodeURIComponent(key)}/${path}`, body);
      await reload();
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="filters" style={{ marginBottom: 0 }}>
        <div className="search">
          <Search />
          <input className="input" placeholder="Find a title…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          <option value="unwatched">Longest unwatched</option>
          <option value="size">Biggest</option>
          <option value="added">Recently added</option>
          <option value="title">A–Z</option>
        </select>
        <Segmented value={kind} onChange={setKind} options={[{ value: 'all', label: 'All' }, { value: 'movie', label: 'Movies' }, { value: 'show', label: 'TV' }, { value: 'music', label: 'Music' }]} />
        <button className="btn btn-sm" onClick={() => void post('/api/library/sync').then(() => reload())}>Refresh library</button>
      </div>
      {data && <div className="faint small">{plural(data.total, 'title')}{data.lastSync ? ` · library read ${timeAgo(data.lastSync.at)}` : ''}</div>}
      {!data && <Loader2 className="spin" />}
      {data && data.rows.length === 0 && <Empty icon={<Library />} title="Nothing here yet">Connect Jellyfin and Radarr/Sonarr, then press “Refresh library”.</Empty>}
      {data && data.rows.length > 0 && (
        <div className="card" style={{ padding: 4 }}>
          {data.rows.map((i) => (
            <div key={i.key} className="lib-row">
              <Poster id={i.jfId} type={i.kind === 'show' ? 'tv' : i.kind === 'music' ? 'Audio' : 'Movie'} size="sm" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: 6 }}>
                  <span className="cell-main" style={{ fontWeight: 500 }}>{i.title}{i.year ? ` (${i.year})` : ''}</span>
                  {i.flag && <span className="badge badge-warn">Leaving in {i.flag.daysLeft}d{i.flag.preview ? ' (preview)' : ''}</span>}
                </div>
                <div className="cell-sub">
                  {i.lastWatchedAt ? `Watched ${timeAgo(i.lastWatchedAt)}` : 'Never watched'} · {plural(i.plays, 'play')} · {fmtBytes(i.sizeBytes)}
                  {i.library ? ` · ${i.library}` : ''}
                </div>
                {i.protectedBy && <div className="cell-sub" style={{ color: 'var(--teal-strong)' }}><ShieldCheck size={12} style={{ verticalAlign: -2 }} /> {i.protectedBy}</div>}
              </div>
              <div className="row" style={{ gap: 6 }}>
                {busy === i.key ? (
                  <Loader2 className="spin" size={16} />
                ) : (
                  <>
                    {!i.flag && (
                      <button className="btn btn-sm btn-ghost" title="Mark for removal by hand" onClick={() => void act(i.key, 'flag', { days: 14 })}>
                        Flag
                      </button>
                    )}
                    <button className="btn btn-sm btn-ghost" title="Never flag this" onClick={() => void act(i.key, 'keep', { days: null })}>
                      Keep
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </div>
  );
}

function KeptTab() {
  const { data, reload } = usePoll<{ item_key: string; title: string; until: number | null; reason: string; created_at: number }[]>('/api/exclusions');
  if (!data) return <Loader2 className="spin" />;
  if (!data.length) return <Empty icon={<ShieldCheck />} title="Nothing kept by hand">Titles you keep from Leaving Soon or the library show up here.</Empty>;
  return (
    <div className="card" style={{ padding: 4 }}>
      {data.map((e) => (
        <div key={e.item_key} className="lib-row">
          <ShieldCheck size={20} color="var(--teal-strong)" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="cell-main" style={{ fontWeight: 500 }}>{e.title}</div>
            <div className="cell-sub">{e.until ? `Kept until ${fmtDateTime(e.until)}` : 'Kept forever'} · {e.reason}</div>
          </div>
          <button
            className="btn btn-sm btn-ghost"
            onClick={async () => {
              await del(`/api/exclusions/${encodeURIComponent(e.item_key)}`);
              await reload();
            }}
          >
            <Undo2 /> Stop keeping
          </button>
        </div>
      ))}
    </div>
  );
}

export default function Rules() {
  const [tab, setTab] = useState<Tab>('rules');
  const { data: meta } = usePoll<{ fields: FieldDef[]; libraries: { library: string; kind: MediaKind }[] }>('/api/cleanup/fields');
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Cleanup rules</h1>
          <p>Decide what counts as unwatched. Matching titles go to Leaving Soon first — nothing is ever deleted automatically.</p>
        </div>
      </div>
      <div className="tabs">
        <button className={tab === 'rules' ? 'active' : ''} onClick={() => setTab('rules')}><ListChecks /> Rules</button>
        <button className={tab === 'library' ? 'active' : ''} onClick={() => setTab('library')}><Library /> Library</button>
        <button className={tab === 'kept' ? 'active' : ''} onClick={() => setTab('kept')}><ShieldCheck /> Kept titles</button>
      </div>
      {tab === 'rules' && (meta ? <RulesTab fields={meta.fields} libraries={meta.libraries} /> : <Loader2 className="spin" />)}
      {tab === 'library' && <LibraryTab />}
      {tab === 'kept' && <KeptTab />}
      <p className="faint small" style={{ marginTop: 18 }}>
        Always protected: titles tagged {''}
        <Link to="/settings/cleanup">keep</Link>, favourites, recent requests and recent additions — change these in <Link to="/settings/cleanup">Settings → Cleanup</Link>.
      </p>
    </div>
  );
}
