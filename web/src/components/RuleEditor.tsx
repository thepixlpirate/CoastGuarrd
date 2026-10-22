import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import { post, put } from '../api';
import { fmtBytes, timeAgo } from '../lib/format';
import type { CleanupRule, Condition, FieldDef, MediaItemView, MediaKind, RuleConfig } from '../types';
import { Alert } from './Fields';
import { Poster, Segmented } from './ui';

interface Preview {
  checked: number;
  matched: number;
  wouldFlag: number;
  bytes: number;
  items: (MediaItemView & { details: { label: string; actual: string }[]; protectedBy: string | null })[];
}

const OPS: Record<FieldDef['type'], { value: Condition['op']; label: string }[]> = {
  number: [
    { value: 'gt', label: 'more than' },
    { value: 'gte', label: 'at least' },
    { value: 'lt', label: 'less than' },
    { value: 'lte', label: 'at most' },
    { value: 'eq', label: 'exactly' },
  ],
  bool: [{ value: 'is', label: 'is' }],
  text: [
    { value: 'contains', label: 'includes' },
    { value: 'notContains', label: 'doesn’t include' },
  ],
};

export const BLANK_RULE: Omit<CleanupRule, 'id' | 'position' | 'flagged'> = {
  name: '',
  enabled: false,
  kind: 'movie',
  config: { libraries: [], match: 'all', graceDays: 14, reason: 'due to not being watched', conditions: [{ field: 'lastWatchedDays', op: 'gt', value: 365 }] },
};

export default function RuleEditor({
  rule,
  fields,
  libraries,
  onClose,
  onSaved,
}: {
  rule: Omit<CleanupRule, 'id' | 'position' | 'flagged'> & { id?: number };
  fields: FieldDef[];
  libraries: { library: string; kind: MediaKind }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [r, setR] = useState(rule);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const byId = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);
  const libs = libraries.filter((l) => l.kind === r.kind).map((l) => l.library);

  const setCfg = (patch: Partial<RuleConfig>) => setR((cur) => ({ ...cur, config: { ...cur.config, ...patch } }));
  const setCond = (i: number, patch: Partial<Condition>) =>
    setCfg({ conditions: r.config.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  // Live preview, debounced.
  useEffect(() => {
    const t = setTimeout(() => {
      if (!r.config.conditions.length) return setPreview(null);
      setLoading(true);
      post<Preview>('/api/cleanup/preview', { kind: r.kind, config: r.config })
        .then((p) => (setPreview(p), setPreviewError('')))
        .catch((e) => setPreviewError((e as Error).message))
        .finally(() => setLoading(false));
    }, 450);
    return () => clearTimeout(t);
  }, [r.kind, r.config]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const body = { name: r.name, enabled: r.enabled, kind: r.kind, config: r.config };
      if (r.id) await put(`/api/cleanup/rules/${r.id}`, body);
      else await post('/api/cleanup/rules', body);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const fieldOptions = fields.filter((f) => !(r.kind !== 'show' && f.id === 'ended'));

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Edit rule">
        <div className="row" style={{ marginBottom: 14 }}>
          <h3 style={{ flex: 1 }}>{r.id ? 'Edit rule' : 'New rule'}</h3>
          <button className="btn btn-ghost icon-btn" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <div className="rule-edit">
          <div className="stack">
            <div>
              <label className="label">Name</label>
              <input className="input" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} placeholder="e.g. Movies nobody watches" autoFocus />
            </div>
            <div>
              <label className="label">What it looks at</label>
              <Segmented
                value={r.kind}
                onChange={(kind) => setR({ ...r, kind, config: { ...r.config, libraries: [] } })}
                options={[
                  { value: 'movie', label: 'Movies' },
                  { value: 'show', label: 'TV shows' },
                  { value: 'music', label: 'Music artists' },
                ]}
              />
            </div>
            {libs.length > 1 && (
              <div>
                <label className="label">Only in these libraries <span className="faint">(none ticked = all)</span></label>
                <div className="chips">
                  {libs.map((l) => (
                    <label key={l} className="check chip-check">
                      <input
                        type="checkbox"
                        checked={r.config.libraries.includes(l)}
                        onChange={(e) => setCfg({ libraries: e.target.checked ? [...r.config.libraries, l] : r.config.libraries.filter((x) => x !== l) })}
                      />
                      {l}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div>
              <div className="row" style={{ marginBottom: 8 }}>
                <span className="label" style={{ margin: 0 }}>Flag a title when</span>
                <select className="select" style={{ width: 'auto', height: 32 }} value={r.config.match} onChange={(e) => setCfg({ match: e.target.value as 'all' | 'any' })}>
                  <option value="all">all of these are true</option>
                  <option value="any">any of these is true</option>
                </select>
              </div>
              <div className="stack" style={{ gap: 8 }}>
                {r.config.conditions.map((c, i) => {
                  const def = byId.get(c.field);
                  const type = def?.type ?? 'number';
                  return (
                    <div key={i} className="cond-row">
                      <select
                        className="select"
                        value={c.field}
                        onChange={(e) => {
                          const nd = byId.get(e.target.value)!;
                          setCond(i, { field: nd.id, op: OPS[nd.type][0].value, value: nd.type === 'bool' ? true : nd.type === 'text' ? '' : 30 });
                        }}
                      >
                        {fieldOptions.map((f) => (
                          <option key={f.id} value={f.id}>{f.label}</option>
                        ))}
                      </select>
                      <select className="select" value={c.op} onChange={(e) => setCond(i, { op: e.target.value as Condition['op'] })}>
                        {OPS[type].map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                      {type === 'bool' ? (
                        <select className="select" value={String(c.value)} onChange={(e) => setCond(i, { value: e.target.value === 'true' })}>
                          <option value="true">yes</option>
                          <option value="false">no</option>
                        </select>
                      ) : type === 'text' ? (
                        <input className="input" value={String(c.value)} onChange={(e) => setCond(i, { value: e.target.value })} placeholder={def?.help} />
                      ) : (
                        <div className="row" style={{ gap: 6 }}>
                          <input className="input" type="number" inputMode="decimal" value={Number(c.value)} onChange={(e) => setCond(i, { value: Number(e.target.value) })} />
                          {def?.unit && <span className="faint small">{def.unit}</span>}
                        </div>
                      )}
                      <button className="btn btn-ghost icon-btn" aria-label="Remove condition" onClick={() => setCfg({ conditions: r.config.conditions.filter((_, j) => j !== i) })}>
                        <Trash2 />
                      </button>
                      {def && <div className="hint cond-help">{def.help}</div>}
                    </div>
                  );
                })}
              </div>
              <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => setCfg({ conditions: [...r.config.conditions, { field: 'addedDays', op: 'gt', value: 90 }] })}>
                <Plus /> Add condition
              </button>
            </div>
            <div className="grid grid-2" style={{ gap: 12 }}>
              <div>
                <label className="label">Days of warning before moving to the recycle bin</label>
                <input className="input" type="number" min={1} value={r.config.graceDays} onChange={(e) => setCfg({ graceDays: Number(e.target.value) })} />
              </div>
              <div>
                <label className="label">Banner wording</label>
                <input className="input" value={r.config.reason} maxLength={80} onChange={(e) => setCfg({ reason: e.target.value })} />
                <div className="hint">Shown under “Marked for removal in {r.config.graceDays} days”.</div>
              </div>
            </div>
            <label className="row" style={{ gap: 12, cursor: 'pointer' }}>
              <input type="checkbox" className="switch" checked={r.enabled} onChange={(e) => setR({ ...r, enabled: e.target.checked })} />
              <span>Rule is switched on</span>
            </label>
            {error && <Alert kind="error">{error}</Alert>}
            <div className="row">
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" disabled={saving || !r.name.trim() || !r.config.conditions.length} onClick={() => void save()}>
                {saving ? <Loader2 className="spin" /> : <Save />} Save rule
              </button>
            </div>
          </div>

          <div className="rule-preview">
            <div className="row" style={{ marginBottom: 10 }}>
              <h4 style={{ flex: 1, fontSize: 15 }}>Would flag right now</h4>
              {loading && <Loader2 className="spin" size={16} />}
            </div>
            {previewError && <Alert kind="error">{previewError}</Alert>}
            {preview && (
              <>
                <div className="small muted" style={{ marginBottom: 10 }}>
                  <b style={{ color: 'var(--text)' }}>{preview.wouldFlag}</b> of {preview.checked} {r.kind === 'movie' ? 'movies' : r.kind === 'show' ? 'shows' : 'artists'} · {fmtBytes(preview.bytes)}
                  {preview.matched > preview.wouldFlag && <> · {preview.matched - preview.wouldFlag} protected</>}
                </div>
                <div className="list preview-list">
                  {preview.items.length === 0 && <div className="faint small">Nothing matches.</div>}
                  {preview.items.map((i) => (
                    <div key={i.key} className="list-item" style={{ opacity: i.protectedBy ? 0.55 : 1 }}>
                      <Poster id={i.jfId} type={i.kind === 'show' ? 'tv' : i.kind === 'music' ? 'Audio' : 'Movie'} size="sm" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="cell-main" style={{ fontWeight: 500 }}>{i.title}{i.year ? ` (${i.year})` : ''}</div>
                        <div className="cell-sub">{i.protectedBy ? `Protected — ${i.protectedBy}` : i.lastWatchedAt ? `Last watched ${timeAgo(i.lastWatchedAt)}` : 'Never watched'}</div>
                      </div>
                      <span className="small faint">{fmtBytes(i.sizeBytes)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            <p className="hint" style={{ marginTop: 10 }}>This preview never changes anything.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
