import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../scripts/server.mjs';
async function setup(t, options = {}) {
  const server = createApp(options);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(
    () =>
      new Promise((r) => {
        server.close(r);
        server.closeAllConnections();
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    post: (body, headers = {}) =>
      fetch(base + '/api/shorten', {
        method: 'POST',
        headers: { origin: base, 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      }),
  };
}
test('public config excludes secrets and private files are unreachable', async (t) => {
  const { base } = await setup(t, { token: 'private-test-token' });
  const config = await (await fetch(base + '/config.js')).text();
  assert.ok(config.includes('/api/shorten'));
  assert.ok(!config.includes('private-test-token'));
  for (const p of [
    '/.env.local',
    '/.git/config',
    '/scripts/server.mjs',
    '/tests/requirements.txt',
    '/src/core/%2e%2e/%2e%2e/.env.local',
  ])
    assert.equal((await fetch(base + p)).status, 404);
  assert.equal((await fetch(base + '/')).status, 200);
});
test('forwards only validated content with server credential; strips upstream fields', async (t) => {
  let call;
  const { post } = await setup(t, {
    token: 'private-test-token',
    fetchImpl: async (url, opts) => {
      call = { url, opts };
      return Response.json({
        success: true,
        data: { url: 'https://surl.id/r/Abc123', private: 'must-not-leak' },
        extra: 'secret',
      });
    },
  });
  const content = 'https://example.com/?x=中文&y=a%26b#part';
  const response = await post({ content, token: 'ignored' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    data: { url: 'https://surl.id/r/Abc123' },
  });
  assert.equal(call.url, 'https://api.acedata.cloud/shorturl');
  assert.equal(call.opts.headers.authorization, 'Bearer private-test-token');
  assert.deepEqual(JSON.parse(call.opts.body), { content });
});
test('rejects foreign origins, invalid content, large requests and absent config', async (t) => {
  const { post } = await setup(t, {
    token: 'private-test-token',
    fetchImpl: () => {
      throw new Error('must not call');
    },
  });
  assert.equal(
    (await post({ content: 'https://example.com' }, { origin: 'https://other.test' })).status,
    403,
  );
  for (const content of ['javascript:alert(1)', 'plain text', 'https://a.cn/a b', 'https://', 42])
    assert.equal((await post({ content })).status, 400);
  assert.equal((await post({ content: 'a'.repeat(40000) })).status, 413);
  const empty = await setup(t);
  assert.equal((await empty.post({ content: 'https://a.cn' })).status, 503);
});
test('maps errors, rejects unexpected short domains, and limits requests', async (t) => {
  const { post } = await setup(t, {
    token: 'test',
    maxRequests: 1,
    fetchImpl: async () => Response.json({ success: true, data: { url: 'https://evil.test/x' } }),
  });
  assert.equal((await post({ content: 'https://a.cn' })).status, 502);
  assert.equal((await post({ content: 'https://a.cn' })).status, 429);
  const denied = await setup(t, {
    token: 'test',
    fetchImpl: async () => new Response('upstream secret', { status: 401 }),
  });
  const response = await denied.post({ content: 'https://a.cn' });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { success: false });
});
