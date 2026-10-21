import { getDb } from '../db/index.js';
import { services, serviceOrder, type ServiceConnection, type ServiceId } from './definitions.js';

export interface StoredService {
  id: ServiceId;
  enabled: boolean;
  url: string;
  apiKey: string;
  lastOkAt: number | null;
  lastError: string | null;
  version: string | null;
}

interface Row {
  id: string;
  enabled: number;
  url: string;
  api_key: string;
  last_ok_at: number | null;
  last_error: string | null;
  version: string | null;
}

export function isServiceId(id: string): id is ServiceId {
  return id in services;
}

export function getService(id: ServiceId): StoredService {
  const row = getDb().prepare('SELECT * FROM services WHERE id = ?').get(id) as Row | undefined;
  return {
    id,
    enabled: row ? !!row.enabled : false,
    url: row?.url ?? '',
    apiKey: row?.api_key ?? '',
    lastOkAt: row?.last_ok_at ?? null,
    lastError: row?.last_error ?? null,
    version: row?.version ?? null,
  };
}

export function listServices(): StoredService[] {
  return serviceOrder.map(getService);
}

export function saveService(id: ServiceId, patch: { enabled?: boolean; url?: string; apiKey?: string }) {
  const cur = getService(id);
  const next = {
    enabled: patch.enabled ?? cur.enabled,
    url: patch.url ?? cur.url,
    apiKey: patch.apiKey ?? cur.apiKey,
  };
  const changedConn = next.url !== cur.url || next.apiKey !== cur.apiKey;
  getDb()
    .prepare(
      `INSERT INTO services (id, enabled, url, api_key, last_ok_at, last_error, version) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, url = excluded.url, api_key = excluded.api_key,
         last_ok_at = excluded.last_ok_at, last_error = excluded.last_error, version = excluded.version`,
    )
    .run(
      id,
      next.enabled ? 1 : 0,
      next.url,
      next.apiKey,
      changedConn ? null : cur.lastOkAt,
      changedConn ? null : cur.lastError,
      changedConn ? null : cur.version,
    );
}

export function recordServiceHealth(id: ServiceId, ok: boolean, info: { version?: string; error?: string }) {
  getDb()
    .prepare(
      ok
        ? 'UPDATE services SET last_ok_at = ?, last_error = NULL, version = ? WHERE id = ?'
        : 'UPDATE services SET last_error = ?, version = COALESCE(version, ?) WHERE id = ?',
    )
    .run(ok ? Date.now() : info.error ?? 'Unknown error', info.version ?? null, id);
}

/** Connection details for an enabled, configured service — or null. */
export function connectionFor(id: ServiceId): ServiceConnection | null {
  const s = getService(id);
  if (!s.enabled || !s.url || !s.apiKey) return null;
  return { url: s.url, apiKey: s.apiKey };
}
