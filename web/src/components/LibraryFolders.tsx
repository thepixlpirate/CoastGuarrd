import { useEffect, useState } from 'react';
import { CheckCircle2, FolderOpen, Loader2, RefreshCw, Save, Trash2, TriangleAlert } from 'lucide-react';
import { del, get, post, put, type LibraryFolder, type PathCheck } from '../api';
import { Alert } from './Fields';
import { ServiceIcon } from './ServiceEditor';
import FolderPicker from './FolderPicker';

function CheckBadge({ check }: { check: PathCheck }) {
  const good = check.localExists && check.recycleWritable && check.sameDrive !== false && !check.recycleInsideLibrary;
  return good ? (
    <span className="badge badge-ok"><CheckCircle2 size={12} /> Ready</span>
  ) : (
    <span className="badge badge-warn"><TriangleAlert size={12} /> Needs attention</span>
  );
}

function FolderRow({ folder, onChange, onRemove }: { folder: LibraryFolder; onChange: (f: LibraryFolder) => void; onRemove: () => void }) {
  const [local, setLocal] = useState(folder.localPath);
  const [recycle, setRecycle] = useState(folder.recyclePath);
  const [check, setCheck] = useState(folder.check);
  const [picker, setPicker] = useState<'local' | 'recycle' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = local !== folder.localPath || recycle !== folder.recyclePath;

  // Re-check paths as they're edited.
  useEffect(() => {
    if (!dirty) {
      setCheck(folder.check);
      return;
    }
    const t = setTimeout(() => {
      post<PathCheck>('/api/storage/check', { localPath: local, recyclePath: recycle })
        .then(setCheck)
        .catch(() => undefined);
    }, 350);
    return () => clearTimeout(t);
  }, [local, recycle, dirty, folder.check]);

  const pickLocal = async (p: string) => {
    setLocal(p);
    setPicker(null);
    // Suggest a recycle bin on the same drive.
    const r = await get<{ recyclePath: string }>(`/api/storage/suggest-recycle?path=${encodeURIComponent(p)}`).catch(() => null);
    if (r?.recyclePath) setRecycle(r.recyclePath);
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      onChange(await put<LibraryFolder>(`/api/library-folders/${folder.id}`, { localPath: local, recyclePath: recycle }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="row" style={{ marginBottom: 14 }}>
        <ServiceIcon id={folder.service} name={folder.serviceName} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{folder.serviceName}</div>
          <div className="faint small mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }} title={folder.remotePath}>
            {folder.serviceName} sees: {folder.remotePath}
          </div>
        </div>
        <CheckBadge check={check} />
      </div>
      <div className="stack">
        <div>
          <label className="label">Where CoastGuarrd sees it</label>
          <div className="row">
            <input className="input mono" value={local} onChange={(e) => setLocal(e.target.value)} placeholder="Pick the matching folder" spellCheck={false} />
            <button className="btn icon-btn" onClick={() => setPicker('local')} aria-label="Browse"><FolderOpen /></button>
          </div>
        </div>
        <div>
          <label className="label">Recycle bin for this folder</label>
          <div className="row">
            <input className="input mono" value={recycle} onChange={(e) => setRecycle(e.target.value)} placeholder="Chosen automatically on the same drive" spellCheck={false} />
            <button className="btn icon-btn" onClick={() => setPicker('recycle')} aria-label="Browse"><FolderOpen /></button>
          </div>
        </div>
        <div className={`small ${check.localExists && check.recycleWritable && check.sameDrive !== false && !check.recycleInsideLibrary ? 'muted' : ''}`} style={{ color: check.localExists && check.sameDrive !== false && check.recycleWritable && !check.recycleInsideLibrary ? undefined : 'var(--amber)' }}>
          {check.message}
        </div>
        {error && <Alert kind="error">{error}</Alert>}
        <div className="row">
          <button className="btn btn-ghost btn-sm" onClick={onRemove}><Trash2 /> Remove</button>
          <div className="spacer" />
          <button className="btn btn-sm btn-teal" disabled={!dirty || busy} onClick={() => void save()}>
            {busy ? <Loader2 className="spin" /> : <Save />} Save
          </button>
        </div>
      </div>
      {picker && (
        <FolderPicker
          title={picker === 'local' ? 'Pick the media folder' : 'Pick the recycle bin folder'}
          start={(picker === 'local' ? local : recycle) || undefined}
          onClose={() => setPicker(null)}
          onPick={(p) => (picker === 'local' ? void pickLocal(p) : (setRecycle(p), setPicker(null)))}
        />
      )}
    </div>
  );
}

export default function LibraryFolders({ autoDiscover }: { autoDiscover?: boolean }) {
  const [folders, setFolders] = useState<LibraryFolder[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ service: string; error: string }[]>([]);
  const [note, setNote] = useState('');

  const discover = async () => {
    setBusy(true);
    setNote('');
    try {
      const r = await post<{ added: number; errors: { service: string; error: string }[]; folders: LibraryFolder[] }>('/api/library-folders/discover');
      setFolders(r.folders);
      setErrors(r.errors);
      setNote(r.added ? `Found ${r.added} new folder${r.added === 1 ? '' : 's'}.` : 'No new folders found.');
    } catch (err) {
      setErrors([{ service: 'CoastGuarrd', error: (err as Error).message }]);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    get<LibraryFolder[]>('/api/library-folders')
      .then((f) => {
        setFolders(f);
        if (autoDiscover) void discover();
      })
      .catch(() => setFolders([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="stack">
      <div className="row row-wrap">
        <button className="btn btn-teal" onClick={() => void discover()} disabled={busy}>
          {busy ? <Loader2 className="spin" /> : <RefreshCw />} Find folders from my apps
        </button>
        {note && <span className="muted small">{note}</span>}
      </div>
      {errors.map((e) => (
        <Alert key={e.service} kind="warn">{e.service}: {e.error}</Alert>
      ))}
      {folders === null && <Loader2 className="spin" />}
      {folders && folders.length === 0 && !busy && (
        <div className="card faint small">No folders yet. Connect your apps, then press “Find folders from my apps”.</div>
      )}
      <div className="grid grid-2">
        {folders?.map((f) => (
          <FolderRow
            key={f.id}
            folder={f}
            onChange={(n) => setFolders((all) => all!.map((x) => (x.id === n.id ? n : x)))}
            onRemove={() => void del(`/api/library-folders/${f.id}`).then(() => setFolders((all) => all!.filter((x) => x.id !== f.id)))}
          />
        ))}
      </div>
    </div>
  );
}
