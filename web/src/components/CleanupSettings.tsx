import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { get, put } from '../api';
import type { CleanupSettings as CS, MediaKind } from '../types';
import { Alert } from './Fields';

function Toggle({ checked, onChange, title, hint }: { checked: boolean; onChange: (v: boolean) => void; title: string; hint?: string }) {
  return (
    <label className="row" style={{ alignItems: 'flex-start', gap: 14, cursor: 'pointer' }}>
      <input type="checkbox" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <div>
        <div style={{ fontWeight: 500 }}>{title}</div>
        {hint && <div className="hint" style={{ marginTop: 2 }}>{hint}</div>}
      </div>
    </label>
  );
}

function Num({ label, value, onChange, suffix, min = 0 }: { label: string; value: number; onChange: (v: number) => void; suffix?: string; min?: number }) {
  return (
    <label className="row small row-wrap" style={{ gap: 8 }}>
      <span className="muted">{label}</span>
      <input className="input" type="number" min={min} inputMode="numeric" style={{ width: 90, height: 34 }} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {suffix && <span className="faint">{suffix}</span>}
    </label>
  );
}

const SWATCH: Record<CS['posters']['color'], string> = { red: '#e11d48', purple: '#8b5cf6', teal: '#0d9488', black: '#27272a' };

export default function CleanupSettings() {
  const [s, setS] = useState<CS | null>(null);
  const [libs, setLibs] = useState<string[]>([]);
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    get<CS>('/api/settings/cleanup').then((c) => (setS(c), setTags(c.protectTags.join(', ')))).catch(() => undefined);
    get<{ libraries: { library: string; kind: MediaKind }[] }>('/api/cleanup/fields').then((f) => setLibs([...new Set(f.libraries.map((l) => l.library))])).catch(() => undefined);
  }, []);
  if (!s) return <Loader2 className="spin" />;

  const save = async () => {
    setBusy(true);
    try {
      const next = await put<CS>('/api/settings/cleanup', { ...s, protectTags: tags.split(',').map((t) => t.trim()).filter(Boolean) });
      setS(next);
      setTags(next.protectTags.join(', '));
      setMsg({ ok: true, text: 'Saved.' });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 3000);
    }
  };

  return (
    <div className="stack" style={{ gap: 16, maxWidth: 900 }}>
      <div className="card stack">
        <h3>Always protect</h3>
        <div>
          <label className="label">Never flag titles with these tags</label>
          <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="keep, coastguarrd-keep" />
          <div className="hint">Tags from Radarr, Sonarr, Lidarr or Jellyfin, separated by commas. Tag something “keep” in Radarr and it’s safe.</div>
        </div>
        <Toggle checked={s.protectFavorites} onChange={(v) => setS({ ...s, protectFavorites: v })} title="Never flag anyone’s favourites" hint="If anyone has hearted it in Jellyfin, it stays." />
        <Num label="Never flag anything requested in the last" value={s.protectRequestedDays} onChange={(v) => setS({ ...s, protectRequestedDays: v })} suffix="days (0 = off)" />
        <Num label="Never flag anything added in the last" value={s.protectAddedDays} onChange={(v) => setS({ ...s, protectAddedDays: v })} suffix="days (0 = off)" />
        {libs.length > 0 && (
          <div>
            <label className="label">Never touch these libraries</label>
            <div className="chips">
              {libs.map((l) => (
                <label key={l} className="check chip-check">
                  <input type="checkbox" checked={s.excludedLibraries.includes(l)} onChange={(e) => setS({ ...s, excludedLibraries: e.target.checked ? [...s.excludedLibraries, l] : s.excludedLibraries.filter((x) => x !== l) })} />
                  {l}
                </label>
              ))}
            </div>
            <div className="hint">Handy for a Kids library.</div>
          </div>
        )}
      </div>

      <div className="card stack">
        <h3>What family sees</h3>
        <Toggle checked={s.posters.enabled} onChange={(v) => setS({ ...s, posters: { ...s.posters, enabled: v } })} title="Put a “Marked for removal in X days” banner on posters" hint="The original poster is saved and put back if the title is kept or watched." />
        {s.posters.enabled && (
          <div className="row row-wrap" style={{ gap: 8, paddingLeft: 58 }}>
            <span className="small muted">Banner colour</span>
            {(Object.keys(SWATCH) as CS['posters']['color'][]).map((c) => (
              <button key={c} className={`swatch ${s.posters.color === c ? 'active' : ''}`} style={{ background: SWATCH[c] }} aria-label={c} title={c} onClick={() => setS({ ...s, posters: { ...s.posters, color: c } })} />
            ))}
          </div>
        )}
        <Toggle checked={s.collection.enabled} onChange={(v) => setS({ ...s, collection: { ...s.collection, enabled: v } })} title="Show flagged titles in a Jellyfin collection" hint="Everything leaving appears together in one row in Jellyfin." />
        {s.collection.enabled && (
          <div style={{ paddingLeft: 58 }}>
            <label className="label">Collection name</label>
            <input className="input" style={{ maxWidth: 320 }} value={s.collection.name} onChange={(e) => setS({ ...s, collection: { ...s.collection, name: e.target.value } })} />
          </div>
        )}
      </div>

      <div className="card stack">
        <h3>Moving and deleting</h3>
        <Toggle checked={s.arr.unmonitor} onChange={(v) => setS({ ...s, arr: { ...s.arr, unmonitor: v } })} title="Stop monitoring in Radarr/Sonarr/Lidarr before moving" hint="So the title isn’t downloaded again. Restoring turns monitoring back on." />
        <Toggle checked={s.arr.removeOnDelete} onChange={(v) => setS({ ...s, arr: { ...s.arr, removeOnDelete: v } })} title="When deleted forever, also remove it from Radarr/Sonarr/Lidarr" />
        {s.arr.removeOnDelete && (
          <div style={{ paddingLeft: 58 }}>
            <Toggle checked={s.arr.importExclusion} onChange={(v) => setS({ ...s, arr: { ...s.arr, importExclusion: v } })} title="…and add it to their exclusion list" hint="Stops lists from adding it back automatically." />
          </div>
        )}
        <Toggle checked={s.seerrReset} onChange={(v) => setS({ ...s, seerrReset: v })} title="When deleted forever, clear it in Seerr" hint="So family can request it again later." />
        <Toggle checked={s.allowCrossDrive} onChange={(v) => setS({ ...s, allowCrossDrive: v })} title="Allow a recycle bin on a different drive" hint="Off is recommended: moving between drives copies the whole file, which is slow. When off, CoastGuarrd refuses instead." />
        <Num label="Check rules every" value={s.evaluateHours} onChange={(v) => setS({ ...s, evaluateHours: v })} suffix="hours" min={1} />
        <Num label="List downloads untouched for" value={s.downloadsAgeDays} onChange={(v) => setS({ ...s, downloadsAgeDays: v })} suffix="days as leftovers" min={1} />
      </div>

      <div className="row">
        <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? <Loader2 className="spin" /> : <Save />} Save cleanup settings
        </button>
        {msg && <span className="small" style={{ color: msg.ok ? 'var(--text-dim)' : 'var(--red)' }}>{msg.text}</span>}
      </div>
      <Alert kind="info">CoastGuarrd never deletes anything on its own. Titles only ever move to the recycle bin, and only you can empty it.</Alert>
    </div>
  );
}
