ALTER TABLE users ADD COLUMN security_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN security_version INTEGER NOT NULL DEFAULT 0;
CREATE TABLE password_resets (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  security_version INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE TABLE site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
