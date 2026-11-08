CREATE TABLE admin_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_login_at TEXT,
  disabled_at TEXT
);

CREATE TABLE admin_sessions (
  session_id TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  session_data TEXT NOT NULL CHECK (json_valid(session_data))
);

CREATE INDEX admin_sessions_expiry_idx ON admin_sessions (expires_at);
