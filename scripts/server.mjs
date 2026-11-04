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
export function createApp({ token = '', origin = '', fetchImpl = fetch, maxRequests = 30 } = {}) {
  const rate = new Map();
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
    if (pathname === '/api/shorten') {
      if (req.method !== 'POST') return send(405, { success: false });
      if (!token) return send(503, { success: false });
      const expected = origin || `http://${req.headers.host}`;
      if (!req.headers.origin || req.headers.origin !== expected)
        return send(403, { success: false });
      if (!req.headers['content-type']?.startsWith('application/json'))
        return send(415, { success: false });
      const ip = req.socket.remoteAddress,
        now = Date.now();
      for (const [key, value] of rate) if (now - value.start > 60000) rate.delete(key);
      const entry = rate.get(ip) || { start: now, count: 0 };
      if (entry.count >= maxRequests) return send(429, { success: false });
      entry.count++;
      rate.set(ip, entry);
      try {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 32768) {
            send(413, { success: false });
            req.resume();
            return;
          }
          chunks.push(chunk);
        }
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks));
        } catch {
          return send(400, { success: false });
        }
        if (
          typeof body.content !== 'string' ||
          body.content.length > 5000 ||
          !/^[hH][tT][tT][pP][sS]?:\/\//.test(body.content) ||
          /[\s\x00-\x1f\x7f]/.test(body.content)
        )
          return send(400, { success: false });
        try {
          new URL(body.content);
        } catch {
          return send(400, { success: false });
        }
        const upstream = await fetchImpl('https://api.acedata.cloud/shorturl', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ content: body.content }),
          signal: AbortSignal.timeout(20000),
          redirect: 'error',
        });
        if (!upstream.ok)
          return send([401, 402, 403, 429].includes(upstream.status) ? upstream.status : 502, {
            success: false,
          });
        const result = await upstream.json();
        if (
          result?.success !== true ||
          typeof result?.data?.url !== 'string' ||
          !/^https:\/\/surl\.id\/r\/[A-Za-z0-9_-]{1,64}$/.test(result.data.url)
        )
          return send(502, { success: false });
        return send(200, { success: true, data: { url: result.data.url } });
      } catch {
        return send(502, { success: false });
      }
    }
    if (!['GET', 'HEAD'].includes(req.method)) return send(405, { success: false });
    if (pathname === '/config.js') {
      res.writeHead(200, { 'content-type': mime['.js'], 'cache-control': 'no-store' });
      return res.end(
        `window.SUNFLOWER_CONFIG = ${JSON.stringify({ shortenEndpoint: token ? '/api/shorten' : '' })};`,
      );
    }
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
  createApp({ token: env.ACEDATA_TOKEN || '', origin: env.PUBLIC_ORIGIN || '' }).listen(
    port,
    host,
    () => console.log(`Sunflower Code: http://${host}:${port}`),
  );
}
