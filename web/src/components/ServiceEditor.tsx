import { useState } from 'react';
import { CheckCircle2, KeyRound, Loader2, PlugZap, Save } from 'lucide-react';
import { post, put, type ServiceView } from '../api';
import { Alert } from './Fields';

export function ServiceIcon({ id, name }: { id: string; name: string }) {
  return <div className={`svc-icon svc-${id}`}>{name.slice(0, 1)}</div>;
}

export function ServiceStatus({ s, enabled = s.enabled }: { s: ServiceView; enabled?: boolean }) {
  if (!enabled) return <span className="badge">Off</span>;
  if (!s.url || !s.hasKey) return <span className="badge badge-warn">Not set up</span>;
  if (s.lastError) return <span className="badge badge-bad"><span className="dot" />Problem</span>;
  if (s.lastOkAt) return <span className="badge badge-ok"><span className="dot" />Connected</span>;
  return <span className="badge">Not tested</span>;
}

/**
 * One app connection: on/off switch, address, API key, test and save.
 * In the wizard, `autoSave` saves automatically after a successful test.
 */
export default function ServiceEditor({ service, onSaved, autoSave }: { service: ServiceView; onSaved: (s: ServiceView) => void; autoSave?: boolean }) {
  const suggested = `http://${window.location.hostname}:${service.defaultPort}`;
  // In the wizard, apps that have never been set up start in their default on/off state.
  const fresh = !service.url && !service.hasKey;
  const [enabled, setEnabled] = useState(autoSave && fresh ? service.enabledByDefault : service.enabled);
  const [url, setUrl] = useState(service.url || (autoSave && fresh && service.enabledByDefault ? suggested : ''));
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState<'test' | 'save' | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty = enabled !== service.enabled || url !== service.url || apiKey !== '';

  const save = async (opts: { quiet?: boolean } = {}) => {
    setBusy('save');
    try {
      const next = await put<ServiceView>(`/api/services/${service.id}`, { enabled, url, apiKey });
      setApiKey('');
      onSaved(next);
      if (!opts.quiet) setResult({ ok: true, text: 'Saved.' });
    } catch (err) {
      setResult({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('test');
    setResult(null);
    try {
      const r = await post<{ ok: boolean; name?: string; version?: string; error?: string }>(`/api/services/${service.id}/test`, { url: url || undefined, apiKey: apiKey || undefined });
      if (r.ok) {
        setResult({ ok: true, text: `Connected to ${r.name} (version ${r.version}).` });
        if (autoSave || dirty) {
          await save({ quiet: true });
          // Re-run the test now that it's saved so the status badge updates.
          await post(`/api/services/${service.id}/test`, {});
          onSaved({ ...service, enabled, url, hasKey: true, lastOkAt: Date.now(), lastError: null, version: r.version ?? null });
        }
      } else {
        setResult({ ok: false, text: r.error ?? 'Could not connect.' });
      }
    } catch (err) {
      setResult({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card">
      <div className="card-head" style={{ marginBottom: enabled ? 16 : 0 }}>
        <ServiceIcon id={service.id} name={service.name} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: 8 }}>
            <h3>{service.name}</h3>
            <ServiceStatus s={service} enabled={enabled} />
          </div>
          <p className="card-sub">{service.description}</p>
        </div>
        <input
          type="checkbox"
          className="switch"
          checked={enabled}
          aria-label={`Use ${service.name}`}
          onChange={(e) => {
            setEnabled(e.target.checked);
            if (!e.target.checked && service.enabled) {
              // Switching off saves straight away.
              void put<ServiceView>(`/api/services/${service.id}`, { enabled: false }).then(onSaved);
            }
            if (e.target.checked && !url) setUrl(suggested);
          }}
        />
      </div>

      {enabled && (
        <div className="stack">
          <div>
            <label className="label" htmlFor={`${service.id}-url`}>Address</label>
            <input id={`${service.id}-url`} className="input mono" value={url} placeholder={suggested} onChange={(e) => setUrl(e.target.value)} spellCheck={false} autoCapitalize="none" />
            <div className="hint">Usually <code>{suggested}</code> — the usual {service.name} port is {service.defaultPort}.</div>
          </div>
          <div>
            <label className="label" htmlFor={`${service.id}-key`}>API key</label>
            <input
              id={`${service.id}-key`}
              className="input mono"
              type="password"
              autoComplete="off"
              value={apiKey}
              placeholder={service.hasKey ? `Saved (${service.keyPreview}) — leave blank to keep` : 'Paste the API key'}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <div className="hint row" style={{ gap: 6 }}>
              <KeyRound size={13} /> {service.keyHint}
            </div>
          </div>
          {result && <Alert kind={result.ok ? 'ok' : 'error'}>{result.text}</Alert>}
          {!result && service.lastError && <Alert kind="error">Last check: {service.lastError}</Alert>}
          <div className="row row-wrap">
            <button className="btn btn-teal" onClick={() => void test()} disabled={!!busy || !url || (!apiKey && !service.hasKey)}>
              {busy === 'test' ? <Loader2 className="spin" /> : <PlugZap />} Test{autoSave ? ' & save' : ''}
            </button>
            {!autoSave && (
              <button className="btn" onClick={() => void save()} disabled={!!busy || !dirty}>
                {busy === 'save' ? <Loader2 className="spin" /> : <Save />} Save
              </button>
            )}
            {service.version && service.lastOkAt && !service.lastError && (
              <span className="faint small row" style={{ gap: 5 }}>
                <CheckCircle2 size={14} color="var(--teal)" /> v{service.version}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
