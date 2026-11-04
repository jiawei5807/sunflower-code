const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
require('../../src/core/protocol-data.js');
require('../../src/core/codec.js');
const codec = globalThis.SunflowerCode;
const fixtures = require('./reference-fixtures.json');
test('120 reference cases: identical matrices/parameters or matching capacity rejection', () => {
  for (const { text, version, level, expected } of fixtures) {
    if (expected.reject) {
      assert.throws(() => codec.encode(text, { version, level }));
      continue;
    }
    const result = codec.encode(text, { version, level });
    assert.equal(result.version, expected.version);
    assert.equal(result.level, expected.level);
    assert.equal(result.mask, expected.mask);
    assert.equal(
      crypto.createHash('sha256').update(JSON.stringify(result.matrix)).digest('hex'),
      expected.hash,
    );
    assert.equal(codec.decode(result.matrix, result.version), text);
  }
});
test('invalid URL, settings, sizes and unsafe image input are rejected', () => {
  for (const text of [
    '',
    'example.com',
    '#小程序://测试/Abc123',
    'weixin://abc',
    'javascript:alert(1)',
    'https://',
    'https://a.cn/a b',
    'https://a.cn/\nb',
    'https://a.cn/' + 'a'.repeat(600),
  ])
    assert.throws(() => codec.encode(text));
  for (const options of [
    { version: 3 },
    { version: -1 },
    { version: 'n/a' },
    { level: 'Z' },
    { level: 'toString' },
  ])
    assert.throws(() => codec.encode('https://a.cn', options));
  const c = codec.encode('https://a.cn');
  assert.throws(() => codec.renderSvg(c, { size: 100 }));
  assert.throws(() => codec.renderSvg(c, { avatar: 'https://remote/image.png' }));
  assert.throws(() => codec.renderSvg(c, { avatar: 'data:image/svg+xml;base64,PHN2Zz4=' }));
  assert.equal(codec.encode('  https://a.cn  ').text, 'https://a.cn');
});
test('changed payload bits and format bits fail integrity validation', () => {
  const c = codec.encode('https://example.com');
  let m = structuredClone(c.matrix);
  m[1][6] ^= 1;
  assert.throws(() => codec.decode(m, c.version));
  m = structuredClone(c.matrix);
  const flags = SunflowerProtocol.data[c.version];
  let changed = false;
  for (let ray = 0; ray < 72 && !changed; ray++)
    for (let ring = 0; ring < 16; ring++)
      if ((flags[ray] >>> ring) & 1) {
        m[ray][ring] ^= 1;
        changed = true;
        break;
      }
  assert.throws(() => codec.decode(m, c.version));
});
test('additional Unicode, fragments and query strings round-trip across all profiles that fit', () => {
  for (const path of ['', '?x=0', '/测试', '/😀', '/#abc', '/a%2Fb', '/?x=1&y=2', '/a-b_~']) {
    const text = 'https://a.cn' + path;
    const c = codec.encode(text);
    assert.equal(codec.decode(c.matrix, c.version), text);
  }
});

test('capacity failures are typed separately from URL and setting errors', () => {
  const long = 'https://example.com/?q=' + 'a'.repeat(800);
  assert.equal(codec.validateUrl(long), long);
  assert.throws(() => codec.encode(long), codec.CapacityError);
  for (const input of ['#小程序://测试/Abc123', 'plain text', 'ftp://a.cn'])
    assert.throws(
      () => codec.encode(input),
      (error) => !(error instanceof codec.CapacityError),
    );
  assert.throws(
    () => codec.encode('https://a.cn', { version: 3 }),
    (error) => !(error instanceof codec.CapacityError),
  );
  for (const text of ['http://example.com', 'https://example.com', 'HTTPS://example.com']) {
    const c = codec.encode(text);
    assert.equal(codec.decode(c.matrix, c.version), text);
  }
  const prefix = 'https://a.cn/%';
  const limit = prefix + 'x'.repeat(44 - prefix.length);
  assert.equal(codec.decode(codec.encode(limit).matrix, 2), limit);
  assert.throws(() => codec.encode(limit + 'x'), codec.CapacityError);
});
