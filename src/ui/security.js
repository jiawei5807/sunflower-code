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
      $('admin-recovery-link').hidden = !forgot;
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
    $('reset-recovery-fields').hidden = Boolean(token);
    $('reset-username').required = $('reset-recovery').required = !token;
    $('reset-recovery-hint').hidden = Boolean(token);
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
            ...(!token
              ? {
                  username: $('reset-username').value.trim(),
                  recoveryCode: $('reset-recovery').value.trim(),
                }
              : {}),
          },
        });
        $('reset-form').hidden = true;
        $('auth-help').textContent = token
          ? '密码已重置，请重新登录。'
          : '密码已重置，二次验证已关闭。请登录后重新绑定验证器。';
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
    const [contact, mfa] = await Promise.all([
      AppAPI.request('/api/support'),
      AppAPI.request('/api/admin/mfa'),
    ]);
    $('support-contact').value = contact.contact;
    $('support-url').value = contact.url;
    $('mfa-status').textContent = mfa.enabled
      ? `已启用 · 剩余 ${mfa.recoveryCodesRemaining} 个备用恢复码`
      : '未启用';
    $('mfa-setup').hidden = mfa.enabled;
    $('mfa-disable-form').hidden = !mfa.enabled;
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
    $('mfa-setup').onsubmit = async (event) => {
      event.preventDefault();
      event.submitter.disabled = true;
      show('');
      try {
        const result = await AppAPI.request('/api/admin/mfa/setup', {
          method: 'POST',
          body: { password: $('mfa-password').value },
        });
        $('mfa-secret').textContent = result.secret;
        $('mfa-bind').hidden = false;
      } catch (error) {
        show(error.message);
      } finally {
        event.submitter.disabled = false;
      }
    };
    $('mfa-enable').onclick = async () => {
      $('mfa-enable').disabled = true;
      show('');
      try {
        const result = await AppAPI.request('/api/admin/mfa/enable', {
          method: 'POST',
          body: { password: $('mfa-password').value, code: $('mfa-code').value.trim() },
        });
        $('mfa-setup').hidden = true;
        $('mfa-bind').hidden = true;
        $('mfa-status').textContent = '已启用，请保存备用恢复码后重新登录';
        $('mfa-password').value = '';
        $('mfa-secret').textContent = '';
        $('mfa-recovery-codes').value = result.recoveryCodes.join('\n');
        $('mfa-recovery-result').hidden = false;
      } catch (error) {
        show(error.message);
      } finally {
        $('mfa-enable').disabled = false;
      }
    };
    $('mfa-save-codes').onclick = () => {
      AppAPI.save(
        new Blob(['葵花码备用恢复码（每个只能使用一次）\n' + $('mfa-recovery-codes').value], {
          type: 'text/plain',
        }),
        'txt',
      );
    };
    $('mfa-disable-form').onsubmit = async (event) => {
      event.preventDefault();
      event.submitter.disabled = true;
      try {
        await AppAPI.request('/api/admin/mfa/disable', {
          method: 'POST',
          body: {
            password: $('mfa-disable-password').value,
            code: $('mfa-disable-code').value.trim(),
          },
        });
        location.assign('/login');
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
            code: document.getElementById('reset-admin-code').value.trim(),
          },
        });
        document.getElementById('reset-link').value = result.url;
        document.getElementById('reset-result').hidden = false;
        document.getElementById('reset-admin-password').value = '';
        document.getElementById('reset-admin-code').value = '';
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
