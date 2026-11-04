'use strict';
globalThis.AppAPI = {
  async request(path, { method = 'GET', body, key, signal } = {}) {
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(key ? { 'idempotency-key': key } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error('服务返回异常，请稍后重试。');
    }
    if (!response.ok) {
      if (response.status === 401 && !path.endsWith('/login')) location.assign('/login');
      throw new Error(data.error || '操作失败，请重试。');
    }
    return data;
  },
  async downloadPNG(svg, size = 1024) {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      canvas.getContext('2d').drawImage(img, 0, 0, size, size);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      if (!blob) throw Error('图片导出失败');
      this.save(blob, 'png');
    } finally {
      URL.revokeObjectURL(url);
    }
  },
  save(blob, extension) {
    const url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = `sunflower-${Date.now()}.${extension}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
