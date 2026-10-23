import { getDb } from '../db/index.js';
import { jellyfinReady, jfApi, TICKS_PER_MS, type JfSession } from '../jellyfin/client.js';
import { getSetting } from '../lib/settings.js';
import { endpointIp, recordDevice, recordIp, deviceCount } from './presence.js';
import { onNewDevice, onNewIp, onPlayStart } from './rules.js';
import { mergeSameDayPlays } from './import.js';
import type { GeoResult } from '../geo/index.js';

/**
 * Asks Jellyfin what's playing every few seconds and turns that into plays:
 * when each one started and stopped, how long was actually watched, paused
 * time, quality, device, and where it was watched from.
 */

export interface LiveStream {
  key: string;
  playId: number;
  sessionId: string;
  userId: string;
  userName: string;
  startedAt: number;
  ip: string;
  geo: GeoResult;
  session: JfSession;
  lastPoll: number;
  paused: boolean;
}

const live = new Map<string, LiveStream>();
let timer: NodeJS.Timeout | null = null;
let lastOkAt: number | null = null;
let lastError: string | null = null;
let failingSince: number | null = null;
let log: { info: (m: string) => void; warn: (m: string) => void; error: (m: unknown) => void } = console;

export function liveStreams(): LiveStream[] {
  return [...live.values()].sort((a, b) => a.startedAt - b.startedAt);
}

export function pollerStatus() {
  return { running: !!timer, lastOkAt, lastError, active: live.size, pollSeconds: getSetting('tracking').pollSeconds };
}

function playFields(s: JfSession) {
  const item = s.NowPlayingItem!;
  const tc = s.TranscodingInfo;
  const video = item.MediaStreams?.find((m) => m.Type === 'Video');
  const audio = item.MediaStreams?.find((m) => m.Type === 'Audio');
  const height = tc?.Height ?? video?.Height;
  const reasons = Array.isArray(tc?.TranscodeReasons) ? tc!.TranscodeReasons.join(',') : (tc?.TranscodeReasons as string | undefined) ?? null;
  const method = s.PlayState?.PlayMethod ?? (tc ? 'Transcode' : 'DirectPlay');
  return {
    play_method: method,
    transcode_video: method === 'Transcode' && tc && tc.IsVideoDirect === false ? 1 : 0,
    transcode_audio: method === 'Transcode' && tc && tc.IsAudioDirect === false ? 1 : 0,
    transcode_reasons: reasons,
    video_codec: (tc && tc.IsVideoDirect === false ? tc.VideoCodec : video?.Codec) ?? null,
    audio_codec: (tc && tc.IsAudioDirect === false ? tc.AudioCodec : audio?.Codec) ?? null,
    resolution: height ? (height >= 2000 ? '4K' : height >= 1000 ? '1080p' : height >= 700 ? '720p' : `${height}p`) : null,
    bitrate: tc?.Bitrate ?? video?.BitRate ?? null,
    container: tc?.Container ?? item.Container ?? null,
  };
}

function itemFields(s: JfSession) {
  const i = s.NowPlayingItem!;
  return {
    item_id: i.Id,
    item_type: i.Type,
    item_name: i.Name,
    series_id: i.SeriesId ?? i.AlbumId ?? null,
    series_name: i.SeriesName ?? i.Album ?? null,
    season_number: i.ParentIndexNumber ?? null,
    episode_number: i.IndexNumber ?? null,
    year: i.ProductionYear ?? null,
    runtime_ms: i.RunTimeTicks ? Math.round(i.RunTimeTicks / TICKS_PER_MS) : null,
  };
}

function startPlay(s: JfSession, key: string, now: number): LiveStream {
  const db = getDb();
  const ip = endpointIp(s.RemoteEndPoint);
  const userId = s.UserId!;
  const userName = s.UserName ?? 'Unknown';

  // After a restart, pick up a play that was still running instead of starting a new one.
  const resumable = db
    .prepare(`SELECT id, started_at FROM plays WHERE session_key = ? AND stopped_at IS NULL AND last_seen_at > ? ORDER BY id DESC LIMIT 1`)
    .get(key, now - 5 * 60_000) as { id: number; started_at: number } | undefined;

  const hadDevices = deviceCount(userId) > 0;
  const newDevice = recordDevice(userId, { id: s.DeviceId, name: s.DeviceName, client: s.Client, version: s.ApplicationVersion, ip }, now);
  const ipRec = recordIp(userId, ip, now);
  const geo = ipRec.geo;
  const position = Math.round((s.PlayState?.PositionTicks ?? 0) / TICKS_PER_MS);

  let playId: number;
  if (resumable) {
    playId = resumable.id;
  } else {
    const f = { ...itemFields(s), ...playFields(s) };
    playId = db
      .prepare(
        `INSERT INTO plays (session_key, jf_session_id, user_id, user_name, item_id, item_type, item_name, series_id, series_name,
           season_number, episode_number, year, runtime_ms, started_at, last_seen_at, position_ms,
           play_method, transcode_video, transcode_audio, transcode_reasons, video_codec, audio_codec, resolution, bitrate, container,
           client, client_version, device_name, device_id, ip, is_local, country, country_code, region, city, lat, lon, artist_name, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live')`,
      )
      .run(
        key, s.Id, userId, userName, f.item_id, f.item_type, f.item_name, f.series_id, f.series_name,
        f.season_number, f.episode_number, f.year, f.runtime_ms, now, now, position,
        f.play_method, f.transcode_video, f.transcode_audio, f.transcode_reasons, f.video_codec, f.audio_codec, f.resolution, f.bitrate, f.container,
        s.Client ?? null, s.ApplicationVersion ?? null, s.DeviceName ?? null, s.DeviceId ?? null, ip || null, geo.isLocal ? 1 : 0,
        geo.country, geo.countryCode, geo.region, geo.city, geo.lat, geo.lon,
        s.NowPlayingItem!.AlbumArtist ?? s.NowPlayingItem!.Artists?.[0] ?? null,
      ).lastInsertRowid as number;
  }

  const stream: LiveStream = {
    key,
    playId,
    sessionId: s.Id,
    userId,
    userName,
    startedAt: resumable?.started_at ?? now,
    ip,
    geo,
    session: s,
    lastPoll: now,
    paused: !!s.PlayState?.IsPaused,
  };

  if (!resumable) {
    const ctx = { userId, userName, at: now, ip, geo, playId };
    try {
      onPlayStart(ctx);
      if (ipRec.isNew) onNewIp(ctx);
      if (newDevice) onNewDevice({ ...ctx, deviceName: s.DeviceName, client: s.Client }, hadDevices);
    } catch (err) {
      log.error(err);
    }
  }
  return stream;
}

function updatePlay(st: LiveStream, s: JfSession, now: number) {
  const dt = Math.min(now - st.lastPoll, getSetting('tracking').pollSeconds * 3000);
  const paused = !!s.PlayState?.IsPaused;
  const f = playFields(s);
  const position = Math.round((s.PlayState?.PositionTicks ?? 0) / TICKS_PER_MS);
  getDb()
    .prepare(
      `UPDATE plays SET last_seen_at = ?, position_ms = ?,
         watched_ms = watched_ms + ?, paused_ms = paused_ms + ?, pause_count = pause_count + ?,
         play_method = ?, transcode_video = MAX(transcode_video, ?), transcode_audio = MAX(transcode_audio, ?),
         transcode_reasons = COALESCE(?, transcode_reasons), video_codec = COALESCE(?, video_codec), audio_codec = COALESCE(?, audio_codec),
         resolution = COALESCE(?, resolution), bitrate = COALESCE(?, bitrate), container = COALESCE(?, container)
       WHERE id = ?`,
    )
    .run(
      now, position,
      st.paused ? 0 : dt, st.paused ? dt : 0, paused && !st.paused ? 1 : 0,
      f.play_method, f.transcode_video, f.transcode_audio, f.transcode_reasons, f.video_codec, f.audio_codec, f.resolution, f.bitrate, f.container,
      st.playId,
    );
  st.paused = paused;
  st.lastPoll = now;
  st.session = s;
}

function closePlay(st: LiveStream) {
  const db = getDb();
  const minMs = getSetting('tracking').minPlaySeconds * 1000;
  const row = db.prepare('SELECT watched_ms, position_ms, runtime_ms, last_seen_at FROM plays WHERE id = ?').get(st.playId) as
    | { watched_ms: number; position_ms: number; runtime_ms: number | null; last_seen_at: number }
    | undefined;
  if (!row) return;
  if (minMs > 0 && row.watched_ms < minMs) {
    db.prepare('DELETE FROM plays WHERE id = ?').run(st.playId);
    return;
  }
  const completed = row.runtime_ms ? (row.position_ms >= row.runtime_ms * 0.9 ? 1 : 0) : 0;
  db.prepare('UPDATE plays SET stopped_at = ?, completed = ? WHERE id = ?').run(row.last_seen_at, completed, st.playId);
  // Pausing and resuming shouldn't leave several entries: fold today's plays of this title into one.
  mergeSameDayPlays({ userId: st.userId, itemId: st.session.NowPlayingItem?.Id ?? '' });
}

/** Closes plays left open from before a restart that never came back. */
function closeOrphans(now: number) {
  getDb()
    .prepare(
      `UPDATE plays SET stopped_at = last_seen_at,
         completed = CASE WHEN runtime_ms > 0 AND position_ms >= runtime_ms * 0.9 THEN 1 ELSE 0 END
       WHERE stopped_at IS NULL AND source = 'live' AND last_seen_at < ?`,
    )
    .run(now - 5 * 60_000);
}

async function tick() {
  if (!jellyfinReady()) {
    lastError = 'Jellyfin is not connected.';
    return;
  }
  const now = Date.now();
  let sessions: JfSession[];
  try {
    sessions = await jfApi.sessions();
    lastOkAt = now;
    lastError = null;
    failingSince = null;
  } catch (err) {
    lastError = (err as Error).message;
    failingSince ??= now;
    // If Jellyfin has been unreachable for 5 minutes, end everything that was playing.
    if (now - failingSince > 5 * 60_000 && live.size) {
      for (const st of live.values()) closePlay(st);
      live.clear();
    }
    return;
  }

  const seen = new Set<string>();
  const db = getDb();
  const tx = db.transaction(() => {
    for (const s of sessions) {
      if (!s.UserId) continue;
      const item = s.NowPlayingItem;
      if (!item || item.Type === 'TvChannel' && !item.Name) continue;
      const key = `${s.Id}:${item.Id}`;
      seen.add(key);
      const existing = live.get(key);
      if (existing) updatePlay(existing, s, now);
      else live.set(key, startPlay(s, key, now));
    }
    for (const [key, st] of live) {
      if (seen.has(key)) continue;
      closePlay(st);
      live.delete(key);
    }
    // Keep device/address history current even when nothing is playing.
    // (Done after plays so brand-new devices/addresses still trigger their alerts.)
    for (const s of sessions) {
      if (!s.UserId || !s.LastActivityDate) continue;
      const ip = endpointIp(s.RemoteEndPoint);
      const at = Date.parse(s.LastActivityDate) || now;
      if (now - at >= 120_000) continue;
      recordDevice(s.UserId, { id: s.DeviceId, name: s.DeviceName, client: s.Client, version: s.ApplicationVersion, ip }, now);
      if (ip) recordIp(s.UserId, ip, now);
      db.prepare('UPDATE media_users SET last_activity_at = MAX(COALESCE(last_activity_at, 0), ?) WHERE id = ?').run(at, s.UserId);
    }
  });
  try {
    tx();
  } catch (err) {
    log.error(err);
  }
}

export function startPoller(logger: typeof log) {
  log = logger;
  closeOrphans(Date.now());
  try {
    mergeSameDayPlays();
  } catch (err) {
    log.error(err);
  }
  const schedule = () => {
    const secs = Math.max(3, Math.min(120, getSetting('tracking').pollSeconds));
    timer = setTimeout(async () => {
      try {
        await tick();
      } catch (err) {
        log.error(err);
      }
      schedule();
    }, secs * 1000);
    timer.unref();
  };
  void tick().finally(schedule);
}

/** Immediately re-check (used after stopping a stream). */
export async function pollNow() {
  await tick();
}
