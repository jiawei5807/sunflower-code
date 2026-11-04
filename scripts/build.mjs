import { mkdir, rm, cp, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('../', import.meta.url));
const docs = spawnSync('python3', ['scripts/render-docs.py'], { cwd: root, stdio: 'inherit' });
if (docs.status !== 0) process.exit(docs.status || 1);
const dist = path.join(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist);
const pages = [
  'index.html',
  'auth.html',
  'history.html',
  'admin.html',
  'guide.html',
  'algorithm.html',
];
for (const name of [...pages, 'src/ui', 'src/styles', 'src/services/qr-reader.js', 'public/vendor'])
  await cp(path.join(root, name), path.join(dist, name === 'public/vendor' ? 'vendor' : name), {
    recursive: true,
  });
for (const name of pages) {
  let html = await readFile(path.join(dist, name), 'utf8');
  for (const [, asset] of [...html.matchAll(/(?:src|href)="\/?((?:src|vendor)\/[^"?]+)"/g)]) {
    const data = await readFile(path.join(dist, asset));
    const hash = createHash('sha256').update(data).digest('hex').slice(0, 12);
    html = html
      .replaceAll(`"${asset}"`, `"/${asset}?v=${hash}"`)
      .replaceAll(`"/${asset}"`, `"/${asset}?v=${hash}"`);
  }
  await writeFile(path.join(dist, name), html);
}
await build({
  entryPoints: [path.join(root, 'cloudflare/worker.mjs')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: path.join(dist, '_worker.js'),
});
await writeFile(
  path.join(dist, '_routes.json'),
  JSON.stringify({ version: 1, include: ['/*'], exclude: [] }, null, 2),
);
console.log(
  'Built authenticated Pages application. D1 DB and private R2 IMAGES bindings required.',
);
