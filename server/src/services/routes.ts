import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { services } from './definitions.js';
import { getService, isServiceId, listServices, recordServiceHealth, saveService } from './store.js';
import { audit } from '../lib/audit.js';
import { clientIp } from '../lib/ip.js';
import { syncAllNow } from '../tracking/sync.js';

const urlSchema = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || /^https?:\/\/[^\s/]+/i.test(v), 'Address must start with http:// or https://')
  .transform((v) => v.replace(/\/+$/, ''));

function publicView(id: Parameters<typeof getService>[0]) {
  const s = getService(id);
  const def = services[id];
  return {
    id,
    name: def.name,
    description: def.description,
    defaultPort: def.defaultPort,
    enabledByDefault: def.enabledByDefault,
    keyHint: def.keyHint,
    hasFolders: !!def.folders,
    enabled: s.enabled,
    url: s.url,
    hasKey: !!s.apiKey,
    keyPreview: s.apiKey ? '••••' + s.apiKey.slice(-4) : '',
    lastOkAt: s.lastOkAt,
    lastError: s.lastError,
    version: s.version,
  };
}

export async function serviceRoutes(app: FastifyInstance) {
  app.get('/api/services', async () => listServices().map((s) => publicView(s.id)));

  app.put<{ Params: { id: string } }>('/api/services/:id', async (req, reply) => {
    const { id } = req.params;
    if (!isServiceId(id)) return reply.code(404).send({ error: 'Unknown app' });
    const body = z
      .object({ enabled: z.boolean().optional(), url: urlSchema.optional(), apiKey: z.string().trim().max(200).optional() })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message });
    const patch = { ...body.data };
    if (patch.apiKey === '') delete patch.apiKey; // blank means "keep the saved key"
    saveService(id, patch);
    audit('service.updated', { userId: req.user!.id, ip: clientIp(req), detail: { id, enabled: patch.enabled, url: patch.url, keyChanged: !!patch.apiKey } });
    // Pull users, sign-ins and requests straight away so pages fill in quickly.
    if ((id === 'jellyfin' || id === 'seerr') && getService(id).enabled) {
      void syncAllNow({ info: (m) => req.log.info(m), warn: (m) => req.log.warn(m), error: (m) => req.log.error(m) });
    }
    return publicView(id);
  });

  /** Tests a connection. Uses the values sent, falling back to what's saved. */
  app.post<{ Params: { id: string } }>('/api/services/:id/test', async (req, reply) => {
    const { id } = req.params;
    if (!isServiceId(id)) return reply.code(404).send({ error: 'Unknown app' });
    const body = z.object({ url: urlSchema.optional(), apiKey: z.string().trim().max(200).optional() }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ ok: false, error: body.error.issues[0]?.message });
    const saved = getService(id);
    const url = body.data.url || saved.url;
    const apiKey = body.data.apiKey || saved.apiKey;
    if (!url) return { ok: false, error: 'Enter the address first.' };
    if (!apiKey) return { ok: false, error: 'Enter the API key first.' };
    const isSaved = url === saved.url && apiKey === saved.apiKey;
    try {
      const result = await services[id].test({ url, apiKey });
      if (isSaved) recordServiceHealth(id, true, { version: result.version });
      return { ok: true, ...result };
    } catch (err) {
      const message = (err as Error).message;
      if (isSaved) recordServiceHealth(id, false, { error: message });
      return { ok: false, error: message };
    }
  });

  app.get<{ Params: { id: string } }>('/api/services/:id/folders', async (req, reply) => {
    const { id } = req.params;
    if (!isServiceId(id)) return reply.code(404).send({ error: 'Unknown app' });
    const def = services[id];
    const s = getService(id);
    if (!def.folders) return [];
    if (!s.url || !s.apiKey) return reply.code(400).send({ error: `${def.name} is not set up yet.` });
    try {
      return await def.folders({ url: s.url, apiKey: s.apiKey });
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });
}
