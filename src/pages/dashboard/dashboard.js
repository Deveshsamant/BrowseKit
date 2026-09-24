/**
 * Dashboard shell: theme, hash router (#/route?query), view lifecycle.
 */
import { ROUTES } from '../../shared/constants.js';
import { h, toast } from '../../shared/dom.js';
import { initTheme } from '../../shared/theme.js';
import { mountPalette } from '../palette/palette-ui.js';
import { applyUiPrefs } from '../../shared/ui-prefs.js';
import { markOnboarding } from '../../features/onboarding/onboarding.js';
import { views } from './views/index.js';

const main = /** @type {HTMLElement} */ (document.getElementById('main'));
const nav = /** @type {HTMLElement} */ (document.getElementById('nav'));

/** @type {(() => void) | void} */
let cleanup;
let renderToken = 0;

/** @returns {{ route: string, params: URLSearchParams }} */
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const route = views[path] ? path : ROUTES.HOME;
  return { route, params: new URLSearchParams(query) };
}

async function render() {
  const token = ++renderToken;
  const { route, params } = parseHash();
  const view = views[route];

  if (typeof cleanup === 'function') cleanup();
  cleanup = undefined;
  // Navigating away closes transient overlays (search, shortcut sheet).
  document.querySelectorAll('dialog.palette-dialog[open], dialog.shortcuts-dialog[open]').forEach((d) => /** @type {HTMLDialogElement} */ (d).close());

  for (const link of nav.querySelectorAll('a[data-route]')) {
    if (link.getAttribute('data-route') === route) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.title = `${view.title} · BrowseKit`;

  const container = document.createElement('div');
  try {
    const result = await view.render(container, { params });
    if (token !== renderToken) {
      if (typeof result === 'function') result();
      return; // a newer navigation won
    }
    cleanup = result;
    main.replaceChildren(container);
    main.focus({ preventScroll: true });
  } catch (err) {
    console.error(`[BrowseKit] failed to render ${route}`, err);
    toast(`Could not load ${view.title}: ${err instanceof Error ? err.message : err}`, 'error');
  }
}

/** Ctrl/⌘+K: search everything in a modal. */
function openSearch() {
  if (document.querySelector('dialog.palette-dialog')) return;
  const body = h('div', { class: 'palette' });
  const dialog = h('dialog', { class: 'dialog palette-dialog', 'aria-label': 'Search everything' }, body);
  document.body.append(dialog);
  const palette = mountPalette(body, { onDone: () => dialog.close() });
  dialog.addEventListener('close', () => {
    palette.destroy();
    dialog.remove();
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.showModal();
  palette.input.focus();
}

const APP_KEYS = [
  ['Ctrl/⌘ + K', 'Search everything (dashboard)'],
  ['/', 'Focus the search box on the current page'],
  ['?', 'Show this list'],
  ['Alt + ↑ / ↓', 'Move a saved tab up/down in TabVault'],
  ['↑ ↓ Enter Esc', 'Navigate search results'],
  ['[  ]  \\', 'Media: slower / faster / reset speed (on pages where Media Boost runs)'],
];

/** "?": every shortcut in one place. */
async function openShortcuts() {
  if (document.querySelector('dialog.shortcuts-dialog')) return;
  const commands = await chrome.commands.getAll();
  const row = (keys, action) => h('tr', null, h('td', null, keys ? h('kbd', { class: 'kbd' }, keys) : h('span', { class: 'muted small' }, 'Not set')), h('td', null, action));
  const dialog = h(
    'dialog',
    { class: 'dialog dialog--wide shortcuts-dialog', 'aria-label': 'Keyboard shortcuts' },
    h(
      'form',
      { method: 'dialog', class: 'dialog__form' },
      h('h2', { class: 'dialog__title' }, 'Keyboard shortcuts'),
      h('h3', { class: 'field__label' }, 'Anywhere in Chrome'),
      h('table', { class: 'table' }, h('tbody', null, commands.map((c) => row(c.shortcut, c.name === '_execute_action' ? 'Open the BrowseKit popup' : c.description)))),
      h('p', { class: 'muted small' }, 'Chrome lets extensions suggest only four shortcuts; assign the rest at chrome://extensions/shortcuts.'),
      h('h3', { class: 'field__label' }, 'Inside BrowseKit'),
      h('table', { class: 'table' }, h('tbody', null, APP_KEYS.map(([k, a]) => row(k, a)))),
      h(
        'div',
        { class: 'dialog__actions' },
        h('button', { class: 'btn', type: 'button', onClick: () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }) }, 'Change shortcuts'),
        h('button', { class: 'btn btn--primary', type: 'submit', value: 'ok' }, 'Done'),
      ),
    ),
  );
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
  markOnboarding('viewedShortcuts').catch(() => {});
}

document.getElementById('open-search')?.addEventListener('click', openSearch);
document.getElementById('open-shortcuts')?.addEventListener('click', openShortcuts);
document.addEventListener('keydown', (e) => {
  const typing = /** @type {HTMLElement} */ (e.target).closest?.('input, textarea, select, [contenteditable]');
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openSearch();
  } else if (e.key === '?' && !typing && !document.querySelector('dialog[open]')) {
    e.preventDefault();
    openShortcuts();
  }
});

window.addEventListener('hashchange', render);
initTheme().catch((err) => console.error('[BrowseKit] theme', err));
applyUiPrefs().catch(() => {});
render();
