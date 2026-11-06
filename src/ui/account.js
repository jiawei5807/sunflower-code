'use strict';
(async () => {
  const $ = (id) => document.getElementById(id),
    api = AppAPI;
  const date = (value) =>
    value
      ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
      : '—';
  const message = (text, target = 'page-message') => {
    const el = $(target);
    if (el) {
      el.textContent = text;
      el.hidden = !text;
    }
  };
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const button = (text, action) => {
    const b = el('button', text);
    b.type = 'button';
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await action();
      } catch (e) {
        message(e.message, b.closest('[role=tabpanel]')?.querySelector('[role=alert]')?.id);
      } finally {
        b.disabled = false;
      }
    });
    return b;
  };
  if ($('auth-form')) {
    AppSecurity.publicHelp().catch(() => {});
    if (location.pathname === '/reset-password') {
      await AppSecurity.resetPage();
      return;
    }
    const register = location.pathname === '/register',
      invite = new URLSearchParams(location.search).get('invite') || '';
    // Keep invitation out of address-bar history and all subsequent requests.
    if (invite) history.replaceState(null, '', '/register');
    $('auth-title').textContent = register ? '创建账号' : '欢迎回来';
    $('auth-submit').textContent = register ? '注册账号' : '登录';
    $('register-fields').hidden = !register;
    $('auth-help').textContent = register
      ? '邀请只能注册一次，注册成功后请登录。'
      : '使用你的账号登录葵花码工作台。';
    $('auth-switch').hidden = !register;
    $('auth-password').autocomplete = register ? 'new-password' : 'current-password';
    if (register && !invite) {
      message('请通过管理员提供的邀请链接注册。');
      $('auth-submit').disabled = true;
    }
    $('auth-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = $('auth-submit');
      submit.disabled = true;
      message('');
      try {
        const username = $('auth-username').value.trim(),
          password = $('auth-password').value;
        if (register && password !== $('auth-confirm').value) throw Error('两次密码不一致。');
        await api.request('/api/auth/' + (register ? 'register' : 'login'), {
          method: 'POST',
          body: {
            username,
            password,
            ...(register ? { invite } : {}),
          },
        });
        if (register) {
          $('auth-form').hidden = true;
          $('auth-help').textContent = '注册成功。';
          $('auth-switch').hidden = false;
          $('auth-switch').textContent = '前往登录 →';
        } else location.assign('/');
      } catch (e) {
        message(e.message);
      } finally {
        submit.disabled = false;
      }
    });
    return;
  }
  let user;
  try {
    user = (await api.request('/api/auth/me')).user;
  } catch {
    return;
  }
  if ($('current-user')) $('current-user').textContent = user.username;
  if ($('admin-link')) $('admin-link').hidden = user.role !== 'admin';
  $('logout')?.addEventListener('click', async () => {
    try {
      await api.request('/api/auth/logout', { method: 'POST', body: {} });
      location.assign('/login');
    } catch (error) {
      message(error.message);
    }
  });
  $('password-open')?.addEventListener('click', () => $('password-dialog').showModal());
  $('password-close')?.addEventListener('click', () => $('password-dialog').close());
  $('password-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = e.submitter;
    b.disabled = true;
    try {
      await api.request('/api/auth/password', {
        method: 'POST',
        body: {
          current: $('password-current').value,
          password: $('password-new').value,
        },
      });
      location.assign('/login');
    } catch (error) {
      $('password-message').textContent = error.message;
    } finally {
      b.disabled = false;
    }
  });
  if ($('history-list')) {
    const viewingUser = location.pathname === '/admin/history';
    const ownerId = new URLSearchParams(location.search).get('user') || '';
    if (viewingUser) {
      $('history-title').textContent = '用户生成记录';
      $('history-title').closest('.page-heading').classList.add('user-history-heading');
      $('history-description').textContent = '正在加载…';
      $('history-action').href = '/admin';
      $('history-action').textContent = '← 返回管理后台';
      $('history-empty').textContent = '该账号还没有生成记录。';
      if (user.role !== 'admin') throw Error('没有管理权限。');
      if (!/^[a-f0-9-]{36}$/.test(ownerId)) throw Error('请从管理后台选择账号。');
    }
    const endpoint = viewingUser ? `/api/admin/users/${ownerId}/history` : '/api/history';
    let query = '';
    let page = 1,
      total = 0,
      loading = false;

    async function load() {
      message('');
      const result = await api.request(
        endpoint + '?page=' + page + '&q=' + encodeURIComponent(query),
      );
      if (viewingUser) {
        $('history-title').textContent = result.user.username + ' 的生成记录';
        document.title = result.user.username + ' 的生成记录 · 葵花码';
        $('history-description').textContent =
          `共 ${result.total} 条${result.user.status === 'disabled' ? ' · 账号已停用' : ''}`;
      }
      total = result.total;
      $('history-list').replaceChildren();
      $('history-empty').hidden = result.items.length > 0;
      if (!result.items.length)
        $('history-empty').textContent = query
          ? '没有匹配的记录，请更换关键词或清除搜索。'
          : viewingUser
            ? '该账号还没有生成记录。'
            : '还没有生成记录，去生成第一张葵花码吧。';
      for (const item of result.items) {
        const card = el('article', undefined, 'history-card'),
          image = el('img');
        image.src = item.imageUrl;
        image.alt = '历史葵花码';
        image.loading = 'lazy';
        card.append(
          image,
          el(
            'p',
            item.originalUrl,
            item.originalUrl.length > 90 ? 'history-url collapsed' : 'history-url',
          ),
          el(
            'small',
            date(item.createdAt) +
              ` · ${item.rays} 条 · ${item.size}px` +
              (viewingUser ? (item.source === 'qr' ? ' · 二维码' : ' · 网页链接') : ''),
          ),
        );
        if (item.originalUrl.length > 90) {
          const expand = button('展开链接', async () => {
            const collapsed = card.querySelector('.history-url').classList.toggle('collapsed');
            expand.textContent = collapsed ? '展开链接' : '收起链接';
            expand.setAttribute('aria-expanded', String(!collapsed));
          });
          expand.className = 'expand-link';
          expand.setAttribute('aria-expanded', 'false');
          card.append(expand);
        }
        const actions = el('div', undefined, 'row-actions');
        const data = async () => {
          const r = await fetch(item.imageUrl, { credentials: 'same-origin' });
          if (!r.ok) throw Error('图片读取失败，请重新登录。');
          return r.text();
        };
        actions.append(
          button('下载 PNG', async () => api.downloadPNG(await data(), item.size)),
          button('下载 SVG', async () =>
            api.save(new Blob([await data()], { type: 'image/svg+xml' }), 'svg'),
          ),
        );
        card.append(actions);
        $('history-list').append(card);
      }
      $('history-page').textContent = `第 ${page} 页 · 共 ${result.total} 条`;
      $('history-prev').disabled = page === 1;
      $('history-next').disabled = page * 20 >= result.total;
    }
    async function turnPage(delta, nextQuery = query) {
      if (loading) return;
      loading = true;
      const previous = page,
        previousQuery = query;
      $('history-filter')
        .querySelectorAll('input,button')
        .forEach((node) => (node.disabled = true));
      page = nextQuery === query ? page + delta : 1;
      query = nextQuery;
      $('history-prev').disabled = $('history-next').disabled = true;
      try {
        await load();
      } catch (error) {
        page = previous;
        query = previousQuery;
        $('history-query').value = query;
        message(error.message);
        $('history-prev').disabled = page === 1;
        $('history-next').disabled = page * 20 >= total;
      } finally {
        $('history-filter')
          .querySelectorAll('input,button')
          .forEach((node) => (node.disabled = false));
        loading = false;
      }
    }
    $('history-filter').onsubmit = async (event) => {
      event.preventDefault();
      if (loading) return;
      await turnPage(0, $('history-query').value.trim());
    };
    $('history-clear').onclick = () => {
      if (loading) return;
      $('history-query').value = '';
      turnPage(0, '');
    };
    $('history-prev').onclick = () => turnPage(-1);
    $('history-next').onclick = () => turnPage(1);
    $('history-prev').disabled = $('history-next').disabled = true;
    await turnPage(0);
  }
  if ($('users-table')) {
    AppSecurity.admin().catch((e) => {
      $('security-message').textContent = e.message;
    });
    let userPage = 1,
      invitePage = 1;
    async function users() {
      const query = new URLSearchParams({ page: userPage, q: $('user-query').value.trim() });
      for (const name of ['from', 'to'])
        if ($('date-' + name).value) {
          const timestamp =
            Date.parse($('date-' + name).value + 'T00:00:00+08:00') +
            (name === 'to' ? 86400000 : 0);
          query.set(name, timestamp);
        }
      const r = await api.request('/api/admin/users?' + query);
      $('users-body').replaceChildren();
      for (const u of r.items) {
        const tr = el('tr');
        for (const v of [
          u.username,
          u.role === 'admin' ? '管理员' : '用户',
          u.status === 'active' ? '正常' : '已停用',
          u.generated,
          u.today,
          u.period,
          date(u.createdAt),
          date(u.lastLoginAt),
        ]) {
          const cell = el('td', v);
          cell.dataset.label = [
            '账号',
            '角色',
            '状态',
            '累计生成',
            '今日',
            '所选时段',
            '注册时间',
            '最近登录',
          ][tr.children.length];
          tr.append(cell);
        }
        const td = el('td');
        const historyLink = el('a', '查看记录', 'record-link');
        historyLink.href = '/admin/history?user=' + encodeURIComponent(u.id);
        historyLink.setAttribute('aria-label', '查看 ' + u.username + ' 的生成记录');
        td.className = 'user-actions';
        td.dataset.label = '操作';
        td.append(historyLink);
        if (u.role !== 'admin' && u.status === 'active')
          td.append(button('重置密码', async () => AppSecurity.resetDialog(u)));
        if (u.role !== 'admin')
          td.append(
            button(u.status === 'active' ? '停用' : '启用', async () => {
              if (!confirm(`${u.status === 'active' ? '停用' : '启用'}账号 ${u.username}？`))
                return;
              await api.request('/api/admin/users/' + u.id + '/status', {
                method: 'POST',
                body: { status: u.status === 'active' ? 'disabled' : 'active' },
              });
              await users();
            }),
          );
        tr.append(td);
        $('users-body').append(tr);
      }
      $('users-page').textContent = `第 ${userPage} 页 · 共 ${r.total} 个账号`;
      $('users-prev').disabled = userPage === 1;
      $('users-next').disabled = userPage * 20 >= r.total;
    }
    async function invites() {
      const r = await api.request('/api/admin/invites?page=' + invitePage);
      $('invites-body').replaceChildren();
      for (const i of r.items) {
        const state = i.used_at
            ? '已使用'
            : i.revoked_at
              ? '已撤销'
              : i.expires_at < Date.now()
                ? '已过期'
                : '待使用',
          tr = el('tr');
        for (const v of [
          i.note || '—',
          state,
          i.used_by || '—',
          date(i.expires_at),
          date(i.used_at),
        ]) {
          const cell = el('td', v);
          cell.dataset.label = ['备注', '状态', '注册账号', '到期时间', '使用时间'][
            tr.children.length
          ];
          tr.append(cell);
        }
        const td = el('td');
        td.className = 'user-actions';
        td.dataset.label = '操作';
        if (state === '待使用')
          td.append(
            button('撤销', async () => {
              if (!confirm('撤销后此邀请将无法注册，继续？')) return;
              await api.request('/api/admin/invites/' + i.id + '/revoke', {
                method: 'POST',
                body: {},
              });
              await invites();
            }),
          );
        tr.append(td);
        $('invites-body').append(tr);
      }
      $('invites-page').textContent = `第 ${invitePage} 页 · 共 ${r.total} 个邀请`;
      $('invites-prev').disabled = invitePage === 1;
      $('invites-next').disabled = invitePage * 20 >= r.total;
    }
    $('user-filter').onsubmit = (e) => {
      e.preventDefault();
      userPage = 1;
      message('', 'accounts-message');
      users().catch((e) => message(e.message, 'accounts-message'));
    };
    for (const [prefix, load, change] of [
      ['users', users, (d) => (userPage += d)],
      ['invites', invites, (d) => (invitePage += d)],
    ])
      for (const [dir, delta] of [
        ['prev', -1],
        ['next', 1],
      ])
        $(prefix + '-' + dir).onclick = () => {
          change(delta);
          const target = prefix === 'users' ? 'accounts-message' : 'invites-message';
          message('', target);
          load().catch((e) => message(e.message, target));
        };
    $('invite-form').onsubmit = async (e) => {
      e.preventDefault();
      e.submitter.disabled = true;
      message('', 'invites-message');
      try {
        const r = await api.request('/api/admin/invites', {
          method: 'POST',
          body: {
            count: Number($('invite-count').value),
            days: Number($('invite-days').value),
            note: $('invite-note').value,
          },
        });
        $('copy-invites').textContent = '复制全部链接';
        $('invite-links').value = r.items.map((x) => x.url).join('\n');
        $('invite-result').hidden = false;
        invitePage = 1;
        await invites();
      } catch (error) {
        message(error.message, 'invites-message');
      } finally {
        e.submitter.disabled = false;
      }
    };
    $('copy-invites').onclick = async () => {
      try {
        await navigator.clipboard.writeText($('invite-links').value);
        $('copy-invites').textContent = '已复制';
      } catch {
        message('无法读取剪贴板，请选中链接手动复制。', 'invites-message');
      }
    };
    await Promise.all([
      users().catch((e) => message(e.message, 'accounts-message')),
      invites().catch((e) => message(e.message, 'invites-message')),
    ]);
  }
})().catch((error) => {
  const p = document.getElementById('page-message');
  if (p) {
    p.textContent = error.message;
    p.hidden = false;
  }
});
