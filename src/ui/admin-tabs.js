/* SPDX-License-Identifier: MIT */
'use strict';
(() => {
  const tabs = [...document.querySelectorAll('[data-admin-tab]')];
  if (!tabs.length) return;
  const activate = (name, { navigate = false, focus = false } = {}) => {
    const active = tabs.find((tab) => tab.dataset.adminTab === name) || tabs[0];
    for (const tab of tabs) {
      const selected = tab === active;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
    }
    if (focus) active.focus();
    if (navigate) {
      const url = new URL(location.href);
      if (active === tabs[0]) url.searchParams.delete('tab');
      else url.searchParams.set('tab', active.dataset.adminTab);
      if (url.href !== location.href) history.pushState(null, '', url);
    }
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(tab.dataset.adminTab, { navigate: true }));
    tab.addEventListener('keydown', (event) => {
      const next = {
        ArrowRight: (index + 1) % tabs.length,
        ArrowLeft: (index + tabs.length - 1) % tabs.length,
        Home: 0,
        End: tabs.length - 1,
      }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      activate(tabs[next].dataset.adminTab, { navigate: true, focus: true });
    });
  });
  const restore = () => activate(new URL(location.href).searchParams.get('tab'));
  addEventListener('popstate', restore);
  restore();
})();
