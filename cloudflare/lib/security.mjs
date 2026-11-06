/* SPDX-License-Identifier: MIT */
import { HttpError, json, readJSON } from './http.mjs';
import {
  digest,
  randomToken,
  password,
  hashPassword,
  verifyPassword,
  limit,
  sessionCookie,
} from './auth.mjs';
const encoder = new TextEncoder();
const audit = (db, actor, action, target) =>
  db
    .prepare('INSERT INTO audit_events VALUES(?,?,?,?,?)')
    .bind(crypto.randomUUID(), actor, action, target, Date.now());
const base32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function newSecret() {
  let bits = 0,
    value = 0,
    result = '';
  for (const byte of crypto.getRandomValues(new Uint8Array(20))) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += base32[(value >>> bits) & 31];
    }
  }
  return result;
}
export async function totp(secret, step = Math.floor(Date.now() / 30000)) {
  let bits = 0,
    value = 0;
  const bytes = [];
  for (const char of secret) {
    value = (value << 5) | base32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 255);
    }
  }
  const key = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(bytes),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const counter = new ArrayBuffer(8);
  new DataView(counter).setBigUint64(0, BigInt(step));
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter)),
    i = mac[19] & 15;
  return String(
    (((mac[i] & 127) << 24) | (mac[i + 1] << 16) | (mac[i + 2] << 8) | mac[i + 3]) % 1000000,
  ).padStart(6, '0');
}
async function encryptionKey(env) {
  if (!/^[a-f0-9]{64}$/i.test(env.MFA_ENCRYPTION_KEY || ''))
    throw new HttpError(503, '请先在 Cloudflare 配置 MFA_ENCRYPTION_KEY，再启用二次验证。');
  return crypto.subtle.importKey(
    'raw',
    Uint8Array.from(env.MFA_ENCRYPTION_KEY.match(/../g), (x) => parseInt(x, 16)),
    'AES-GCM',
    false,
    ['encrypt', 'decrypt'],
  );
}
async function seal(env, userId, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: encoder.encode(userId) },
      await encryptionKey(env),
      encoder.encode(value),
    ),
  );
  return btoa(String.fromCharCode(...iv, ...data));
}
async function open(env, userId, value) {
  const key = await encryptionKey(env);
  try {
    const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: encoder.encode(userId) },
        key,
        bytes.slice(12),
      ),
    );
  } catch {
    throw new HttpError(503, '二次验证配置无法读取，请联系站点维护者。');
  }
}
async function matchedStep(secret, code) {
  if (!/^\d{6}$/.test(code || '')) return null;
  const now = Math.floor(Date.now() / 30000);
  for (const step of [now, now - 1, now + 1]) if ((await totp(secret, step)) === code) return step;
  return null;
}
export async function consumeRecovery(db, userId, code) {
  const normalized = typeof code === 'string' ? code.replace(/[-\s]/g, '').toLowerCase() : '';
  if (!/^[a-f0-9]{32}$/.test(normalized)) return false;
  const result = await db
    .prepare('DELETE FROM mfa_recovery_codes WHERE user_id=? AND code_hash=? RETURNING code_hash')
    .bind(userId, await digest(normalized))
    .first();
  return Boolean(result);
}
export async function verifySecondFactor(env, user, code) {
  const mfa = await env.DB.prepare('SELECT secret,last_step FROM admin_mfa WHERE user_id=?')
    .bind(user.id)
    .first();
  if (!mfa?.secret) return;
  if (!code) throw new HttpError(400, '请输入验证器动态码或备用恢复码。', 'MFA_REQUIRED');
  await limit(env.DB, 'mfa:' + user.id, 10, 900000);
  if (await consumeRecovery(env.DB, user.id, code)) return;
  const step = await matchedStep(await open(env, user.id, mfa.secret), code);
  if (step !== null) {
    const result = await env.DB.prepare(
      'UPDATE admin_mfa SET last_step=? WHERE user_id=? AND secret=? AND last_step<?',
    )
      .bind(step, user.id, mfa.secret, step)
      .run();
    if (result.meta.changes) return;
  }
  throw new HttpError(
    400,
    '验证码无效或已使用，请等待新动态码，或使用未用过的恢复码。',
    'MFA_INVALID',
  );
}
async function checkPassword(db, user, value) {
  await limit(db, 'security-action:' + user.id, 10, 900000);
  if (
    typeof value !== 'string' ||
    value.length > 128 ||
    !(await verifyPassword(value, user.password_hash))
  )
    throw new HttpError(400, '当前密码不正确。');
}
export async function support(db) {
  const row = await db.prepare("SELECT value FROM site_settings WHERE key='support'").first();
  return row ? JSON.parse(row.value) : { contact: '', url: '' };
}
export async function publicSecurity(path, request, env) {
  const db = env.DB;
  if (path === '/api/support' && request.method === 'GET') return json(await support(db));
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
  if (b.recoveryCode) {
    // Possession of a 128-bit offline recovery code can recover the administrator's password.
    const name = typeof b.username === 'string' ? b.username.toLowerCase() : '';
    const user = await db
      .prepare("SELECT * FROM users WHERE username=? AND role='admin' AND status='active'")
      .bind(name)
      .first();
    const recovery =
      typeof b.recoveryCode === 'string' ? b.recoveryCode.replace(/[-\s]/g, '').toLowerCase() : '';
    if (!user || !/^[a-f0-9]{32}$/.test(recovery)) throw new HttpError(400, '账号或恢复码无效。');
    const recoveryHash = await digest(recovery);
    const result = await db.batch([
      db
        .prepare(
          'UPDATE users SET password_hash=?,security_version=security_version+1 WHERE id=? AND security_version=? AND EXISTS(SELECT 1 FROM mfa_recovery_codes WHERE user_id=? AND code_hash=?)',
        )
        .bind(newHash, user.id, user.security_version, user.id, recoveryHash),
      db
        .prepare(
          'DELETE FROM admin_mfa WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=?)',
        )
        .bind(user.id, user.id, newHash),
      db
        .prepare(
          'DELETE FROM mfa_recovery_codes WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=?)',
        )
        .bind(user.id, user.id, newHash),
      db
        .prepare(
          "INSERT INTO audit_events SELECT ?,id,'password.recover',id,? FROM users WHERE id=? AND password_hash=?",
        )
        .bind(crypto.randomUUID(), Date.now(), user.id, newHash),
    ]);
    if (!result[0].meta.changes) throw new HttpError(400, '账号或恢复码无效。');
  } else {
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
  }
  return json({ message: '密码已重置，请重新登录。' }, 200, {
    'set-cookie': sessionCookie(request, '', true),
  });
}
export async function adminSecurity(path, request, env, user) {
  const db = env.DB,
    method = request.method;
  if (path === '/api/admin/support' && method === 'POST') {
    const b = await readJSON(request, 4096),
      contact = typeof b.contact === 'string' ? b.contact.trim() : '',
      url = typeof b.url === 'string' ? b.url.trim() : '';
    if (contact.length > 200 || url.length > 500) throw new HttpError(400, '联系方式过长。');
    if (url) {
      try {
        const parsed = new URL(url);
        if (
          !['http:', 'https:', 'mailto:'].includes(parsed.protocol) ||
          parsed.username ||
          parsed.password
        )
          throw Error();
      } catch {
        throw new HttpError(400, '客服链接需为 HTTP/HTTPS 或 mailto 地址。');
      }
    }
    await db.batch([
      db
        .prepare(
          "INSERT INTO site_settings VALUES('support',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .bind(JSON.stringify({ contact, url })),
      audit(db, user.id, 'support.update', 'support'),
    ]);
    return json({ ok: true });
  }
  const reset = path.match(/^\/api\/admin\/users\/([a-f0-9-]{36})\/reset-password$/);
  if (reset && method === 'POST') {
    const b = await readJSON(request, 4096);
    await checkPassword(db, user, b.password);
    await verifySecondFactor(env, user, b.code);
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
  if (!path.startsWith('/api/admin/mfa')) return null;
  if (path === '/api/admin/mfa' && method === 'GET') {
    const row = await db
      .prepare('SELECT secret FROM admin_mfa WHERE user_id=?')
      .bind(user.id)
      .first();
    const count = await db
      .prepare('SELECT COUNT(*) n FROM mfa_recovery_codes WHERE user_id=?')
      .bind(user.id)
      .first();
    return json({ enabled: Boolean(row?.secret), recoveryCodesRemaining: count.n });
  }
  if (method !== 'POST') return null;
  const b = await readJSON(request, 4096);
  await checkPassword(db, user, b.password);
  const row = await db.prepare('SELECT * FROM admin_mfa WHERE user_id=?').bind(user.id).first();
  if (path === '/api/admin/mfa/setup') {
    if (row?.secret) throw new HttpError(409, '二次验证已启用。');
    const secret = newSecret(),
      pending = await seal(env, user.id, secret);
    const saved = await db
      .prepare(
        'INSERT INTO admin_mfa(user_id,pending_secret,pending_until) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET pending_secret=excluded.pending_secret,pending_until=excluded.pending_until WHERE admin_mfa.secret IS NULL',
      )
      .bind(user.id, pending, Date.now() + 900000)
      .run();
    if (!saved.meta.changes) throw new HttpError(409, '绑定状态已变更，请刷新页面。');
    return json({ secret });
  }
  if (path === '/api/admin/mfa/enable') {
    if (row?.secret || !row?.pending_secret || row.pending_until < Date.now())
      throw new HttpError(400, '绑定已过期或已完成，请重新开始。');
    const step = await matchedStep(await open(env, user.id, row.pending_secret), b.code);
    if (step === null) throw new HttpError(400, '动态码不正确，请核对验证器和设备时间。');
    const activation = crypto.randomUUID();
    const codes = Array.from({ length: 8 }, () => randomToken().slice(0, 32));
    const result = await db.batch([
      db
        .prepare(
          'UPDATE admin_mfa SET secret=pending_secret,pending_secret=NULL,pending_until=NULL,last_step=?,activation_id=? WHERE user_id=? AND secret IS NULL AND pending_secret=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND security_version=?) RETURNING secret',
        )
        .bind(step, activation, user.id, row.pending_secret, user.id, user.security_version),
      db
        .prepare(
          'UPDATE users SET security_version=security_version+1 WHERE id=? AND EXISTS(SELECT 1 FROM admin_mfa WHERE user_id=? AND activation_id=?)',
        )
        .bind(user.id, user.id, activation),
      ...(await Promise.all(
        codes.map(async (code) =>
          db
            .prepare(
              'INSERT INTO mfa_recovery_codes SELECT ?,? WHERE EXISTS(SELECT 1 FROM admin_mfa WHERE user_id=? AND activation_id=?)',
            )
            .bind(user.id, await digest(code), user.id, activation),
        ),
      )),
      audit(db, user.id, 'mfa.enable', user.id),
    ]);
    if (!result[0].meta.changes) throw new HttpError(409, '绑定状态已变更，请重新登录。');
    return json({ recoveryCodes: codes.map((c) => c.match(/.{8}/g).join('-')) }, 200, {
      'set-cookie': sessionCookie(request, '', true),
    });
  }
  if (path === '/api/admin/mfa/disable') {
    if (!row?.secret) throw new HttpError(400, '二次验证尚未启用。');
    await verifySecondFactor(env, user, b.code);
    const result = await db.batch([
      db
        .prepare(
          'DELETE FROM admin_mfa WHERE user_id=? AND secret=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND security_version=?)',
        )
        .bind(user.id, row.secret, user.id, user.security_version),
      db
        .prepare(
          'DELETE FROM mfa_recovery_codes WHERE user_id=? AND NOT EXISTS(SELECT 1 FROM admin_mfa WHERE user_id=?)',
        )
        .bind(user.id, user.id),
      db
        .prepare(
          'UPDATE users SET security_version=security_version+1 WHERE id=? AND security_version=? AND NOT EXISTS(SELECT 1 FROM admin_mfa WHERE user_id=?)',
        )
        .bind(user.id, user.security_version, user.id),
      audit(db, user.id, 'mfa.disable', user.id),
    ]);
    if (!result[0].meta.changes) throw new HttpError(409, '安全设置已变更，请重新登录。');
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(request, '', true) });
  }
  return null;
}
