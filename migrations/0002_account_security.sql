ALTER TABLE users ADD COLUMN security_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN security_version INTEGER NOT NULL DEFAULT 0;
CREATE TABLE password_resets (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  security_version INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE TABLE admin_mfa (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  secret TEXT,
  pending_secret TEXT,
  pending_until INTEGER,
  activation_id TEXT,
  last_step INTEGER NOT NULL DEFAULT -1
);
CREATE TABLE mfa_recovery_codes (
  user_id TEXT NOT NULL REFERENCES users(id),
  code_hash TEXT NOT NULL,
  PRIMARY KEY(user_id,code_hash)
);
CREATE TABLE site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
