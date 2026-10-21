import { httpJson, joinUrl, ServiceError } from '../services/http.js';
import { jellyfinHeaders } from '../services/definitions.js';
import { connectionFor } from '../services/store.js';

/** Jellyfin's API types — only the fields CoastGuarrd uses. */
export interface JfItem {
  Id: string;
  Name: string;
  Type: string;
  MediaType?: string;
  SeriesName?: string;
  SeriesId?: string;
  SeasonId?: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  ProductionYear?: number;
  RunTimeTicks?: number;
  Album?: string;
  AlbumArtist?: string;
  Artists?: string[];
  Container?: string;
  ImageTags?: Record<string, string>;
  SeriesPrimaryImageTag?: string;
  AlbumId?: string;
  AlbumPrimaryImageTag?: string;
  MediaStreams?: { Type: string; Codec?: string; Width?: number; Height?: number; BitRate?: number; DisplayTitle?: string }[];
  UserData?: { PlayCount?: number; LastPlayedDate?: string; Played?: boolean; PlaybackPositionTicks?: number };
}

export interface JfSession {
  Id: string;
  UserId?: string;
  UserName?: string;
  Client?: string;
  ApplicationVersion?: string;
  DeviceName?: string;
  DeviceId?: string;
  RemoteEndPoint?: string;
  LastActivityDate?: string;
  IsActive?: boolean;
  SupportsRemoteControl?: boolean;
  NowPlayingItem?: JfItem;
  PlayState?: { PositionTicks?: number; IsPaused?: boolean; PlayMethod?: string; MediaSourceId?: string };
  TranscodingInfo?: {
    VideoCodec?: string;
    AudioCodec?: string;
    Container?: string;
    IsVideoDirect?: boolean;
    IsAudioDirect?: boolean;
    Bitrate?: number;
    Width?: number;
    Height?: number;
    TranscodeReasons?: string[] | string;
    HardwareAccelerationType?: string;
    CompletionPercentage?: number;
  };
}

export interface JfUser {
  Id: string;
  Name: string;
  PrimaryImageTag?: string;
  LastLoginDate?: string;
  LastActivityDate?: string;
  Policy?: { IsAdministrator?: boolean; IsDisabled?: boolean };
}

export interface JfActivity {
  Id: number;
  Name: string;
  ShortOverview?: string;
  Overview?: string;
  Type: string;
  ItemId?: string;
  Date: string;
  UserId?: string;
  Severity?: string;
}

export interface JfDevice {
  Id: string;
  Name?: string;
  AppName?: string;
  AppVersion?: string;
  LastUserName?: string;
  LastUserId?: string;
  DateLastActivity?: string;
}

export const TICKS_PER_MS = 10_000;

function conn() {
  const c = connectionFor('jellyfin');
  if (!c) throw new ServiceError('Jellyfin is not connected.');
  return c;
}

export function jellyfinReady(): boolean {
  return !!connectionFor('jellyfin');
}

export async function jf<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const c = conn();
  return httpJson<T>(joinUrl(c.url, path), {
    ...init,
    headers: { ...jellyfinHeaders(c.apiKey), ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) },
  });
}

/** Raw request for images — returns the response so it can be streamed. */
export async function jfRaw(path: string): Promise<Response> {
  const c = conn();
  return fetch(joinUrl(c.url, path), { headers: jellyfinHeaders(c.apiKey), signal: AbortSignal.timeout(15_000) });
}

export const jfApi = {
  sessions: () => jf<JfSession[]>('/Sessions?activeWithinSeconds=960'),
  users: () => jf<JfUser[]>('/Users'),
  devices: () => jf<{ Items: JfDevice[] }>('/Devices'),
  activity: (minDate: string, startIndex = 0, limit = 200) =>
    jf<{ Items: JfActivity[]; TotalRecordCount: number }>(
      `/System/ActivityLog/Entries?startIndex=${startIndex}&limit=${limit}&minDate=${encodeURIComponent(minDate)}`,
    ),
  stop: (sessionId: string) => jf<void>(`/Sessions/${encodeURIComponent(sessionId)}/Playing/Stop`, { method: 'POST' }),
  message: (sessionId: string, header: string, text: string, timeoutMs = 15_000) =>
    jf<void>(`/Sessions/${encodeURIComponent(sessionId)}/Message`, {
      method: 'POST',
      body: JSON.stringify({ Header: header, Text: text, TimeoutMs: timeoutMs }),
    }),
  /** Items a user has played, with their last-played dates. */
  async playedItems(userId: string, startIndex: number, limit: number) {
    const q = `Recursive=true&IncludeItemTypes=Movie,Episode,Audio&Filters=IsPlayed&Fields=UserData,RunTimeTicks,ProductionYear&EnableImages=false&StartIndex=${startIndex}&Limit=${limit}`;
    try {
      return await jf<{ Items: JfItem[]; TotalRecordCount: number }>(`/Items?userId=${userId}&${q}`);
    } catch (err) {
      if ((err as ServiceError).status === 404 || (err as ServiceError).status === 400) {
        return jf<{ Items: JfItem[]; TotalRecordCount: number }>(`/Users/${userId}/Items?${q}`);
      }
      throw err;
    }
  },
  /** Playback Reporting plugin (optional). Returns null if the plugin isn't installed. */
  async playbackReporting(sql: string): Promise<{ colums?: string[]; columns?: string[]; results: unknown[][] } | null> {
    try {
      return await jf('/user_usage_stats/submit_custom_query', {
        method: 'POST',
        body: JSON.stringify({ CustomQueryString: sql, ReplaceUserId: false }),
        timeoutMs: 120_000,
      });
    } catch (err) {
      const status = (err as ServiceError).status;
      if (status === 404 || status === 400 || status === 405) return null;
      throw err;
    }
  },
};

/** "S1 · E4" style label for episodes. */
export function episodeLabel(season?: number | null, episode?: number | null): string {
  if (season == null && episode == null) return '';
  return `S${season ?? '?'} · E${episode ?? '?'}`;
}
