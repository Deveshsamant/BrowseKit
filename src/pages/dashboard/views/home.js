/**
 * Home: overview of everything BrowseKit holds, plus quick actions.
 */
import { ROUTES } from '../../../shared/constants.js';
import { onDatabaseChange } from '../../../shared/db/database.js';
import { h, mount, toast } from '../../../shared/dom.js';
import { formatBytes, formatDateTime, formatNumber } from '../../../shared/format.js';
import { openTabs } from '../../../shared/tabs.js';
import { debounce, errorMessage, favicon } from '../../../shared/ui.js';
import { hostOf } from '../../../shared/urls.js';
import { loadVault } from '../../../features/vault/vault.js';
import { saveTabsToVault } from '../../../features/vault/save.js';
import { listWatchLater, setWatched } from '../../../features/watch-later/watch-later.js';
import { listSessions, saveCurrentSession, sessionTabCount } from '../../../features/sessions/sessions.js';
import { findDuplicateGroups } from '../../../features/tab-manager/tab-model.js';

/**
 * @param {HTMLElement} root
 * @param {{ params: URLSearchParams }} ctx
 */
export async function render(root, { params }) {
  const fail = (err) => toast(errorMessage(err), 'error');
  const statsGrid = h('div', { class: 'grid grid--stats', 'aria-label': 'At a glance' });
  const upNext = h('div');
  const recent = h('div');
  const tabHealth = h('div');
  const storageLine = h('p', { class: 'muted small' });

  async function refresh() {
    const [vault, queue, sessions, openTabsList] = await Promise.all([
      loadVault(),
      listWatchLater(),
      listSessions(),
      chrome.tabs.query({ windowType: 'normal' }),
    ]);
    const unwatched = queue.filter((i) => !i.watched);
    const dupes = findDuplicateGroups(openTabsList).reduce((n, g) => n + g.extras.length, 0);

    mount(
      statsGrid,
      stat(vault.tabs.length, 'Saved tabs', `in ${formatNumber(vault.collections.length)} collections`, ROUTES.VAULT),
      stat(unwatched.length, 'To watch', `${formatNumber(queue.length - unwatched.length)} watched`, ROUTES.WATCH_LATER),
      stat(openTabsList.length, 'Open tabs', dupes ? `${dupes} duplicate${dupes === 1 ? '' : 's'}` : 'no duplicates', `${ROUTES.SESSIONS}?tab=open`),
      stat(sessions.length, 'Saved sessions', sessions[0] ? `last ${formatDateTime(sessions[0].createdAt)}` : 'none yet', `${ROUTES.SESSIONS}?tab=saved`),
    );

    mount(
      upNext,
      unwatched.length
        ? h(
            'ul',
            { class: 'rows rows--compact' },
            unwatched.slice(0, 5).map((item) =>
              h(
                'li',
                { class: 'row' },
                favicon(item.url),
                h(
                  'a',
                  {
                    class: 'row__main',
                    href: item.url,
                    onClick: (e) => {
                      e.preventDefault();
                      openTabs([item]).then(() => setWatched([item.id], true), fail);
                    },
                  },
                  h('span', { class: 'row__title' }, item.title),
                  h('span', { class: 'row__sub' }, hostOf(item.url)),
                ),
              ),
            ),
          )
        : h('p', { class: 'muted small' }, 'Nothing queued. Right-click a page → “Save page to Watch Later”.'),
    );

    const recentCollections = [...vault.collections].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);
    mount(
      recent,
      recentCollections.length
        ? h(
            'ul',
            { class: 'rows rows--compact' },
            recentCollections.map((c) => {
              const tabs = vault.tabsByCollection.get(c.id) ?? [];
              return h(
                'li',
                { class: 'row' },
                h('span', { class: `dot dot--${c.color}`, 'aria-hidden': 'true' }),
                h('a', { class: 'row__main', href: `#/${ROUTES.VAULT}?c=${encodeURIComponent(c.id)}` }, h('span', { class: 'row__title' }, c.name), h('span', { class: 'row__sub' }, `${tabs.length} tab${tabs.length === 1 ? '' : 's'}`)),
                h('button', { class: 'btn btn--sm', type: 'button', disabled: !tabs.length, onClick: () => openTabs(tabs).catch(fail) }, 'Open'),
              );
            }),
          )
        : h('p', { class: 'muted small' }, 'No collections yet. Save a window from the popup or below.'),
    );

    mount(
      tabHealth,
      h('p', null, `${formatNumber(openTabsList.length)} tabs across ${plural(new Set(openTabsList.map((t) => t.windowId)).size, 'window')}.`),
      dupes
        ? h('a', { class: 'btn btn--sm', href: `#/${ROUTES.SESSIONS}?tab=duplicates` }, `Review ${dupes} duplicate${dupes === 1 ? '' : 's'}`)
        : h('p', { class: 'muted small' }, 'No duplicate tabs.'),
    );

    if (navigator.storage?.estimate) {
      const { usage = 0 } = await navigator.storage.estimate();
      storageLine.textContent = `BrowseKit uses ${formatBytes(usage)} of local browser storage.`;
    }
  }

  async function quick(action) {
    try {
      if (action === 'save-all') {
        const r = await saveTabsToVault({ scope: 'all' });
        toast(`Saved ${r.added} tabs to “${r.collectionName}”.`);
      } else if (action === 'session') {
        const s = await saveCurrentSession(`Session · ${formatDateTime(Date.now())}`);
        toast(`Session saved (${sessionTabCount(s)} tabs).`);
      }
    } catch (err) {
      fail(err);
    }
  }

  await refresh();

  mount(
    root,
    h(
      'header',
      { class: 'page-header' },
      h('div', null, h('h1', null, 'Home'), h('p', { class: 'muted' }, 'Your private browser toolkit.')),
      h(
        'div',
        { class: 'btn-row' },
        h('button', { class: 'btn', type: 'button', onClick: () => quick('session') }, 'Save session'),
        h('button', { class: 'btn btn--primary', type: 'button', onClick: () => quick('save-all') }, 'Save all windows to TabVault'),
      ),
    ),
    h(
      'div',
      { class: 'stack' },
      params.get('welcome') &&
        h(
          'section',
          { class: 'card welcome' },
          h('h2', { class: 'card__title' }, 'Welcome to BrowseKit'),
          h('p', null, 'Everything you save stays in this browser profile. Pin BrowseKit from the puzzle-piece menu, then try:'),
          h(
            'ul',
            { class: 'plain-list' },
            h('li', null, 'Alt+Shift+B — open the popup (save tabs, media controls, tools)'),
            h('li', null, 'Alt+Shift+W — save the current page to Watch Later'),
            h('li', null, 'Right-click any page or link → Save to Watch Later'),
          ),
        ),
      statsGrid,
      h(
        'div',
        { class: 'two-col' },
        h('section', { class: 'card' }, h('div', { class: 'card__head' }, h('h2', { class: 'card__title' }, 'Up next'), h('a', { href: `#/${ROUTES.WATCH_LATER}`, class: 'small' }, 'All →')), upNext),
        h('section', { class: 'card' }, h('div', { class: 'card__head' }, h('h2', { class: 'card__title' }, 'Recent collections'), h('a', { href: `#/${ROUTES.VAULT}`, class: 'small' }, 'All →')), recent),
      ),
      h(
        'div',
        { class: 'two-col' },
        h('section', { class: 'card' }, h('h2', { class: 'card__title' }, 'Open tabs'), tabHealth),
        h(
          'section',
          { class: 'card' },
          h('h2', { class: 'card__title' }, 'Privacy'),
          h(
            'ul',
            { class: 'privacy-list privacy-list--compact' },
            h('li', null, 'No account, servers or AI'),
            h('li', null, 'No analytics or telemetry'),
            h('li', null, 'No remote code'),
            h('li', null, 'Data stays on this device'),
          ),
          storageLine,
        ),
      ),
    ),
  );

  const debounced = debounce(() => refresh().catch(fail), 150);
  const unsubscribe = onDatabaseChange(debounced);
  const tabEvents = [chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onUpdated];
  tabEvents.forEach((ev) => ev.addListener(debounced));
  return () => {
    unsubscribe();
    tabEvents.forEach((ev) => ev.removeListener(debounced));
  };
}

/** @param {number} n @param {string} word */
const plural = (n, word) => `${formatNumber(n)} ${word}${n === 1 ? '' : 's'}`;

/**
 * @param {number} value
 * @param {string} label
 * @param {string} sub
 * @param {string} route
 */
function stat(value, label, sub, route) {
  return h(
    'a',
    { class: 'card stat', href: `#/${route}` },
    h('span', { class: 'stat__value' }, formatNumber(value)),
    h('span', { class: 'stat__label' }, label),
    h('span', { class: 'muted small' }, sub),
  );
}
