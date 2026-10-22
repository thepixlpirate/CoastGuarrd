import crypto from 'node:crypto';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { clientIp } from '../lib/ip.js';
import { getSetting, setSetting, type NotifySettings } from '../lib/settings.js';
import { getState } from '../lib/state.js';
import { buildFacts, fieldList, listRules, loadItems, matchRule, protectedReason, seedRules, FIELDS, type MediaRow, type RuleConfig } from '../cleanup/rules.js';
import { applyVisuals, daysLeft, evaluateNow, lastEvaluation, weeklyDigest, type FlagRow } from '../cleanup/engine.js';
import { previewBanner, restorePoster } from '../cleanup/posters.js';
import { deleteForever, leftoverDownloads, logCleanup, moveDownloadToBin, moveToBin, planMove, restoreFromBin } from '../cleanup/recycle.js';
import { driveSpace } from '../cleanup/locate.js';
import { jfRaw, jellyfinReady } from '../jellyfin/client.js';
import { notify, sendDiscord, sendEmail } from '../notify/index.js';
import { syncLibrary } from '../cleanup/library.js';

const DAY = 86_400_000;
type Log = { info: (m: string) => void; warn: (m: string) => void; error: (m: unknown) => void };

const conditionSchema = z.object({
  field: z.string().refine((f) => f in FIELDS, 'Unknown field'),
  op: z.enum(['gt', 'lt', 'gte', 'lte', 'eq', 'is', 'contains', 'notContains']),
  value: z.union([z.number(), z.string().max(200), z.boolean()]),
});
const configSchema = z.object({
  libraries: z.array(z.string().max(200)).max(50).default([]),
  match: z.enum(['all', 'any']).default('all'),
  conditions: z.array(conditionSchema).min(1, 'Add at least one condition.').max(20),
  graceDays: z.number().int().min(1).max(365),
  reason: z.string().max(80).default('due to not being watched'),
});
const ruleSchema = z.object({
  name: z.string().trim().min(1, 'Give the rule a name.').max(100),
  enabled: z.boolean(),
  kind: z.enum(['movie', 'show', 'music']),
  config: configSchema,
});

function itemView(m: MediaRow, f: ReturnType<typeof buildFacts> extends Map<string, infer V> ? V : never) {
  return {
    key: m.key,
    kind: m.kind,
    jfId: m.jf_id,
    title: m.title,
    year: m.year,
    library: m.library,
    sizeBytes: m.size_bytes,
    addedAt: m.added_at,
    lastWatchedAt: f.lastWatchedAt,
    plays: f.plays,
    viewers: f.viewers,
    requestedBy: f.requestedBy,
    requestedAt: f.requestedAt,
    requesterWatched: f.requesterWatched,
    favoriteOf: f.favoriteOf,
    tags: f.tags,
    arr: m.arr_service,
    monitored: m.arr_monitored == null ? null : !!m.arr_monitored,
    path: m.path,
  };
}

function flagsView() {
  const db = getDb();
  const rows = db.prepare('SELECT f.*, m.* FROM flags f JOIN media_items m ON m.key = f.item_key ORDER BY f.delete_at').all() as (FlagRow & MediaRow)[];
  const facts = buildFacts(rows);
  const pending = new Map(
    (db.prepare(`SELECT item_key, COUNT(*) AS n, GROUP_CONCAT(name, ', ') AS names FROM keep_requests WHERE status = 'pending' GROUP BY item_key`).all() as { item_key: string; n: number; names: string }[]).map((r) => [r.item_key, r]),
  );
  return rows.map((r) => ({
    id: r.id,
    ...itemView(r, facts.get(r.key)!),
    ruleName: r.rule_name ?? 'Manual',
    manual: r.rule_id == null,
    reason: r.reason,
    details: r.detail ? JSON.parse(r.detail) : [],
    flaggedAt: r.flagged_at,
    deleteAt: r.delete_at,
    daysLeft: daysLeft(r.delete_at),
    preview: !!r.preview,
    bannerApplied: r.poster_days != null,
    inCollection: !!r.in_collection,
    lastError: r.last_error,
    keepRequests: pending.get(r.key) ?? null,
  }));
}

function maskNotify(s: NotifySettings) {
  return { ...s, email: { ...s.email, pass: s.email.pass ? '••••••••' : '' }, hasPass: !!s.email.pass };
}

export async function cleanupRoutes(app: FastifyInstance, opts: { log: Log }) {
  const log = opts.log;

  // ---- Rules -----------------------------------------------------------
  app.get('/api/cleanup/fields', async () => {
    const libs = getDb().prepare('SELECT library, kind, COUNT(*) AS n FROM media_items WHERE library IS NOT NULL GROUP BY library, kind ORDER BY library').all();
    return { fields: fieldList(), libraries: libs };
  });

  app.get('/api/cleanup/rules', async () => {
    seedRules();
    const counts = new Map((getDb().prepare('SELECT rule_id, COUNT(*) AS n FROM flags GROUP BY rule_id').all() as { rule_id: number; n: number }[]).map((r) => [r.rule_id, r.n]));
    return listRules().map((r) => ({ ...r, flagged: counts.get(r.id) ?? 0 }));
  });

  app.post('/api/cleanup/rules', async (req, reply) => {
    const body = ruleSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message });
    const now = Date.now();
    const pos = (getDb().prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM cleanup_rules').get() as { p: number }).p;
    const id = getDb()
      .prepare('INSERT INTO cleanup_rules (name, enabled, kind, config, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(body.data.name, body.data.enabled ? 1 : 0, body.data.kind, JSON.stringify(body.data.config), pos, now, now).lastInsertRowid;
    audit('cleanup.rule_created', { userId: req.user!.id, ip: clientIp(req), detail: body.data });
    return { id };
  });

  app.put<{ Params: { id: string } }>('/api/cleanup/rules/:id', async (req, reply) => {
    const body = ruleSchema.partial().safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message });
    const cur = listRules().find((r) => r.id === Number(req.params.id));
    if (!cur) return reply.code(404).send({ error: 'Not found' });
    const next = { ...cur, ...body.data, config: body.data.config ?? cur.config };
    getDb()
      .prepare('UPDATE cleanup_rules SET name = ?, enabled = ?, kind = ?, config = ?, updated_at = ? WHERE id = ?')
      .run(next.name, next.enabled ? 1 : 0, next.kind, JSON.stringify(next.config), Date.now(), cur.id);
    audit('cleanup.rule_updated', { userId: req.user!.id, ip: clientIp(req), detail: { id: cur.id, ...body.data } });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/cleanup/rules/:id', async (req) => {
    getDb().prepare('DELETE FROM cleanup_rules WHERE id = ?').run(Number(req.params.id));
    audit('cleanup.rule_deleted', { userId: req.user!.id, ip: clientIp(req), detail: { id: req.params.id } });
    return { ok: true };
  });

  app.post('/api/cleanup/rules/order', async (req, reply) => {
    const body = z.object({ ids: z.array(z.number().int()).max(200) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Bad order' });
    const st = getDb().prepare('UPDATE cleanup_rules SET position = ? WHERE id = ?');
    body.data.ids.forEach((id, i) => st.run(i, id));
    return { ok: true };
  });

  /** What a rule would flag right now — nothing is changed. */
  app.post('/api/cleanup/preview', async (req, reply) => {
    const body = z.object({ kind: z.enum(['movie', 'show', 'music']), config: configSchema }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message });
    const items = loadItems().filter((i) => i.kind === body.data.kind);
    const facts = buildFacts(items);
    const now = Date.now();
    const matches: (ReturnType<typeof itemView> & { details: unknown; protectedBy: string | null })[] = [];
    for (const m of items) {
      const f = facts.get(m.key)!;
      const d = matchRule({ kind: body.data.kind, config: body.data.config as RuleConfig }, m, f, now);
      if (d) matches.push({ ...itemView(m, f), details: d, protectedBy: protectedReason(m, f, now) });
    }
    const flaggable = matches.filter((m) => !m.protectedBy);
    return {
      checked: items.length,
      matched: matches.length,
      wouldFlag: flaggable.length,
      bytes: flaggable.reduce((n, m) => n + (m.sizeBytes ?? 0), 0),
      items: matches.sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0)).slice(0, 300),
    };
  });

  app.post('/api/cleanup/run', async (req) => {
    audit('cleanup.run', { userId: req.user!.id, ip: clientIp(req) });
    return evaluateNow(log);
  });

  app.get('/api/cleanup/status', async () => {
    const db = getDb();
    return {
      lastEvaluation: lastEvaluation(),
      library: getState<{ at: number; items: number } | null>('library:lastSync', null),
      previewMode: getSetting('general').previewMode,
      counts: db.prepare(`SELECT (SELECT COUNT(*) FROM media_items) AS items, (SELECT COUNT(*) FROM flags) AS flagged,
        (SELECT COUNT(*) FROM recycle_bin WHERE status = 'in_bin') AS inBin, (SELECT COUNT(*) FROM keep_requests WHERE status = 'pending') AS keepRequests`).get(),
    };
  });

  // ---- Library ---------------------------------------------------------
  app.get<{ Querystring: Record<string, string | undefined> }>('/api/library', async (req) => {
    const q = req.query;
    let items = loadItems();
    if (q.kind && q.kind !== 'all') items = items.filter((i) => i.kind === q.kind);
    if (q.q?.trim()) {
      const s = q.q.trim().toLowerCase();
      items = items.filter((i) => i.title.toLowerCase().includes(s));
    }
    const facts = buildFacts(items);
    const flags = new Map((getDb().prepare('SELECT item_key, delete_at, preview FROM flags').all() as { item_key: string; delete_at: number; preview: number }[]).map((f) => [f.item_key, f]));
    const now = Date.now();
    let rows = items.map((m) => {
      const f = facts.get(m.key)!;
      const fl = flags.get(m.key);
      return { ...itemView(m, f), protectedBy: protectedReason(m, f, now), flag: fl ? { daysLeft: daysLeft(fl.delete_at), preview: !!fl.preview } : null };
    });
    const sort = q.sort ?? 'unwatched';
    rows.sort((a, b) =>
      sort === 'size' ? (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0) : sort === 'title' ? a.title.localeCompare(b.title) : sort === 'added' ? (b.addedAt ?? 0) - (a.addedAt ?? 0) : (a.lastWatchedAt ?? 0) - (b.lastWatchedAt ?? 0) || (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0),
    );
    const total = rows.length;
    const page = Math.max(1, Number(q.page) || 1);
    rows = rows.slice((page - 1) * 60, page * 60);
    return { total, page, pageSize: 60, rows, lastSync: getState('library:lastSync', null) };
  });

  app.post('/api/library/sync', async (req) => {
    audit('library.sync', { userId: req.user!.id, ip: clientIp(req) });
    return syncLibrary();
  });

  /** Flag a title by hand. */
  app.post<{ Params: { key: string } }>('/api/library/:key/flag', async (req, reply) => {
    const body = z.object({ days: z.number().int().min(0).max(365), reason: z.string().max(80).optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Pick how many days.' });
    const item = getDb().prepare('SELECT * FROM media_items WHERE key = ?').get(req.params.key) as MediaRow | undefined;
    if (!item) return reply.code(404).send({ error: 'Not found' });
    const now = Date.now();
    getDb().prepare('DELETE FROM exclusions WHERE item_key = ?').run(item.key);
    getDb()
      .prepare(
        `INSERT INTO flags (item_key, rule_id, rule_name, reason, detail, flagged_at, delete_at, preview) VALUES (?, NULL, 'Manual', ?, '[]', ?, ?, ?)
         ON CONFLICT(item_key) DO UPDATE SET rule_id = NULL, rule_name = 'Manual', reason = excluded.reason, delete_at = excluded.delete_at`,
      )
      .run(item.key, body.data.reason ?? 'by the server owner', now, now + body.data.days * DAY, getSetting('general').previewMode ? 1 : 0);
    logCleanup(item.key, item.title, 'flagged', { rule: 'Manual', days: body.data.days });
    await applyVisuals(getSetting('general').previewMode).catch(() => undefined);
    return { ok: true };
  });

  app.post<{ Params: { key: string } }>('/api/library/:key/keep', async (req, reply) => {
    const body = z.object({ days: z.number().int().min(1).max(3650).nullable() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Bad request' });
    const item = getDb().prepare('SELECT * FROM media_items WHERE key = ?').get(req.params.key) as MediaRow | undefined;
    if (!item) return reply.code(404).send({ error: 'Not found' });
    await keepItem(item, body.data.days, 'Kept by you');
    return { ok: true };
  });

  async function keepItem(item: MediaRow, days: number | null, reason: string) {
    const db = getDb();
    const flag = db.prepare('SELECT * FROM flags WHERE item_key = ?').get(item.key) as FlagRow | undefined;
    if (flag && item.jf_id && flag.poster_days != null) await restorePoster(item.jf_id).catch(() => undefined);
    db.prepare('DELETE FROM flags WHERE item_key = ?').run(item.key);
    db.prepare('INSERT OR REPLACE INTO exclusions (item_key, title, until, reason, created_at) VALUES (?, ?, ?, ?, ?)').run(item.key, item.title, days == null ? null : Date.now() + days * DAY, reason, Date.now());
    db.prepare(`UPDATE keep_requests SET status = 'approved' WHERE item_key = ? AND status = 'pending'`).run(item.key);
    logCleanup(item.key, item.title, 'kept', { days, reason });
    await applyVisuals(getSetting('general').previewMode).catch(() => undefined);
  }

  // ---- Leaving soon ----------------------------------------------------
  app.get('/api/leaving', async () => {
    const rows = flagsView();
    const keep = getDb().prepare(`SELECT * FROM keep_requests WHERE status = 'pending' ORDER BY at DESC`).all();
    const n = getSetting('notify');
    return {
      preview: getSetting('general').previewMode,
      rows,
      totalBytes: rows.reduce((s, r) => s + (r.sizeBytes ?? 0), 0),
      keepRequests: keep,
      familyLink: n.family.pageEnabled && n.family.token ? `/public/leaving/${n.family.token}` : null,
      lastEvaluation: lastEvaluation(),
    };
  });

  function flagItem(id: number) {
    return getDb().prepare('SELECT f.*, m.* FROM flags f JOIN media_items m ON m.key = f.item_key WHERE f.id = ?').get(id) as (FlagRow & MediaRow) | undefined;
  }

  app.get<{ Params: { id: string } }>('/api/leaving/:id/poster', async (req, reply) => {
    const f = flagItem(Number(req.params.id));
    if (!f?.jf_id || !jellyfinReady()) return reply.code(404).send();
    try {
      const img = await previewBanner(f.jf_id, daysLeft(f.delete_at), f.reason ?? '', getSetting('cleanup').posters.color);
      if (!img) return reply.code(404).send();
      reply.header('Content-Type', 'image/jpeg').header('Cache-Control', 'private, max-age=600');
      return reply.send(img);
    } catch {
      return reply.code(502).send();
    }
  });

  app.post<{ Params: { id: string } }>('/api/leaving/:id/keep', async (req, reply) => {
    const body = z.object({ days: z.number().int().min(1).max(3650).nullable() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Bad request' });
    const f = flagItem(Number(req.params.id));
    if (!f) return reply.code(404).send({ error: 'Not found' });
    await keepItem(f, body.data.days, body.data.days == null ? 'Kept forever' : `Kept for ${body.data.days} days`);
    audit('cleanup.kept', { userId: req.user!.id, ip: clientIp(req), detail: { title: f.title, days: body.data.days } });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/leaving/:id/extend', async (req, reply) => {
    const body = z.object({ days: z.number().int().min(1).max(365) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Bad request' });
    const f = flagItem(Number(req.params.id));
    if (!f) return reply.code(404).send({ error: 'Not found' });
    getDb().prepare('UPDATE flags SET delete_at = delete_at + ? WHERE id = ?').run(body.data.days * DAY, f.id);
    logCleanup(f.key, f.title, 'extended', { days: body.data.days });
    await applyVisuals(getSetting('general').previewMode).catch(() => undefined);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/leaving/:id/plan', async (req, reply) => {
    const f = flagItem(Number(req.params.id));
    if (!f) return reply.code(404).send({ error: 'Not found' });
    try {
      const p = planMove(f);
      return { ok: true, sources: p.sources, dest: p.dest };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  app.post<{ Params: { id: string } }>('/api/leaving/:id/move', async (req, reply) => {
    const f = flagItem(Number(req.params.id));
    if (!f) return reply.code(404).send({ error: 'Not found' });
    try {
      const id = await moveToBin(f, f.rule_name);
      audit('cleanup.moved_now', { userId: req.user!.id, ip: clientIp(req), detail: { title: f.title } });
      await applyVisuals(getSetting('general').previewMode).catch(() => undefined);
      return { ok: true, binId: id };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  // ---- Exclusions & keep requests --------------------------------------
  app.get('/api/exclusions', async () => getDb().prepare('SELECT * FROM exclusions WHERE until IS NULL OR until > ? ORDER BY created_at DESC').all(Date.now()));
  app.delete<{ Params: { key: string } }>('/api/exclusions/:key', async (req) => {
    getDb().prepare('DELETE FROM exclusions WHERE item_key = ?').run(req.params.key);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/keep-requests/:id', async (req, reply) => {
    const body = z.object({ action: z.enum(['approve', 'decline']), days: z.number().int().min(1).max(3650).nullable().optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Bad request' });
    const kr = getDb().prepare('SELECT * FROM keep_requests WHERE id = ?').get(Number(req.params.id)) as { id: number; item_key: string; name: string } | undefined;
    if (!kr) return reply.code(404).send({ error: 'Not found' });
    if (body.data.action === 'decline') {
      getDb().prepare(`UPDATE keep_requests SET status = 'declined' WHERE id = ?`).run(kr.id);
      return { ok: true };
    }
    const item = getDb().prepare('SELECT * FROM media_items WHERE key = ?').get(kr.item_key) as MediaRow | undefined;
    if (item) await keepItem(item, body.data.days ?? 90, `Kept because ${kr.name} asked`);
    getDb().prepare(`UPDATE keep_requests SET status = 'approved' WHERE id = ?`).run(kr.id);
    return { ok: true };
  });

  // ---- Recycle bin -----------------------------------------------------
  app.get('/api/recycle', async () => {
    const db = getDb();
    const rows = db.prepare(`SELECT * FROM recycle_bin WHERE status = 'in_bin' ORDER BY moved_at DESC`).all() as { recycle_path: string; size_bytes: number | null }[];
    const roots = new Map<string, { path: string; total: number; free: number; binBytes: number }>();
    for (const r of rows) {
      const root = r.recycle_path.split('.coastguarrd-recycle')[0] + '.coastguarrd-recycle';
      const key = r.recycle_path.includes('.coastguarrd-recycle') ? root : path.dirname(r.recycle_path);
      let e = roots.get(key);
      if (!e) {
        const sp = driveSpace(key);
        e = { path: key, total: sp?.total ?? 0, free: sp?.free ?? 0, binBytes: 0 };
        roots.set(key, e);
      }
      e.binBytes += r.size_bytes ?? 0;
    }
    return { rows, totalBytes: rows.reduce((n, r) => n + (r.size_bytes ?? 0), 0), drives: [...roots.values()] };
  });

  app.get('/api/recycle/history', async () =>
    getDb().prepare('SELECT * FROM cleanup_log ORDER BY at DESC LIMIT 300').all(),
  );

  app.post<{ Params: { id: string } }>('/api/recycle/:id/restore', async (req, reply) => {
    try {
      await restoreFromBin(Number(req.params.id));
      audit('recycle.restored', { userId: req.user!.id, ip: clientIp(req), detail: { id: req.params.id } });
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post<{ Params: { id: string } }>('/api/recycle/:id/delete', async (req, reply) => {
    const body = z.object({ confirm: z.literal(true) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Please confirm.' });
    try {
      await deleteForever(Number(req.params.id));
      audit('recycle.deleted', { userId: req.user!.id, ip: clientIp(req), detail: { id: req.params.id } });
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post('/api/recycle/empty', async (req, reply) => {
    const body = z.object({ confirm: z.literal('EMPTY') }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Type EMPTY to confirm.' });
    const ids = (getDb().prepare(`SELECT id FROM recycle_bin WHERE status = 'in_bin'`).all() as { id: number }[]).map((r) => r.id);
    const errors: string[] = [];
    for (const id of ids) await deleteForever(id).catch((e) => errors.push((e as Error).message));
    audit('recycle.emptied', { userId: req.user!.id, ip: clientIp(req), detail: { count: ids.length, errors: errors.length } });
    return { ok: true, deleted: ids.length - errors.length, errors };
  });

  app.get('/api/downloads/leftovers', async () => ({ path: getSetting('general').downloadsPath, ageDays: getSetting('cleanup').downloadsAgeDays, rows: leftoverDownloads() }));
  app.post('/api/downloads/leftovers/move', async (req, reply) => {
    const body = z.object({ name: z.string().min(1).max(500) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Bad request' });
    try {
      const id = moveDownloadToBin(body.data.name);
      audit('downloads.moved', { userId: req.user!.id, ip: clientIp(req), detail: { name: body.data.name } });
      return { ok: true, id };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  // ---- Settings --------------------------------------------------------
  app.get('/api/settings/cleanup', async () => getSetting('cleanup'));
  app.put('/api/settings/cleanup', async (req, reply) => {
    const body = z
      .object({
        protectTags: z.array(z.string().trim().toLowerCase().max(60)).max(50),
        protectFavorites: z.boolean(),
        protectRequestedDays: z.number().int().min(0).max(3650),
        protectAddedDays: z.number().int().min(0).max(3650),
        excludedLibraries: z.array(z.string().max(200)).max(50),
        evaluateHours: z.number().int().min(1).max(48),
        posters: z.object({ enabled: z.boolean(), color: z.enum(['red', 'purple', 'teal', 'black']) }).partial(),
        collection: z.object({ enabled: z.boolean(), name: z.string().trim().min(1).max(80) }).partial(),
        arr: z.object({ unmonitor: z.boolean(), removeOnDelete: z.boolean(), importExclusion: z.boolean() }).partial(),
        seerrReset: z.boolean(),
        allowCrossDrive: z.boolean(),
        downloadsAgeDays: z.number().int().min(1).max(3650),
      })
      .partial()
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message });
    const before = getSetting('cleanup');
    const next = setSetting('cleanup', body.data);
    audit('settings.cleanup', { userId: req.user!.id, ip: clientIp(req), detail: body.data });
    // Banner colour changed: redraw every banner.
    if (body.data.posters?.color && body.data.posters.color !== before.posters.color) getDb().prepare('UPDATE flags SET poster_days = -1 WHERE poster_days IS NOT NULL').run();
    void applyVisuals(getSetting('general').previewMode).catch(() => undefined);
    return next;
  });

  app.get('/api/settings/notify', async () => maskNotify(getSetting('notify')));
  app.put('/api/settings/notify', async (req, reply) => {
    const url = z.string().trim().max(500).refine((v) => v === '' || /^https?:\/\//.test(v), 'Must start with http:// or https://');
    const body = z
      .object({
        discord: z.object({ enabled: z.boolean(), webhook: url }).partial(),
        email: z.object({ enabled: z.boolean(), host: z.string().trim().max(200), port: z.number().int().min(1).max(65535), secure: z.boolean(), user: z.string().trim().max(200), pass: z.string().max(500), from: z.string().trim().max(200), to: z.string().trim().max(500) }).partial(),
        webhook: z.object({ enabled: z.boolean(), url }).partial(),
        events: z.object({ alerts: z.enum(['off', 'info', 'warning', 'critical']), flagged: z.boolean(), moved: z.boolean(), keepRequests: z.boolean(), digest: z.boolean() }).partial(),
        family: z.object({ pageEnabled: z.boolean(), emailDigest: z.boolean() }).partial(),
        publicUrl: url,
      })
      .partial()
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message });
    const patch = body.data;
    if (patch.email?.pass === '••••••••') delete patch.email.pass;
    if (patch.publicUrl) patch.publicUrl = patch.publicUrl.replace(/\/+$/, '');
    let next = setSetting('notify', patch);
    if (next.family.pageEnabled && !next.family.token) next = setSetting('notify', { family: { token: crypto.randomBytes(18).toString('base64url') } });
    audit('settings.notify', { userId: req.user!.id, ip: clientIp(req), detail: { ...patch, email: patch.email ? { ...patch.email, pass: patch.email.pass ? '(changed)' : undefined } : undefined } });
    return maskNotify(next);
  });

  app.post('/api/notify/family-token', async (req) => {
    const next = setSetting('notify', { family: { token: crypto.randomBytes(18).toString('base64url') } });
    audit('settings.family_link_reset', { userId: req.user!.id, ip: clientIp(req) });
    return maskNotify(next);
  });

  app.post('/api/notify/test', async (req, reply) => {
    const body = z.object({ channel: z.enum(['discord', 'email', 'webhook']) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Pick a channel.' });
    const s = getSetting('notify');
    const msg = { title: 'Test message from CoastGuarrd', text: 'If you can read this, notifications are working. ⚓', link: '/', severity: 'good' as const, event: 'test' };
    try {
      if (body.data.channel === 'discord') {
        if (!s.discord.webhook) throw new Error('Add a Discord webhook address first.');
        await sendDiscord(s.discord.webhook, msg, s);
      } else if (body.data.channel === 'email') {
        if (!s.email.host || !s.email.to) throw new Error('Fill in the mail server and “send to” address first.');
        await sendEmail(s.email.to, msg, s);
      } else {
        if (!s.webhook.url) throw new Error('Add a webhook address first.');
        const res = await fetch(s.webhook.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...msg, app: 'CoastGuarrd' }), signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post('/api/notify/digest-now', async () => {
    await weeklyDigest();
    return { ok: true };
  });

  // ---- Public family page (no sign-in; secret link) ----------------------
  function tokenOk(token: string) {
    const s = getSetting('notify');
    if (!s.family.pageEnabled || !s.family.token) return false;
    const a = Buffer.from(token);
    const b = Buffer.from(s.family.token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  app.get<{ Params: { token: string } }>('/api/public/leaving/:token', async (req, reply) => {
    if (!tokenOk(req.params.token)) return reply.code(404).send({ error: 'This link isn’t valid.' });
    const rows = (getDb().prepare('SELECT f.id, f.delete_at, f.reason, m.title, m.year, m.kind, m.jf_id, m.key FROM flags f JOIN media_items m ON m.key = f.item_key WHERE f.preview = 0 ORDER BY f.delete_at').all() as {
      id: number; delete_at: number; reason: string | null; title: string; year: number | null; kind: string; jf_id: string | null; key: string;
    }[]).map((r) => ({ id: r.id, title: r.title, year: r.year, kind: r.kind, daysLeft: daysLeft(r.delete_at), reason: r.reason, hasPoster: !!r.jf_id }));
    return { rows };
  });

  app.get<{ Params: { token: string; id: string } }>('/api/public/poster/:token/:id', async (req, reply) => {
    if (!tokenOk(req.params.token)) return reply.code(404).send();
    const r = getDb().prepare('SELECT m.jf_id FROM flags f JOIN media_items m ON m.key = f.item_key WHERE f.id = ? AND f.preview = 0').get(Number(req.params.id)) as { jf_id: string | null } | undefined;
    if (!r?.jf_id || !jellyfinReady()) return reply.code(404).send();
    const res = await jfRaw(`/Items/${r.jf_id}/Images/Primary?maxHeight=360&quality=85`).catch(() => null);
    if (!res?.ok) return reply.code(404).send();
    reply.header('Content-Type', res.headers.get('content-type') ?? 'image/jpeg').header('Cache-Control', 'public, max-age=3600');
    return reply.send(Buffer.from(await res.arrayBuffer()));
  });

  const keepHits = new Map<string, number[]>();
  app.post<{ Params: { token: string } }>('/api/public/leaving/:token/keep', async (req, reply) => {
    if (!tokenOk(req.params.token)) return reply.code(404).send({ error: 'This link isn’t valid.' });
    const ip = clientIp(req);
    const now = Date.now();
    const hits = (keepHits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
    if (hits.length >= 20) return reply.code(429).send({ error: 'That’s a lot of requests — please try again later.' });
    keepHits.set(ip, [...hits, now]);
    const body = z.object({ id: z.number().int(), name: z.string().trim().min(1, 'Please add your name.').max(60), message: z.string().trim().max(300).optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message });
    const f = getDb().prepare('SELECT f.item_key, m.title FROM flags f JOIN media_items m ON m.key = f.item_key WHERE f.id = ? AND f.preview = 0').get(body.data.id) as { item_key: string; title: string } | undefined;
    if (!f) return reply.code(404).send({ error: 'That title is no longer leaving.' });
    getDb().prepare('INSERT INTO keep_requests (item_key, title, name, message, ip, at) VALUES (?, ?, ?, ?, ?, ?)').run(f.item_key, f.title, body.data.name, body.data.message ?? null, ip, now);
    if (getSetting('notify').events.keepRequests) {
      void notify({ title: `${body.data.name} wants to keep “${f.title}”`, text: body.data.message || 'They asked to keep it from the Leaving Soon page.', link: '/leaving', severity: 'info', event: 'cleanup.keep_request' });
    }
    return { ok: true };
  });
}
