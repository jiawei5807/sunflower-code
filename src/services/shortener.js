/* SPDX-License-Identifier: MIT */
'use strict';
(() => {
  const cache = new Map();
  let limitedUntil = 0;
  const limitMessage = '转链请求过于频繁，请至少等待一分钟后重试。';

  async function shorten(url, signal) {
    if (cache.has(url)) return cache.get(url);
    if (Date.now() < limitedUntil) throw new Error(limitMessage);

    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
    let response, shortUrl;
    try {
      response = await fetch('https://da.gd/s', {
        method: 'POST',
        headers: { accept: 'text/plain' },
        body: new URLSearchParams({ url }),
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        redirect: 'error',
        signal: requestSignal,
      });
      if (response.ok) shortUrl = (await response.text()).trim();
    } catch (error) {
      if (signal.aborted) throw error;
      if (requestSignal.aborted) throw new Error('转链超时，请稍后重试。');
      throw new Error('浏览器无法连接转链服务，请检查网络或稍后重试。');
    }
    if (response.status === 429) {
      limitedUntil = Date.now() + 60000;
      throw new Error(limitMessage);
    }
    if (!response.ok) throw new Error('转链服务返回 HTTP ' + response.status + '，请稍后重试。');
    if (!/^https:\/\/da\.gd\/[A-Za-z0-9_-]{1,10}$/.test(shortUrl))
      throw new Error('转链服务返回的短链无效，请重试。');
    if (cache.size >= 256) cache.delete(cache.keys().next().value);
    cache.set(url, shortUrl);
    return shortUrl;
  }
  globalThis.SunflowerShortener = { shorten };
})();
