/**
 * Watch Later queue: search, filter, watched toggle, open / open & remove / open all.
 */
import { onDatabaseChange } from '../../../shared/db/database.js';
import { h, mount, toast } from '../../../shared/dom.js';
import { formatDateTime, formatNumber } from '../../../shared/format.js';
import { getSettings } from '../../../shared/settings.js';
import { openTabs } from '../../../shared/tabs.js';
import { confirmDialog, debounce, emptyState, errorMessage, favicon } from '../../../shared/ui.js';
import { hostOf } from '../../../shared/urls.js';
import {
  clearWatched,
  filterWatchLater,
  listWatchLater,
  removeFromWatchLater,
  setWatched,
} from '../../../features/watch-later/watch-later.js';
import { getPositions, progressFor } from '../../../features/media/positions.js';

const FILTERS = [
  { value: 'unwatched', label: 'To watch' },
  { value: 'watched', label: 'Watched' },
  { value: 'all', label: 'All' },
];

/** @param {HTMLElement} root */
export async function render(root) {
  let items = await listWatchLater();
  let positions = await getPositions();
  const state = { filter: 'unwatched', query: '' };
  const fail = (err) => toast(errorMessage(err), 'error');

  const summary = h('p', { class: 'muted' });
  const listHost = h('div');
  const search = h('input', {
    class: 'input search',
    type: 'search',
    placeholder: 'Search Watch Later…  ( / )',
    'aria-label': 'Search Watch Later',
    onInput: debounce(() => {
      state.query = search.value.trim();
      renderList();
    }, 120),
  });
  const filterControl = h(
    'div',
    { class: 'segmented', role: 'radiogroup', 'aria-label': 'Filter' },
    FILTERS.map((f) =>
      h(
        'label',
        null,
        h('input', {
          type: 'radio',
          name: 'wl-filter',
          value: f.value,
          checked: state.filter === f.value,
          onChange: () => {
            state.filter = f.value;
            renderList();
          },
        }),
        f.label,
      ),
    ),
  );
  const openAllBtn = h('button', { class: 'btn btn--primary', type: 'button', onClick: openAll }, 'Open all');
  const clearBtn = h('button', { class: 'btn', type: 'button', onClick: clearAllWatched }, 'Clear watched');
  const randomBtn = h(
    'button',
    {
      class: 'btn',
      type: 'button',
      title: 'Open a random unwatched item',
      onClick: () => {
        const pool = items.filter((i) => !i.watched);
        if (pool.length) open([pool[Math.floor(Math.random() * pool.length)]], false).catch(fail);
      },
    },
    '🎲 Surprise me',
  );

  mount(
    root,
    h(
      'header',
      { class: 'page-header' },
      h('div', null, h('h1', null, 'Watch Later'), summary),
      h('div', { class: 'btn-row' }, randomBtn, openAllBtn, clearBtn),
    ),
    h('div', { class: 'toolbar' }, search, filterControl),
    h(
      'div',
      { class: 'stack' },
      listHost,
      h(
        'p',
        { class: 'muted small' },
        'Tip: right-click any page or link → “Save page/link to Watch Later”, or press Alt+Shift+W (change it under Media Boost → Keyboard shortcuts).',
      ),
    ),
  );

  function visible() {
    return filterWatchLater(items, state);
  }

  function renderList() {
    const unwatched = items.filter((i) => !i.watched).length;
    summary.textContent = `${formatNumber(unwatched)} to watch · ${formatNumber(items.length - unwatched)} watched`;
    const list = visible();
    openAllBtn.disabled = !list.length;
    openAllBtn.textContent = list.length ? `Open ${list.length === items.length ? 'all' : `${list.length} shown`}` : 'Open all';
    clearBtn.disabled = items.length === unwatched;
    randomBtn.disabled = !unwatched;

    if (!list.length) {
      mount(
        listHost,
        items.length
          ? emptyState('Nothing here', state.query ? 'No items match your search.' : 'Try another filter.')
          : emptyState('Your queue is empty', 'Save pages from the toolbar popup, the right-click menu, or the keyboard shortcut.'),
      );
      return;
    }
    mount(
      listHost,
      h(
        'div',
        { class: 'list-card' },
        h(
          'ul',
          { class: 'rows' },
          list.map((item) =>
            h(
              'li',
              { class: `row${item.watched ? ' is-watched' : ''}`, dataset: { id: item.id } },
              h('input', {
                type: 'checkbox',
                checked: !!item.watched,
                title: item.watched ? 'Mark as unwatched' : 'Mark as watched',
                'aria-label': `${item.watched ? 'Watched' : 'Not watched'}: ${item.title}`,
                onChange: (e) => setWatched([item.id], e.target.checked).catch(fail),
              }),
              favicon(item.url),
              h(
                'a',
                {
                  class: 'row__main',
                  href: item.url,
                  title: item.url,
                  onClick: (e) => {
                    e.preventDefault();
                    open([item], false);
                  },
                },
                h('span', { class: 'row__title' }, item.title),
                h('span', { class: 'row__sub' }, `${hostOf(item.url)} · added ${formatDateTime(item.addedAt)}`),
                progressBar(progressFor(positions, item.url)),
              ),
              h(
                'span',
                { class: 'row__actions row__actions--visible' },
                h('button', { class: 'btn btn--sm', type: 'button', onClick: () => open([item], false) }, 'Open'),
                h('button', { class: 'btn btn--sm', type: 'button', onClick: () => open([item], true) }, 'Open & remove'),
                h(
                  'button',
                  {
                    class: 'icon-btn icon-btn--danger',
                    type: 'button',
                    title: 'Remove',
                    'aria-label': `Remove ${item.title}`,
                    onClick: () => removeFromWatchLater([item.id]).catch(fail),
                  },
                  '✕',
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  /**
   * @param {import('../../../features/watch-later/watch-later.js').WatchItem[]} list
   * @param {boolean} remove
   */
  async function open(list, remove) {
    const { opened, failed } = await openTabs(list, { newWindow: false, activateFirst: list.length === 1 });
    const okIds = list.filter((i) => !failed.includes(i.url)).map((i) => i.id);
    if (remove) await removeFromWatchLater(okIds);
    else if ((await getSettings()).watchLater.markWatchedOnOpen) await setWatched(okIds, true);
    if (failed.length) toast(`Chrome refused to open ${failed.length} item(s).`, 'error');
    else if (list.length > 1) toast(`Opened ${opened} tabs.`);
  }

  async function openAll() {
    const list = visible();
    if (!list.length) return;
    if (list.length > 10) {
      const ok = await confirmDialog({ title: `Open ${list.length} tabs?`, confirmLabel: 'Open all' });
      if (!ok) return;
    }
    await open(list, false).catch(fail);
  }

  async function clearAllWatched() {
    const ok = await confirmDialog({ title: 'Delete all watched items?', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    const n = await clearWatched().catch(fail);
    if (n !== undefined) toast(`Removed ${n} watched item${n === 1 ? '' : 's'}.`);
  }

  const onKey = (/** @type {KeyboardEvent} */ e) => {
    if (e.key === '/' && !/** @type {HTMLElement} */ (e.target).closest('input, textarea, select, [contenteditable]')) {
      e.preventDefault();
      search.focus();
    }
  };
  document.addEventListener('keydown', onKey);
  renderList();
  const refresh = debounce(async () => {
    items = await listWatchLater();
    positions = await getPositions();
    renderList();
  }, 50);
  const unsubscribe = onDatabaseChange((d) => {
    if (d.stores.includes('watchLater')) refresh();
  });
  return () => {
    unsubscribe();
    document.removeEventListener('keydown', onKey);
  };
}

/** @param {ReturnType<typeof progressFor>} pos */
function progressBar(pos) {
  if (!pos || pos.progress < 0.02) return null;
  const pct = Math.round(pos.progress * 100);
  const bar = h('span', { class: 'progress__fill' });
  bar.style.width = `${pct}%`; // CSSOM: allowed by CSP
  return h('span', { class: 'progress', title: `Watched ${pct}%`, role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 }, bar);
}
