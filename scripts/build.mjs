import { mkdir, rm, cp, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const docs = spawnSync('python3', ['scripts/render-docs.py'], { cwd: root, stdio: 'inherit' });
if (docs.status !== 0) process.exit(docs.status || 1);
const dist = path.join(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist);
for (const name of [
  'index.html',
  'guide.html',
  'algorithm.html',
  'config.js',
  'src',
  'public/vendor',
]) {
  await cp(path.join(root, name), path.join(dist, name === 'public/vendor' ? 'vendor' : name), {
    recursive: true,
  });
}
for (const name of ['index.html', 'guide.html', 'algorithm.html']) {
  let html = await readFile(path.join(dist, name), 'utf8');
  const matches = [...html.matchAll(/(?:src|href)="((?:src|vendor)\/[^"?]+)(?:\?v=[a-z0-9]+)?"/g)];
  for (const [, asset] of matches) {
    const data = await readFile(path.join(dist, asset));
    const hash = createHash('sha256').update(data).digest('hex').slice(0, 12);
    html = html.replaceAll(`"${asset}"`, `"${asset}?v=${hash}"`);
  }
  await writeFile(path.join(dist, name), html);
}
console.log('Built static site in dist/ (no private configuration).');
