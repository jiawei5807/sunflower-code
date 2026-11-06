/* SPDX-License-Identifier: MIT */
import { HttpError, json, readJSON, sameOrigin, pageNumber, publicUser } from './lib/http.mjs';
import {
  username,
  password,
  hashPassword,
  verifyPassword,
  digest,
  randomToken,
  getUser,
  requireUser,
  initializeAdmin,
  newSession,
  readCookie,
  sessionCookie,
  limit,
} from './lib/auth.mjs';
import { generate, historyItem, validateAppearance } from './lib/generation.mjs';
import { publicSecurity, adminSecurity } from './lib/security.mjs';
const codec = globalThis.SunflowerCode;
const audit = (db, user, action, target) =>
  db
    .prepare('INSERT INTO audit_events VALUES(?,?,?,?,?)')
    .bind(crypto.randomUUID(), user.id, action, target, Date.now());
export function createWorker() {
  return {
    async fetch(request, env) {
      const url = new URL(request.url),
        path = url.pathname,
        method = request.method;
      try {
        if (path.startsWith('/api/')) {
          if (!env.DB || !env.IMAGES)
            throw new HttpError(503, '站点尚未配置数据库或图片存储，请联系管理员。');
          if (!['GET', 'HEAD'].includes(method)) sameOrigin(request);
          const db = env.DB,
            now = Date.now();
          const publicResult = await publicSecurity(path, request, env);
          if (publicResult) return publicResult;
          if (path === '/api/auth/login' && method === 'POST') {
            const b = await readJSON(request, 4096),
              name = username(b.username);
            password(b.password);
            await limit(
              db,
              'login-ip:' + (await digest(request.headers.get('cf-connecting-ip') || 'local')),
              20,
              900000,
            );
            await limit(db, 'login-user:' + name, 10, 900000);
            await initializeAdmin(env, name);
            const user = await db
              .prepare('SELECT * FROM users WHERE username=?')
              .bind(name)
              .first();
            const valid = await verifyPassword(
              b.password,
              user?.password_hash ||
                'pbkdf2-sha256$100000$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000',
            );
            if (!user || !valid || user.status !== 'active')
              throw new HttpError(401, '账号或密码错误，或账号已停用。');
            const session = await newSession(db, user, request);
            return json({ user: session.user }, 200, { 'set-cookie': session.cookie });
          }
          if (path === '/api/auth/register' && method === 'POST') {
            const b = await readJSON(request, 4096),
              name = username(b.username);
            password(b.password);
            await limit(
              db,
              'register:' + (await digest(request.headers.get('cf-connecting-ip') || 'local')),
              20,
              3600000,
            );
            if (typeof b.invite !== 'string' || !/^[a-f0-9]{64}$/.test(b.invite))
              throw new HttpError(400, '邀请链接无效。');
            const inviteHash = await digest(b.invite),
              id = crypto.randomUUID(),
              hash = await hashPassword(b.password);
            let results;
            try {
              results = await db.batch([
                db
                  .prepare(
                    'INSERT INTO users(id,username,password_hash,invite_id,created_at) SELECT ?,?,?,id,? FROM invites WHERE token_hash=? AND used_by IS NULL AND revoked_at IS NULL AND expires_at>?',
                  )
                  .bind(id, name, hash, now, inviteHash, now),
                db
                  .prepare(
                    'UPDATE invites SET used_by=?,used_at=? WHERE token_hash=? AND used_by IS NULL AND EXISTS(SELECT 1 FROM users WHERE id=?)',
                  )
                  .bind(id, now, inviteHash, id),
              ]);
            } catch {
              throw new HttpError(409, '账号已存在，或邀请已被使用。');
            }
            if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1)
              throw new HttpError(400, '邀请码已使用、已撤销或已过期，请联系管理员。');
            return json({ message: '注册成功，请登录。' }, 201);
          }
          if (path === '/api/auth/me' && method === 'GET') {
            const user = await requireUser(request, db);
            return json({ user: publicUser(user) });
          }
          if (path === '/api/auth/logout' && method === 'POST') {
            await db
              .prepare('DELETE FROM sessions WHERE token_hash=?')
              .bind(await digest(readCookie(request)))
              .run();
            return json({ ok: true }, 200, { 'set-cookie': sessionCookie(request, '', true) });
          }
          const user = await requireUser(request, db, path.startsWith('/api/admin/'));
          if (path.startsWith('/api/admin/')) {
            const result = await adminSecurity(path, request, env, user);
            if (result) return result;
          }
          if (path === '/api/auth/password' && method === 'POST') {
            const b = await readJSON(request, 4096);
            password(b.password);
            await limit(db, 'password:' + user.id, 5, 900000);
            if (
              typeof b.current !== 'string' ||
              b.current.length > 128 ||
              !(await verifyPassword(b.current, user.password_hash))
            )
              throw new HttpError(400, '当前密码不正确。');
            const updated = await db.batch([
              db
                .prepare(
                  'UPDATE users SET password_hash=?,security_version=security_version+1 WHERE id=? AND security_version=?',
                )
                .bind(await hashPassword(b.password), user.id, user.security_version),
              db.prepare('DELETE FROM sessions WHERE user_id=?').bind(user.id),
              audit(db, user, 'password.change', user.id),
            ]);
            if (!updated[0].meta.changes)
              throw new HttpError(409, '账号安全设置已变更，请重新登录。');
            return json({ message: '密码已更新，请重新登录。' }, 200, {
              'set-cookie': sessionCookie(request, '', true),
            });
          }
          if (path === '/api/shortener/config' && method === 'POST') {
            await readJSON(request, 4096);
            await limit(db, 'shortener-config:' + user.id, 30, 60000);
            const token = env.ACEDATA_TOKEN?.trim();
            if (!token) throw new HttpError(503, '转链服务未配置，请联系管理员。');
            // Browser direct calls necessarily expose this credential to signed-in users.
            return json({ token });
          }
          if (path === '/api/generate' && method === 'POST') {
            return json(await generate(env, user, await readJSON(request), request), 201);
          }
          if (path === '/api/history' && method === 'GET')
            return json(await listHistory(db, user.id, url));
          const adminHistory = path.match(
            /^\/api\/admin\/users\/([a-f0-9-]{36})\/history(?:\/([a-f0-9-]{36})\/image)?$/,
          );
          if (adminHistory && method === 'GET') {
            const ownerId = adminHistory[1];
            if (adminHistory[2]) {
              const row = await db
                .prepare("SELECT * FROM generations WHERE id=? AND user_id=? AND state='ready'")
                .bind(adminHistory[2], ownerId)
                .first();
              if (!row) throw new HttpError(404, '记录不存在。');
              return await historyImage(env.IMAGES, row, url);
            }
            const owner = await db
              .prepare(
                'SELECT id,username,role,status,created_at,last_login_at FROM users WHERE id=?',
              )
              .bind(ownerId)
              .first();
            if (!owner) throw new HttpError(404, '账号不存在。');
            const history = await listHistory(db, ownerId, url);
            return json({
              ...history,
              user: publicUser(owner),
              items: history.items.map((item) => ({
                ...item,
                imageUrl: `/api/admin/users/${ownerId}/history/${item.id}/image`,
              })),
            });
          }
          const item = path.match(/^\/api\/history\/([a-f0-9-]{36})\/(image|appearance)$/);
          if (item) {
            const row = await db
              .prepare("SELECT * FROM generations WHERE id=? AND user_id=? AND state='ready'")
              .bind(item[1], user.id)
              .first();
            if (!row) throw new HttpError(404, '记录不存在。');
            if (item[2] === 'image' && method === 'GET')
              return await historyImage(env.IMAGES, row, url);
            if (item[2] === 'appearance' && method === 'POST') {
              await limit(db, 'appearance:' + user.id, 60, 60000);
              const b = await readJSON(request),
                appearance = validateAppearance(b);
              const encoded = codec.encode(row.encoded_url, {
                  version: [36, 54, 72].indexOf(row.rays),
                  level: row.level,
                }),
                svg = codec.renderSvg(encoded, appearance),
                objectKey = `users/${user.id}/${row.id}-${crypto.randomUUID()}.svg`;
              await env.IMAGES.put(objectKey, svg, {
                httpMetadata: { contentType: 'image/svg+xml' },
              });
              let changed;
              try {
                changed = await db
                  .prepare(
                    'UPDATE generations SET object_key=?,size=? WHERE id=? AND object_key=? RETURNING *',
                  )
                  .bind(objectKey, appearance.size, row.id, row.object_key)
                  .first();
              } catch {
                const latest = await db
                  .prepare('SELECT object_key FROM generations WHERE id=?')
                  .bind(row.id)
                  .first();
                if (latest?.object_key !== objectKey)
                  await env.IMAGES.delete(objectKey).catch(() => {});
                throw new HttpError(503, '图片更新状态未确认，请刷新历史记录。');
              }
              if (!changed) {
                await env.IMAGES.delete(objectKey).catch(() => {});
                throw new HttpError(409, '图片已被其他操作更新，请刷新历史记录。');
              }
              await env.IMAGES.delete(row.object_key).catch(() => {});
              return json({ ...historyItem(changed), svg });
            }
          }
          if (path === '/api/admin/users' && method === 'GET') {
            const page = pageNumber(url),
              query = (url.searchParams.get('q') || '').slice(0, 32),
              day = now - ((now + 8 * 3600000) % 86400000);
            const from = Number(url.searchParams.get('from')) || 0,
              to = Number(url.searchParams.get('to')) || now + 1;
            if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to)
              throw new HttpError(400, '开始日期不能晚于结束日期。');
            const rows = await db
              .prepare(
                `SELECT u.id,u.username,u.role,u.status,u.created_at,u.last_login_at,COUNT(g.id) generated,COALESCE(SUM(g.completed_at>=?),0) today,COALESCE(SUM(g.completed_at>=? AND g.completed_at<?),0) period FROM users u LEFT JOIN generations g ON g.user_id=u.id AND g.state='ready' WHERE u.username LIKE ? GROUP BY u.id ORDER BY u.created_at DESC,u.id DESC LIMIT 20 OFFSET ?`,
              )
              .bind(day, from, to, '%' + query + '%', (page - 1) * 20)
              .all();
            const count = await db
              .prepare('SELECT COUNT(*) count FROM users WHERE username LIKE ?')
              .bind('%' + query + '%')
              .first();
            return json({
              items: rows.results.map((r) => ({
                ...publicUser(r),
                generated: r.generated,
                today: r.today,
                period: r.period,
              })),
              page,
              total: count.count,
            });
          }
          const status = path.match(/^\/api\/admin\/users\/([a-f0-9-]{36})\/status$/);
          if (status && method === 'POST') {
            const b = await readJSON(request, 4096);
            if (!['active', 'disabled'].includes(b.status))
              throw new HttpError(400, '账号状态无效。');
            const target = await db
              .prepare('SELECT * FROM users WHERE id=?')
              .bind(status[1])
              .first();
            if (!target) throw new HttpError(404, '账号不存在。');
            if (target.role === 'admin') throw new HttpError(400, '不能停用管理员。');
            await db.batch([
              db
                .prepare('UPDATE users SET status=?,security_version=security_version+1 WHERE id=?')
                .bind(b.status, target.id),
              db.prepare('DELETE FROM sessions WHERE user_id=?').bind(target.id),
              audit(db, user, 'user.' + b.status, target.id),
            ]);
            return json({ ok: true });
          }
          if (path === '/api/admin/invites' && method === 'POST') {
            const b = await readJSON(request, 4096),
              count = Number(b.count ?? 1),
              days = Number(b.days ?? 7),
              note = typeof b.note === 'string' ? b.note.trim() : '';
            if (
              !Number.isInteger(count) ||
              count < 1 ||
              count > 50 ||
              !Number.isInteger(days) ||
              days < 1 ||
              days > 90 ||
              note.length > 100
            )
              throw new HttpError(
                400,
                '每次可生成 1～50 个邀请，有效期 1～90 天，备注最多 100 字。',
              );
            await limit(db, 'invites:' + user.id, 10, 60000);
            const invites = [],
              stmts = [];
            for (let i = 0; i < count; i++) {
              const id = crypto.randomUUID(),
                token = randomToken();
              invites.push({
                id,
                url: `${url.origin}/register?invite=${token}`,
                expiresAt: now + days * 86400000,
              });
              stmts.push(
                db
                  .prepare(
                    'INSERT INTO invites(id,token_hash,note,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?)',
                  )
                  .bind(id, await digest(token), note, user.id, now, now + days * 86400000),
              );
            }
            stmts.push(audit(db, user, 'invite.create', String(count)));
            await db.batch(stmts);
            return json({ items: invites }, 201);
          }
          if (path === '/api/admin/invites' && method === 'GET') {
            const page = pageNumber(url),
              r = await db
                .prepare(
                  'SELECT i.id,i.note,i.created_at,i.expires_at,i.used_at,i.revoked_at,u.username used_by FROM invites i LEFT JOIN users u ON u.id=i.used_by ORDER BY i.created_at DESC,i.id DESC LIMIT 20 OFFSET ?',
                )
                .bind((page - 1) * 20)
                .all();
            const count = await db.prepare('SELECT COUNT(*) count FROM invites').first();
            return json({ items: r.results, page, total: count.count });
          }
          const revoke = path.match(/^\/api\/admin\/invites\/([a-f0-9-]{36})\/revoke$/);
          if (revoke && method === 'POST') {
            const r = await db.batch([
              db
                .prepare(
                  'UPDATE invites SET revoked_at=? WHERE id=? AND used_by IS NULL AND revoked_at IS NULL',
                )
                .bind(now, revoke[1]),
              audit(db, user, 'invite.revoke', revoke[1]),
            ]);
            if (!r[0].meta.changes) throw new HttpError(409, '邀请已使用或已撤销。');
            return json({ ok: true });
          }
          throw new HttpError(404, '接口不存在。');
        }
        const authPages = ['/login', '/register', '/reset-password', '/auth.html'];
        const publicAsset =
          /^\/src\/(styles\/|services\/qr-reader.js|ui\/(account|api|security)\.js)/.test(path) ||
          path.startsWith('/vendor/');
        if (authPages.includes(path)) return asset(env, request, '/auth.html');
        if (!env.DB || !env.IMAGES)
          return new Response('站点尚未配置 D1 数据库或 R2 图片存储。请联系管理员。', {
            status: 503,
          });
        const user = await getUser(request, env.DB);
        if (!user && !publicAsset)
          return new Response(null, {
            status: 302,
            headers: { location: '/login', 'cache-control': 'no-store' },
          });
        if (path === '/admin' || path === '/admin.html' || path === '/admin/history') {
          if (user?.role !== 'admin') return new Response('没有管理权限', { status: 403 });
          return asset(env, request, path === '/admin/history' ? '/history.html' : '/admin.html');
        }
        if (path === '/history') return asset(env, request, '/history.html');
        if (path.startsWith('/src/core/')) return new Response('Not found', { status: 404 });
        return asset(env, request, path === '/' ? '/index.html' : path);
      } catch (error) {
        if (error instanceof HttpError)
          return json({ error: error.message, code: error.code }, error.status);
        console.error('request_failed', { path, errorType: error?.name || 'Error' });
        return json({ error: '服务暂不可用，请稍后重试。' }, 503);
      }
    },
  };
}
async function listHistory(db, ownerId, url) {
  const page = pageNumber(url);
  const query = (url.searchParams.get('q') || '').trim().slice(0, 200);
  const rows = await db
    .prepare(
      "SELECT * FROM generations WHERE user_id=? AND state='ready' AND instr(lower(original_url),lower(?))>0 ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET ?",
    )
    .bind(ownerId, query, (page - 1) * 20)
    .all();
  const count = await db
    .prepare(
      "SELECT COUNT(*) count FROM generations WHERE user_id=? AND state='ready' AND instr(lower(original_url),lower(?))>0",
    )
    .bind(ownerId, query)
    .first();
  return { items: rows.results.map(historyItem), total: count.count, page };
}
async function historyImage(bucket, row, url) {
  const object = await bucket.get(row.object_key);
  if (!object) throw new HttpError(404, '图片暂不可用。');
  return new Response(object.body, {
    headers: {
      'content-type': 'image/svg+xml',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'content-disposition': `${url.searchParams.has('download') ? 'attachment' : 'inline'}; filename="sunflower-${row.id}.svg"`,
      'content-security-policy':
        "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
    },
  });
}
async function asset(env, request, path) {
  const url = new URL(request.url);
  // Pages canonicalizes .html to extensionless URLs; avoid returning its redirect
  // for internal page mappings such as /login -> auth.html.
  url.pathname = path === '/index.html' ? '/' : path.replace(/\.html$/, '');
  const response = await env.ASSETS.fetch(new Request(url, request));
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'private, no-store');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(response.body, { status: response.status, headers });
}
export default createWorker();
