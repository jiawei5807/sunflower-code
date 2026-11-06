/* SPDX-License-Identifier: MIT */
'use strict';
globalThis.AppSecurity = {
  async publicHelp() {
    const $ = (id) => document.getElementById(id),
      dialog = $('auth-support-dialog');
    let request = 0;
    const showHelp = async (forgot) => {
      const current = ++request;
      $('auth-support-title').textContent = forgot ? '找回密码' : '联系支持';
      $('auth-support-hint').textContent = '联系管理员获取密码重置链接。';
      $('auth-support-hint').hidden = !forgot;
      const image = $('auth-support-image'),
        empty = $('auth-support-empty');
      image.hidden = true;
      image.removeAttribute('src');
      empty.hidden = false;
      empty.textContent = '正在加载…';
      dialog.showModal();
      try {
        const data = await AppAPI.request('/api/support');
        if (current !== request) return;
        if (!data.imageUrl) {
          empty.textContent = '请联系邀请你的管理员。';
          return;
        }
        image.onload = () => {
          if (current === request) {
            image.hidden = false;
            empty.hidden = true;
          }
        };
        image.onerror = () => {
          if (current === request) {
            image.hidden = true;
            empty.hidden = false;
            empty.textContent = '图片加载失败，请关闭后重试。';
          }
        };
        image.src = data.imageUrl;
      } catch {
        if (current === request) empty.textContent = '联系图片加载失败，请稍后重试。';
      }
    };
    $('forgot-open').onclick = () => showHelp(true);
    $('support-open').onclick = () => showHelp(false);
    $('auth-support-close').onclick = () => dialog.close();
    dialog.addEventListener('close', () => {
      request++;
    });
  },
  async resetPage() {
    const $ = (id) => document.getElementById(id);
    $('auth-form').hidden = true;
    $('auth-title').textContent = '重置密码';
    $('auth-help').textContent = '设置新密码后，请重新登录。';
    $('auth-switch').hidden = false;
    $('auth-switch').textContent = '返回登录 →';
    $('reset-form').hidden = false;
    const token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
    if (token) history.replaceState(null, '', '/reset-password');
    if (!/^[a-f0-9]{64}$/.test(token)) {
      $('reset-form').hidden = true;
      $('auth-help').textContent = '请通过管理员提供的重置链接设置新密码。';
      return;
    }
    $('reset-form').onsubmit = async (event) => {
      event.preventDefault();
      const button = event.submitter;
      button.disabled = true;
      $('page-message').hidden = true;
      try {
        if ($('reset-new').value !== $('reset-confirm').value) throw Error('两次密码不一致。');
        await AppAPI.request('/api/auth/reset', {
          method: 'POST',
          body: {
            token,
            password: $('reset-new').value,
          },
        });
        $('reset-form').hidden = true;
        $('auth-help').textContent = '密码已重置，请重新登录。';
      } catch (error) {
        $('page-message').textContent = error.message;
        $('page-message').hidden = false;
      } finally {
        button.disabled = false;
      }
    };
  },
  async admin() {
    const $ = (id) => document.getElementById(id),
      show = (text) => {
        $('security-message').textContent = text;
      };
    let draft = null,
      saved = '',
      previewUrl = '',
      revision = 0,
      busy = false;
    const preview = (url) => {
      $('support-preview').hidden = !url;
      if (url) $('support-preview').src = url;
      else $('support-preview').removeAttribute('src');
      $('support-placeholder').textContent = url ? '点击更换图片' : '＋ 选择联系图片';
      $('support-remove').hidden = !url;
    };
    const release = () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = '';
    };
    const controls = () => {
      $('support-choose').disabled = busy;
      $('support-file').disabled = busy;
      $('support-save').disabled = busy || !draft;
      $('support-remove').disabled = busy;
    };
    const data = await AppAPI.request('/api/support');
    saved = data.imageUrl;
    preview(saved);
    controls();
    $('support-choose').onclick = () => $('support-file').click();
    $('support-file').onchange = async () => {
      const file = $('support-file').files[0];
      $('support-file').value = '';
      if (!file || busy) return;
      const current = ++revision;
      let source = '',
        canvas;
      busy = true;
      controls();
      show('正在处理图片…');
      try {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
          throw Error('请选择 PNG、JPG 或 WebP 图片。');
        if (file.size > 10 * 1024 * 1024) throw Error('图片超过 10 MB，请压缩后重试。');
        source = URL.createObjectURL(file);
        const image = new Image();
        image.src = source;
        await image.decode();
        if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 40000000)
          throw Error('图片尺寸过大，请压缩后重试。');
        const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
        canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d');
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!blob || blob.size > 2 * 1024 * 1024)
          throw Error('处理后的图片超过 2 MB，请压缩后重试。');
        if (current !== revision) return;
        draft = canvas.toDataURL('image/png');
        release();
        previewUrl = URL.createObjectURL(blob);
        preview(previewUrl);
        show('预览已更新，保存后生效。');
      } catch (error) {
        if (current === revision)
          show(error.name === 'EncodingError' ? '图片无法读取，请更换图片。' : error.message);
      } finally {
        if (source) URL.revokeObjectURL(source);
        if (canvas) canvas.width = canvas.height = 1;
        if (current === revision) {
          busy = false;
          controls();
        }
      }
    };
    $('support-form').onsubmit = async (event) => {
      event.preventDefault();
      if (!draft || busy) return;
      busy = true;
      controls();
      show('正在保存…');
      try {
        const result = await AppAPI.request('/api/admin/support', {
          method: 'POST',
          body: { image: draft },
        });
        saved = result.imageUrl;
        draft = null;
        release();
        preview(saved);
        show('图片已保存。');
      } catch (error) {
        show(error.message);
      } finally {
        busy = false;
        controls();
      }
    };
    $('support-remove').onclick = async () => {
      if (busy || !confirm('移除后，用户将看不到联系图片。继续？')) return;
      busy = true;
      controls();
      try {
        await AppAPI.request('/api/admin/support', { method: 'POST', body: { image: null } });
        saved = '';
        draft = null;
        release();
        preview('');
        show('图片已移除。');
      } catch (error) {
        show(error.message);
      } finally {
        busy = false;
        controls();
      }
    };
    window.addEventListener('pagehide', () => {
      revision++;
      release();
    });
  },
  resetDialog(user) {
    const dialog = document.getElementById('reset-dialog');
    dialog.querySelector('form').reset();
    document.getElementById('reset-result').hidden = true;
    document.getElementById('reset-error').textContent = '';
    document.getElementById('reset-target').textContent = '重置 ' + user.username + ' 的密码';
    dialog.showModal();
    dialog.querySelector('form').onsubmit = async (event) => {
      event.preventDefault();
      event.submitter.disabled = true;
      document.getElementById('reset-error').textContent = '';
      document.getElementById('reset-result').hidden = true;
      try {
        const result = await AppAPI.request('/api/admin/users/' + user.id + '/reset-password', {
          method: 'POST',
          body: {
            password: document.getElementById('reset-admin-password').value,
          },
        });
        document.getElementById('reset-link').value = result.url;
        document.getElementById('reset-result').hidden = false;
        document.getElementById('reset-admin-password').value = '';
      } catch (error) {
        document.getElementById('reset-error').textContent = error.message;
      } finally {
        event.submitter.disabled = false;
      }
    };
    document.getElementById('reset-copy').onclick = async () => {
      try {
        await navigator.clipboard.writeText(document.getElementById('reset-link').value);
        document.getElementById('reset-error').textContent = '已复制，请私下发送给该用户。';
      } catch {
        document.getElementById('reset-error').textContent = '请选中链接手动复制。';
      }
    };
  },
};
