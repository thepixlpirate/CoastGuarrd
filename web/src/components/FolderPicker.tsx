import { useEffect, useState } from 'react';
import { ChevronLeft, Folder, Loader2, X } from 'lucide-react';
import { get } from '../api';
import { Alert } from './Fields';

interface Browse {
  root: string;
  rootExists: boolean;
  path: string;
  parent: string | null;
  folders: string[];
}

/** Lets the admin click through the folders CoastGuarrd can see. */
export default function FolderPicker({ start, title, onPick, onClose }: { start?: string; title: string; onPick: (path: string) => void; onClose: () => void }) {
  const [data, setData] = useState<Browse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async (p?: string) => {
    setLoading(true);
    setError('');
    try {
      setData(await get<Browse>(`/api/storage/browse${p ? `?path=${encodeURIComponent(p)}` : ''}`));
    } catch (err) {
      if (p) return load(undefined); // fall back to the top
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="row" style={{ marginBottom: 8 }}>
          <h3 style={{ flex: 1 }}>{title}</h3>
          <button className="btn btn-ghost icon-btn" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        {error && <Alert kind="error">{error}</Alert>}
        {data && !data.rootExists && (
          <Alert kind="warn">
            Nothing is mounted at <code>{data.root}</code>. In the Unraid container settings, map your media to <code>{data.root}</code>.
          </Alert>
        )}
        {data && (
          <>
            <div className="row" style={{ marginTop: 6 }}>
              <button className="btn btn-sm" disabled={!data.parent || loading} onClick={() => void load(data.parent!)}>
                <ChevronLeft /> Up
              </button>
              <code className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data.path}</code>
              {loading && <Loader2 className="spin" size={16} />}
            </div>
            <div className="folder-list">
              {data.folders.length === 0 && <div className="faint small" style={{ padding: 12 }}>No folders here.</div>}
              {data.folders.map((f) => (
                <button key={f} onClick={() => void load(`${data.path.replace(/\/$/, '')}/${f}`)}>
                  <Folder /> {f}
                </button>
              ))}
            </div>
            <div className="row">
              <div className="spacer" />
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={() => onPick(data.path)}>Use this folder</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
