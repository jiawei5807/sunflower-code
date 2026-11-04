/* SPDX-License-Identifier: MIT */
'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const api = AppAPI;
  let record = null;
  let code = null,
    avatar = '',
    png = null,
    svg = '',
    revision = 0,
    avatarRevision = 0,
    previewUrl = '',
    copyTimer;
  let generationRequest = null,
    generating = false,
    qrRequest = null;

  let sourceMode = 'link';
  const error = (message) => {
    $('error').textContent = message;
    $('error-box').hidden = !message;
    $('url').setAttribute('aria-invalid', String(Boolean(message)));

    if (message) {
      $('result-badge').textContent = '需要处理';
      $('result-badge').dataset.state = 'error';
    }
  };
  const status = (message, pending = false) => {
    $('status').textContent = message;
    $('status').classList.toggle('pending', pending);
  };
  const exportsEnabled = (enabled) => {
    for (const id of ['png', 'svg', 'copy']) $(id).disabled = !enabled;
  };
  function invalidate() {
    qrRequest?.abort();
    qrRequest = null;
    $('qr-label').textContent = '选择二维码图片';
    generationRequest?.abort();
    generationRequest = null;
    generating = false;
    $('generate').disabled = false;
    $('generate-label').textContent = '生成葵花码';
    revision++;
    code = null;
    record = null;
    png = null;
    svg = '';
    exportsEnabled(false);
    error('');
    $('preview').classList.add('stale');
    $('code-info').textContent = '等待重新生成';
    $('copy').textContent = '复制图片';
    clearTimeout(copyTimer);
    $('clear-input').hidden = !$('url').value;
    $('result-badge').textContent = '待生成';
    $('result-badge').dataset.state = 'stale';
    status('内容已修改，点击生成更新图片。', true);
  }
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('图片无法读取，请更换图片后重试。'));
      image.src = src;
    });
  }
  async function render(source) {
    if (!code) return;
    const current = ++revision,
      snapshot = code,
      size = Number($('size').value);
    exportsEnabled(false);
    png = null;
    svg = '';
    status('正在生成…', true);

    const objectUrl = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
    try {
      const image = await loadImage(objectUrl);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      canvas.getContext('2d').drawImage(image, 0, 0, size, size);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('图片导出失败，请重试。');
      if (current !== revision) return;
      png = blob;
      svg = source;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(blob);
      const preview = new Image();
      preview.src = previewUrl;
      preview.alt = '当前链接生成的葵花码';
      preview.width = size;
      preview.height = size;
      $('preview').replaceChildren(preview);
      $('preview').classList.remove('stale');
      $('code-info').textContent = `${snapshot.rays} 条射线 · ${snapshot.level} 纠错`;
      $('image-info').textContent = `${size} × ${size} PX`;
      status('已保存到历史记录，可以下载或复制图片。');
      $('result-badge').textContent = '已生成';
      $('result-badge').dataset.state = 'ready';
      exportsEnabled(true);
    } catch (cause) {
      if (current === revision) {
        error(cause.message);
        status('生成失败', true);
        $('preview').classList.add('stale');
      }
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }
  async function generate(event) {
    event?.preventDefault();
    if (generating) return;
    invalidate();
    if (sourceMode === 'qr' && $('qr-source').hidden) {
      error('请先选择一张二维码图片。');
      return;
    }
    $('result-badge').textContent = '生成中';
    $('result-badge').dataset.state = 'pending';
    const current = revision;
    const controller = new AbortController();
    generationRequest = controller;
    generating = true;
    const options = { version: $('version').value, level: $('level').value };
    const appearance = { size: Number($('size').value), avatar };
    let timeout,
      timedOut = false;
    try {
      const text = $('url').value.trim();
      if (!/^https?:\/\//i.test(text)) throw new Error('链接需要以 https:// 或 http:// 开头。');
      $('generate').disabled = true;
      $('generate-label').textContent = '生成并保存中…';
      status('正在生成并保存到历史记录…', true);
      const operationKey = crypto.randomUUID();
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 30000);
      const result = await api.request('/api/generate', {
        method: 'POST',
        body: {
          content: text,
          ...options,
          ...appearance,
          source: sourceMode,
        },
        key: operationKey,
        signal: controller.signal,
      });
      if (current !== revision) return;
      clearTimeout(timeout);
      record = result;
      code = result;
      const encoded = result;
      if (appearance.size !== Number($('size').value) || appearance.avatar !== avatar)
        await updateAppearance();
      else await render(result.svg);
      if (code === encoded && png && matchMedia('(max-width: 760px)').matches) {
        document.activeElement?.blur();
        document.querySelector('.result-panel').scrollIntoView({
          behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
          block: 'start',
        });
      }
    } catch (cause) {
      if (current !== revision) return;
      error(timedOut ? '请求超时，请先查看历史记录，确认是否已生成。' : cause.message);
      status('请检查链接或重试', true);
    } finally {
      clearTimeout(timeout);
      if (generationRequest === controller) {
        generationRequest = null;
        generating = false;
        $('generate').disabled = false;
        $('generate-label').textContent = '生成葵花码';
      }
    }
  }
  function download(blob, extension) {
    const url = URL.createObjectURL(blob),
      link = document.createElement('a');
    link.href = url;
    link.download = `sunflower-${Date.now()}.${extension}`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  $('form').addEventListener('submit', generate);
  $('choose-qr').addEventListener('click', () => $('qr-file').click());
  async function importQR(file) {
    $('qr-file').value = '';
    if (!file) return;
    switchTab('qr');
    invalidate();
    $('qr-source').hidden = true;
    const controller = new AbortController();
    qrRequest = controller;
    $('qr-label').textContent = '识别中…';
    $('generate').disabled = true;
    $('result-badge').textContent = '识别中';
    $('result-badge').dataset.state = 'pending';
    status('正在识别二维码…', true);
    try {
      const text = await SunflowerQR.read(file, controller.signal);
      if (qrRequest !== controller || controller.signal.aborted) return;
      let url;
      try {
        url = text.trim();
        if (!/^https?:\/\//i.test(url)) throw new Error('二维码必须包含 HTTP/HTTPS 网页链接。');
      } catch (cause) {
        throw new Error(`二维码内容无法转换：${cause.message}`);
      }
      $('url').value = url;
      $('qr-source').hidden = false;
      $('qr-file-name').textContent = file.name;
      $('clear-input').hidden = false;
      qrRequest = null;
      $('qr-label').textContent = '选择二维码图片';
      await generate();
    } catch (cause) {
      if (qrRequest === controller && !controller.signal.aborted) {
        error(cause.message);
        status('二维码识别失败', true);
      }
    } finally {
      if (qrRequest === controller) {
        qrRequest = null;
        $('qr-label').textContent = '选择二维码图片';
        $('generate').disabled = false;
      }
    }
  }
  $('qr-file').addEventListener('change', () => importQR($('qr-file').files[0]));
  $('url').addEventListener('input', () => {
    $('qr-source').hidden = true;
    invalidate();
  });
  for (const id of ['version', 'level']) $(id).addEventListener('change', invalidate);
  $('size').addEventListener('change', () => {
    error('');
    updateAppearance();
  });
  $('png').addEventListener('click', () => {
    if (png) download(png, 'png');
  });
  $('svg').addEventListener('click', () => {
    if (svg) download(new Blob([svg], { type: 'image/svg+xml' }), 'svg');
  });
  $('copy').addEventListener('click', async () => {
    if (!png) return;
    const current = revision;
    $('copy').disabled = true;
    error('');
    clearTimeout(copyTimer);
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined')
        throw new Error('当前环境不支持复制图片，请下载 PNG。建议通过 localhost 或 HTTPS 打开。');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      if (current !== revision) return;
      $('copy').textContent = '✓ 已复制';
      copyTimer = setTimeout(() => {
        $('copy').textContent = '复制图片';
      }, 1800);
    } catch (cause) {
      if (current === revision)
        error(
          cause.name === 'NotAllowedError'
            ? '浏览器未允许复制图片，请允许剪贴板权限，或下载 PNG。'
            : cause.message,
        );
    } finally {
      if (current === revision) $('copy').disabled = !png;
    }
  });
  $('choose-avatar').addEventListener('click', () => $('avatar').click());
  $('avatar').addEventListener('change', async () => {
    const file = $('avatar').files[0],
      current = ++avatarRevision;
    $('avatar').value = '';
    if (!file) return;
    error('');
    let localUrl;
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
        throw new Error('请选择 PNG、JPG 或 WebP 图片。');
      if (file.size > 10 * 1024 * 1024) throw new Error('头像超过 10 MB，请压缩后再上传。');
      localUrl = URL.createObjectURL(file);
      const image = await loadImage(localUrl);
      if (current !== avatarRevision) return;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 512;
      const edge = Math.min(image.naturalWidth, image.naturalHeight);
      canvas
        .getContext('2d')
        .drawImage(
          image,
          (image.naturalWidth - edge) / 2,
          (image.naturalHeight - edge) / 2,
          edge,
          edge,
          0,
          0,
          512,
          512,
        );
      avatar = canvas.toDataURL('image/png');
      const thumb = new Image();
      thumb.src = avatar;
      thumb.alt = '';
      $('avatar-preview').replaceChildren(thumb);
      $('clear-avatar').hidden = false;
      await updateAppearance();
    } catch (cause) {
      if (current === avatarRevision) error(cause.message);
    } finally {
      if (localUrl) URL.revokeObjectURL(localUrl);
    }
  });
  $('clear-avatar').addEventListener('click', () => {
    avatarRevision++;
    avatar = '';
    $('avatar').value = '';
    $('avatar-preview').textContent = '＋';
    $('clear-avatar').hidden = true;
    error('');
    updateAppearance();
  });
  window.addEventListener('pagehide', () => {
    qrRequest?.abort();
    generationRequest?.abort();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  });
  function switchTab(mode) {
    sourceMode = mode;
    for (const name of ['link', 'qr']) {
      const selected = name === mode;
      $('tab-' + name).setAttribute('aria-selected', String(selected));
      $('tab-' + name).tabIndex = selected ? 0 : -1;
      $('panel-' + name).hidden = !selected;
    }
  }
  for (const name of ['link', 'qr']) {
    $('tab-' + name).addEventListener('click', () => {
      if (qrRequest || generating) invalidate();
      switchTab(name);
    });
    $('tab-' + name).addEventListener('keydown', (event) => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next =
          event.key === 'Home'
            ? 'link'
            : event.key === 'End'
              ? 'qr'
              : name === 'link'
                ? 'qr'
                : 'link';
        if (qrRequest || generating) invalidate();
        switchTab(next);
        $('tab-' + next).focus();
      }
    });
  }
  $('edit-qr-link').addEventListener('click', () => {
    switchTab('link');
    $('url').focus();
  });
  $('clear-input').addEventListener('click', () => {
    $('url').value = '';
    $('qr-source').hidden = true;
    invalidate();
    $('url').focus();
  });
  $('example').addEventListener('click', () => {
    $('url').value = 'https://example.com';
    generate();
  });
  for (const event of ['dragenter', 'dragover'])
    $('choose-qr').addEventListener(event, (e) => {
      e.preventDefault();
      $('choose-qr').classList.add('dragging');
    });
  for (const event of ['dragleave', 'drop'])
    $('choose-qr').addEventListener(event, (e) => {
      e.preventDefault();
      $('choose-qr').classList.remove('dragging');
    });
  $('choose-qr').addEventListener('drop', (event) => importQR(event.dataTransfer.files[0]));
  document.addEventListener('paste', (event) => {
    if (sourceMode !== 'qr') return;
    const item = [...event.clipboardData.items].find(
      (item) => item.kind === 'file' && item.type.startsWith('image/'),
    );
    if (item) {
      event.preventDefault();
      importQR(item.getAsFile());
    }
  });
  async function updateAppearance() {
    if (!record) return;
    const previous = record,
      current = ++revision;
    exportsEnabled(false);
    status('正在保存外观…', true);
    try {
      const result = await api.request('/api/history/' + previous.id + '/appearance', {
        method: 'POST',
        body: { size: Number($('size').value), avatar },
      });
      if (current !== revision) return;
      record = result;
      code = result;
      await render(result.svg);
    } catch (cause) {
      if (current === revision) {
        error(cause.message);
        status('保存失败，请重试。', true);
      }
    }
  }
})();
