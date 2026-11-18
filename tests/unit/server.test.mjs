import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../scripts/server.mjs';
test('development server only serves public assets', async (t) => {
  const server = createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
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
