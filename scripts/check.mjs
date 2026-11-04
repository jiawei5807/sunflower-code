import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const files = [];
async function walk(relative) {
  for (const item of await readdir(path.join(root, relative), { withFileTypes: true })) {
    if (
      [
        '.git',
        '.env.local',
        '.env',
        '.dev.vars',
        '.wrangler',
        'node_modules',
        'dist',
        'release',
        '__pycache__',
        'test-results',
      ].includes(item.name)
    )
      continue;
    const name = path.join(relative, item.name);
    if (item.isDirectory()) await walk(name);
    else files.push(name);
  }
}
await walk('');
for (const name of files) {
  const text = await readFile(path.join(root, name), 'utf8');
  if (/Bearer\s+[a-f0-9]{32,}/i.test(text) || /SHORTEN_TOKEN\s*=\s*['"][a-f0-9]{32}/i.test(text))
    throw new Error(`Possible embedded credential: ${name}`);
  if (name.endsWith('.js') || name.endsWith('.mjs') || name.endsWith('.cjs')) {
    const p = spawnSync(process.execPath, ['--check', name], { cwd: root, stdio: 'inherit' });
    if (p.status !== 0) process.exit(p.status);
  }
}
console.log(`Checked ${files.length} files: JavaScript syntax and embedded-token patterns.`);
