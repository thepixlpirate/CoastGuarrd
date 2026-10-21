import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3-multiple-ciphers';
import { config } from '../config.js';
import { migrations } from './migrations.js';

export type DB = Database.Database;

let db: DB | null = null;

/**
 * Returns the database encryption key. Priority:
 *   1. CG_DB_KEY environment variable
 *   2. a key file in the data folder (created automatically on first run)
 */
function loadKey(): string {
  if (config.dbKey) return config.dbKey;
  const keyFile = path.join(config.dataDir, '.dbkey');
  if (fs.existsSync(keyFile)) return fs.readFileSync(keyFile, 'utf8').trim();
  const key = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(keyFile, key + '\n', { mode: 0o600 });
  return key;
}

export function openDb(): DB {
  if (db) return db;
  fs.mkdirSync(config.dataDir, { recursive: true });
  const file = path.join(config.dataDir, 'coastguarrd.db');
  const key = loadKey();

  const instance = new Database(file);
  // SQLCipher v4 compatible encryption of the whole database file.
  instance.pragma(`cipher='sqlcipher'`);
  instance.pragma(`legacy=4`);
  instance.pragma(`key='${key.replace(/'/g, "''")}'`);

  try {
    // Fails here if the key is wrong.
    instance.prepare('SELECT count(*) FROM sqlite_master').get();
  } catch {
    instance.close();
    throw new Error(
      'Could not unlock the database. The encryption key does not match. ' +
        'If you set CG_DB_KEY, make sure it is the same value used when the database was created.',
    );
  }

  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');
  instance.pragma('busy_timeout = 5000');
  migrate(instance);
  db = instance;
  return db;
}

export function getDb(): DB {
  if (!db) throw new Error('Database not opened');
  return db;
}

function migrate(instance: DB) {
  instance.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`);
  const row = instance.prepare('SELECT version FROM schema_version LIMIT 1').get() as
    | { version: number }
    | undefined;
  let current = row?.version ?? 0;
  if (!row) instance.prepare('INSERT INTO schema_version (version) VALUES (0)').run();

  for (const m of migrations) {
    if (m.version <= current) continue;
    const run = instance.transaction(() => {
      instance.exec(m.sql);
      instance.prepare('UPDATE schema_version SET version = ?').run(m.version);
    });
    run();
    current = m.version;
  }
}
