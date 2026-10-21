import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Eye, FolderSync, Loader2, LogOut, PlugZap, ShieldCheck, Trash2 } from 'lucide-react';
import { get, put, type GeneralSettings, type ServiceView } from '../api';
import { useAuth } from '../auth';
import ServiceEditor from '../components/ServiceEditor';
import LibraryFolders from '../components/LibraryFolders';
import { TwoFactorCard } from '../components/Security';
import { Alert } from '../components/Fields';
import FolderPicker from '../components/FolderPicker';

const STEPS = ['Welcome', 'Connect apps', 'Folders & recycle bins', 'Two-factor', 'Finish'];

export default function SetupWizard() {
  const { refresh, logout, status } = useAuth();
  const [step, setStep] = useState(0);
  const [svcs, setSvcs] = useState<ServiceView[] | null>(null);
  const [general, setGeneral] = useState<GeneralSettings | null>(null);
  const [picker, setPicker] = useState(false);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    get<ServiceView[]>('/api/services').then(setSvcs).catch(() => setSvcs([]));
    get<GeneralSettings>('/api/settings/general').then(setGeneral).catch(() => undefined);
  }, []);

  useEffect(() => window.scrollTo(0, 0), [step]);

  const jellyfinOk = !!svcs?.find((s) => s.id === 'jellyfin' && s.enabled && s.lastOkAt && !s.lastError);

  const finish = async () => {
    setFinishing(true);
    await put('/api/settings/general', { setupComplete: true });
    await refresh();
  };

  return (
    <div className="backdrop" style={{ minHeight: '100%' }}>
      <div className="wizard">
        <div className="wizard-top">
          <img src="/logo.png" alt="" />
          <div style={{ flex: 1 }}>
            <div className="grad-text" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 21 }}>CoastGuarrd</div>
            <div className="faint small">Setup · step {step + 1} of {STEPS.length} — {STEPS[step]}</div>
          </div>
          <button className="btn btn-ghost icon-btn" onClick={() => void logout()} aria-label="Sign out" title="Sign out">
            <LogOut />
          </button>
        </div>
        <div className="steps">
          {STEPS.map((s, i) => (
            <div key={s} className={i <= step ? 'done' : ''} />
          ))}
        </div>

        {step === 0 && (
          <div className="stack" style={{ gap: 18 }}>
            <div>
              <h2>Welcome aboard, {status?.user?.username}</h2>
              <p className="muted" style={{ margin: 0 }}>A few quick steps and CoastGuarrd will be keeping watch over your library.</p>
            </div>
            <div className="grid grid-2">
              {[
                { icon: PlugZap, t: 'Connect your apps', d: 'Jellyfin, Seerr, Radarr and Sonarr. Lidarr is there too, switched off until you want it.' },
                { icon: FolderSync, t: 'Match your folders', d: 'Tell CoastGuarrd where your media lives, and pick a recycle bin on the same drive so moves are instant.' },
                { icon: ShieldCheck, t: 'Lock it down', d: 'Turn on two-factor sign-in — recommended if you reach CoastGuarrd from the internet.' },
                { icon: Trash2, t: 'Never deletes on its own', d: 'Removed titles only ever go to the recycle bin. Emptying it is always up to you.' },
              ].map(({ icon: Icon, t, d }) => (
                <div key={t} className="card row" style={{ alignItems: 'flex-start', gap: 14 }}>
                  <div className="svc-icon" style={{ background: 'var(--purple-soft)', color: 'var(--teal-strong)' }}>
                    <Icon size={20} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: 15.5 }}>{t}</h3>
                    <p className="card-sub">{d}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="stack" style={{ gap: 16 }}>
            <div>
              <h2>Connect your apps</h2>
              <p className="muted" style={{ margin: 0 }}>Paste each app’s address and API key, then press “Test & save”. Addresses are pre-filled with the usual ports — change them if yours differ.</p>
            </div>
            {!svcs && <Loader2 className="spin" />}
            {svcs?.map((s) => (
              <ServiceEditor key={s.id} service={s} autoSave onSaved={(n) => setSvcs((all) => all!.map((x) => (x.id === n.id ? { ...x, ...n } : x)))} />
            ))}
            {svcs && !jellyfinOk && <Alert kind="info">Jellyfin is the one CoastGuarrd needs most — it’s where all watch activity comes from.</Alert>}
          </div>
        )}

        {step === 2 && (
          <div className="stack" style={{ gap: 16 }}>
            <div>
              <h2>Folders & recycle bins</h2>
              <p className="muted" style={{ margin: 0 }}>
                Each app may call your folders something different (for example Radarr might say <code>/movies</code>). Match each one to where CoastGuarrd sees it under <code>{general?.mediaRoot ?? '/media'}</code>.
                A recycle bin is picked on the same drive automatically.
              </p>
            </div>
            <LibraryFolders autoDiscover />
            <div className="card">
              <div className="card-head" style={{ marginBottom: 10 }}>
                <h3>Downloads folder <span className="faint small">(optional)</span></h3>
              </div>
              <p className="card-sub" style={{ marginTop: -6, marginBottom: 12 }}>Lets CoastGuarrd spot leftover downloads that never made it into your library. Nothing there is ever removed without you.</p>
              <div className="row">
                <input
                  className="input mono"
                  value={general?.downloadsPath ?? ''}
                  placeholder="Not set"
                  onChange={(e) => setGeneral((g) => (g ? { ...g, downloadsPath: e.target.value } : g))}
                  onBlur={() => general && void put('/api/settings/general', { downloadsPath: general.downloadsPath })}
                />
                <button className="btn" onClick={() => setPicker(true)}>Browse</button>
              </div>
            </div>
            {picker && (
              <FolderPicker
                title="Pick the downloads folder"
                start={general?.downloadsPath || undefined}
                onClose={() => setPicker(false)}
                onPick={(p) => {
                  setPicker(false);
                  setGeneral((g) => (g ? { ...g, downloadsPath: p } : g));
                  void put('/api/settings/general', { downloadsPath: p });
                }}
              />
            )}
          </div>
        )}

        {step === 3 && (
          <div className="stack" style={{ gap: 16 }}>
            <div>
              <h2>Two-factor sign-in</h2>
              <p className="muted" style={{ margin: 0 }}>Strongly recommended, since CoastGuarrd can be reached from outside your home. You can also do this later in Settings.</p>
            </div>
            <TwoFactorCard compact />
          </div>
        )}

        {step === 4 && (
          <div className="stack" style={{ gap: 16 }}>
            <div>
              <h2>Ready to set sail</h2>
              <p className="muted" style={{ margin: 0 }}>One last thing worth knowing:</p>
            </div>
            <div className="card row" style={{ alignItems: 'flex-start', gap: 14 }}>
              <div className="svc-icon" style={{ background: 'var(--teal-soft)', color: 'var(--teal-strong)' }}>
                <Eye size={20} />
              </div>
              <div>
                <h3 style={{ fontSize: 15.5 }}>Preview mode is on</h3>
                <p className="card-sub">
                  While preview mode is on, CoastGuarrd shows what it <em>would</em> flag and move, but doesn’t change a thing — no posters, no moves. Turn it off in Settings → General once the rules look right.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="wizard-foot">
          {step > 0 && (
            <button className="btn" onClick={() => setStep((s) => s - 1)}>
              <ArrowLeft /> Back
            </button>
          )}
          <div className="spacer" />
          {step < STEPS.length - 1 ? (
            <button className="btn btn-primary" onClick={() => setStep((s) => s + 1)}>
              {step === 0 ? 'Get started' : step === 3 && !status?.user?.totpEnabled ? 'Skip for now' : 'Next'} <ArrowRight />
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => void finish()} disabled={finishing}>
              {finishing ? <Loader2 className="spin" /> : null} Open CoastGuarrd <ArrowRight />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
