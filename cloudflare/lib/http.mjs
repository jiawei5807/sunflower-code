export class HttpError extends Error {
  constructor(status, message, code = '') {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extra,
    },
  });
export async function readJSON(request, limit = 800000) {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new HttpError(415, '请使用 JSON 请求。');
  if (Number(request.headers.get('content-length')) > limit)
    throw new HttpError(413, '提交内容过大。');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, '请求内容为空。');
  let size = 0,
    text = '';
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new HttpError(413, '提交内容过大。');
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  try {
    const result = JSON.parse(text);
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw Error();
    return result;
  } catch {
    throw new HttpError(400, '请求内容不正确。');
  }
}
export function sameOrigin(request) {
  if (request.headers.get('origin') !== new URL(request.url).origin)
    throw new HttpError(403, '请求来源不匹配，请刷新页面重试。');
}
export const pageNumber = (url) =>
  Math.max(1, Math.min(10000, Number.parseInt(url.searchParams.get('page'), 10) || 1));
export const publicUser = (user) => ({
  id: user.id,
  username: user.username,
  role: user.role,
  status: user.status,
  createdAt: user.created_at,
  lastLoginAt: user.last_login_at,
});
