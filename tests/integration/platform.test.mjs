import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const password = 'Example-Password-123!';
async function setup(t) {
  let calls = 0,
    fail = false;
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
    outboundService: async (request) => {
      calls++;
      assert.equal(request.headers.get('authorization'), 'Bearer private-test-token');
      assert.equal(request.url, 'https://api.acedata.cloud/shorturl');
      return fail
        ? new Response('no', { status: 500 })
        : Response.json({ success: true, data: { url: 'https://surl.id/r/Abc123' } });
    },
  });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  await db.exec(
    (await readFile(path.join(root, 'migrations/0001_accounts.sql'), 'utf8')).replace(/\n/g, ' '),
  );
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
    fail: () => (fail = true),
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
  assert.equal(
    (
      await call('/api/generate', {
        method: 'POST',
        cookie: account,
        key: 'long-request-123456',
        body: long,
      })
    ).status,
    201,
  );
  assert.equal(s.calls, 1);
  s.fail();
  assert.equal(
    (
      await call('/api/generate', {
        method: 'POST',
        cookie: account,
        key: 'failed-request-123456',
        body: { ...long, content: long.content + 'b' },
      })
    ).status,
    502,
  );
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
  const first = await (await call('/api/history', { cookie })).json();
  const last = await (await call('/api/history?page=2', { cookie })).json();
  assert.equal(first.items.length, 20);
  assert.equal(last.items.length, 1);
  assert.equal(first.total, 21);
  assert.ok(!first.items.some((item) => item.id === last.items[0].id));
  const stats = await (
    await call(`/api/admin/users?from=${day - 2000}&to=${day}`, { cookie })
  ).json();
  assert.equal(stats.items[0].generated, 21);
  assert.equal(stats.items[0].today, 20);
  assert.equal(stats.items[0].period, 1);
});
