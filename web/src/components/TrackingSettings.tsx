import { useEffect, useState } from 'react';
import { Database, Download, Globe2, History, Loader2, Save } from 'lucide-react';
import { get, post, put } from '../api';
import { usePoll } from '../lib/usePoll';
import { timeAgo } from '../lib/format';
import type { GeoStatus, ImportStatus, TrackingSettings as TS } from '../types';
import { Alert } from './Fields';

type RuleKey = keyof TS['rules'];

const RULE_HELP: Record<RuleKey, string> = {
  impossibleTravel: 'Someone shows up somewhere too far away to have travelled there in time — usually a shared account.',
  simultaneousLocations: 'The same account is streaming from two different places at once (including home + away).',
  concurrentStreams: 'More things playing at once than allowed. You can set a different limit per person on their page.',
  ipVelocity: 'An account uses lots of different internet addresses in a short time.',
  newDevice: 'An account signs in from a device it has never used before.',
  newCountry: 'An account connects from a country it has never connected from before.',
  failedSignIns: 'Repeated wrong passwords on Jellyfin from the same address — someone may be guessing.',
};

function NumberField({ label, value, onChange, suffix, min = 0 }: { label: string; value: number; onChange: (v: number) => void; suffix?: string; min?: number }) {
  return (
    <label className="row small" style={{ gap: 8 }}>
      <span className="muted">{label}</span>
      <input className="input" type="number" inputMode="numeric" min={min} style={{ width: 90, height: 34 }} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {suffix && <span className="faint">{suffix}</span>}
    </label>
  );
}

export default function TrackingSettings() {
  const [s, setS] = useState<TS | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [geoBusy, setGeoBusy] = useState(false);
  const { data: status, reload } = usePoll<{ geo: GeoStatus; import: ImportStatus; counts: { plays: number; users: number; signIns: number; requests: number } }>('/api/tracking/status', 4000);

  useEffect(() => {
    get<TS>('/api/settings/tracking').then(setS).catch(() => undefined);
  }, []);

  if (!s) return <Loader2 className="spin" />;

  const rule = <K extends RuleKey>(k: K, patch: Partial<TS['rules'][K]>) => setS({ ...s, rules: { ...s.rules, [k]: { ...s.rules[k], ...patch } } });

  const save = async () => {
    setBusy(true);
    try {
      const { ruleLabels: _ignored, ...body } = s;
      setS(await put<TS>('/api/settings/tracking', body));
      setMsg({ ok: true, text: 'Saved.' });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 3000);
    }
  };

  /** Location switches save straight away. */
  const saveNow = async (patch: Partial<TS>) => {
    setS({ ...s, ...patch });
    try {
      const next = await put<TS>('/api/settings/tracking', patch);
      setS((cur) => (cur ? { ...cur, geoEnabled: next.geoEnabled, geoAutoUpdate: next.geoAutoUpdate } : next));
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  };

  const updateGeo = async () => {
    setGeoBusy(true);
    try {
      await post('/api/geo/update');
      setMsg({ ok: true, text: 'Location database updated.' });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setGeoBusy(false);
      void reload();
    }
  };

  const geo = status?.geo;
  const imp = status?.import;

  return (
    <div className="stack" style={{ gap: 16, maxWidth: 900 }}>
      <div className="card">
        <h3 style={{ marginBottom: 6 }}>Alert rules</h3>
        <p className="card-sub" style={{ marginTop: 0, marginBottom: 6 }}>Pick what CoastGuarrd should watch for and how serious each one is.</p>
        <div className="list">
          {(Object.keys(RULE_HELP) as RuleKey[]).map((k) => {
            const r = s.rules[k] as TS['rules'][RuleKey] & Record<string, number>;
            return (
              <div key={k} className="list-item" style={{ alignItems: 'flex-start', gap: 14, padding: '14px 0' }}>
                <input type="checkbox" className="switch" checked={r.enabled} onChange={(e) => rule(k, { enabled: e.target.checked } as never)} aria-label={s.ruleLabels[k]} style={{ marginTop: 2 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{s.ruleLabels[k]}</div>
                  <div className="hint" style={{ marginTop: 2 }}>{RULE_HELP[k]}</div>
                  {r.enabled && (
                    <div className="row row-wrap" style={{ gap: 14, marginTop: 10 }}>
                      {k === 'impossibleTravel' && <NumberField label="Faster than" value={r.kmh} onChange={(v) => rule(k, { kmh: v })} suffix="km/h" min={100} />}
                      {k === 'simultaneousLocations' && <NumberField label="At least" value={r.km} onChange={(v) => rule(k, { km: v })} suffix="km apart" min={1} />}
                      {k === 'concurrentStreams' && <NumberField label="More than" value={r.max} onChange={(v) => rule(k, { max: v })} suffix="at once" min={1} />}
                      {k === 'ipVelocity' && (
                        <>
                          <NumberField label="" value={r.count} onChange={(v) => rule(k, { count: v })} suffix="addresses" min={2} />
                          <NumberField label="within" value={r.hours} onChange={(v) => rule(k, { hours: v })} suffix="hours" min={1} />
                        </>
                      )}
                      {k === 'failedSignIns' && (
                        <>
                          <NumberField label="" value={r.count} onChange={(v) => rule(k, { count: v })} suffix="failures" min={2} />
                          <NumberField label="within" value={r.minutes} onChange={(v) => rule(k, { minutes: v })} suffix="minutes" min={1} />
                        </>
                      )}
                      <label className="row small" style={{ gap: 8 }}>
                        <span className="muted">Severity</span>
                        <select className="select" style={{ width: 130, height: 34 }} value={r.severity} onChange={(e) => rule(k, { severity: e.target.value as 'info' })}>
                          <option value="info">Info</option>
                          <option value="warning">Warning</option>
                          <option value="critical">Critical</option>
                        </select>
                      </label>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 12 }}>Tracking</h3>
        <div className="stack">
          <NumberField label="Check Jellyfin every" value={s.pollSeconds} onChange={(v) => setS({ ...s, pollSeconds: v })} suffix="seconds (3–120)" min={3} />
          <NumberField label="Ignore plays shorter than" value={s.minPlaySeconds} onChange={(v) => setS({ ...s, minPlaySeconds: v })} suffix="seconds (0 keeps everything)" />
        </div>
      </div>

      <div className="row">
        <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? <Loader2 className="spin" /> : <Save />} Save rules & tracking
        </button>
        {msg && <span className={msg.ok ? 'muted small' : 'small'} style={{ color: msg.ok ? undefined : 'var(--red)' }}>{msg.text}</span>}
      </div>

      <div className="card">
        <div className="card-head">
          <div className="svc-icon" style={{ background: 'var(--teal-soft)', color: 'var(--teal-strong)' }}><Globe2 size={20} /></div>
          <div style={{ flex: 1 }}>
            <h3>Location lookups</h3>
            <p className="card-sub">Turns internet addresses into cities for the map and alerts. Everything is looked up on your server — no addresses are sent anywhere.</p>
          </div>
        </div>
        <div className="stack">
          <label className="row" style={{ gap: 12, cursor: 'pointer' }}>
            <input type="checkbox" className="switch" checked={s.geoEnabled} onChange={(e) => void saveNow({ geoEnabled: e.target.checked })} />
            <span>Look up locations</span>
          </label>
          <label className="row" style={{ gap: 12, cursor: 'pointer' }}>
            <input type="checkbox" className="switch" checked={s.geoAutoUpdate} onChange={(e) => void saveNow({ geoAutoUpdate: e.target.checked })} />
            <span>Download the free location database and refresh it monthly</span>
          </label>
          {geo && (
            <div className="small muted">
              {geo.ready
                ? geo.source === 'maxmind'
                  ? 'Using your MaxMind GeoLite2 database.'
                  : `Using DB-IP City Lite (${geo.month}) · downloaded ${timeAgo(geo.downloadedAt)}.`
                : geo.downloading
                  ? 'Downloading the location database…'
                  : 'No location database yet.'}
              {geo.error && <div style={{ color: 'var(--amber)', marginTop: 4 }}>{geo.error}</div>}
              <div className="faint" style={{ marginTop: 4 }}>
                Prefer MaxMind? Put <code>GeoLite2-City.mmdb</code> in <code>{geo.customPath.replace(/\/[^/]+$/, '')}</code> and restart.
              </div>
            </div>
          )}
          <div>
            <button className="btn btn-sm" disabled={geoBusy || geo?.downloading} onClick={() => void updateGeo()}>
              {geoBusy || geo?.downloading ? <Loader2 className="spin" /> : <Download />} Update now
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="svc-icon" style={{ background: 'var(--purple-soft)', color: 'var(--purple-strong)' }}><History size={20} /></div>
          <div style={{ flex: 1 }}>
            <h3>Bring in older history</h3>
            <p className="card-sub">
              CoastGuarrd records everything from now on. To fill in the past, it can import from Jellyfin. If the <b>Playback Reporting</b> plugin is installed you get every past play; otherwise just each person’s watched items and when they last watched them.
            </p>
          </div>
        </div>
        {imp?.message && <div style={{ marginBottom: 12 }}><Alert kind={imp.running ? 'info' : imp.message.startsWith('Import stopped') ? 'error' : 'ok'}>{imp.message}{imp.running ? ` (${imp.imported.toLocaleString()} so far)` : ''}</Alert></div>}
        <button className="btn btn-teal" disabled={imp?.running} onClick={() => void post('/api/tracking/import').then(() => reload()).catch((e) => setMsg({ ok: false, text: (e as Error).message }))}>
          {imp?.running ? <Loader2 className="spin" /> : <Database />} {imp?.finishedAt ? 'Import again' : 'Import history'}
        </button>
        <div className="hint">Safe to run more than once — nothing is imported twice.</div>
      </div>

      {status && (
        <div className="small faint">
          {status.counts.plays.toLocaleString()} plays · {status.counts.users} people · {status.counts.signIns.toLocaleString()} sign-ins · {status.counts.requests.toLocaleString()} requests stored
        </div>
      )}
    </div>
  );
}
