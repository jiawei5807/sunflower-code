/* SPDX-License-Identifier: MIT */
import { HttpError, json, readJSON } from './http.mjs';
import { support, supportImage, saveSupport } from './support.mjs';
import {
  digest,
  randomToken,
  password,
  hashPassword,
  verifyPassword,
  limit,
  sessionCookie,
} from './auth.mjs';
const audit = (db, actor, action, target) =>
  db
    .prepare('INSERT INTO audit_events VALUES(?,?,?,?,?)')
    .bind(crypto.randomUUID(), actor, action, target, Date.now());
async function checkPassword(db, user, value) {
  await limit(db, 'security-action:' + user.id, 10, 900000);
  if (
    typeof value !== 'string' ||
    value.length > 128 ||
    !(await verifyPassword(value, user.password_hash))
  )
    throw new HttpError(400, '当前密码不正确。');
}
export async function publicSecurity(path, request, env) {
  const db = env.DB;
  if (path === '/api/support' && request.method === 'GET') return json(await support(env.IMAGES));
  if (path === '/api/support/image' && ['GET', 'HEAD'].includes(request.method))
    return supportImage(request, env.IMAGES);
  if (path !== '/api/auth/reset' || request.method !== 'POST') return null;
  const b = await readJSON(request, 4096),
    now = Date.now();
  password(b.password);
  await limit(
    db,
    'reset-ip:' + (await digest(request.headers.get('cf-connecting-ip') || 'local')),
    20,
    900000,
  );
  const newHash = await hashPassword(b.password);
  if (!/^[a-f0-9]{64}$/.test(b.token || ''))
    throw new HttpError(400, '重置链接无效、已使用或已过期。');
  const tokenHash = await digest(b.token);
  const result = await db.batch([
    db
      .prepare(
        "UPDATE users SET password_hash=?,security_version=security_version+1 WHERE role='user' AND status='active' AND EXISTS(SELECT 1 FROM password_resets r WHERE r.user_id=users.id AND r.token_hash=? AND r.used_at IS NULL AND r.expires_at>? AND r.security_version=users.security_version)",
      )
      .bind(newHash, tokenHash, now),
    db
      .prepare(
        'UPDATE password_resets SET used_at=? WHERE token_hash=? AND EXISTS(SELECT 1 FROM users u WHERE u.id=password_resets.user_id AND u.password_hash=? AND u.security_version=password_resets.security_version+1)',
      )
      .bind(now, tokenHash, newHash),
    db
      .prepare(
        "INSERT INTO audit_events SELECT ?,u.id,'password.reset',u.id,? FROM users u JOIN password_resets r ON r.user_id=u.id WHERE r.token_hash=? AND u.password_hash=? AND r.used_at=?",
      )
      .bind(crypto.randomUUID(), now, tokenHash, newHash, now),
  ]);
  if (!result[0].meta.changes) throw new HttpError(400, '重置链接无效、已使用或已过期。');
  return json({ message: '密码已重置，请重新登录。' }, 200, {
    'set-cookie': sessionCookie(request, '', true),
  });
}
export async function adminSecurity(path, request, env, user) {
  const db = env.DB,
    method = request.method;
  if (path === '/api/admin/support' && method === 'POST') return saveSupport(request, env, user);
  const reset = path.match(/^\/api\/admin\/users\/([a-f0-9-]{36})\/reset-password$/);
  if (reset && method === 'POST') {
    const b = await readJSON(request, 4096);
    await checkPassword(db, user, b.password);
    const target = await db
      .prepare(
        "SELECT id,security_version FROM users WHERE id=? AND role='user' AND status='active'",
      )
      .bind(reset[1])
      .first();
    if (!target) throw new HttpError(400, '只能重置正常用户的密码；停用账号请先启用。');
    const token = randomToken(),
      expiresAt = Date.now() + 1800000;
    await db.batch([
      db
        .prepare(
          'INSERT INTO password_resets(user_id,token_hash,security_version,expires_at,used_at) VALUES(?,?,?,?,NULL) ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,security_version=excluded.security_version,expires_at=excluded.expires_at,used_at=NULL',
        )
        .bind(target.id, await digest(token), target.security_version, expiresAt),
      audit(db, user.id, 'password.reset.issue', target.id),
    ]);
    return json({ url: new URL(request.url).origin + '/reset-password#token=' + token, expiresAt });
  }
  return null;
}
