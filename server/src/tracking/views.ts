import { placeLabel } from '../geo/index.js';
import { episodeLabel } from '../jellyfin/client.js';

export interface PlayRow {
  id: number;
  jf_session_id: string | null;
  user_id: string;
  user_name: string;
  item_id: string;
  item_type: string;
  item_name: string;
  series_id: string | null;
  series_name: string | null;
  season_number: number | null;
  episode_number: number | null;
  year: number | null;
  runtime_ms: number | null;
  started_at: number;
  last_seen_at: number;
  stopped_at: number | null;
  position_ms: number;
  watched_ms: number;
  paused_ms: number;
  pause_count: number;
  play_method: string | null;
  transcode_video: number;
  transcode_audio: number;
  transcode_reasons: string | null;
  video_codec: string | null;
  audio_codec: string | null;
  resolution: string | null;
  bitrate: number | null;
  container: string | null;
  client: string | null;
  client_version: string | null;
  device_name: string | null;
  device_id: string | null;
  ip: string | null;
  is_local: number;
  country: string | null;
  country_code: string | null;
  region: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
  source: string;
  completed: number;
}

export function playTitle(r: Pick<PlayRow, 'item_type' | 'item_name' | 'series_name' | 'season_number' | 'episode_number' | 'year'>) {
  if (r.item_type === 'Episode') {
    return { title: r.series_name ?? r.item_name, subtitle: [episodeLabel(r.season_number, r.episode_number), r.series_name ? r.item_name : null].filter(Boolean).join(' — ') };
  }
  if (r.item_type === 'Audio') return { title: r.item_name, subtitle: r.series_name ?? '' };
  return { title: r.item_name, subtitle: r.year ? String(r.year) : '' };
}

export function playView(r: PlayRow) {
  const { title, subtitle } = playTitle(r);
  const percent = r.runtime_ms ? Math.min(100, Math.round((r.position_ms / r.runtime_ms) * 100)) : null;
  return {
    id: r.id,
    userId: r.user_id,
    userName: r.user_name,
    itemId: r.item_id,
    itemType: r.item_type,
    title,
    subtitle,
    seriesId: r.series_id,
    posterId: r.series_id && (r.item_type === 'Episode' || r.item_type === 'Audio') ? r.series_id : r.item_id,
    startedAt: r.started_at,
    stoppedAt: r.stopped_at,
    lastSeenAt: r.last_seen_at,
    watchedMs: r.watched_ms,
    pausedMs: r.paused_ms,
    pauseCount: r.pause_count,
    runtimeMs: r.runtime_ms,
    positionMs: r.position_ms,
    percent,
    completed: !!r.completed,
    playMethod: r.play_method,
    transcodeVideo: !!r.transcode_video,
    transcodeAudio: !!r.transcode_audio,
    transcodeReasons: r.transcode_reasons ? r.transcode_reasons.split(',').filter(Boolean) : [],
    resolution: r.resolution,
    videoCodec: r.video_codec,
    audioCodec: r.audio_codec,
    bitrate: r.bitrate,
    container: r.container,
    client: r.client,
    clientVersion: r.client_version,
    device: r.device_name,
    ip: r.ip,
    isLocal: !!r.is_local,
    place: r.ip ? placeLabel({ city: r.city, region: r.region, country: r.country, isLocal: r.is_local }) : null,
    countryCode: r.country_code,
    lat: r.lat,
    lon: r.lon,
    source: r.source,
  };
}

export const REQUEST_STATUS: Record<number, string> = { 1: 'Pending', 2: 'Approved', 3: 'Declined', 4: 'Failed', 5: 'Completed' };
export const MEDIA_STATUS: Record<number, string> = { 1: 'Unknown', 2: 'Pending', 3: 'Processing', 4: 'Partly available', 5: 'Available', 6: 'Deleted' };
