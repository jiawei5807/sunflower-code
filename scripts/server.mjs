import http from 'node:http';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};
export async function localEnv() {
  let text = '';
  try {
    text = await readFile(path.join(root, '.env.local'), 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1).trim()];
      }),
  );
}
export function createApp() {
  return http.createServer(async (req, res) => {
    const send = (status, data) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      return send(400, { success: false });
    }
    if (!['GET', 'HEAD'].includes(req.method)) return send(405, { success: false });
    // Serve only public app assets. Never expose .env, repository metadata or test files.
    let relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (
      !(
        /^(index|guide|algorithm)\.html$/.test(relative) ||
        /^src\/(core|services|ui|styles)\/[A-Za-z0-9._/-]+$/.test(relative) ||
        /^vendor\/[A-Za-z0-9._-]+$/.test(relative)
      )
    )
      return send(404, { success: false });
    if (relative.split('/').some((part) => part === '..' || part.startsWith('.')))
      return send(404, { success: false });
    if (relative.startsWith('vendor/')) relative = 'public/' + relative;
    const file = path.join(root, relative);
    try {
      if (!(await stat(file)).isFile()) return send(404, { success: false });
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': mime[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      return send(404, { success: false });
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const env = { ...(await localEnv()), ...process.env };
  const port = Number(env.PORT || 5173),
    host = env.HOST || '127.0.0.1';
  createApp().listen(port, host, () => console.log(`Sunflower Code: http://${host}:${port}`));
}
