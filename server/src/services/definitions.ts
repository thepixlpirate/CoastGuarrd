import { httpJson, joinUrl } from './http.js';

export type ServiceId = 'jellyfin' | 'seerr' | 'radarr' | 'sonarr' | 'lidarr';

export interface ServiceConnection {
  url: string;
  apiKey: string;
}

export interface TestResult {
  name: string;
  version: string;
}

export interface RemoteFolder {
  path: string;
  label?: string;
  freeSpace?: number;
}

export interface ServiceDefinition {
  id: ServiceId;
  name: string;
  description: string;
  defaultPort: number;
  /** Turned on in the setup wizard unless the admin switches it off. */
  enabledByDefault: boolean;
  /** Where to find the API key inside that app. */
  keyHint: string;
  test(conn: ServiceConnection): Promise<TestResult>;
  /** Media folders as the app itself sees them. */
  folders?(conn: ServiceConnection): Promise<RemoteFolder[]>;
}

export function jellyfinHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `MediaBrowser Client="CoastGuarrd", Device="CoastGuarrd", DeviceId="coastguarrd", Version="1", Token="${apiKey}"`,
  };
}

function arr(id: 'radarr' | 'sonarr' | 'lidarr', name: string, port: number, apiVersion: 'v1' | 'v3', description: string): ServiceDefinition {
  return {
    id,
    name,
    description,
    defaultPort: port,
    enabledByDefault: id !== 'lidarr',
    keyHint: `${name} → Settings → General → API Key`,
    async test({ url, apiKey }) {
      const s = await httpJson<{ appName?: string; version?: string; instanceName?: string }>(
        joinUrl(url, `/api/${apiVersion}/system/status`),
        { headers: { 'X-Api-Key': apiKey } },
      );
      if (!s?.version) throw new Error(`Connected, but this does not look like ${name}.`);
      const app = (s.appName ?? '').toLowerCase();
      if (app && app !== id) throw new Error(`That address is ${s.appName}, not ${name}.`);
      return { name: s.instanceName || s.appName || name, version: s.version };
    },
    async folders({ url, apiKey }) {
      const rows = await httpJson<{ path: string; freeSpace?: number }[]>(joinUrl(url, `/api/${apiVersion}/rootfolder`), {
        headers: { 'X-Api-Key': apiKey },
      });
      return (rows ?? []).map((r) => ({ path: r.path, freeSpace: r.freeSpace }));
    },
  };
}

export const services: Record<ServiceId, ServiceDefinition> = {
  jellyfin: {
    id: 'jellyfin',
    name: 'Jellyfin',
    description: 'Watch activity, users, devices and posters.',
    defaultPort: 8096,
    enabledByDefault: true,
    keyHint: 'Jellyfin → Dashboard → API Keys → +',
    async test({ url, apiKey }) {
      const info = await httpJson<{ ServerName?: string; Version?: string }>(joinUrl(url, '/System/Info'), {
        headers: jellyfinHeaders(apiKey),
      });
      if (!info?.Version) throw new Error('Connected, but this does not look like Jellyfin.');
      return { name: info.ServerName || 'Jellyfin', version: info.Version };
    },
    async folders({ url, apiKey }) {
      const rows = await httpJson<{ Name: string; Locations?: string[]; CollectionType?: string }[]>(
        joinUrl(url, '/Library/VirtualFolders'),
        { headers: jellyfinHeaders(apiKey) },
      );
      return (rows ?? []).flatMap((lib) => (lib.Locations ?? []).map((path) => ({ path, label: lib.Name })));
    },
  },
  seerr: {
    id: 'seerr',
    name: 'Seerr',
    description: 'Who requested what, and when.',
    defaultPort: 5055,
    enabledByDefault: true,
    keyHint: 'Seerr → Settings → General → API Key',
    async test({ url, apiKey }) {
      const status = await httpJson<{ version?: string }>(joinUrl(url, '/api/v1/status'));
      // The status page is public, so also check the key against a protected page.
      const main = await httpJson<{ applicationTitle?: string }>(joinUrl(url, '/api/v1/settings/main'), {
        headers: { 'X-Api-Key': apiKey },
      });
      if (!status?.version) throw new Error('Connected, but this does not look like Seerr.');
      return { name: main?.applicationTitle || 'Seerr', version: status.version };
    },
  },
  radarr: arr('radarr', 'Radarr', 7878, 'v3', 'Movies — unmonitor before removal, re-monitor on restore.'),
  sonarr: arr('sonarr', 'Sonarr', 8989, 'v3', 'TV shows — unmonitor before removal, re-monitor on restore.'),
  lidarr: arr('lidarr', 'Lidarr', 8686, 'v1', 'Music — optional, off by default.'),
};

export const serviceOrder: ServiceId[] = ['jellyfin', 'seerr', 'radarr', 'sonarr', 'lidarr'];
