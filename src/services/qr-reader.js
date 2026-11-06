/* SPDX-License-Identifier: MIT */
'use strict';
(() => {
  const check = (signal) => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  };
  async function read(file, signal) {
    check(signal);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
      throw new Error('请选择 PNG、JPG 或 WebP 二维码图片。');
    if (file.size > 10 * 1024 * 1024) throw new Error('二维码图片超过 10 MB，请压缩后再上传。');
    const url = URL.createObjectURL(file),
      image = new Image();
    try {
      await new Promise((resolve, reject) => {
        let timer;
        const finish = (cause) => {
          clearTimeout(timer);
          image.onload = image.onerror = null;
          signal?.removeEventListener('abort', abort);
          cause ? reject(cause) : resolve();
        };
        const abort = () => {
          image.src = '';
          finish(new DOMException('Aborted', 'AbortError'));
        };
        image.onload = () => finish();
        image.onerror = () => finish(new Error('二维码图片无法读取，请更换图片后重试。'));
        signal?.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => {
          image.src = '';
          finish(new Error('二维码图片读取超时，请更换图片后重试。'));
        }, 15000);
        image.src = url;
      });
      check(signal);
      const width = image.naturalWidth,
        height = image.naturalHeight;
      if (!width || !height || width * height > 40000000)
        throw new Error('二维码图片尺寸过大，请裁剪到二维码区域后重试。');
      const canvas = document.createElement('canvas'),
        context = canvas.getContext('2d', { willReadFrequently: true });
      try {
        const longest = Math.max(width, height),
          first = Math.min(1200, longest);
        // Rounded or separated modules can confuse local thresholding at one scale.
        // Keep the original fast path, then retry bounded sizes without blurring the gaps.
        const attempts = [
          [first, true],
          [Math.min(2400, longest), true],
          [Math.round(first * 0.875), false],
          [Math.round(first * 0.75), false],
          [Math.round(first * 0.5), false],
        ];
        if (longest < 600) attempts.push([longest * 2, false]);
        const tried = new Set();
        for (const [edge, smoothing] of attempts) {
          const key = edge + ':' + smoothing;
          if (tried.has(key)) continue;
          tried.add(key);
          await new Promise((resolve) => setTimeout(resolve, 0));
          check(signal);
          const scale = edge / longest;
          canvas.width = Math.max(1, Math.round(width * scale));
          canvas.height = Math.max(1, Math.round(height * scale));
          context.imageSmoothingEnabled = smoothing;
          context.fillStyle = '#fff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
          const result = jsQR(pixels.data, pixels.width, pixels.height, {
            inversionAttempts: 'attemptBoth',
          });
          check(signal);
          if (result?.data) return result.data;
        }
        throw new Error('未识别到二维码，请上传清晰、完整的二维码图片。');
      } finally {
        canvas.width = canvas.height = 1;
      }
    } finally {
      image.src = '';
      URL.revokeObjectURL(url);
    }
  }
  globalThis.SunflowerQR = { read };
})();
