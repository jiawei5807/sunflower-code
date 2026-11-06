import { Miniflare } from 'miniflare';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const local = {};
try {
  for (const line of (await readFile(path.join(root, '.env.local'), 'utf8')).split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) local[m[1]] = m[2].trim();
  }
} catch {}
const env = { ...local, ...process.env };
const state = env.LOCAL_STATE || path.join(root, '.wrangler/state');
const mf = new Miniflare({
  modules: true,
  scriptPath: path.join(root, 'dist/_worker.js'),
  compatibilityDate: '2026-07-01',
  host: '127.0.0.1',
  port: Number(env.PORT || 5173),
  d1Databases: { DB: 'sunflower-db' },
  r2Buckets: { IMAGES: 'sunflower-images' },
  d1Persist: path.join(state, 'd1'),
  r2Persist: path.join(state, 'r2'),
  bindings: {
    ADMIN_USERNAME: env.ADMIN_USERNAME || 'admin',
    ADMIN_PASSWORD: env.ADMIN_PASSWORD || '',
    ACEDATA_TOKEN: env.ACEDATA_TOKEN || '',
    MFA_ENCRYPTION_KEY: env.MFA_ENCRYPTION_KEY || '',
  },
  serviceBindings: {
    ASSETS: async (request) => {
      const pathname = decodeURIComponent(new URL(request.url).pathname);
      const assetPath =
        pathname === '/' ? '/index.html' : path.extname(pathname) ? pathname : pathname + '.html';
      const file = path.resolve(root, 'dist', '.' + assetPath);
      if (!file.startsWith(path.join(root, 'dist') + path.sep) || pathname.includes('_worker'))
        return new Response('Not found', { status: 404 });
      try {
        const bytes = await readFile(file);
        return new Response(bytes, {
          headers: {
            'content-type':
              {
                '.html': 'text/html',
                '.js': 'text/javascript',
                '.css': 'text/css',
                '.txt': 'text/plain',
              }[path.extname(file)] || 'application/octet-stream',
          },
        });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    },
  },
});
const db = await mf.getD1Database('DB');
await db.prepare('CREATE TABLE IF NOT EXISTS local_migrations(name TEXT PRIMARY KEY)').run();
for (const name of (await readdir(path.join(root, 'migrations'))).sort()) {
  if (await db.prepare('SELECT name FROM local_migrations WHERE name=?').bind(name).first())
    continue;
  const sql = await readFile(path.join(root, 'migrations', name), 'utf8');
  await db.exec(sql.replace(/\n/g, ' '));
  await db.prepare('INSERT INTO local_migrations VALUES(?)').bind(name).run();
}
console.log('Local application ready:', String(await mf.ready));
if (!env.ADMIN_PASSWORD)
  console.log('Set ADMIN_PASSWORD in .env.local before the first administrator login.');
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, async () => {
    await mf.dispose();
    process.exit(0);
  });
