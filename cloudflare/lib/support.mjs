/* SPDX-License-Identifier: MIT */
import { HttpError, json, readJSON } from './http.mjs';
import { limit } from './auth.mjs';
const key = 'site/support-image.png';
const maxBytes = 2 * 1024 * 1024;
export async function support(images) {
  const object = await images.head(key);
  return { imageUrl: object ? '/api/support/image?v=' + object.etag : '' };
}
export async function supportImage(request, images) {
  const object = await images.get(key);
  if (!object) throw new HttpError(404, '暂未设置联系图片。');
  return new Response(request.method === 'HEAD' ? null : object.body, {
    headers: {
      'content-type': 'image/png',
      'content-length': String(object.size),
      'content-disposition': 'inline; filename="support.png"',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    },
  });
}
export async function saveSupport(request, env, user) {
  await limit(env.DB, 'support-image:' + user.id, 20, 60000);
  const body = await readJSON(request, Math.ceil((maxBytes * 4) / 3) + 100);
  if (body.image === null) {
    await env.IMAGES.delete(key);
    return json({ imageUrl: '' });
  }
  if (
    typeof body.image !== 'string' ||
    !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(body.image)
  )
    throw new HttpError(400, '请选择图片后保存。');
  let bytes;
  try {
    bytes = Uint8Array.from(atob(body.image.slice(22)), (char) => char.charCodeAt(0));
  } catch {
    throw new HttpError(400, '图片数据无效，请重新选择。');
  }
  if (bytes.length > maxBytes) throw new HttpError(413, '处理后的图片超过 2 MB，请压缩后重试。');
  // Accept raster PNG data only. Public reads always use a fixed image MIME type.
  const signature = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82];
  if (bytes.length < 33 || !signature.every((byte, i) => bytes[i] === byte))
    throw new HttpError(400, '图片数据无效，请重新选择。');
  const view = new DataView(bytes.buffer),
    width = view.getUint32(16),
    height = view.getUint32(20);
  if (!width || !height || width > 1600 || height > 1600)
    throw new HttpError(400, '图片尺寸无效，请重新选择。');
  // One atomic object replacement; a failed upload leaves the previous image available.
  const object = await env.IMAGES.put(key, bytes, { httpMetadata: { contentType: 'image/png' } });
  return json({ imageUrl: '/api/support/image?v=' + object.etag });
}
