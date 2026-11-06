import { HttpError, publicUser } from './http.mjs';
const encoder = new TextEncoder();
export const randomToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
export async function digest(value) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
export function username(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_]{3,32}$/.test(value))
    throw new HttpError(400, '账号需为 3～32 位字母、数字或下划线。');
  return value.toLowerCase();
}
export function password(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128)
    throw new HttpError(400, '密码需为 12～128 位。');
  return value;
}
async function derive(value, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(value), 'PBKDF2', false, [
    'deriveBits',
  ]);
  return Array.from(
    new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations: 100000 },
        key,
        256,
      ),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
export async function hashPassword(value) {
  const salt = randomToken();
  return `pbkdf2-sha256$100000$${salt}$${await derive(value, salt)}`;
}
export async function verifyPassword(value, stored) {
  const [kind, rounds, salt, expected] = stored.split('$');
  if (kind !== 'pbkdf2-sha256' || rounds !== '100000') return false;
  const actual = await derive(value, salt);
  let diff = actual.length ^ expected.length;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
const cookieName = (request) =>
  new URL(request.url).protocol === 'https:' ? '__Host-sunflower' : 'sunflower_local';
export function sessionCookie(request, token, clear = false) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${cookieName(request)}=${clear ? '' : token}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${clear ? 0 : 604800}`;
}
export function readCookie(request) {
  return (
    (request.headers.get('cookie') || '')
      .split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith(cookieName(request) + '='))
      ?.split('=')[1] || ''
  );
}
export async function getUser(request, db) {
  const token = readCookie(request);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return db
    .prepare(
      `SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>? AND u.status='active' AND s.security_version=u.security_version`,
    )
    .bind(await digest(token), Date.now())
    .first();
}
export async function requireUser(request, db, admin = false) {
  const user = await getUser(request, db);
  if (!user) throw new HttpError(401, '登录已失效，请重新登录。');
  if (admin && user.role !== 'admin') throw new HttpError(403, '没有管理权限。');
  return user;
}
export async function limit(db, key, max, windowMs) {
  const now = Date.now();
  const row = await db
    .prepare(
      `INSERT INTO rate_limits(key,hits,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN expires_at<=? THEN 1 ELSE hits+1 END,expires_at=CASE WHEN expires_at<=? THEN ? ELSE expires_at END RETURNING hits`,
    )
    .bind(key, now + windowMs, now, now, now + windowMs)
    .first();
  if (row.hits > max) throw new HttpError(429, '请求过于频繁，请稍后重试。');
  await db
    .prepare(
      'DELETE FROM rate_limits WHERE key IN (SELECT key FROM rate_limits WHERE expires_at<? LIMIT 50)',
    )
    .bind(now)
    .run();
}
export async function initializeAdmin(env, loginName) {
  if (!env.ADMIN_PASSWORD || loginName !== (env.ADMIN_USERNAME || 'admin').toLowerCase()) return;
  if (await env.DB.prepare("SELECT id FROM users WHERE role='admin'").first()) return;
  const name = username(env.ADMIN_USERNAME || 'admin'),
    hash = await hashPassword(password(env.ADMIN_PASSWORD));
  await env.DB.prepare(
    "INSERT OR IGNORE INTO users(id,username,password_hash,role,created_at) VALUES(?,?,?,'admin',?)",
  )
    .bind(crypto.randomUUID(), name, hash, Date.now())
    .run();
}
export async function newSession(db, user, request) {
  const token = randomToken(),
    now = Date.now();
  await db.batch([
    db
      .prepare(
        'INSERT INTO sessions(token_hash,user_id,created_at,expires_at,security_version) VALUES(?,?,?,?,?)',
      )
      .bind(await digest(token), user.id, now, now + 604800000, user.security_version),
    db.prepare('UPDATE users SET last_login_at=? WHERE id=?').bind(now, user.id),
    db.prepare('DELETE FROM sessions WHERE expires_at<?').bind(now),
  ]);
  return {
    user: publicUser({ ...user, last_login_at: now }),
    cookie: sessionCookie(request, token),
  };
}
