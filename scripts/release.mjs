import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
for (const command of ['check', 'test', 'build']) {
  const p = spawnSync('npm', ['run', command], { cwd: root, stdio: 'inherit' });
  if (p.status !== 0) process.exit(p.status || 1);
}
const output = path.join(root, 'release/sunflower-code');
await rm(path.join(root, 'release'), { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const name of [
  '.prettierignore',
  '.prettierrc.json',
  'index.html',
  'config.js',
  'guide.html',
  'algorithm.html',
  'src',
  'public',
  'docs',
  'scripts',
  'tests',
  '.github',
  '.gitignore',
  '.env.example',
  'package.json',
  'package-lock.json',
  'README.md',
  'LICENSE',
  'NOTICE',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'CHANGELOG.md',
])
  await cp(path.join(root, name), path.join(output, name), {
    recursive: true,
    filter: (src) => !src.includes('__pycache__') && !src.endsWith('.pyc'),
  });
console.log(
  'Release source staged in release/sunflower-code/. See NOTICE for pending third-party authorization.',
);
