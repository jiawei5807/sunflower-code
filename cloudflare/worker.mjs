/* SPDX-License-Identifier: MIT */
const json = (status, data) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

// Best-effort per-isolate throttle; use Cloudflare rate limiting for a global limit.
export function createWorker(fetchImpl = fetch) {
  const rates = new Map();
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (url.pathname === '/config.js') {
        return new Response('window.SUNFLOWER_CONFIG = { shortenEndpoint: "/api/shorten" };', {
          headers: {
            'content-type': 'text/javascript; charset=utf-8',
            'cache-control': 'no-store',
          },
        });
      }
      if (url.pathname !== '/api/shorten') return env.ASSETS.fetch(request);
      if (request.method !== 'POST') return json(405, { success: false });
      if (request.headers.get('origin') !== url.origin) return json(403, { success: false });
      if (!request.headers.get('content-type')?.startsWith('application/json'))
        return json(415, { success: false });
      if (!env.ACEDATA_TOKEN?.trim()) return json(503, { success: false });
      const now = Date.now(),
        ip = request.headers.get('cf-connecting-ip') || 'unknown';
      for (const [key, value] of rates) if (now - value.start >= 60000) rates.delete(key);
      const entry = rates.get(ip) || { start: now, count: 0 };
      if (entry.count >= 30 || (!rates.has(ip) && rates.size >= 10000))
        return json(429, { success: false });
      entry.count++;
      rates.set(ip, entry);
      if (Number(request.headers.get('content-length')) > 32768)
        return json(413, { success: false });
      const reader = request.body?.getReader();
      if (!reader) return json(400, { success: false });
      let text = '';
      try {
        const decoder = new TextDecoder();
        let size = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 32768) {
            await reader.cancel();
            return json(413, { success: false });
          }
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
      } catch {
        return json(400, { success: false });
      } finally {
        reader.releaseLock();
      }
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        return json(400, { success: false });
      }
      if (
        typeof body?.content !== 'string' ||
        body.content.length > 5000 ||
        !/^https?:\/\//i.test(body.content) ||
        /[\s\x00-\x1f\x7f]/.test(body.content)
      )
        return json(400, { success: false });
      try {
        new URL(body.content);
      } catch {
        return json(400, { success: false });
      }
      try {
        const response = await fetchImpl('https://api.acedata.cloud/shorturl', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${env.ACEDATA_TOKEN.trim()}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ content: body.content }),
          // Workers supports only follow/manual. Reject 3xx below without forwarding credentials.
          redirect: 'manual',
          signal: AbortSignal.timeout(20000),
        });
        if (!response.ok)
          return json([401, 402, 403, 429].includes(response.status) ? response.status : 502, {
            success: false,
          });
        const result = await response.json();
        if (
          result?.success !== true ||
          typeof result?.data?.url !== 'string' ||
          !/^https:\/\/surl\.id\/r\/[A-Za-z0-9_-]{1,64}$/.test(result.data.url)
        )
          return json(502, { success: false });
        return json(200, { success: true, data: { url: result.data.url } });
      } catch {
        return json(502, { success: false });
      }
    },
  };
}
export default createWorker();
