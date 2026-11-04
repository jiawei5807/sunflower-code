import '../../src/core/protocol-data.js';
import '../../src/core/codec.js';
import { HttpError } from './http.mjs';
import { digest, limit } from './auth.mjs';
const codec = globalThis.SunflowerCode;
export function validateAppearance(body) {
  const size = Number(body.size || 1024),
    avatar = body.avatar || '';
  if (![512, 1024, 2048].includes(size)) throw new HttpError(400, '图片尺寸不正确。');
  if (
    typeof avatar !== 'string' ||
    avatar.length > 700000 ||
    (avatar && !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(avatar))
  )
    throw new HttpError(400, '头像格式不正确，请重新上传。');
  if (avatar) {
    let bytes;
    try {
      bytes = atob(avatar.split(',')[1]);
    } catch {
      throw new HttpError(400, '头像无法读取。');
    }
    if (
      bytes.length < 33 ||
      bytes.slice(0, 8) !== '\x89PNG\r\n\x1a\n' ||
      bytes.slice(12, 16) !== 'IHDR'
    )
      throw new HttpError(400, '头像必须是 PNG 图片。');
    const u32 = (i) =>
      bytes.charCodeAt(i) * 0x1000000 +
      (bytes.charCodeAt(i + 1) << 16) +
      (bytes.charCodeAt(i + 2) << 8) +
      bytes.charCodeAt(i + 3);
    if (!u32(16) || !u32(20) || u32(16) > 1024 || u32(20) > 1024)
      throw new HttpError(400, '头像尺寸过大。');
  }
  return { size, avatar };
}
async function shorten(env, text, fetchImpl) {
  if (!env.ACEDATA_TOKEN?.trim()) throw new HttpError(503, '转链服务未配置，请联系管理员。');
  let r;
  try {
    r = await fetchImpl('https://api.acedata.cloud/shorturl', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.ACEDATA_TOKEN.trim()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ content: text }),
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new HttpError(502, '转链服务连接失败，请稍后重试。');
  }
  if (r.status === 429) throw new HttpError(429, '转链服务请求过于频繁，请稍后重试。');
  if (!r.ok) throw new HttpError(502, '转链服务暂不可用，请联系管理员。');
  let result;
  try {
    result = await r.json();
  } catch {
    throw new HttpError(502, '转链服务返回异常。');
  }
  if (
    result?.success !== true ||
    !/^https:\/\/surl\.id\/r\/[A-Za-z0-9_-]{1,64}$/.test(result?.data?.url || '')
  )
    throw new HttpError(502, '转链失败，请稍后重试。');
  return result.data.url;
}
export const historyItem = (r) => ({
  id: r.id,
  originalUrl: r.original_url,
  source: r.source,
  size: r.size,
  rays: r.rays,
  level: r.level,
  createdAt: r.completed_at,
  imageUrl: `/api/history/${r.id}/image`,
});
export async function generate(env, user, body, request, fetchImpl) {
  let content;
  try {
    content = codec.validateUrl(body.content);
  } catch (e) {
    throw new HttpError(400, e.message || '请输入有效网址。');
  }
  const appearance = validateAppearance(body),
    options = { version: body.version ?? 'auto', level: body.level ?? 'auto' };
  if (
    !['auto', '0', '1', '2'].includes(String(options.version)) ||
    !['auto', 'L', 'M', 'Q', 'H'].includes(options.level)
  )
    throw new HttpError(400, '编码设置无效。');
  const key = request.headers.get('idempotency-key');
  if (!key || !/^[a-zA-Z0-9_-]{16,80}$/.test(key))
    throw new HttpError(400, '请求标识无效，请刷新页面。');
  const source = body.source === 'qr' ? 'qr' : 'link';
  const hash = await digest(JSON.stringify({ content, ...appearance, ...options, source }));
  let existing = await env.DB.prepare('SELECT * FROM generations WHERE user_id=? AND request_key=?')
    .bind(user.id, key)
    .first();
  if (existing) {
    if (existing.payload_hash !== hash) throw new HttpError(409, '请求内容已变更，请重新生成。');
    if (existing.state === 'ready') {
      const saved = await env.IMAGES.get(existing.object_key);
      if (!saved) throw new HttpError(503, '历史图片暂不可用。');
      return { ...historyItem(existing), svg: await saved.text() };
    }
    throw new HttpError(
      409,
      existing.state === 'pending'
        ? '请求正在处理，请稍后到历史记录查看。'
        : '上次生成失败，请重新生成。',
    );
  }
  await limit(env.DB, 'generate:' + user.id, 30, 60000);
  const id = crypto.randomUUID(),
    now = Date.now();
  const inserted = await env.DB.prepare(
    "INSERT OR IGNORE INTO generations(id,user_id,request_key,payload_hash,original_url,source,state,created_at) VALUES(?,?,?,?,?,?,'pending',?)",
  )
    .bind(id, user.id, key, hash, content, source, now)
    .run();
  if (inserted.meta.changes !== 1) throw new HttpError(409, '请求正在处理，请稍后到历史记录查看。');
  const objectKey = `users/${user.id}/${id}.svg`;
  try {
    let encoded;
    try {
      encoded = codec.encode(content, options);
    } catch (e) {
      if (!(e instanceof codec.CapacityError)) throw e;
      const short = await shorten(env, content, fetchImpl);
      try {
        encoded = codec.encode(short, options);
      } catch {
        throw new HttpError(400, '短链仍超出容量，请将射线和纠错改为自动。');
      }
    }
    const svg = codec.renderSvg(encoded, appearance);
    await env.IMAGES.put(objectKey, svg, { httpMetadata: { contentType: 'image/svg+xml' } });
    const row = await env.DB.prepare(
      "UPDATE generations SET state='ready',encoded_url=?,object_key=?,size=?,rays=?,level=?,completed_at=? WHERE id=? RETURNING *",
    )
      .bind(
        encoded.text,
        objectKey,
        appearance.size,
        [36, 54, 72][encoded.version],
        encoded.level,
        Date.now(),
        id,
      )
      .first();
    return { ...historyItem(row), svg };
  } catch (error) {
    // If final D1 commit succeeded but its response was lost, keep the successful record/object.
    const row = await env.DB.prepare('SELECT state FROM generations WHERE id=?').bind(id).first();
    if (row?.state !== 'ready') {
      await env.DB.prepare("UPDATE generations SET state='failed' WHERE id=? AND state='pending'")
        .bind(id)
        .run();
      await env.IMAGES.delete(objectKey).catch(() => {});
    }
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, '图片保存失败，请稍后重试。');
  }
}
