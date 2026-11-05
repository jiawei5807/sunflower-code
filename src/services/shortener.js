/* SPDX-License-Identifier: MIT */
'use strict';
globalThis.SunflowerShortener = {
  async shorten(content, signal) {
    // No persistence: the credential is visible to the signed-in browser for this request.
    const { token } = await AppAPI.request('/api/shortener/config', {
      method: 'POST',
      body: {},
      signal,
    });
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
    let response;
    try {
      response = await fetch('https://api.acedata.cloud/shorturl', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ content }),
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        redirect: 'error',
        signal: requestSignal,
      });
    } catch (error) {
      if (signal.aborted) throw error;
      if (requestSignal.aborted) throw new Error('转链超时，请稍后重试。');
      throw new Error('浏览器无法连接转链服务，请检查网络或服务商跨域访问设置。');
    }
    if (!response.ok) {
      const errors = {
        401: '转链认证失败（HTTP 401），请管理员检查 ACEDATA_TOKEN。',
        402: '转链账户余额或额度不足（HTTP 402），请管理员检查账户。',
        403: '转链服务拒绝访问（HTTP 403），请管理员检查接口权限或访问限制。',
        429: '转链服务请求过于频繁（HTTP 429），请稍后重试。',
      };
      throw new Error(
        errors[response.status] || `转链服务返回异常（HTTP ${response.status}），请稍后重试。`,
      );
    }
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error('转链服务返回异常，请稍后重试。');
    }
    if (
      result?.success !== true ||
      !/^https:\/\/surl\.id\/(?:r\/)?[A-Za-z0-9_-]{1,64}$/.test(result?.data?.url || '')
    )
      throw new Error('转链服务返回的短链无效，请联系管理员。');
    return result.data.url;
  },
};
