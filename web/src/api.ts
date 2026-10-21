export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** Fired when the server says the session has ended. */
export const SESSION_EXPIRED = 'cg:session-expired';

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(method !== 'GET' ? { 'X-CoastGuarrd': '1' } : {}),
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let data: Record<string, unknown> = {};
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      /* not JSON */
    }
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new Event(SESSION_EXPIRED));
    throw new ApiError((data.error as string) || `Request failed (${res.status})`, res.status, data);
  }
  return data as T;
}

export const get = <T,>(path: string) => api<T>(path);
export const post = <T,>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body });
export const put = <T,>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body });
export const del = <T,>(path: string) => api<T>(path, { method: 'DELETE' });

// ---- Shared types --------------------------------------------------------

export interface AuthStatus {
  needsAccount: boolean;
  setupComplete: boolean;
  user: { username: string; role: string; totpEnabled: boolean } | null;
}

export type ServiceId = 'jellyfin' | 'seerr' | 'radarr' | 'sonarr' | 'lidarr';

export interface ServiceView {
  id: ServiceId;
  name: string;
  description: string;
  defaultPort: number;
  enabledByDefault: boolean;
  keyHint: string;
  hasFolders: boolean;
  enabled: boolean;
  url: string;
  hasKey: boolean;
  keyPreview: string;
  lastOkAt: number | null;
  lastError: string | null;
  version: string | null;
}

export interface PathCheck {
  localExists: boolean;
  recycleExists: boolean;
  recycleWritable: boolean;
  sameDrive: boolean | null;
  recycleInsideLibrary: boolean;
  message: string;
}

export interface LibraryFolder {
  id: number;
  service: ServiceId;
  serviceName: string;
  remotePath: string;
  localPath: string;
  recyclePath: string;
  check: PathCheck;
}

export interface GeneralSettings {
  previewMode: boolean;
  setupComplete: boolean;
  downloadsPath: string;
  mediaRoot: string;
  version: string;
}

export interface SecuritySettings {
  maxFailures: number;
  windowMinutes: number;
  lockoutMinutes: number;
  sessionHours: number;
  rememberDays: number;
  trustProxyHeaders: boolean;
}
