import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorker } from '../../cloudflare/worker.mjs';
const base = 'https://example.pages.dev';
const env = {
  ACEDATA_TOKEN: 'private-test-token',
  ASSETS: { fetch: async () => new Response('asset') },
};
const request = (body, extra = {}) =>
  new Request(base + '/api/shorten', {
    method: 'POST',
    headers: {
      origin: base,
      'content-type': 'application/json',
      'cf-connecting-ip': '192.0.2.1',
      ...extra,
    },
    body: JSON.stringify(body),
  });
test('Pages serves public config and assets without exposing token', async () => {
  const w = createWorker();
  const config = await w.fetch(new Request(base + '/config.js'), env);
  const text = await config.text();
  assert.ok(text.includes('/api/shorten'));
  assert.ok(!text.includes(env.ACEDATA_TOKEN));
  assert.equal(config.headers.get('cache-control'), 'no-store');
  assert.equal(await (await w.fetch(new Request(base + '/'), env)).text(), 'asset');
});
test('Pages forwards exact JSON with secret and filters response', async () => {
  let sent;
  const w = createWorker(async (url, options) => {
    sent = { url, options };
    return Response.json({
      success: true,
      data: { url: 'https://surl.id/r/Abc123', secret: 'redacted' },
    });
  });
  const content = 'https://example.com/?name=中文&x=a%26b#section';
  const r = await w.fetch(request({ content }), env);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { success: true, data: { url: 'https://surl.id/r/Abc123' } });
  assert.equal(sent.url, 'https://api.acedata.cloud/shorturl');
  assert.equal(sent.options.headers.authorization, 'Bearer ' + env.ACEDATA_TOKEN);
  assert.equal(sent.options.redirect, 'manual');
  assert.deepEqual(JSON.parse(sent.options.body), { content });
});
test('Pages rejects invalid input, origin, methods and oversized bodies', async () => {
  const w = createWorker(() => {
    throw Error('unexpected upstream call');
  });
  assert.equal((await w.fetch(new Request(base + '/api/shorten'), env)).status, 405);
  assert.equal(
    (
      await w.fetch(
        request({ content: 'https://example.com' }, { origin: 'https://other.test' }),
        env,
      )
    ).status,
    403,
  );
  assert.equal(
    (await w.fetch(request({ content: 'https://example.com' }), { ...env, ACEDATA_TOKEN: '' }))
      .status,
    503,
  );
  for (const body of [
    null,
    {},
    { content: 'javascript:alert(1)' },
    { content: 'https://' },
    { content: 'https://a.cn/a b' },
  ])
    assert.equal((await w.fetch(request(body), env)).status, 400);
  assert.equal((await w.fetch(request({ content: 'x'.repeat(40000) }), env)).status, 413);
});
test('Pages handles upstream failure and best-effort isolate rate limit', async () => {
  const w = createWorker(async () => new Response('private upstream details', { status: 401 }));
  for (let i = 0; i < 30; i++) {
    const r = await w.fetch(request({ content: 'https://a.cn' }), env);
    assert.equal(r.status, 401);
    assert.deepEqual(await r.json(), { success: false });
  }
  assert.equal((await w.fetch(request({ content: 'https://a.cn' }), env)).status, 429);
  const bad = createWorker(async () =>
    Response.json({ success: true, data: { url: 'https://wrong.test/x' } }),
  );
  assert.equal((await bad.fetch(request({ content: 'https://a.cn' }), env)).status, 502);
});

test('Pages rejects upstream redirects without following their destination', async () => {
  let calls = 0;
  const w = createWorker(async (url, options) => {
    calls++;
    assert.equal(options.redirect, 'manual');
    return new Response(null, { status: 302, headers: { location: 'https://other.test/collect' } });
  });
  const response = await w.fetch(request({ content: 'https://a.cn' }), env);
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { success: false });
  assert.equal(calls, 1);
});
