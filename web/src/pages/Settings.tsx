import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { Bell, Brush, FolderSync, Loader2, PlugZap, Radar, Shield, SlidersHorizontal } from 'lucide-react';
import CleanupSettings from '../components/CleanupSettings';
import NotifySettings from '../components/NotifySettings';
import TrackingSettings from '../components/TrackingSettings';
import { get, put, type GeneralSettings, type ServiceView } from '../api';
import ServiceEditor from '../components/ServiceEditor';
import LibraryFolders from '../components/LibraryFolders';
import { LockoutCard, LoginAttemptsCard, PasswordCard, SessionsCard, TwoFactorCard } from '../components/Security';
import { Alert } from '../components/Fields';
import FolderPicker from '../components/FolderPicker';

function Connections() {
  const [svcs, setSvcs] = useState<ServiceView[] | null>(null);
  useEffect(() => {
    get<ServiceView[]>('/api/services').then(setSvcs).catch(() => setSvcs([]));
  }, []);
  if (!svcs) return <Loader2 className="spin" />;
  return (
    <div className="grid grid-2">
      {svcs.map((s) => (
        <ServiceEditor key={s.id} service={s} onSaved={(n) => setSvcs((all) => all!.map((x) => (x.id === n.id ? { ...x, ...n } : x)))} />
      ))}
    </div>
  );
}

function Security() {
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="grid grid-2">
        <TwoFactorCard />
        <PasswordCard />
      </div>
      <SessionsCard />
      <LockoutCard />
      <LoginAttemptsCard />
    </div>
  );
}

function General() {
  const [g, setG] = useState<GeneralSettings | null>(null);
  const [picker, setPicker] = useState(false);
  const [saved, setSaved] = useState('');
  useEffect(() => {
    get<GeneralSettings>('/api/settings/general').then(setG).catch(() => undefined);
  }, []);
  if (!g) return <Loader2 className="spin" />;

  const save = async (patch: Partial<GeneralSettings>) => {
    const next = await put<GeneralSettings>('/api/settings/general', patch);
    setG((cur) => ({ ...cur!, ...next }));
    setSaved('Saved.');
    setTimeout(() => setSaved(''), 2000);
  };

  return (
    <div className="stack" style={{ gap: 16, maxWidth: 760 }}>
      <div className="card">
        <label className="row" style={{ alignItems: 'flex-start', gap: 14, cursor: 'pointer' }}>
          <input type="checkbox" className="switch" checked={g.previewMode} onChange={(e) => void save({ previewMode: e.target.checked })} />
          <div>
            <div style={{ fontWeight: 600 }}>Preview mode</div>
            <div className="hint" style={{ marginTop: 2 }}>
              While on, CoastGuarrd only shows what it would flag and move. It won’t touch posters, collections or files. Turn it off once you’re happy with your rules.
            </div>
          </div>
        </label>
        {!g.previewMode && (
          <div style={{ marginTop: 14 }}>
            <Alert kind="warn">Preview mode is off. Flagged titles will get banners and, when their countdown ends, be moved to the recycle bin. Nothing is ever permanently deleted without you.</Alert>
          </div>
        )}
      </div>
      <div className="card">
        <h3 style={{ marginBottom: 12 }}>Downloads folder</h3>
        <div className="row">
          <input className="input mono" value={g.downloadsPath} placeholder="Not set" onChange={(e) => setG({ ...g, downloadsPath: e.target.value })} onBlur={() => void save({ downloadsPath: g.downloadsPath })} />
          <button className="btn" onClick={() => setPicker(true)}>Browse</button>
        </div>
        <div className="hint">Optional. Used to spot leftover downloads that never reached your library.</div>
      </div>
      <div className="card small muted">
        <div>Version <code>{g.version}</code></div>
        <div>Media is mounted inside the container at <code>{g.mediaRoot}</code></div>
      </div>
      {saved && <Alert kind="ok">{saved}</Alert>}
      {picker && (
        <FolderPicker
          title="Pick the downloads folder"
          start={g.downloadsPath || undefined}
          onClose={() => setPicker(false)}
          onPick={(p) => {
            setPicker(false);
            void save({ downloadsPath: p });
          }}
        />
      )}
    </div>
  );
}

export default function Settings() {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Connections, folders, tracking, cleanup, notifications and security.</p>
        </div>
      </div>
      <div className="tabs">
        <NavLink to="/settings" end><PlugZap /> Connections</NavLink>
        <NavLink to="/settings/library"><FolderSync /> Folders & recycle bins</NavLink>
        <NavLink to="/settings/tracking"><Radar /> Tracking & alerts</NavLink>
        <NavLink to="/settings/cleanup"><Brush /> Cleanup</NavLink>
        <NavLink to="/settings/notifications"><Bell /> Notifications</NavLink>
        <NavLink to="/settings/security"><Shield /> Security</NavLink>
        <NavLink to="/settings/general"><SlidersHorizontal /> General</NavLink>
      </div>
      <Routes>
        <Route index element={<Connections />} />
        <Route path="library" element={<LibraryFolders />} />
        <Route path="tracking" element={<TrackingSettings />} />
        <Route path="cleanup" element={<CleanupSettings />} />
        <Route path="notifications" element={<NotifySettings />} />
        <Route path="security" element={<Security />} />
        <Route path="general" element={<General />} />
      </Routes>
    </div>
  );
}
