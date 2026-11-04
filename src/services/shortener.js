/* SPDX-License-Identifier: MIT */
'use strict';
(() => {
  const API = 'https://api.acedata.cloud/shorturl';
  let token = '',
    limitedUntil = 0;
  const cache = new Map();
  const endpoint = () => {
    const path = globalThis.SUNFLOWER_CONFIG?.shortenEndpoint;
    return typeof path === 'string' && /^\/(?!\/)[^\\?#]*$/.test(path) ? path : '';
  };
  const configured = () => Boolean(endpoint() || token);
  async function shorten(text, signal) {
    if (cache.has(text)) return cache.get(text);
    if (!configured()) {
      const error = new Error('网址超过容量，请先设置自动转链，或输入一个更短的网址。');
      error.code = 'SHORTENER_NOT_CONFIGURED';
      throw error;
    }
    if (Date.now() < limitedUntil) throw new Error('转链请求过于频繁，请至少等待一分钟后重试。');
    const path = endpoint();
    let response;
    try {
      response = await fetch(path || API, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        headers: {
          'content-type': 'application/json',
          ...(!path ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ content: text }),
        signal,
      });
    } catch (cause) {
      if (cause.name === 'AbortError') throw cause;
      throw new Error('无法连接转链服务，请检查网络或稍后重试。');
    }
    if (response.status === 429) {
      limitedUntil = Date.now() + 60000;
      throw new Error('转链请求过于频繁，请至少等待一分钟后重试。');
    }
    if ([401, 403].includes(response.status))
      throw new Error('转链认证失败，请检查 Token 或账号权限。');
    if (response.status === 402) throw new Error('转链账号额度不足，请检查账号余额或配额。');
    if (response.status === 503) throw new Error('转链服务暂不可用，请联系站点维护者或稍后重试。');
    let result;
    try {
      result = await response.json();
    } catch (cause) {
      if (cause.name === 'AbortError') throw cause;
      throw new Error('转链服务返回异常，请稍后重试。');
    }
    if (!response.ok || result?.success !== true)
      throw new Error('转链失败，请检查网址或账号状态后重试。');
    const shortUrl = result?.data?.url;
    if (
      typeof shortUrl !== 'string' ||
      !/^https:\/\/surl\.id\/r\/[A-Za-z0-9_-]{1,64}$/.test(shortUrl)
    )
      throw new Error('转链服务返回了无效短链接，请重试。');
    if (cache.size >= 256) cache.delete(cache.keys().next().value);
    cache.set(text, shortUrl);
    return shortUrl;
  }
  globalThis.SunflowerShortener = {
    shorten,
    configured,
    serverConfigured: () => Boolean(endpoint()),
    setToken(value) {
      token = value.trim();
      cache.clear();
      limitedUntil = 0;
    },
    hasToken: () => Boolean(token),
  };
})();
