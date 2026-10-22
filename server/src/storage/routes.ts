import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { services, serviceOrder } from '../services/definitions.js';
import { getService } from '../services/store.js';
import { audit } from '../lib/audit.js';
import { clientIp } from '../lib/ip.js';
import { getSetting, setSetting } from '../lib/settings.js';
import { checkPaths, isInside, listDirs, suggestLocalPath, suggestRecyclePath } from './paths.js';
import { evaluateNow } from '../cleanup/engine.js';

interface FolderRow {
  id: number;
  service: string;
  remote_path: string;
  local_path: string;
  recycle_path: string;
}

function view(row: FolderRow) {
  return {
    id: row.id,
    service: row.service,
    serviceName: services[row.service as keyof typeof services]?.name ?? row.service,
    remotePath: row.remote_path,
    localPath: row.local_path,
    recyclePath: row.recycle_path,
    check: checkPaths(row.local_path, row.recycle_path),
  };
}

const absPath = z
  .string()
  .trim()
  .max(1000)
  .refine((p) => p === '' || (path.isAbsolute(p) && p !== '/'), 'Use a full folder path, like /media/Movies');

export async function storageRoutes(app: FastifyInstance) {
  /** Folder picker: lists folders under the container's media mount. */
  app.get<{ Querystring: { path?: string } }>('/api/storage/browse', async (req, reply) => {
    const requested = path.resolve(req.query.path || config.mediaRoot);
    if (!isInside(requested, config.mediaRoot)) return reply.code(400).send({ error: 'Only folders inside the media mount can be browsed.' });
    return {
      root: config.mediaRoot,
      rootExists: fs.existsSync(config.mediaRoot),
      path: requested,
      parent: requested === config.mediaRoot ? null : path.dirname(requested),
      folders: listDirs(requested),
    };
  });

  app.post('/api/storage/check', async (req, reply) => {
    const body = z.object({ localPath: absPath, recyclePath: absPath }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message });
    return checkPaths(body.data.localPath, body.data.recyclePath);
  });

  app.get('/api/library-folders', async () => {
    const rows = getDb().prepare('SELECT * FROM library_folders ORDER BY service, remote_path').all() as FolderRow[];
    return rows.map(view);
  });

  /** Pulls the media folders from every connected app and adds any new ones with suggested paths. */
  app.post('/api/library-folders/discover', async (req) => {
    const db = getDb();
    const errors: { service: string; error: string }[] = [];
    let added = 0;
    for (const id of serviceOrder) {
      const def = services[id];
      const s = getService(id);
      if (!def.folders || !s.enabled || !s.url || !s.apiKey) continue;
      try {
        const folders = await def.folders({ url: s.url, apiKey: s.apiKey });
        for (const f of folders) {
          const exists = db.prepare('SELECT 1 FROM library_folders WHERE service = ? AND remote_path = ?').get(id, f.path);
          if (exists) continue;
          const local = suggestLocalPath(f.path);
          db.prepare('INSERT INTO library_folders (service, remote_path, local_path, recycle_path) VALUES (?, ?, ?, ?)').run(
            id,
            f.path,
            local,
            local ? suggestRecyclePath(local) : '',
          );
          added++;
        }
      } catch (err) {
        errors.push({ service: def.name, error: (err as Error).message });
      }
    }
    if (added) audit('library.discovered', { userId: req.user!.id, ip: clientIp(req), detail: { added } });
    const rows = db.prepare('SELECT * FROM library_folders ORDER BY service, remote_path').all() as FolderRow[];
    return { added, errors, folders: rows.map(view) };
  });

  app.put<{ Params: { id: string } }>('/api/library-folders/:id', async (req, reply) => {
    const body = z.object({ localPath: absPath, recyclePath: absPath.optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message });
    const db = getDb();
    const row = db.prepare('SELECT * FROM library_folders WHERE id = ?').get(Number(req.params.id)) as FolderRow | undefined;
    if (!row) return reply.code(404).send({ error: 'Not found' });
    const recycle = body.data.recyclePath ?? (body.data.localPath ? suggestRecyclePath(body.data.localPath) : '');
    db.prepare('UPDATE library_folders SET local_path = ?, recycle_path = ? WHERE id = ?').run(body.data.localPath, recycle, row.id);
    audit('library.updated', { userId: req.user!.id, ip: clientIp(req), detail: { id: row.id, localPath: body.data.localPath, recyclePath: recycle } });
    return view({ ...row, local_path: body.data.localPath, recycle_path: recycle });
  });

  app.delete<{ Params: { id: string } }>('/api/library-folders/:id', async (req) => {
    getDb().prepare('DELETE FROM library_folders WHERE id = ?').run(Number(req.params.id));
    audit('library.removed', { userId: req.user!.id, ip: clientIp(req), detail: { id: req.params.id } });
    return { ok: true };
  });

  /** Suggests the recycle bin for a folder (same drive). */
  app.get<{ Querystring: { path?: string } }>('/api/storage/suggest-recycle', async (req) => ({
    recyclePath: req.query.path ? suggestRecyclePath(req.query.path) : '',
  }));

  // ---- General settings --------------------------------------------------

  app.get('/api/settings/general', async () => ({ ...getSetting('general'), mediaRoot: config.mediaRoot, version: config.version }));

  app.put('/api/settings/general', async (req, reply) => {
    const body = z
      .object({ previewMode: z.boolean(), setupComplete: z.boolean(), downloadsPath: absPath })
      .partial()
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message });
    audit('settings.general', { userId: req.user!.id, ip: clientIp(req), detail: body.data });
    const before = getSetting('general').previewMode;
    const next = setSetting('general', body.data);
    // Turning preview mode on/off: re-check straight away so posters and the collection follow.
    if (body.data.previewMode !== undefined && body.data.previewMode !== before) {
      void evaluateNow({ info: (m) => req.log.info(m), warn: (m) => req.log.warn(m), error: (m) => req.log.error(m) }, { sync: false }).catch(() => undefined);
    }
    return next;
  });
}
