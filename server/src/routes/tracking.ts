import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { jellyfinReady, jfApi, jfRaw } from '../jellyfin/client.js';
import { geoStatus, placeLabel, updateGeoDatabase } from '../geo/index.js';
import { audit } from '../lib/audit.js';
import { clientIp } from '../lib/ip.js';
import { getSetting, setSetting } from '../lib/settings.js';
import { liveStreams, pollerStatus, pollNow } from '../tracking/poller.js';
import { syncStatus } from '../tracking/sync.js';
import { importStatus, startImport } from '../tracking/import.js';
import { RULE_LABELS, trustScores, type RuleId } from '../tracking/rules.js';
import { MEDIA_STATUS, REQUEST_STATUS, playView, type PlayRow } from '../tracking/views.js';

const DAY = 86_400_000;

function rows<T>(sql: string, ...params: unknown[]): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}
function row<T>(sql: string, ...params: unknown[]): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined;
}

/** Local calendar day for a timestamp, using the server's time zone (TZ). */
const LOCAL_DAY = `strftime('%Y-%m-%d', started_at / 1000, 'unixepoch', 'localtime')`;

async function proxyImage(reply: FastifyReply, path: string) {
  if (!jellyfinReady()) return reply.code(404).send();
  try {
    const res = await jfRaw(path);
    if (!res.ok || !res.body) return reply.code(res.status === 404 ? 404 : 502).send();
    reply.header('Content-Type', res.headers.get('content-type') ?? 'image/jpeg');
    reply.header('Cache-Control', 'private, max-age=86400');
    return reply.send(Buffer.from(await res.arrayBuffer()));
  } catch {
    return reply.code(502).send();
  }
}

function requestView(r: {
  id: number; type: string; status: number; media_status: number | null; tmdb_id: number | null; jellyfin_media_id: string | null;
  requested_by_name: string | null; requested_by_jf: string | null; is4k: number; seasons: string | null; created_at: number;
  title: string | null; year: number | null; poster: string | null;
  req_plays: number; req_last: number | null; req_done: number; other_users: number; total_plays: number;
}) {
  return {
    id: r.id,
    type: r.type,
    status: REQUEST_STATUS[r.status] ?? 'Unknown',
    mediaStatus: r.media_status ? MEDIA_STATUS[r.media_status] ?? 'Unknown' : 'Unknown',
    available: r.media_status === 4 || r.media_status === 5,
    title: r.title ?? `${r.type === 'tv' ? 'Show' : 'Movie'} #${r.tmdb_id}`,
    year: r.year,
    poster: r.poster,
    tmdbId: r.tmdb_id,
    jellyfinId: r.jellyfin_media_id,
    requestedBy: { id: r.requested_by_jf, name: r.requested_by_name ?? 'Unknown' },
    is4k: !!r.is4k,
    seasons: r.seasons ? (JSON.parse(r.seasons) as number[]) : [],
    createdAt: r.created_at,
    requester: { plays: r.req_plays, lastAt: r.req_last, completed: !!r.req_done },
    otherViewers: r.other_users,
    totalPlays: r.total_plays,
  };
}

/** Request list query with "did the requester watch it" columns. */
const REQUEST_SQL = `
  SELECT r.*, m.title, m.year, m.poster,
    (SELECT COUNT(*) FROM plays p WHERE p.user_id = r.requested_by_jf AND (p.item_id = r.jellyfin_media_id OR p.series_id = r.jellyfin_media_id OR (p.series_name = m.title AND r.type = 'tv'))) AS req_plays,
    (SELECT MAX(p.started_at) FROM plays p WHERE p.user_id = r.requested_by_jf AND (p.item_id = r.jellyfin_media_id OR p.series_id = r.jellyfin_media_id OR (p.series_name = m.title AND r.type = 'tv'))) AS req_last,
    (SELECT MAX(p.completed) FROM plays p WHERE p.user_id = r.requested_by_jf AND (p.item_id = r.jellyfin_media_id OR p.series_id = r.jellyfin_media_id)) AS req_done,
    (SELECT COUNT(DISTINCT p.user_id) FROM plays p WHERE p.user_id != COALESCE(r.requested_by_jf, '') AND (p.item_id = r.jellyfin_media_id OR p.series_id = r.jellyfin_media_id)) AS other_users,
    (SELECT COUNT(*) FROM plays p WHERE p.item_id = r.jellyfin_media_id OR p.series_id = r.jellyfin_media_id) AS total_plays
  FROM requests r LEFT JOIN seerr_media m ON m.key = r.type || ':' || r.tmdb_id`;

function alertView(a: {
  id: number; at: number; user_id: string | null; user_name: string | null; rule: string; severity: string; title: string;
  detail: string | null; play_id: number | null; acknowledged_at: number | null; dismissed: number;
}) {
  return {
    id: a.id,
    at: a.at,
    userId: a.user_id,
    userName: a.user_name,
    rule: a.rule,
    ruleLabel: RULE_LABELS[a.rule as RuleId] ?? a.rule,
    severity: a.severity,
    title: a.title,
    detail: a.detail ? (JSON.parse(a.detail) as Record<string, unknown>) : {},
    playId: a.play_id,
    acknowledgedAt: a.acknowledged_at,
    dismissed: !!a.dismissed,
  };
}

function statsFor(where: string, params: unknown[], since: number) {
  const w = `WHERE ${where} AND started_at >= ?`;
  const p = [...params, since];
  const hourOfDay = Array(24).fill(0) as number[];
  for (const r of rows<{ h: string; ms: number }>(`SELECT strftime('%H', started_at / 1000, 'unixepoch', 'localtime') AS h, SUM(watched_ms) AS ms FROM plays ${w} GROUP BY h`, ...p)) {
    hourOfDay[Number(r.h)] = r.ms / 3_600_000;
  }
  const week = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  for (const r of rows<{ d: string; h: string; ms: number }>(
    `SELECT strftime('%w', started_at / 1000, 'unixepoch', 'localtime') AS d, strftime('%H', started_at / 1000, 'unixepoch', 'localtime') AS h, SUM(watched_ms) AS ms FROM plays ${w} GROUP BY d, h`,
    ...p,
  )) {
    week[Number(r.d)][Number(r.h)] = r.ms / 3_600_000;
  }
  const platforms = rows<{ name: string; plays: number; ms: number }>(
    `SELECT COALESCE(client, 'Unknown') AS name, COUNT(*) AS plays, SUM(watched_ms) AS ms FROM plays ${w} GROUP BY name ORDER BY ms DESC LIMIT 8`,
    ...p,
  ).map((r) => ({ name: r.name, plays: r.plays, hours: r.ms / 3_600_000 }));
  const topTitles = rows<{ key: string; title: string; type: string; plays: number; ms: number; users: number; poster: string }>(
    `SELECT COALESCE(series_id, CASE WHEN item_type = 'Episode' AND series_name IS NOT NULL THEN 'name:' || series_name END, item_id) AS key,
       COALESCE(CASE WHEN item_type = 'Episode' THEN series_name END, item_name) AS title,
       item_type AS type, COUNT(*) AS plays, SUM(watched_ms) AS ms, COUNT(DISTINCT user_id) AS users,
       MAX(CASE WHEN item_type IN ('Episode','Audio') AND series_id IS NOT NULL THEN series_id ELSE item_id END) AS poster
     FROM plays ${w} GROUP BY key ORDER BY ms DESC LIMIT 10`,
    ...p,
  ).map((r) => ({ id: r.key, title: r.title, type: r.type, plays: r.plays, hours: r.ms / 3_600_000, users: r.users, posterId: r.poster }));
  return { hourOfDay, week, platforms, topTitles };
}

export async function trackingRoutes(app: FastifyInstance) {
  // ---- Images ----------------------------------------------------------
  app.get<{ Params: { id: string }; Querystring: { h?: string } }>('/api/img/item/:id', async (req, reply) => {
    const id = req.params.id.replace(/[^a-zA-Z0-9-]/g, '');
    const h = Math.min(900, Math.max(60, Number(req.query.h) || 300));
    return proxyImage(reply, `/Items/${id}/Images/Primary?maxHeight=${h}&quality=85`);
  });
  app.get<{ Params: { id: string } }>('/api/img/user/:id', async (req, reply) => {
    const id = req.params.id.replace(/[^a-zA-Z0-9-]/g, '');
    return proxyImage(reply, `/Users/${id}/Images/Primary?maxHeight=160&quality=85`);
  });

  // ---- Live ------------------------------------------------------------
  app.get('/api/live', async () => {
    const streams = liveStreams();
    const ids = streams.map((s) => s.playId);
    const byId = new Map(
      (ids.length ? rows<PlayRow>(`SELECT * FROM plays WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids) : []).map((r) => [r.id, r]),
    );
    const items = streams
      .map((s) => {
        const r = byId.get(s.playId);
        if (!r) return null;
        const tc = s.session.TranscodingInfo;
        return {
          ...playView(r),
          sessionId: s.sessionId,
          paused: s.paused,
          canControl: s.session.SupportsRemoteControl !== false,
          transcodeProgress: tc?.CompletionPercentage ?? null,
          hwAccel: tc?.HardwareAccelerationType ?? null,
        };
      })
      .filter(Boolean);
    const bandwidth = items.reduce((sum, i) => sum + (i!.bitrate ?? 0), 0);
    return {
      streams: items,
      summary: {
        total: items.length,
        transcoding: items.filter((i) => i!.playMethod === 'Transcode').length,
        directPlay: items.filter((i) => i!.playMethod !== 'Transcode').length,
        bandwidth,
      },
      poller: pollerStatus(),
    };
  });

  app.post<{ Params: { sessionId: string } }>('/api/live/:sessionId/stop', async (req, reply) => {
    const body = z.object({ message: z.string().max(300).optional() }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'Message is too long.' });
    const sid = req.params.sessionId;
    const st = liveStreams().find((s) => s.sessionId === sid);
    try {
      if (body.data.message?.trim()) {
        await jfApi.message(sid, 'Message from the server', body.data.message.trim(), 15_000).catch(() => undefined);
        await new Promise((r) => setTimeout(r, 1200));
      }
      await jfApi.stop(sid);
    } catch (err) {
      return reply.code(502).send({ error: `Jellyfin would not stop the stream: ${(err as Error).message}` });
    }
    audit('stream.stopped', { userId: req.user!.id, ip: clientIp(req), detail: { user: st?.userName, title: st?.session.NowPlayingItem?.Name, message: body.data.message } });
    setTimeout(() => void pollNow().catch(() => undefined), 1500);
    return { ok: true };
  });

  app.post<{ Params: { sessionId: string } }>('/api/live/:sessionId/message', async (req, reply) => {
    const body = z.object({ text: z.string().trim().min(1).max(300) }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'Type a message (up to 300 characters).' });
    try {
      await jfApi.message(req.params.sessionId, 'Message from the server', body.data.text, 15_000);
    } catch (err) {
      return reply.code(502).send({ error: `Jellyfin would not deliver the message: ${(err as Error).message}` });
    }
    audit('stream.message', { userId: req.user!.id, ip: clientIp(req), detail: { session: req.params.sessionId, text: body.data.text } });
    return { ok: true };
  });

  // ---- Overview / dashboard ---------------------------------------------
  app.get('/api/stats/overview', async () => {
    const now = Date.now();
    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);
    const today = row<{ plays: number; ms: number | null }>('SELECT COUNT(*) AS plays, SUM(watched_ms) AS ms FROM plays WHERE started_at >= ?', startToday.getTime())!;
    const week = row<{ plays: number; ms: number | null; viewers: number }>(
      'SELECT COUNT(*) AS plays, SUM(watched_ms) AS ms, COUNT(DISTINCT user_id) AS viewers FROM plays WHERE started_at >= ?',
      now - 7 * DAY,
    )!;
    const since30 = new Date(startToday.getTime() - 29 * DAY).getTime();
    const dailyMap = new Map(
      rows<{ day: string; plays: number; ms: number }>(`SELECT ${LOCAL_DAY} AS day, COUNT(*) AS plays, SUM(watched_ms) AS ms FROM plays WHERE started_at >= ? GROUP BY day`, since30).map((r) => [r.day, r]),
    );
    const daily = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(since30 + i * DAY + 12 * 3_600_000);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const r = dailyMap.get(key);
      return { day: key, plays: r?.plays ?? 0, hours: (r?.ms ?? 0) / 3_600_000 };
    });
    const topUsers = rows<{ id: string; name: string; plays: number; ms: number }>(
      `SELECT user_id AS id, MAX(user_name) AS name, COUNT(*) AS plays, SUM(watched_ms) AS ms FROM plays WHERE started_at >= ? GROUP BY user_id ORDER BY ms DESC LIMIT 6`,
      since30,
    ).map((r) => ({ ...r, hours: r.ms / 3_600_000 }));
    const s = statsFor('1 = 1', [], since30);
    const openAlerts = row<{ n: number }>('SELECT COUNT(*) AS n FROM alerts WHERE acknowledged_at IS NULL AND dismissed = 0')!.n;
    const recentAlerts = rows<Parameters<typeof alertView>[0]>('SELECT * FROM alerts WHERE acknowledged_at IS NULL AND dismissed = 0 ORDER BY at DESC LIMIT 5').map(alertView);
    const recent = rows<PlayRow>('SELECT * FROM plays ORDER BY started_at DESC LIMIT 8').map(playView);
    const live = liveStreams();
    return {
      live: { total: live.length, transcoding: live.filter((l) => l.session.PlayState?.PlayMethod === 'Transcode').length },
      today: { plays: today.plays, hours: (today.ms ?? 0) / 3_600_000 },
      week: { plays: week.plays, hours: (week.ms ?? 0) / 3_600_000, viewers: week.viewers },
      daily,
      topUsers,
      topTitles: s.topTitles.slice(0, 6),
      platforms: s.platforms,
      hourOfDay: s.hourOfDay,
      openAlerts,
      recentAlerts,
      recent,
      hasData: (row<{ n: number }>('SELECT COUNT(*) AS n FROM plays')!.n ?? 0) > 0,
    };
  });

  // ---- History ---------------------------------------------------------
  app.get<{ Querystring: Record<string, string | undefined> }>('/api/history', async (req) => {
    const q = req.query;
    const page = Math.max(1, Number(q.page) || 1);
    const size = Math.min(200, Math.max(10, Number(q.pageSize) || 50));
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];
    if (q.user) {
      where.push('user_id = ?');
      params.push(q.user);
    }
    if (q.type && q.type !== 'all') {
      const map: Record<string, string[]> = { movie: ['Movie'], episode: ['Episode'], music: ['Audio', 'MusicVideo'], other: [] };
      const types = map[q.type];
      if (types?.length) {
        where.push(`item_type IN (${types.map(() => '?').join(',')})`);
        params.push(...types);
      } else if (q.type === 'other') {
        where.push(`item_type NOT IN ('Movie','Episode','Audio','MusicVideo')`);
      }
    }
    if (q.q?.trim()) {
      const like = `%${q.q.trim().replace(/[%_]/g, '\\$&')}%`;
      where.push(`(item_name LIKE ? ESCAPE '\\' OR series_name LIKE ? ESCAPE '\\' OR user_name LIKE ? ESCAPE '\\' OR device_name LIKE ? ESCAPE '\\' OR ip LIKE ? ESCAPE '\\' OR city LIKE ? ESCAPE '\\')`);
      params.push(like, like, like, like, like, like);
    }
    if (q.from) {
      where.push('started_at >= ?');
      params.push(Number(q.from));
    }
    if (q.to) {
      where.push('started_at < ?');
      params.push(Number(q.to));
    }
    if (q.method === 'transcode') where.push(`play_method = 'Transcode'`);
    if (q.method === 'direct') where.push(`COALESCE(play_method, '') != 'Transcode'`);
    if (q.source === 'live') where.push(`source = 'live'`);
    const w = where.join(' AND ');
    const total = row<{ n: number; ms: number | null }>(`SELECT COUNT(*) AS n, SUM(watched_ms) AS ms FROM plays WHERE ${w}`, ...params)!;
    const list = rows<PlayRow>(`SELECT * FROM plays WHERE ${w} ORDER BY started_at DESC LIMIT ? OFFSET ?`, ...params, size, (page - 1) * size).map(playView);
    return { total: total.n, hours: (total.ms ?? 0) / 3_600_000, page, pageSize: size, rows: list };
  });

  app.get<{ Params: { id: string } }>('/api/history/:id', async (req, reply) => {
    const r = row<PlayRow>('SELECT * FROM plays WHERE id = ?', Number(req.params.id));
    if (!r) return reply.code(404).send({ error: 'Not found' });
    const alerts = rows<Parameters<typeof alertView>[0]>('SELECT * FROM alerts WHERE play_id = ? ORDER BY at DESC', r.id).map(alertView);
    return { ...playView(r), alerts };
  });

  // ---- Users -----------------------------------------------------------
  app.get('/api/users', async () => {
    const trust = trustScores();
    const live = liveStreams();
    const users = rows<{
      id: string; name: string; is_admin: number; is_disabled: number; image_tag: string | null; last_login_at: number | null; last_activity_at: number | null;
      seerr_name: string | null; removed: number; plays: number; ms: number | null; plays30: number; last_play: number | null;
      devices: number; ips: number; alerts_open: number; requests: number;
    }>(`
      SELECT u.*,
        (SELECT COUNT(*) FROM plays p WHERE p.user_id = u.id) AS plays,
        (SELECT SUM(watched_ms) FROM plays p WHERE p.user_id = u.id) AS ms,
        (SELECT COUNT(*) FROM plays p WHERE p.user_id = u.id AND p.started_at > ?) AS plays30,
        (SELECT MAX(started_at) FROM plays p WHERE p.user_id = u.id) AS last_play,
        (SELECT COUNT(*) FROM devices d WHERE d.user_id = u.id) AS devices,
        (SELECT COUNT(*) FROM user_ips i WHERE i.user_id = u.id AND i.is_local = 0) AS ips,
        (SELECT COUNT(*) FROM alerts a WHERE a.user_id = u.id AND a.acknowledged_at IS NULL AND a.dismissed = 0) AS alerts_open,
        (SELECT COUNT(*) FROM requests r WHERE r.requested_by_jf = u.id) AS requests
      FROM media_users u ORDER BY u.removed, COALESCE(u.last_activity_at, 0) DESC`, Date.now() - 30 * DAY);
    const lastPlaces = new Map(
      rows<{ user_id: string; city: string | null; region: string | null; country: string | null; is_local: number }>(
        `SELECT i.user_id, i.city, i.region, i.country, i.is_local FROM user_ips i
         WHERE i.last_seen_at = (SELECT MAX(last_seen_at) FROM user_ips j WHERE j.user_id = i.user_id)`,
      ).map((r) => [r.user_id, placeLabel({ ...r, isLocal: r.is_local })]),
    );
    return users.map((u) => ({
      id: u.id,
      name: u.name,
      isAdmin: !!u.is_admin,
      isDisabled: !!u.is_disabled,
      removed: !!u.removed,
      hasImage: !!u.image_tag,
      lastLoginAt: u.last_login_at,
      lastActivityAt: Math.max(u.last_activity_at ?? 0, u.last_play ?? 0) || null,
      seerrName: u.seerr_name,
      plays: u.plays,
      hours: (u.ms ?? 0) / 3_600_000,
      plays30: u.plays30,
      devices: u.devices,
      ips: u.ips,
      openAlerts: u.alerts_open,
      requests: u.requests,
      trust: trust.get(u.id) ?? 100,
      streamingNow: live.filter((l) => l.userId === u.id).length,
      lastPlace: lastPlaces.get(u.id) ?? null,
    }));
  });

  app.get<{ Params: { id: string } }>('/api/users/:id', async (req, reply) => {
    const id = req.params.id;
    const u = row<{
      id: string; name: string; is_admin: number; is_disabled: number; image_tag: string | null; last_login_at: number | null; last_activity_at: number | null;
      seerr_name: string | null; email: string | null; stream_limit: number | null; notes: string; first_seen_at: number; removed: number;
    }>('SELECT * FROM media_users WHERE id = ?', id);
    if (!u) return reply.code(404).send({ error: 'Not found' });
    const totals = row<{ plays: number; ms: number | null; first: number | null; titles: number }>(
      'SELECT COUNT(*) AS plays, SUM(watched_ms) AS ms, MIN(started_at) AS first, COUNT(DISTINCT COALESCE(series_id, item_id)) AS titles FROM plays WHERE user_id = ?',
      id,
    )!;
    const s = statsFor('user_id = ?', [id], Date.now() - 90 * DAY);
    const devices = rows<{ device_id: string; name: string | null; client: string | null; client_version: string | null; first_seen_at: number; last_seen_at: number; last_ip: string | null }>(
      'SELECT * FROM devices WHERE user_id = ? ORDER BY last_seen_at DESC',
      id,
    ).map((d) => ({ id: d.device_id, name: d.name, client: d.client, version: d.client_version, firstSeenAt: d.first_seen_at, lastSeenAt: d.last_seen_at, lastIp: d.last_ip }));
    const locations = rows<{ ip: string; first_seen_at: number; last_seen_at: number; times: number; is_local: number; country: string | null; country_code: string | null; region: string | null; city: string | null; lat: number | null; lon: number | null }>(
      'SELECT * FROM user_ips WHERE user_id = ? ORDER BY last_seen_at DESC',
      id,
    ).map((l) => ({ ip: l.ip, firstSeenAt: l.first_seen_at, lastSeenAt: l.last_seen_at, times: l.times, isLocal: !!l.is_local, place: placeLabel({ ...l, isLocal: l.is_local }), countryCode: l.country_code, lat: l.lat, lon: l.lon }));
    const signIns = rows<{ id: number; at: number; kind: string; ip: string | null; is_local: number; device_name: string | null; city: string | null; country: string | null }>(
      'SELECT * FROM sign_ins WHERE user_id = ? ORDER BY at DESC LIMIT 200',
      id,
    ).map((r) => ({ id: r.id, at: r.at, kind: r.kind, ip: r.ip, device: r.device_name, place: r.ip ? placeLabel({ city: r.city, country: r.country, isLocal: r.is_local }) : null }));
    const recent = rows<PlayRow>('SELECT * FROM plays WHERE user_id = ? ORDER BY started_at DESC LIMIT 50', id).map(playView);
    const requests = rows<Parameters<typeof requestView>[0]>(`${REQUEST_SQL} WHERE r.requested_by_jf = ? ORDER BY r.created_at DESC LIMIT 200`, id).map(requestView);
    const alerts = rows<Parameters<typeof alertView>[0]>('SELECT * FROM alerts WHERE user_id = ? ORDER BY at DESC LIMIT 100', id).map(alertView);
    const live = liveStreams().filter((l) => l.userId === id).length;
    return {
      user: {
        id: u.id,
        name: u.name,
        isAdmin: !!u.is_admin,
        isDisabled: !!u.is_disabled,
        removed: !!u.removed,
        hasImage: !!u.image_tag,
        lastLoginAt: u.last_login_at,
        lastActivityAt: u.last_activity_at,
        seerrName: u.seerr_name,
        email: u.email,
        streamLimit: u.stream_limit,
        notes: u.notes,
        firstSeenAt: totals.first ?? u.first_seen_at,
        trust: trustScores().get(id) ?? 100,
        streamingNow: live,
      },
      totals: { plays: totals.plays, hours: (totals.ms ?? 0) / 3_600_000, titles: totals.titles },
      ...s,
      devices,
      locations,
      signIns,
      recent,
      requests,
      alerts,
      defaultStreamLimit: getSetting('tracking').rules.concurrentStreams.max,
    };
  });

  app.put<{ Params: { id: string } }>('/api/users/:id', async (req, reply) => {
    const body = z.object({ notes: z.string().max(5000).optional(), streamLimit: z.number().int().min(0).max(50).nullable().optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message });
    const db = getDb();
    if (body.data.notes !== undefined) db.prepare('UPDATE media_users SET notes = ? WHERE id = ?').run(body.data.notes, req.params.id);
    if (body.data.streamLimit !== undefined) db.prepare('UPDATE media_users SET stream_limit = ? WHERE id = ?').run(body.data.streamLimit, req.params.id);
    audit('user.updated', { userId: req.user!.id, ip: clientIp(req), detail: { mediaUser: req.params.id, streamLimit: body.data.streamLimit } });
    return { ok: true };
  });

  // ---- Map -------------------------------------------------------------
  app.get<{ Querystring: { days?: string; user?: string } }>('/api/map', async (req) => {
    const days = Math.min(3650, Math.max(1, Number(req.query.days) || 30));
    const since = Date.now() - days * DAY;
    const userWhere = req.query.user ? 'AND user_id = ?' : '';
    const uParams = req.query.user ? [req.query.user] : [];
    type P = { lat: number; lon: number; city: string | null; region: string | null; country: string | null; user_id: string; user_name: string; n: number; last: number; ips: string };
    const plays = rows<P>(
      `SELECT ROUND(lat, 2) AS lat, ROUND(lon, 2) AS lon, city, region, country, user_id, MAX(user_name) AS user_name, COUNT(*) AS n, MAX(started_at) AS last, GROUP_CONCAT(DISTINCT ip) AS ips
       FROM plays WHERE started_at >= ? AND lat IS NOT NULL ${userWhere} GROUP BY ROUND(lat, 2), ROUND(lon, 2), user_id`,
      since,
      ...uParams,
    );
    const signs = rows<P>(
      `SELECT ROUND(lat, 2) AS lat, ROUND(lon, 2) AS lon, city, NULL AS region, country, user_id, MAX(user_name) AS user_name, COUNT(*) AS n, MAX(at) AS last, GROUP_CONCAT(DISTINCT ip) AS ips
       FROM sign_ins WHERE at >= ? AND lat IS NOT NULL AND user_id IS NOT NULL AND kind != 'failed' ${userWhere} GROUP BY ROUND(lat, 2), ROUND(lon, 2), user_id`,
      since,
      ...uParams,
    );
    const points = new Map<string, { lat: number; lon: number; place: string; plays: number; signIns: number; lastAt: number; ips: Set<string>; users: Map<string, { id: string; name: string; plays: number; signIns: number }> }>();
    const add = (r: P, kind: 'plays' | 'signIns') => {
      const key = `${r.lat},${r.lon}`;
      let pt = points.get(key);
      if (!pt) {
        pt = { lat: r.lat, lon: r.lon, place: placeLabel(r), plays: 0, signIns: 0, lastAt: 0, ips: new Set(), users: new Map() };
        points.set(key, pt);
      }
      pt[kind] += r.n;
      pt.lastAt = Math.max(pt.lastAt, r.last);
      for (const ip of (r.ips ?? '').split(',').filter(Boolean)) pt.ips.add(ip);
      const u = pt.users.get(r.user_id) ?? { id: r.user_id, name: r.user_name, plays: 0, signIns: 0 };
      u[kind] += r.n;
      pt.users.set(r.user_id, u);
    };
    plays.forEach((r) => add(r, 'plays'));
    signs.forEach((r) => add(r, 'signIns'));
    const counts = row<{ local: number; unknown: number; total: number; localUsers: number }>(
      `SELECT SUM(is_local) AS local, SUM(CASE WHEN is_local = 0 AND lat IS NULL THEN 1 ELSE 0 END) AS unknown, COUNT(*) AS total,
         COUNT(DISTINCT CASE WHEN is_local = 1 THEN user_id END) AS localUsers
       FROM plays WHERE started_at >= ? AND source = 'live' ${userWhere}`,
      since,
      ...uParams,
    )!;
    const live = liveStreams()
      .filter((l) => l.geo.lat != null && (!req.query.user || l.userId === req.query.user))
      .map((l) => ({ lat: l.geo.lat, lon: l.geo.lon, userName: l.userName, title: l.session.NowPlayingItem?.SeriesName ?? l.session.NowPlayingItem?.Name, place: placeLabel(l.geo) }));
    return {
      points: [...points.values()].map((p) => ({ ...p, ips: [...p.ips].slice(0, 20), users: [...p.users.values()].sort((a, b) => b.plays - a.plays) })),
      live,
      localPlays: counts.local ?? 0,
      unknownPlays: counts.unknown ?? 0,
      totalPlays: counts.total ?? 0,
      // Lots of "local" plays from several people usually means Jellyfin sees a tunnel/proxy instead of the real visitor.
      proxyHint: (counts.total ?? 0) >= 10 && (counts.local ?? 0) / Math.max(1, counts.total) >= 0.7 && (counts.localUsers ?? 0) >= 3,
      geo: geoStatus(),
    };
  });

  // ---- Requests --------------------------------------------------------
  app.get<{ Querystring: Record<string, string | undefined> }>('/api/requests', async (req) => {
    const q = req.query;
    const page = Math.max(1, Number(q.page) || 1);
    const size = Math.min(200, Math.max(10, Number(q.pageSize) || 48));
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];
    if (q.user) {
      where.push('requested_by_jf = ?');
      params.push(q.user);
    }
    if (q.type === 'movie' || q.type === 'tv') {
      where.push('type = ?');
      params.push(q.type);
    }
    if (q.q?.trim()) {
      where.push(`title LIKE ? ESCAPE '\\'`);
      params.push(`%${q.q.trim().replace(/[%_]/g, '\\$&')}%`);
    }
    if (q.filter === 'unwatched') where.push('available = 1 AND req_plays = 0');
    if (q.filter === 'nobody') where.push('available = 1 AND total_plays = 0');
    if (q.filter === 'watched') where.push('req_plays > 0');
    if (q.filter === 'pending') where.push('status = 1');
    const base = `SELECT *, CASE WHEN media_status IN (4, 5) THEN 1 ELSE 0 END AS available FROM (${REQUEST_SQL})`;
    const w = where.join(' AND ');
    const total = row<{ n: number }>(`SELECT COUNT(*) AS n FROM (${base}) WHERE ${w}`, ...params)!.n;
    const list = rows<Parameters<typeof requestView>[0]>(`SELECT * FROM (${base}) WHERE ${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`, ...params, size, (page - 1) * size).map(requestView);
    const summary = row<{ total: number; available: number; unwatched: number; nobody: number; pending: number }>(
      `SELECT COUNT(*) AS total, SUM(available) AS available,
         SUM(CASE WHEN available = 1 AND req_plays = 0 THEN 1 ELSE 0 END) AS unwatched,
         SUM(CASE WHEN available = 1 AND total_plays = 0 THEN 1 ELSE 0 END) AS nobody,
         SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) AS pending
       FROM (${base})`,
    )!;
    const byUser = rows<{ id: string | null; name: string | null; n: number; unwatched: number }>(
      `SELECT requested_by_jf AS id, MAX(requested_by_name) AS name, COUNT(*) AS n, SUM(CASE WHEN available = 1 AND req_plays = 0 THEN 1 ELSE 0 END) AS unwatched
       FROM (${base}) GROUP BY requested_by_jf ORDER BY n DESC`,
    );
    return { total, page, pageSize: size, rows: list, summary, byUser, seerrConnected: !!row('SELECT 1 FROM services WHERE id = ? AND enabled = 1', 'seerr') };
  });

  // ---- Alerts ----------------------------------------------------------
  app.get<{ Querystring: Record<string, string | undefined> }>('/api/alerts', async (req) => {
    const q = req.query;
    const page = Math.max(1, Number(q.page) || 1);
    const size = Math.min(200, Math.max(10, Number(q.pageSize) || 50));
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];
    if (!q.status || q.status === 'open') where.push('acknowledged_at IS NULL AND dismissed = 0');
    if (q.status === 'dismissed') where.push('dismissed = 1');
    if (q.status === 'seen') where.push('acknowledged_at IS NOT NULL AND dismissed = 0');
    if (q.user) {
      where.push('user_id = ?');
      params.push(q.user);
    }
    if (q.rule) {
      where.push('rule = ?');
      params.push(q.rule);
    }
    const w = where.join(' AND ');
    const total = row<{ n: number }>(`SELECT COUNT(*) AS n FROM alerts WHERE ${w}`, ...params)!.n;
    const list = rows<Parameters<typeof alertView>[0]>(`SELECT * FROM alerts WHERE ${w} ORDER BY at DESC LIMIT ? OFFSET ?`, ...params, size, (page - 1) * size).map(alertView);
    const counts = row<{ open: number; critical: number }>(
      `SELECT SUM(CASE WHEN acknowledged_at IS NULL AND dismissed = 0 THEN 1 ELSE 0 END) AS open,
         SUM(CASE WHEN acknowledged_at IS NULL AND dismissed = 0 AND severity = 'critical' THEN 1 ELSE 0 END) AS critical FROM alerts`,
    )!;
    return { total, page, pageSize: size, rows: list, counts: { open: counts.open ?? 0, critical: counts.critical ?? 0 }, rules: RULE_LABELS };
  });

  app.post<{ Params: { id: string } }>('/api/alerts/:id', async (req, reply) => {
    const body = z.object({ action: z.enum(['seen', 'dismiss', 'reopen']) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Unknown action' });
    const id = Number(req.params.id);
    const db = getDb();
    if (body.data.action === 'seen') db.prepare('UPDATE alerts SET acknowledged_at = ?, acknowledged_by = ? WHERE id = ?').run(Date.now(), req.user!.id, id);
    if (body.data.action === 'dismiss') db.prepare('UPDATE alerts SET acknowledged_at = ?, acknowledged_by = ?, dismissed = 1 WHERE id = ?').run(Date.now(), req.user!.id, id);
    if (body.data.action === 'reopen') db.prepare('UPDATE alerts SET acknowledged_at = NULL, acknowledged_by = NULL, dismissed = 0 WHERE id = ?').run(id);
    return { ok: true };
  });

  app.post('/api/alerts/seen-all', async (req) => {
    const res = getDb().prepare('UPDATE alerts SET acknowledged_at = ?, acknowledged_by = ? WHERE acknowledged_at IS NULL AND dismissed = 0').run(Date.now(), req.user!.id);
    return { ok: true, updated: res.changes };
  });

  // ---- Settings, status, import ------------------------------------------
  app.get('/api/settings/tracking', async () => ({ ...getSetting('tracking'), ruleLabels: RULE_LABELS }));

  const sev = z.enum(['info', 'warning', 'critical']);
  const toggle = { enabled: z.boolean(), severity: sev };
  app.put('/api/settings/tracking', async (req, reply) => {
    const body = z
      .object({
        pollSeconds: z.number().int().min(3).max(120),
        geoEnabled: z.boolean(),
        geoAutoUpdate: z.boolean(),
        minPlaySeconds: z.number().int().min(0).max(600),
        rules: z
          .object({
            impossibleTravel: z.object({ ...toggle, kmh: z.number().min(100).max(5000) }).partial(),
            simultaneousLocations: z.object({ ...toggle, km: z.number().min(1).max(5000) }).partial(),
            concurrentStreams: z.object({ ...toggle, max: z.number().int().min(1).max(50) }).partial(),
            ipVelocity: z.object({ ...toggle, count: z.number().int().min(2).max(100), hours: z.number().int().min(1).max(168) }).partial(),
            newDevice: z.object(toggle).partial(),
            newCountry: z.object(toggle).partial(),
            failedSignIns: z.object({ ...toggle, count: z.number().int().min(2).max(100), minutes: z.number().int().min(1).max(1440) }).partial(),
          })
          .partial(),
      })
      .partial()
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message });
    audit('settings.tracking', { userId: req.user!.id, ip: clientIp(req), detail: body.data });
    return { ...setSetting('tracking', body.data), ruleLabels: RULE_LABELS };
  });

  app.get('/api/tracking/status', async () => ({
    poller: pollerStatus(),
    sync: syncStatus(),
    geo: geoStatus(),
    import: importStatus(),
    counts: row('SELECT (SELECT COUNT(*) FROM plays) AS plays, (SELECT COUNT(*) FROM media_users WHERE removed = 0) AS users, (SELECT COUNT(*) FROM sign_ins) AS signIns, (SELECT COUNT(*) FROM requests) AS requests'),
  }));

  app.post('/api/geo/update', async (req, reply) => {
    try {
      await updateGeoDatabase();
      audit('geo.updated', { userId: req.user!.id, ip: clientIp(req) });
      return geoStatus();
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  app.get('/api/tracking/import', async () => importStatus());
  app.post('/api/tracking/import', async (req, reply) => {
    if (!jellyfinReady()) return reply.code(400).send({ error: 'Connect Jellyfin first.' });
    const started = startImport(req.log);
    audit('history.import', { userId: req.user!.id, ip: clientIp(req) });
    return { started, status: importStatus() };
  });
}
