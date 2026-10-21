/**
 * Database schema history. New versions are only ever appended to this list;
 * existing entries must never be edited once released.
 */
export const migrations: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE users (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        username       TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash  TEXT NOT NULL,
        role           TEXT NOT NULL DEFAULT 'admin',
        totp_secret    TEXT,
        totp_enabled   INTEGER NOT NULL DEFAULT 0,
        totp_last_step INTEGER,
        created_at     INTEGER NOT NULL,
        last_login_at  INTEGER,
        last_login_ip  TEXT
      );

      CREATE TABLE sessions (
        id           TEXT PRIMARY KEY,          -- sha256 of the cookie token
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at   INTEGER NOT NULL,
        expires_at   INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        ip           TEXT,
        user_agent   TEXT,
        remember     INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_sessions_user ON sessions(user_id);

      CREATE TABLE login_challenges (
        id         TEXT PRIMARY KEY,            -- sha256 of challenge token
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        remember   INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER NOT NULL,
        attempts   INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE login_attempts (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        at       INTEGER NOT NULL,
        ip       TEXT NOT NULL,
        username TEXT,
        success  INTEGER NOT NULL,
        reason   TEXT
      );
      CREATE INDEX idx_login_attempts_ip ON login_attempts(ip, at);
      CREATE INDEX idx_login_attempts_user ON login_attempts(username, at);

      CREATE TABLE services (
        id       TEXT PRIMARY KEY,              -- jellyfin | seerr | radarr | sonarr | lidarr
        enabled  INTEGER NOT NULL DEFAULT 0,
        url      TEXT NOT NULL DEFAULT '',
        api_key  TEXT NOT NULL DEFAULT '',
        extra    TEXT NOT NULL DEFAULT '{}',
        last_ok_at   INTEGER,
        last_error   TEXT,
        version      TEXT
      );

      CREATE TABLE library_folders (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        service     TEXT NOT NULL,              -- which app reports this folder
        remote_path TEXT NOT NULL,              -- path as that app sees it
        local_path  TEXT NOT NULL,              -- path as CoastGuarrd sees it
        recycle_path TEXT NOT NULL DEFAULT '',  -- recycle bin on the same drive
        UNIQUE(service, remote_path)
      );

      CREATE TABLE audit_log (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        at      INTEGER NOT NULL,
        user_id INTEGER,
        ip      TEXT,
        action  TEXT NOT NULL,
        detail  TEXT
      );
      CREATE INDEX idx_audit_at ON audit_log(at);
    `,
  },
];
