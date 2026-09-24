import { ROUTES } from '../../../shared/constants.js';
import { onDatabaseChange } from '../../../shared/db/database.js';
import { countAll } from '../../../shared/db/repository.js';
import { STORES } from '../../../shared/db/schema.js';
import { h, mount } from '../../../shared/dom.js';
import { formatBytes, formatNumber } from '../../../shared/format.js';

const STATS = [
  { store: STORES.COLLECTIONS, label: 'Collections', route: ROUTES.VAULT },
  { store: STORES.VAULT_TABS, label: 'Saved tabs', route: ROUTES.VAULT },
  { store: STORES.WATCH_LATER, label: 'Watch Later', route: ROUTES.WATCH_LATER },
  { store: STORES.SESSIONS, label: 'Saved sessions', route: ROUTES.SESSIONS },
];

/**
 * @param {HTMLElement} root
 * @param {{ params: URLSearchParams }} ctx
 */
export async function render(root, { params }) {
  const statsGrid = h('div', { class: 'grid', 'aria-label': 'Saved items' });
  const storageLine = h('p', { class: 'muted' }, 'Calculating storage…');

  async function refresh() {
    const counts = await countAll();
    mount(
      statsGrid,
      STATS.map(({ store, label, route }) =>
        h(
          'a',
          { class: 'card stat', href: `#/${route}` },
          h('span', { class: 'stat__value' }, formatNumber(counts[store] ?? 0)),
          h('span', { class: 'muted' }, label),
        ),
      ),
    );
    if (navigator.storage?.estimate) {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      storageLine.textContent = `Using ${formatBytes(usage)} of local browser storage (quota ${formatBytes(quota)}).`;
    } else {
      storageLine.textContent = 'Storage usage is not available in this browser.';
    }
  }

  await refresh();

  mount(
    root,
    h(
      'header',
      { class: 'page-header' },
      h('div', null, h('h1', null, 'Home'), h('p', { class: 'muted' }, 'Your private browser toolkit.')),
    ),
    h(
      'div',
      { class: 'stack' },
      params.get('welcome') &&
        h(
          'section',
          { class: 'card welcome' },
          h('h2', { class: 'card__title' }, 'Welcome to BrowseKit'),
          h(
            'p',
            null,
            'Everything you save stays in this browser profile. Pin BrowseKit from the puzzle-piece menu for one-click access.',
          ),
        ),
      statsGrid,
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card__title' }, 'Privacy'),
        h(
          'ul',
          { class: 'privacy-list' },
          h('li', null, 'No account or login'),
          h('li', null, 'No servers, APIs or AI services'),
          h('li', null, 'No analytics or telemetry'),
          h('li', null, 'No remote code'),
          h('li', null, 'Data stored only on this device'),
          h('li', null, 'Export or erase everything any time'),
        ),
        storageLine,
      ),
    ),
  );

  return onDatabaseChange(() => {
    refresh().catch((err) => console.error('[BrowseKit] home refresh', err));
  });
}
