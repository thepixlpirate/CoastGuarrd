import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Eye, FolderCheck, PlugZap, ShieldCheck, ShieldOff } from 'lucide-react';
import { get, type GeneralSettings, type LibraryFolder, type ServiceView } from '../api';
import { useAuth } from '../auth';
import { ServiceIcon, ServiceStatus } from '../components/ServiceEditor';
import { timeAgo } from '../components/Security';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function Dashboard() {
  const { status } = useAuth();
  const [svcs, setSvcs] = useState<ServiceView[]>([]);
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [general, setGeneral] = useState<GeneralSettings | null>(null);

  useEffect(() => {
    get<ServiceView[]>('/api/services').then(setSvcs).catch(() => undefined);
    get<LibraryFolder[]>('/api/library-folders').then(setFolders).catch(() => undefined);
    get<GeneralSettings>('/api/settings/general').then(setGeneral).catch(() => undefined);
  }, []);

  const enabled = svcs.filter((s) => s.enabled);
  const healthy = enabled.filter((s) => s.lastOkAt && !s.lastError);
  const ready = folders.filter((f) => f.check.localExists && f.check.recycleWritable && f.check.sameDrive !== false && !f.check.recycleInsideLibrary);
  const totp = !!status?.user?.totpEnabled;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>
            {greeting()}, <span className="grad-text">{status?.user?.username}</span>
          </h1>
          <p>Here’s how things look across your harbour.</p>
        </div>
      </div>

      {general?.previewMode && (
        <div className="preview-banner">
          <Eye />
          <div style={{ flex: 1 }}>
            <strong>Preview mode is on.</strong> <span className="muted">CoastGuarrd won’t change posters or move anything until you turn it off.</span>
          </div>
          <Link to="/settings/general" className="btn btn-sm hide-mobile">Change</Link>
        </div>
      )}

      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <Link to="/settings" className="card" style={{ color: 'inherit', textDecoration: 'none' }}>
          <div className="row muted small" style={{ gap: 8 }}><PlugZap size={16} color="var(--purple-strong)" /> Apps connected</div>
          <div className="stat" style={{ marginTop: 8 }}>
            {healthy.length}<span className="faint" style={{ fontSize: 18 }}> / {enabled.length}</span>
          </div>
          <div className="small muted">{enabled.length === 0 ? 'No apps switched on yet.' : enabled.length === healthy.length ? 'All switched-on apps are answering.' : 'Some apps need attention.'}</div>
        </Link>
        <Link to="/settings/library" className="card" style={{ color: 'inherit', textDecoration: 'none' }}>
          <div className="row muted small" style={{ gap: 8 }}><FolderCheck size={16} color="var(--teal-strong)" /> Folders ready</div>
          <div className="stat" style={{ marginTop: 8 }}>
            {ready.length}<span className="faint" style={{ fontSize: 18 }}> / {folders.length}</span>
          </div>
          <div className="small muted">{folders.length === 0 ? 'No folders matched yet.' : ready.length === folders.length ? 'Every folder has a recycle bin.' : 'Some folders need a look.'}</div>
        </Link>
        <Link to="/settings/security" className="card" style={{ color: 'inherit', textDecoration: 'none' }}>
          <div className="row muted small" style={{ gap: 8 }}>
            {totp ? <ShieldCheck size={16} color="var(--teal-strong)" /> : <ShieldOff size={16} color="var(--amber)" />} Two-factor sign-in
          </div>
          <div className="stat" style={{ marginTop: 8, color: totp ? 'var(--teal-strong)' : 'var(--amber)' }}>{totp ? 'On' : 'Off'}</div>
          <div className="small muted">{totp ? 'Your account is extra protected.' : 'Recommended for internet access.'}</div>
        </Link>
      </div>

      <div className="grid grid-2">
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
                  <div className="faint small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.enabled ? (s.lastError ? s.lastError : s.lastOkAt ? `v${s.version} · checked ${timeAgo(s.lastOkAt)}` : s.url || 'Not set up') : 'Switched off'}
                  </div>
                </div>
                <ServiceStatus s={s} />
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>On the horizon</h3>
          </div>
          <div className="list">
            {[
              { n: 1, t: 'Foundation', d: 'Secure sign-in, connections, folders and recycle bins.', done: true },
              { n: 2, t: 'Watch tracking', d: 'Live activity, history, users, devices, map and sharing alerts.' },
              { n: 3, t: 'Rules & flagging', d: 'Unwatched rules, protections, “Leaving Soon” collection and poster banners.' },
              { n: 4, t: 'Recycle bin', d: 'Safe moves, one-click restore, manual emptying.' },
              { n: 5, t: 'Notifications', d: 'Discord and email notices, with “keep it” requests from family.' },
            ].map((p) => (
              <div key={p.n} className="list-item" style={{ alignItems: 'flex-start' }}>
                <span className={`badge ${p.done ? 'badge-ok' : 'badge-purple'}`} style={{ marginTop: 2 }}>Phase {p.n}</span>
                <div>
                  <div style={{ fontWeight: 500 }}>{p.t}</div>
                  <div className="faint small">{p.d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
