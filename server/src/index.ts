import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { openDb } from './db/index.js';
import { loadSession, purgeExpired } from './auth/sessions.js';
import { authRoutes } from './auth/routes.js';
import { accountRoutes } from './routes/account.js';
import { serviceRoutes } from './services/routes.js';
import { storageRoutes } from './storage/routes.js';
import { services } from './services/definitions.js';
import { listServices, recordServiceHealth } from './services/store.js';
import { trackingRoutes } from './routes/tracking.js';
import { initGeo } from './geo/index.js';
import { startPoller } from './tracking/poller.js';
import { startSync } from './tracking/sync.js';

openDb();

const app = Fastify({
  logger: { level: config.logLevel },
  bodyLimit: 1024 * 1024,
  // Client addresses are worked out in lib/ip.ts with stricter rules.
  trustProxy: false,
});

await app.register(cookie);
await app.register(helmet, {
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'img-src': ["'self'", 'data:', 'blob:', 'https:', 'http:'],
      'connect-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'script-src': ["'self'"],
      'frame-ancestors': ["'none'"],
      'upgrade-insecure-requests': null,
    },
  },
  // Served over plain http on the LAN as well, so HSTS is left to the tunnel.
  hsts: false,
  crossOriginEmbedderPolicy: false,
});

const PUBLIC_API = new Set(['/api/health', '/api/auth/status', '/api/auth/login', '/api/auth/login/2fa', '/api/auth/register', '/api/auth/logout']);

app.addHook('onRequest', async (req, reply) => {
  if (!req.url.startsWith('/api/')) return;
  req.user = loadSession(req);

  // Basic cross-site request protection: every change must come from our own pages.
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-coastguarrd'] !== '1') {
    return reply.code(403).send({ error: 'Request blocked.' });
  }

  const route = req.url.split('?')[0];
  if (PUBLIC_API.has(route)) return;
  if (!req.user) return reply.code(401).send({ error: 'Please sign in.' });
});

app.get('/api/health', async () => ({ ok: true, version: config.version }));

await app.register(authRoutes);
await app.register(accountRoutes);
await app.register(serviceRoutes);
await app.register(storageRoutes);
await app.register(trackingRoutes);

app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
  req.log.error(err);
  const status = (err as { statusCode?: number }).statusCode ?? 500;
  reply.code(status).send({ error: status >= 500 ? 'Something went wrong on the server.' : err.message });
});

// ---- Web interface ------------------------------------------------------

if (fs.existsSync(path.join(config.webDir, 'index.html'))) {
  await app.register(fastifyStatic, { root: config.webDir, wildcard: false, index: false });
  // Hashed build files can be cached forever; index.html never.
  app.get('/assets/*', (req, reply) => {
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    return reply.sendFile(req.url.slice(1).split('?')[0]);
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
    const file = path.join(config.webDir, req.url.split('?')[0]);
    if (req.url !== '/' && file.startsWith(config.webDir) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      return reply.sendFile(path.relative(config.webDir, file));
    }
    reply.header('Cache-Control', 'no-store');
    return reply.sendFile('index.html');
  });
} else {
  app.log.warn(`Web interface not found in ${config.webDir}; only the API is available.`);
}

// ---- Background chores --------------------------------------------------

async function checkServices() {
  for (const s of listServices()) {
    if (!s.enabled || !s.url || !s.apiKey) continue;
    try {
      const r = await services[s.id].test({ url: s.url, apiKey: s.apiKey });
      recordServiceHealth(s.id, true, { version: r.version });
    } catch (err) {
      recordServiceHealth(s.id, false, { error: (err as Error).message });
    }
  }
}

setInterval(() => {
  try {
    purgeExpired();
  } catch (err) {
    app.log.error(err);
  }
}, 15 * 60_000).unref();
setInterval(() => void checkServices().catch((e) => app.log.error(e)), 5 * 60_000).unref();
setTimeout(() => void checkServices().catch((e) => app.log.error(e)), 5_000).unref();

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: config.port, host: config.host });

// ---- Tracking -------------------------------------------------------------
const bgLog = {
  info: (m: string) => app.log.info(m),
  warn: (m: string) => app.log.warn(m),
  error: (m: unknown) => app.log.error(m),
};
void initGeo((m) => app.log.info(m));
startPoller(bgLog);
startSync(bgLog);
app.log.info(`CoastGuarrd ${config.version} is up on port ${config.port}`);
