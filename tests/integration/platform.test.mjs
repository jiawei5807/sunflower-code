import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const password = 'Example-Password-123!';
async function setup(t, beforeSecurity) {
  let calls = 0;
  const mf = new Miniflare({
    modules: true,
    scriptPath: path.join(root, 'dist/_worker.js'),
    compatibilityDate: '2026-07-01',
    d1Databases: ['DB'],
    r2Buckets: ['IMAGES'],
    bindings: {
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: password,
      ACEDATA_TOKEN: 'private-test-token',
    },
    serviceBindings: {
      ASSETS: (request) => {
        const pathname = new URL(request.url).pathname;
        return pathname.endsWith('.html')
          ? new Response(null, { status: 308, headers: { location: pathname.slice(0, -5) } })
          : new Response('page:' + pathname);
      },
    },
    outboundService: async () => {
      calls++;
      throw Error('Server must not contact Ace Data');
    },
  });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  for (const name of (await readdir(path.join(root, 'migrations'))).sort()) {
    if (name === '0002_account_security.sql' && beforeSecurity) await beforeSecurity(db);
    await db.exec(
      (await readFile(path.join(root, 'migrations', name), 'utf8')).replace(/\n/g, ' '),
    );
  }
  const call = async (
    p,
    { method = 'GET', body, cookie = '', key, origin = 'https://site.test' } = {},
  ) =>
    mf.dispatchFetch('https://site.test' + p, {
      method,
      headers: {
        origin,
        'content-type': 'application/json',
        cookie,
        ...(key ? { 'idempotency-key': key } : {}),
        'cf-connecting-ip': '192.0.2.1',
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });
  const login = async (username) => {
    const r = await call('/api/auth/login', { method: 'POST', body: { username, password } });
    assert.equal(r.status, 200, await r.clone().text());
    return r.headers.get('set-cookie').split(';')[0];
  };
  return {
    mf,
    db,
    call,
    login,
    get calls() {
      return calls;
    },
  };
}
test('invite account lifecycle, access controls, R2 history and accurate counters', async (t) => {
  const s = await setup(t);
  const { call, db, login } = s;
  assert.equal((await call('/api/history')).status, 401);
  assert.equal((await call('/')).status, 302);
  assert.equal((await call('/api/generate', { method: 'POST', body: {} })).status, 401);
  const admin = await login('admin');
  assert.ok(admin.startsWith('__Host-sunflower='));
  assert.equal(await (await call('/login')).text(), 'page:/auth');
  assert.equal(await (await call('/register?invite=test')).text(), 'page:/auth');
  assert.equal(await (await call('/', { cookie: admin })).text(), 'page:/');
  assert.equal(await (await call('/admin', { cookie: admin })).text(), 'page:/admin');
  assert.equal(await (await call('/history', { cookie: admin })).text(), 'page:/history');
  const invites = await (
    await call('/api/admin/invites', {
      method: 'POST',
      cookie: admin,
      body: { count: 5, days: 7, note: 'test' },
    })
  ).json();
  assert.equal(invites.items.length, 5);
  const token = (i) => new URL(invites.items[i].url).searchParams.get('invite');
  const register = (name, invite) =>
    call('/api/auth/register', { method: 'POST', body: { username: name, password, invite } });
  const results = await Promise.all([register('alice', token(0)), register('bob', token(0))]);
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.equal(results.filter((r) => r.status !== 201).length, 1);
  const first = await db.prepare("SELECT * FROM users WHERE role='user'").first();
  const account = await login(first.username);
  assert.equal((await call('/api/admin/users', { cookie: account })).status, 403);
  assert.equal((await call('/admin', { cookie: account })).status, 403);
  assert.equal((await register(first.username, token(1))).status, 409);
  assert.equal((await register('charlie', token(1))).status, 201);
  const other = await login('charlie');
  await call('/api/admin/invites/' + invites.items[2].id + '/revoke', {
    method: 'POST',
    cookie: admin,
    body: {},
  });
  assert.equal((await register('revoked', token(2))).status, 400);
  await db.prepare('UPDATE invites SET expires_at=0 WHERE id=?').bind(invites.items[3].id).run();
  assert.equal((await register('expired', token(3))).status, 400);
  const body = {
    content: 'https://example.com',
    version: 'auto',
    level: 'auto',
    size: 1024,
    source: 'link',
    avatar: '',
  };
  const key = 'unique-request-123456';
  const generated = await call('/api/generate', { method: 'POST', cookie: account, body, key });
  assert.equal(generated.status, 201, await generated.clone().text());
  const item = await generated.json();
  assert.ok(item.svg.startsWith('<svg'));
  assert.equal(s.calls, 0);
  assert.equal(
    (await call('/api/generate', { method: 'POST', cookie: account, body, key })).status,
    201,
  );
  assert.equal(
    (
      await call('/api/generate', {
        method: 'POST',
        cookie: account,
        body: { ...body, content: 'https://different.test' },
        key,
      })
    ).status,
    409,
  );
  assert.equal((await call(item.imageUrl, { cookie: other })).status, 404);
  assert.equal((await call(item.imageUrl)).status, 401);
  const image = await call(item.imageUrl, { cookie: account });
  assert.equal(await image.text(), item.svg);
  assert.equal(image.headers.get('cache-control'), 'private, no-store');
  const history = await (await call('/api/history', { cookie: account })).json();
  assert.equal(history.total, 1);
  const adminHistoryPath = `/api/admin/users/${first.id}/history`;
  assert.equal((await call(adminHistoryPath)).status, 401);
  assert.equal((await call(adminHistoryPath, { cookie: account })).status, 403);
  assert.equal((await call('/admin/history?user=' + first.id, { cookie: account })).status, 403);
  assert.equal((await call('/admin/history?user=' + first.id)).status, 302);
  assert.equal(
    await (await call('/admin/history?user=' + first.id, { cookie: admin })).text(),
    'page:/history',
  );
  const adminHistory = await (await call(adminHistoryPath, { cookie: admin })).json();
  assert.equal(adminHistory.user.username, first.username);
  assert.equal(adminHistory.total, 1);
  assert.equal(adminHistory.items[0].originalUrl, body.content);
  assert.equal(adminHistory.items[0].id, item.id);
  assert.ok(!('password_hash' in adminHistory.user));
  const adminImage = adminHistory.items[0].imageUrl;
  assert.equal(adminImage, `${adminHistoryPath}/${item.id}/image`);
  assert.equal((await call(adminImage)).status, 401);
  assert.equal((await call(adminImage, { cookie: account })).status, 403);
  const administratorImage = await call(adminImage, { cookie: admin });
  assert.equal(await administratorImage.text(), item.svg);
  assert.equal(administratorImage.headers.get('cache-control'), 'private, no-store');
  assert.match(administratorImage.headers.get('content-security-policy'), /sandbox/);
  const downloaded = await call(adminImage + '?download=1', { cookie: admin });
  assert.match(downloaded.headers.get('content-disposition'), /^attachment;/);
  const otherId = (await db.prepare("SELECT id FROM users WHERE username='charlie'").first()).id;
  assert.equal(
    (await (await call(`/api/admin/users/${otherId}/history`, { cookie: admin })).json()).total,
    0,
  );
  assert.equal(
    (await call(`/api/admin/users/${otherId}/history/${item.id}/image`, { cookie: admin })).status,
    404,
  );
  assert.equal(
    (await call(`/api/admin/users/${crypto.randomUUID()}/history`, { cookie: admin })).status,
    404,
  );
  assert.equal((await call(adminImage, { method: 'POST', cookie: admin, body: {} })).status, 404);
  assert.equal(
    (
      await call(`/api/admin/users/${first.id}/history/${item.id}/appearance`, {
        method: 'POST',
        cookie: admin,
        body: { size: 512 },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await call('/api/history/' + item.id + '/appearance', {
        method: 'POST',
        cookie: admin,
        body: { size: 512 },
      })
    ).status,
    404,
  );
  assert.equal((await call(item.imageUrl, { cookie: admin })).status, 404);

  const changed = await call('/api/history/' + item.id + '/appearance', {
    method: 'POST',
    cookie: account,
    body: { size: 2048, avatar: '' },
  });
  assert.equal(changed.status, 200);
  assert.match((await changed.json()).svg, /width="2048"/);
  assert.equal((await (await call('/api/history', { cookie: account })).json()).total, 1);
  const bad = await call('/api/generate', {
    method: 'POST',
    cookie: account,
    key: 'bad-request-123456',
    body: { ...body, content: 'javascript:alert(1)' },
  });
  assert.equal(bad.status, 400);
  const long = { ...body, content: 'https://example.com/?q=' + 'a'.repeat(200) };
  const needsShort = await call('/api/generate', {
    method: 'POST',
    cookie: account,
    key: 'long-request-123456',
    body: long,
  });
  assert.equal(needsShort.status, 422);
  assert.equal((await needsShort.json()).code, 'SHORTEN_REQUIRED');
  assert.equal(
    (
      await call('/api/generate', {
        method: 'POST',
        cookie: account,
        key: 'long-request-123456',
        body: { ...long, shortUrl: 'https://surl.id/Test123' },
      })
    ).status,
    201,
  );
  assert.equal(s.calls, 0);
  const users = await (await call('/api/admin/users', { cookie: admin })).json();
  assert.equal(users.items.find((u) => u.id === first.id).generated, 2);
  assert.equal(
    (
      await call('/api/generate', {
        method: 'POST',
        cookie: account,
        body,
        key: 'cross-request-123456',
        origin: 'https://evil.test',
      })
    ).status,
    403,
  );
  await call('/api/admin/users/' + first.id + '/status', {
    method: 'POST',
    cookie: admin,
    body: { status: 'disabled' },
  });
  assert.equal((await call('/api/history', { cookie: account })).status, 401);
  const disabledHistory = await (await call(adminHistoryPath, { cookie: admin })).json();
  assert.equal(disabledHistory.user.status, 'disabled');
  assert.equal(disabledHistory.total, 2);
  assert.equal((await call(adminImage, { cookie: admin })).status, 200);
  assert.equal((await call(adminImage, { cookie: account })).status, 401);

  assert.equal(
    (
      await call('/api/admin/users/' + users.items.find((u) => u.role === 'admin').id + '/status', {
        method: 'POST',
        cookie: admin,
        body: { status: 'disabled' },
      })
    ).status,
    400,
  );
  await call('/api/auth/password', {
    method: 'POST',
    cookie: other,
    body: { current: password, password: 'New-Password-12345!' },
  });
  assert.equal((await call('/api/history', { cookie: other })).status, 401);
  const savedRow = await db
    .prepare('SELECT object_key FROM generations WHERE id=?')
    .bind(item.id)
    .first();
  await (await s.mf.getR2Bucket('IMAGES')).delete(savedRow.object_key);
  const missingImage = await call(adminImage, { cookie: admin });
  assert.equal(missingImage.status, 404);
  assert.equal((await missingImage.json()).error, '图片暂不可用。');
  const hashes = await db.prepare('SELECT token_hash FROM invites').all();
  assert.ok(hashes.results.every((r) => !invites.items.some((i) => i.url.endsWith(r.token_hash))));
});
test('concurrent duplicate generation commits only once', async (t) => {
  const { call, login, db } = await setup(t);
  const cookie = await login('admin'),
    key = 'simultaneous-request-123',
    body = { content: 'https://example.com', size: 512 };
  const responses = await Promise.all([
    call('/api/generate', { method: 'POST', cookie, body, key }),
    call('/api/generate', { method: 'POST', cookie, body, key }),
  ]);
  assert.ok(responses.every((r) => [201, 409].includes(r.status)));
  assert.equal(
    (await db.prepare("SELECT COUNT(*) n FROM generations WHERE state='ready'").first()).n,
    1,
  );
});

test('expired sessions, password rotation, login throttling and request boundaries', async (t) => {
  const { call, login, db } = await setup(t);
  const cookie = await login('admin');
  assert.equal((await call('/src/core/codec.js', { cookie })).status, 404);
  assert.equal((await call('/api/shorten', { method: 'POST', cookie, body: {} })).status, 404);
  assert.equal(
    (await call('/api/admin/invites', { method: 'POST', cookie, body: { note: 'a'.repeat(5000) } }))
      .status,
    413,
  );
  assert.equal(
    (await call('/api/admin/invites', { method: 'POST', cookie, origin: '', body: {} })).status,
    403,
  );
  assert.equal((await call('/api/admin/users?from=500&to=100', { cookie })).status, 400);
  const nextPassword = 'Rotated-Admin-Password-123!';
  assert.equal(
    (
      await call('/api/auth/password', {
        method: 'POST',
        cookie,
        body: { current: password, password: nextPassword },
      })
    ).status,
    200,
  );
  assert.equal((await call('/api/auth/me', { cookie })).status, 401);
  // The still-configured bootstrap secret cannot reset an existing administrator.
  assert.equal(
    (await call('/api/auth/login', { method: 'POST', body: { username: 'admin', password } }))
      .status,
    401,
  );
  const rotated = await call('/api/auth/login', {
    method: 'POST',
    body: { username: 'ADMIN', password: nextPassword },
  });
  assert.equal(rotated.status, 200);
  assert.match(rotated.headers.get('set-cookie'), /HttpOnly; SameSite=Lax; Secure/);
  const nextCookie = rotated.headers.get('set-cookie').split(';')[0];
  await db.prepare('UPDATE sessions SET expires_at=0').run();
  assert.equal((await call('/api/auth/me', { cookie: nextCookie })).status, 401);
  for (let i = 0; i < 7; i++)
    await call('/api/auth/login', { method: 'POST', body: { username: 'admin', password } });
  assert.equal(
    (
      await call('/api/auth/login', {
        method: 'POST',
        body: { username: 'admin', password: nextPassword },
      })
    ).status,
    429,
  );
});

test('storage failures do not count; ambiguous committed responses preserve R2 images', async (t) => {
  const bundle = await readFile(path.join(root, 'dist/_worker.js'));
  const { createWorker } = await import('data:text/javascript;base64,' + bundle.toString('base64'));
  const { db, mf, login, call } = await setup(t);
  const cookie = await login('admin'),
    bucket = await mf.getR2Bucket('IMAGES');
  const base = { DB: db, IMAGES: bucket };
  const worker = createWorker(() => {
    throw Error('Unexpected external call');
  });
  const request = (path, body, key) =>
    new Request('https://site.test' + path, {
      method: 'POST',
      headers: {
        origin: 'https://site.test',
        'content-type': 'application/json',
        cookie,
        'idempotency-key': key,
      },
      body: JSON.stringify(body),
    });
  const body = { content: 'https://example.com', size: 1024 };
  const brokenBucket = {
    put: async () => {
      throw Error('R2 unavailable');
    },
    delete: bucket.delete.bind(bucket),
  };
  assert.equal(
    (
      await worker.fetch(request('/api/generate', body, 'storage-fail-123456'), {
        ...base,
        IMAGES: brokenBucket,
      })
    ).status,
    503,
  );
  assert.equal(
    (await db.prepare("SELECT COUNT(*) n FROM generations WHERE state='ready'").first()).n,
    0,
  );
  assert.equal(
    (
      await db
        .prepare("SELECT state FROM generations WHERE request_key='storage-fail-123456'")
        .first()
    ).state,
    'failed',
  );
  const uncertainDB = {
    prepare(sql) {
      const stmt = db.prepare(sql);
      if (!sql.startsWith('UPDATE generations SET')) return stmt;
      return {
        bind(...values) {
          const bound = stmt.bind(...values);
          return {
            async first() {
              await bound.first();
              throw Error('Lost response after commit');
            },
          };
        },
      };
    },
  };
  assert.equal(
    (
      await worker.fetch(request('/api/generate', body, 'storage-commit-123456'), {
        ...base,
        DB: uncertainDB,
      })
    ).status,
    503,
  );
  const saved = await db.prepare("SELECT * FROM generations WHERE state='ready'").first();
  assert.ok(await bucket.get(saved.object_key));
  assert.equal(
    (await worker.fetch(request('/api/generate', body, 'storage-commit-123456'), base)).status,
    201,
  );
  assert.equal(
    (
      await worker.fetch(
        request('/api/history/' + saved.id + '/appearance', { size: 512 }, 'appearance-123456'),
        { ...base, DB: uncertainDB },
      )
    ).status,
    503,
  );
  const changed = await db.prepare('SELECT * FROM generations WHERE id=?').bind(saved.id).first();
  assert.notEqual(changed.object_key, saved.object_key);
  assert.ok(await bucket.get(changed.object_key));
  assert.equal((await (await call('/api/history', { cookie })).json()).total, 1);
  assert.equal(
    (await worker.fetch(request('/api/generate', body, 'no-binding-123456'), {})).status,
    503,
  );
});

test('history pagination and date statistics use successful completion times', async (t) => {
  const { call, login, db } = await setup(t);
  const cookie = await login('admin');
  const id = (await db.prepare("SELECT id FROM users WHERE role='admin'").first()).id;
  const now = Date.now(),
    day = now - ((now + 8 * 3600000) % 86400000);
  await db.batch(
    Array.from({ length: 21 }, (_, i) =>
      db
        .prepare(
          "INSERT INTO generations(id,user_id,request_key,payload_hash,original_url,source,state,created_at,completed_at) VALUES(?,?,?,'test','https://example.com','link','ready',?,?)",
        )
        .bind(crypto.randomUUID(), id, 'pagination-' + i, day - 1000 + i, i ? day + i : day - 1000),
    ),
  );
  await db.batch(
    ['pending', 'failed'].map((state) =>
      db
        .prepare(
          "INSERT INTO generations(id,user_id,request_key,payload_hash,original_url,source,state,created_at) VALUES(?,?,?,'test','https://example.com','link',?,?)",
        )
        .bind(crypto.randomUUID(), id, 'excluded-' + state, state, now),
    ),
  );
  const first = await (await call('/api/history', { cookie })).json();
  const last = await (await call('/api/history?page=2', { cookie })).json();
  assert.equal(first.items.length, 20);
  assert.equal(last.items.length, 1);
  assert.equal(first.total, 21);
  assert.ok(!first.items.some((item) => item.id === last.items[0].id));
  const adminPage = await (await call(`/api/admin/users/${id}/history?page=2`, { cookie })).json();
  assert.equal(adminPage.page, 2);
  assert.equal(adminPage.total, 21);
  assert.deepEqual(
    adminPage.items.map((item) => item.id),
    last.items.map((item) => item.id),
  );

  const stats = await (
    await call(`/api/admin/users?from=${day - 2000}&to=${day}`, { cookie })
  ).json();
  assert.equal(stats.items[0].generated, 21);
  assert.equal(stats.items[0].today, 20);
  assert.equal(stats.items[0].period, 1);
});

test('browser shortener config is authenticated; short URLs are validated and preflight never counts', async (t) => {
  const s = await setup(t);
  assert.equal((await s.call('/api/shortener/config', { method: 'POST', body: {} })).status, 401);
  const cookie = await s.login('admin');
  assert.equal(
    (
      await s.call('/api/shortener/config', {
        method: 'POST',
        cookie,
        body: {},
        origin: 'https://evil.test',
      })
    ).status,
    403,
  );
  const config = await s.call('/api/shortener/config', { method: 'POST', cookie, body: {} });
  assert.equal(config.status, 200);
  assert.equal(config.headers.get('cache-control'), 'no-store');
  assert.equal((await config.json()).token, 'private-test-token');
  const body = { content: 'https://example.com/?q=' + 'a'.repeat(200), size: 512 };
  let i = 0;
  for (const shortUrl of ['https://surl.id/Abc123', 'https://surl.id/r/Abc123']) {
    const key = 'client-short-test-' + ++i;
    const send = (data) => s.call('/api/generate', { method: 'POST', cookie, body: data, key });
    const preflight = await send(body);
    assert.equal(preflight.status, 422);
    assert.equal((await preflight.json()).code, 'SHORTEN_REQUIRED');
    assert.equal((await s.db.prepare('SELECT COUNT(*) n FROM generations').first()).n, i - 1);
    const result = await send({ ...body, shortUrl });
    assert.equal(result.status, 201);
    const item = await result.json();
    assert.ok(item.svg.startsWith('<svg'));
    const stored = await s.db
      .prepare('SELECT original_url,encoded_url FROM generations WHERE id=?')
      .bind(item.id)
      .first();
    assert.equal(stored.original_url, body.content);
    assert.equal(stored.encoded_url, shortUrl);
    assert.equal((await send({ ...body, shortUrl })).status, 201);
    assert.equal((await send({ ...body, shortUrl: 'https://surl.id/Changed' })).status, 409);
  }
  for (const shortUrl of [
    'https://surl.id.evil.test/Abc123',
    'http://surl.id/Abc123',
    'https://surl.id/Abc123?secret=x',
    'https://surl.id/a/b',
    'https://surl.id/Abc123#fragment',
    'https://evil.test/Abc123',
  ]) {
    const r = await s.call('/api/generate', {
      method: 'POST',
      cookie,
      body: { ...body, shortUrl },
      key: 'client-invalid-' + ++i,
    });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).code, 'SHORTENER_BAD_RESPONSE');
  }
  assert.equal(
    (
      await s.call('/api/generate', {
        method: 'POST',
        cookie,
        body: { content: 'https://example.com', shortUrl: 'https://surl.id/Abc123' },
        key: 'unnecessary-short-123',
      })
    ).status,
    400,
  );
  assert.equal((await (await s.call('/api/history', { cookie })).json()).total, 2);
  assert.equal(s.calls, 0);
});

test('password resets require administrator reauthentication and are single-use, expiring and session-revoking', async (t) => {
  const { call, login, db } = await setup(t);
  const admin = await login('admin');
  const invites = await (
    await call('/api/admin/invites', { method: 'POST', cookie: admin, body: { count: 1 } })
  ).json();
  await call('/api/auth/register', {
    method: 'POST',
    body: {
      username: 'reset_user',
      password,
      invite: new URL(invites.items[0].url).searchParams.get('invite'),
    },
  });
  const cookie = await login('reset_user');
  const user = await db.prepare("SELECT * FROM users WHERE username='reset_user'").first();
  const endpoint = `/api/admin/users/${user.id}/reset-password`;
  assert.equal((await call(endpoint, { method: 'POST', body: { password } })).status, 401);
  assert.equal((await call(endpoint, { method: 'POST', cookie, body: { password } })).status, 403);
  assert.equal(
    (await call(endpoint, { method: 'POST', cookie: admin, body: { password: 'wrong' } })).status,
    400,
  );
  const issue = async () => {
    const r = await call(endpoint, { method: 'POST', cookie: admin, body: { password } });
    assert.equal(r.status, 200, await r.clone().text());
    const token = new URLSearchParams(new URL((await r.json()).url).hash.slice(1)).get('token');
    assert.ok(token);
    return token;
  };
  const old = await issue(),
    token = await issue();
  const reset = (token, password) =>
    call('/api/auth/reset', { method: 'POST', body: { token, password } });
  assert.equal((await reset(old, 'New-Password-123!')).status, 400);
  assert.equal((await reset(token, 'short')).status, 400);
  const results = await Promise.all([
    reset(token, 'New-Password-123!'),
    reset(token, 'New-Password-456!'),
  ]);
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal((await call('/api/auth/me', { cookie })).status, 401);
  assert.equal((await reset(token, 'Another-Password-123!')).status, 400);
  assert.equal(
    (await call('/api/auth/login', { method: 'POST', body: { username: user.username, password } }))
      .status,
    401,
  );
  const successPassword = results[0].status === 200 ? 'New-Password-123!' : 'New-Password-456!';
  const signed = await call('/api/auth/login', {
    method: 'POST',
    body: { username: user.username, password: successPassword },
  });
  assert.equal(signed.status, 200);
  const expired = await issue();
  await db.prepare('UPDATE password_resets SET expires_at=0 WHERE user_id=?').bind(user.id).run();
  assert.equal((await reset(expired, 'New-Password-000!')).status, 400);
  const changed = await issue();
  await call('/api/auth/password', {
    method: 'POST',
    cookie: signed.headers.get('set-cookie').split(';')[0],
    body: { current: successPassword, password: 'Final-Password-123!' },
  });
  assert.equal((await reset(changed, 'New-Password-000!')).status, 400);
  const disabled = await issue();
  await call(`/api/admin/users/${user.id}/status`, {
    method: 'POST',
    cookie: admin,
    body: { status: 'disabled' },
  });
  assert.equal((await reset(disabled, 'New-Password-000!')).status, 400);
  await call(`/api/admin/users/${user.id}/status`, {
    method: 'POST',
    cookie: admin,
    body: { status: 'active' },
  });
  assert.equal((await reset(disabled, 'New-Password-000!')).status, 400);
  const adminId = (await db.prepare("SELECT id FROM users WHERE role='admin'").first()).id;
  assert.equal(
    (
      await call(`/api/admin/users/${adminId}/reset-password`, {
        method: 'POST',
        cookie: admin,
        body: { password },
      })
    ).status,
    400,
  );
});

test('support settings are public read-only and history search stays scoped to the owner', async (t) => {
  const { call, login, db } = await setup(t),
    cookie = await login('admin');
  assert.deepEqual(await (await call('/api/support')).json(), { imageUrl: '' });
  assert.equal(
    (await call('/api/admin/support', { method: 'POST', body: { contact: 'x' } })).status,
    401,
  );
  assert.equal(
    (
      await call('/api/admin/support', {
        method: 'POST',
        cookie,
        body: { contact: 'x', url: 'javascript:alert(1)' },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call('/api/admin/support', {
        method: 'POST',
        cookie,
        body: {
          image:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8ZkAAAAASUVORK5CYII=',
        },
      })
    ).status,
    200,
  );
  assert.match((await (await call('/api/support')).json()).imageUrl, /^\/api\/support\/image\?v=/);
  await call('/api/generate', {
    method: 'POST',
    cookie,
    key: 'history-search-test-01',
    body: { content: 'https://example.com/Alpha?special=%25' },
  });
  await call('/api/generate', {
    method: 'POST',
    cookie,
    key: 'history-search-test-02',
    body: { content: 'https://example.com/Beta' },
  });
  assert.equal((await (await call('/api/history?q=ALPHA', { cookie })).json()).total, 1);
  assert.equal((await (await call('/api/history?q=none', { cookie })).json()).total, 0);
  assert.equal((await (await call('/api/history?q=%25', { cookie })).json()).total, 1);
  const admin = (await db.prepare("SELECT id FROM users WHERE role='admin'").first()).id;
  assert.equal(
    (await (await call(`/api/admin/users/${admin}/history?q=beta`, { cookie })).json()).total,
    1,
  );
});

test('support configuration stays administrator-only and user search cannot cross accounts', async (t) => {
  const { call, login, db } = await setup(t);
  const cookie = await login('admin');
  const invites = await (
    await call('/api/admin/invites', { method: 'POST', cookie, body: { count: 2 } })
  ).json();
  for (const [i, name] of ['security_user', 'other_user'].entries()) {
    assert.equal(
      (
        await call('/api/auth/register', {
          method: 'POST',
          body: {
            username: name,
            password,
            invite: new URL(invites.items[i].url).searchParams.get('invite'),
          },
        })
      ).status,
      201,
    );
  }
  const own = await login('security_user'),
    other = await login('other_user');
  const userId = (await db.prepare("SELECT id FROM users WHERE username='security_user'").first())
    .id;
  assert.equal(
    (
      await call('/api/admin/support', {
        method: 'POST',
        cookie: own,
        body: { contact: 'forbidden' },
      })
    ).status,
    403,
  );
  await call('/api/generate', {
    method: 'POST',
    cookie: own,
    key: 'search-scope-own-01',
    body: { content: 'https://example.com/private-marker' },
  });
  await call('/api/generate', {
    method: 'POST',
    cookie: other,
    key: 'search-scope-other-01',
    body: { content: 'https://example.com/private-marker' },
  });
  assert.equal(
    (await (await call('/api/history?q=private-marker', { cookie: own })).json()).total,
    1,
  );
  assert.equal(
    (await (await call(`/api/admin/users/${userId}/history?q=private-marker`, { cookie })).json())
      .total,
    1,
  );
});

test('account security migration preserves existing data and password-only admin access', async (t) => {
  const { hashPassword, digest } = await import('../../cloudflare/lib/auth.mjs');
  const id = crypto.randomUUID(),
    ordinary = crypto.randomUUID(),
    generationId = crypto.randomUUID();
  const oldSession = '1'.repeat(64),
    ordinarySession = '2'.repeat(64),
    recovery = '3'.repeat(32);
  const now = Date.now(),
    originalHash = await hashPassword(password);
  const { call, login, db } = await setup(t, async (db) => {
    await db.batch([
      db
        .prepare(
          "INSERT INTO users(id,username,password_hash,role,created_at) VALUES(?,'admin',?,'admin',?)",
        )
        .bind(id, originalHash, now),
      db
        .prepare(
          "INSERT INTO users(id,username,password_hash,role,created_at) VALUES(?,'existing_user',?,'user',?)",
        )
        .bind(ordinary, originalHash, now),
      db
        .prepare('INSERT INTO sessions VALUES(?,?,?,?)')
        .bind(await digest(oldSession), id, now, now + 600000),
      db
        .prepare('INSERT INTO sessions VALUES(?,?,?,?)')
        .bind(await digest(ordinarySession), ordinary, now, now + 600000),
      db
        .prepare(
          "INSERT INTO generations(id,user_id,request_key,payload_hash,original_url,source,state,created_at,completed_at) VALUES(?,?,'existing-record','test','https://example.com','link','ready',?,?)",
        )
        .bind(generationId, ordinary, now, now),
    ]);
  });
  assert.equal(
    (
      await db
        .prepare(
          "SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name IN ('admin_mfa','mfa_recovery_codes')",
        )
        .first()
    ).n,
    0,
  );
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM users').first()).n, 2);
  assert.equal((await db.prepare('SELECT id FROM generations').first()).id, generationId);
  assert.deepEqual(await (await call('/api/support')).json(), { imageUrl: '' });
  assert.equal(
    (await call('/api/auth/me', { cookie: '__Host-sunflower=' + oldSession })).status,
    200,
  );
  assert.equal(
    (await call('/api/auth/me', { cookie: '__Host-sunflower=' + ordinarySession })).status,
    200,
  );
  const cookie = await login('admin');
  for (const path of [
    '/api/admin/mfa',
    '/api/admin/mfa/setup',
    '/api/admin/mfa/enable',
    '/api/admin/mfa/disable',
  ]) {
    assert.equal(
      (
        await call(path, {
          cookie,
          method: path === '/api/admin/mfa' ? 'GET' : 'POST',
          body: path === '/api/admin/mfa' ? undefined : { password },
        })
      ).status,
      404,
    );
  }
  const denied = await call('/api/auth/reset', {
    method: 'POST',
    body: { username: 'admin', recoveryCode: recovery, password: 'New-Admin-Password!' },
  });
  assert.equal(denied.status, 400);
  assert.equal(
    (await db.prepare('SELECT password_hash FROM users WHERE id=?').bind(id).first()).password_hash,
    originalHash,
  );
  assert.equal((await call('/api/auth/me', { cookie })).status, 200);
  const issue = await call(`/api/admin/users/${ordinary}/reset-password`, {
    method: 'POST',
    cookie,
    body: { password },
  });
  assert.equal(issue.status, 200);
  const token = new URLSearchParams(new URL((await issue.json()).url).hash.slice(1)).get('token');
  assert.equal(
    (
      await call('/api/auth/reset', {
        method: 'POST',
        body: { token, password: 'New-User-Password!' },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call('/api/auth/password', {
        method: 'POST',
        cookie,
        body: { current: password, password: 'Changed-Admin-Password!' },
      })
    ).status,
    200,
  );
  assert.equal((await call('/api/auth/me', { cookie })).status, 401);
});

test('support image can be published and replaced only by admins, stays separate from history, and can be removed', async (t) => {
  const { call, login, db, mf } = await setup(t),
    cookie = await login('admin');
  const images = await mf.getR2Bucket('IMAGES');
  const image =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8ZkAAAAASUVORK5CYII=';
  assert.equal((await call('/api/support/image')).status, 404);
  assert.equal((await call('/api/admin/support', { method: 'POST', body: { image } })).status, 401);
  assert.equal(
    (
      await call('/api/admin/support', {
        method: 'POST',
        cookie,
        origin: 'https://evil.test',
        body: { image },
      })
    ).status,
    403,
  );
  await db
    .prepare("INSERT INTO site_settings VALUES('support',?)")
    .bind(JSON.stringify({ contact: 'old contact', url: 'mailto:old@example.com' }))
    .run();
  assert.deepEqual(await (await call('/api/support')).json(), { imageUrl: '' });
  const published = await call('/api/admin/support', { method: 'POST', cookie, body: { image } });
  assert.equal(published.status, 200);
  const first = (await published.json()).imageUrl;
  const response = await call(first);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(
    Buffer.from(await response.arrayBuffer()),
    Buffer.from(image.split(',')[1], 'base64'),
  );
  for (const bad of [
    'data:image/svg+xml;base64,PHN2Zy8+',
    'data:image/png;base64,YmFk',
    'https://evil.test/image.png',
  ]) {
    assert.equal(
      (await call('/api/admin/support', { method: 'POST', cookie, body: { image: bad } })).status,
      400,
    );
    assert.equal((await (await call('/api/support')).json()).imageUrl, first);
  }
  assert.equal(
    (
      await call('/api/admin/support', {
        method: 'POST',
        cookie,
        body: { image: 'data:image/png;base64,' + 'a'.repeat(2800000) },
      })
    ).status,
    413,
  );
  const secondImage =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC';
  assert.equal(
    (await call('/api/admin/support', { method: 'POST', cookie, body: { image: secondImage } }))
      .status,
    200,
  );
  const second = (await (await call('/api/support')).json()).imageUrl;
  assert.notEqual(first, second);
  assert.equal((await images.list({ prefix: 'site/' })).objects.length, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM generations').first()).n, 0);
  assert.equal(
    (await call('/api/support/image?key=users/private.svg')).headers.get('content-type'),
    'image/png',
  );
  assert.equal(
    (await call('/api/admin/support', { method: 'POST', cookie, body: { image: null } })).status,
    200,
  );
  assert.deepEqual(await (await call('/api/support')).json(), { imageUrl: '' });
  assert.equal((await call('/api/support/image')).status, 404);
  assert.equal((await images.list({ prefix: 'site/' })).objects.length, 0);
});
