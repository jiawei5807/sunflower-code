PRAGMA foreign_keys = ON;
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  invite_id TEXT UNIQUE REFERENCES invites(id),
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE UNIQUE INDEX one_initial_admin ON users(role) WHERE role='admin';
CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_by TEXT REFERENCES users(id),
  used_at INTEGER,
  revoked_at INTEGER
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE generations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  request_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  original_url TEXT NOT NULL,
  encoded_url TEXT,
  source TEXT NOT NULL CHECK(source IN ('link','qr')),
  state TEXT NOT NULL CHECK(state IN ('pending','ready','failed')),
  object_key TEXT,
  size INTEGER,
  rays INTEGER,
  level TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE(user_id,request_key)
);
CREATE INDEX generations_user_ready ON generations(user_id,state,created_at DESC);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target_id TEXT,
  created_at INTEGER NOT NULL
);
