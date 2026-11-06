/* SPDX-License-Identifier: MIT */
'use strict';
globalThis.AppSecurity = {
  async publicHelp() {
    const $ = (id) => document.getElementById(id),
      dialog = $('auth-support-dialog');
    const showHelp = (forgot) => {
      $('auth-support-title').textContent = forgot ? '找回密码' : '联系支持';
      $('auth-support-hint').textContent = forgot
        ? '联系管理员获取密码重置链接。'
        : '获取邀请或使用帮助，请联系管理员。';
      dialog.showModal();
    };
    $('forgot-open').onclick = () => showHelp(true);
    $('support-open').onclick = () => showHelp(false);
    $('auth-support-close').onclick = () => dialog.close();
    const data = await AppAPI.request('/api/support');
    document.querySelectorAll('[data-support]').forEach((node) => {
      node.textContent = data.contact || '请联系邀请你的管理员。';
      if (data.url) {
        const a = document.createElement('a');
        a.href = data.url;
        a.textContent = '联系支持';
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        node.append(document.createElement('br'), a);
      }
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
    const contact = await AppAPI.request('/api/support');
    $('support-contact').value = contact.contact;
    $('support-url').value = contact.url;
    $('support-form').onsubmit = async (event) => {
      event.preventDefault();
      event.submitter.disabled = true;
      try {
        await AppAPI.request('/api/admin/support', {
          method: 'POST',
          body: { contact: $('support-contact').value, url: $('support-url').value },
        });
        show('联系方式已保存，登录页已同步。');
      } catch (error) {
        show(error.message);
      } finally {
        event.submitter.disabled = false;
      }
    };
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
