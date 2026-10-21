import path from 'node:path';

/**
 * Runtime configuration. Everything here comes from environment variables so
 * nothing about a specific install is ever baked into the code. All
 * service addresses, keys and paths are entered in the web UI and stored in
 * the encrypted database instead.
 */
export const config = {
  /** Port the web UI listens on inside the container. */
  port: Number(process.env.CG_PORT ?? 8787),
  /** Interface to bind to. */
  host: process.env.CG_HOST ?? '0.0.0.0',
  /** Folder that holds the database, key file and poster backups. */
  dataDir: path.resolve(process.env.CG_DATA_DIR ?? '/config'),
  /** Optional database key. If unset a random key is generated and saved in dataDir. */
  dbKey: process.env.CG_DB_KEY ?? '',
  /** Folder with the built web UI. */
  webDir: path.resolve(process.env.CG_WEB_DIR ?? path.join(process.cwd(), 'public')),
  /** Folder where media is mounted inside the container (used for folder pickers). */
  mediaRoot: path.resolve(process.env.CG_MEDIA_ROOT ?? '/media'),
  logLevel: process.env.CG_LOG_LEVEL ?? 'info',
  version: process.env.CG_VERSION ?? '0.1.0-dev',
};
