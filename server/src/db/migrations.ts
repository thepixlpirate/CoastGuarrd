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
  {
    version: 2,
    sql: `
      -- Small key/value store for sync cursors and job state.
      CREATE TABLE state (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      -- People who use the media server (Jellyfin accounts).
      CREATE TABLE media_users (
        id                TEXT PRIMARY KEY,      -- Jellyfin user id
        name              TEXT NOT NULL,
        is_admin          INTEGER NOT NULL DEFAULT 0,
        is_disabled       INTEGER NOT NULL DEFAULT 0,
        image_tag         TEXT,
        last_login_at     INTEGER,
        last_activity_at  INTEGER,
        seerr_user_id     INTEGER,
        seerr_name        TEXT,
        email             TEXT,
        stream_limit      INTEGER,               -- overrides the global limit
        notes             TEXT NOT NULL DEFAULT '',
        first_seen_at     INTEGER NOT NULL,
        removed           INTEGER NOT NULL DEFAULT 0
      );

      -- One row per time someone watched or listened to something.
      CREATE TABLE plays (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        session_key     TEXT,
        jf_session_id   TEXT,
        user_id         TEXT NOT NULL,
        user_name       TEXT NOT NULL,
        item_id         TEXT NOT NULL,
        item_type       TEXT NOT NULL,
        item_name       TEXT NOT NULL,
        series_id       TEXT,
        series_name     TEXT,
        season_number   INTEGER,
        episode_number  INTEGER,
        year            INTEGER,
        runtime_ms      INTEGER,
        started_at      INTEGER NOT NULL,
        last_seen_at    INTEGER NOT NULL,
        stopped_at      INTEGER,
        position_ms     INTEGER NOT NULL DEFAULT 0,
        watched_ms      INTEGER NOT NULL DEFAULT 0,
        paused_ms       INTEGER NOT NULL DEFAULT 0,
        pause_count     INTEGER NOT NULL DEFAULT 0,
        play_method     TEXT,
        transcode_video INTEGER NOT NULL DEFAULT 0,
        transcode_audio INTEGER NOT NULL DEFAULT 0,
        transcode_reasons TEXT,
        video_codec     TEXT,
        audio_codec     TEXT,
        resolution      TEXT,
        bitrate         INTEGER,
        container       TEXT,
        client          TEXT,
        client_version  TEXT,
        device_name     TEXT,
        device_id       TEXT,
        ip              TEXT,
        is_local        INTEGER NOT NULL DEFAULT 0,
        country         TEXT,
        country_code    TEXT,
        region          TEXT,
        city            TEXT,
        lat             REAL,
        lon             REAL,
        source          TEXT NOT NULL DEFAULT 'live',
        completed       INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_plays_user ON plays(user_id, started_at);
      CREATE INDEX idx_plays_started ON plays(started_at);
      CREATE INDEX idx_plays_item ON plays(item_id);
      CREATE INDEX idx_plays_series ON plays(series_id);
      CREATE INDEX idx_plays_open ON plays(stopped_at);
      CREATE UNIQUE INDEX idx_plays_import ON plays(source, user_id, item_id, started_at) WHERE source != 'live';

      -- Sign-ins and session starts read from Jellyfin's activity log.
      CREATE TABLE sign_ins (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        log_id       INTEGER UNIQUE,
        at           INTEGER NOT NULL,
        kind         TEXT NOT NULL,              -- signin | failed | session
        user_id      TEXT,
        user_name    TEXT,
        ip           TEXT,
        is_local     INTEGER NOT NULL DEFAULT 0,
        device_name  TEXT,
        country      TEXT,
        country_code TEXT,
        city         TEXT,
        lat          REAL,
        lon          REAL,
        detail       TEXT
      );
      CREATE INDEX idx_sign_ins_user ON sign_ins(user_id, at);
      CREATE INDEX idx_sign_ins_at ON sign_ins(at);

      -- Every device each person has used.
      CREATE TABLE devices (
        device_id      TEXT NOT NULL,
        user_id        TEXT NOT NULL,
        name           TEXT,
        client         TEXT,
        client_version TEXT,
        first_seen_at  INTEGER NOT NULL,
        last_seen_at   INTEGER NOT NULL,
        last_ip        TEXT,
        PRIMARY KEY (device_id, user_id)
      );

      -- Every internet address each person has connected from.
      CREATE TABLE user_ips (
        user_id       TEXT NOT NULL,
        ip            TEXT NOT NULL,
        first_seen_at INTEGER NOT NULL,
        last_seen_at  INTEGER NOT NULL,
        times         INTEGER NOT NULL DEFAULT 1,
        is_local      INTEGER NOT NULL DEFAULT 0,
        country       TEXT,
        country_code  TEXT,
        region        TEXT,
        city          TEXT,
        lat           REAL,
        lon           REAL,
        PRIMARY KEY (user_id, ip)
      );

      CREATE TABLE alerts (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        at              INTEGER NOT NULL,
        user_id         TEXT,
        user_name       TEXT,
        rule            TEXT NOT NULL,
        severity        TEXT NOT NULL,           -- info | warning | critical
        title           TEXT NOT NULL,
        detail          TEXT,
        dedupe_key      TEXT,
        play_id         INTEGER,
        acknowledged_at INTEGER,
        acknowledged_by INTEGER,
        dismissed       INTEGER NOT NULL DEFAULT 0   -- marked "not a problem"
      );
      CREATE INDEX idx_alerts_at ON alerts(at);
      CREATE INDEX idx_alerts_user ON alerts(user_id, at);
      CREATE INDEX idx_alerts_dedupe ON alerts(dedupe_key, at);

      -- Requests made in Seerr.
      CREATE TABLE requests (
        id                 INTEGER PRIMARY KEY,  -- Seerr request id
        type               TEXT NOT NULL,        -- movie | tv
        status             INTEGER NOT NULL,
        media_status       INTEGER,
        tmdb_id            INTEGER,
        tvdb_id            INTEGER,
        jellyfin_media_id  TEXT,
        requested_by_seerr INTEGER,
        requested_by_name  TEXT,
        requested_by_jf    TEXT,
        is4k               INTEGER NOT NULL DEFAULT 0,
        seasons            TEXT,
        created_at         INTEGER NOT NULL,
        updated_at         INTEGER
      );
      CREATE INDEX idx_requests_user ON requests(requested_by_jf);
      CREATE INDEX idx_requests_jf ON requests(jellyfin_media_id);

      -- Titles and posters looked up from Seerr for each requested movie/show.
      CREATE TABLE seerr_media (
        key        TEXT PRIMARY KEY,             -- movie:123 or tv:456
        title      TEXT,
        year       INTEGER,
        poster     TEXT,
        fetched_at INTEGER NOT NULL
      );
    `,
  },
  {
    version: 3,
    sql: `
      ALTER TABLE plays ADD COLUMN artist_name TEXT;

      -- Everything in the library, merged from Jellyfin and Radarr/Sonarr/Lidarr.
      CREATE TABLE media_items (
        key            TEXT PRIMARY KEY,         -- jf:<id> or radarr:<id> etc.
        kind           TEXT NOT NULL,            -- movie | show | music
        jf_id          TEXT,
        title          TEXT NOT NULL,
        sort_title     TEXT,
        year           INTEGER,
        library        TEXT,
        path           TEXT,                     -- as the source app sees it
        path_service   TEXT,                     -- which app reported the path
        size_bytes     INTEGER,
        size_checked_at INTEGER,
        added_at       INTEGER,
        tmdb_id        INTEGER,
        tvdb_id        INTEGER,
        imdb_id        TEXT,
        genres         TEXT NOT NULL DEFAULT '[]',
        tags           TEXT NOT NULL DEFAULT '[]',
        rating         REAL,
        official_rating TEXT,
        ended          INTEGER,
        arr_service    TEXT,
        arr_id         INTEGER,
        arr_monitored  INTEGER,
        favorite_of    TEXT NOT NULL DEFAULT '[]',
        seen_at        INTEGER NOT NULL
      );
      CREATE INDEX idx_media_jf ON media_items(jf_id);
      CREATE INDEX idx_media_arr ON media_items(arr_service, arr_id);

      CREATE TABLE cleanup_rules (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        enabled    INTEGER NOT NULL DEFAULT 1,
        kind       TEXT NOT NULL,
        config     TEXT NOT NULL,                -- JSON: libraries, match, conditions, graceDays, reason
        position   INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Titles currently marked for removal.
      CREATE TABLE flags (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        item_key      TEXT NOT NULL UNIQUE,
        rule_id       INTEGER,
        rule_name     TEXT,
        reason        TEXT,                      -- banner wording, e.g. "due to not being watched"
        detail        TEXT,                      -- JSON: why it matched
        flagged_at    INTEGER NOT NULL,
        delete_at     INTEGER NOT NULL,
        preview       INTEGER NOT NULL DEFAULT 1,
        poster_days   INTEGER,                   -- days shown on the current banner
        in_collection INTEGER NOT NULL DEFAULT 0,
        notified      INTEGER NOT NULL DEFAULT 0,
        last_error    TEXT
      );

      -- Titles that must never be (or not yet be) flagged.
      CREATE TABLE exclusions (
        item_key   TEXT PRIMARY KEY,
        title      TEXT,
        until      INTEGER,                      -- NULL = forever
        reason     TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE recycle_bin (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        item_key       TEXT,
        jf_id          TEXT,
        kind           TEXT NOT NULL,
        title          TEXT NOT NULL,
        year           INTEGER,
        original_path  TEXT NOT NULL,            -- inside the container
        recycle_path   TEXT NOT NULL,
        size_bytes     INTEGER,
        moved_at       INTEGER NOT NULL,
        rule_name      TEXT,
        arr_service    TEXT,
        arr_id         INTEGER,
        was_monitored  INTEGER,
        tmdb_id        INTEGER,
        tvdb_id        INTEGER,
        poster_backup  TEXT,
        status         TEXT NOT NULL DEFAULT 'in_bin',  -- in_bin | restored | deleted
        finished_at    INTEGER,
        note           TEXT
      );
      CREATE INDEX idx_bin_status ON recycle_bin(status, moved_at);

      -- "Please keep this" requests from the family page.
      CREATE TABLE keep_requests (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        item_key  TEXT NOT NULL,
        title     TEXT,
        name      TEXT NOT NULL,
        message   TEXT,
        ip        TEXT,
        at        INTEGER NOT NULL,
        status    TEXT NOT NULL DEFAULT 'pending'   -- pending | approved | declined
      );

      -- What happened to each title (flagged, kept, moved, restored, deleted).
      CREATE TABLE cleanup_log (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        at       INTEGER NOT NULL,
        item_key TEXT,
        title    TEXT,
        action   TEXT NOT NULL,
        detail   TEXT
      );
      CREATE INDEX idx_cleanup_log_at ON cleanup_log(at);
    `,
  },
];
