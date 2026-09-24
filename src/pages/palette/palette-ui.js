/**
 * Search-everything UI, shared by the palette window, popup, side panel and
 * the dashboard's Ctrl+K dialog. Keyboard: ↑/↓ to move, Enter to run, Esc to close.
 */
import { h, mount, toast } from '../../shared/dom.js';
import { getSettings } from '../../shared/settings.js';
import { focusTab, openTabs, ownOrigin } from '../../shared/tabs.js';
import { debounce, errorMessage, favicon } from '../../shared/ui.js';
import { hostOf } from '../../shared/urls.js';
import { buildSearchItems, searchEverything } from '../../features/search/search-model.js';
import { loadVault } from '../../features/vault/vault.js';
import { listWatchLater, setWatched } from '../../features/watch-later/watch-later.js';
import { listSessions, restoreSession } from '../../features/sessions/sessions.js';
import { listSnoozed, wakeNow } from '../../features/snooze/snooze.js';
import { paletteActions } from './actions.js';
import { markOnboarding } from '../../features/onboarding/onboarding.js';

const KIND_LABEL = {
  action: 'Action',
  tab: 'Tab',
  watch: 'Later',
  vault: 'Vault',
  collection: 'Collection',
  session: 'Session',
  snoozed: 'Snoozed',
};

/**
 * @param {HTMLElement} root
 * @param {{ onDone?: () => void, autofocus?: boolean, placeholder?: string, input?: HTMLInputElement, emptyHint?: boolean }} [options]
 * @returns {{ input: HTMLInputElement, refresh: () => Promise<void>, destroy: () => void }}
 */
export function mountPalette(root, { onDone, autofocus = true, placeholder = 'Search tabs, TabVault, Watch Later, sessions, actions…', input: externalInput, emptyHint = true } = {}) {
  const actions = paletteActions();
  /** @type {ReturnType<typeof buildSearchItems>} */
  let items = [];
  /** @type {ReturnType<typeof searchEverything>} */
  let results = [];
  let selected = 0;

  const input =
    externalInput ??
    /** @type {HTMLInputElement} */ (
      h('input', { class: 'input palette__input', type: 'search', placeholder, 'aria-label': 'Search everything', autocomplete: 'off', spellcheck: false })
    );
  const list = h('ul', { class: 'palette__list', role: 'listbox', 'aria-label': 'Results' });
  const status = h('p', { class: 'palette__status muted small', 'aria-live': 'polite' });
  if (!externalInput) mount(root, input, list, status);
  else mount(root, list, status);

  async function refresh() {
    const [tabs, vault, watch, sessions, snoozed] = await Promise.all([
      chrome.tabs.query({ windowType: 'normal' }),
      loadVault(),
      listWatchLater(),
      listSessions(),
      listSnoozed(),
    ]);
    items = buildSearchItems({
      openTabs: tabs,
      collections: vault.collections,
      vaultTabs: vault.tabs,
      watchLater: watch,
      sessions,
      snoozed,
      actions,
      ownOrigin: ownOrigin(),
    });
    render();
  }

  function render() {
    const q = input.value.trim();
    if (!q) {
      results = [];
      mount(list);
      status.textContent = emptyHint ? 'Type to search everything. Try “dup”, “snooze”, “#tag” or a site name.' : '';
      root.classList.toggle('is-empty', true);
      return;
    }
    root.classList.toggle('is-empty', false);
    results = searchEverything(items, q, { limit: 40 });
    selected = Math.min(selected, Math.max(0, results.length - 1));
    status.textContent = results.length ? `${results.length} result${results.length === 1 ? '' : 's'} · Enter to open` : 'No matches.';
    mount(
      list,
      results.map((r, i) =>
        h(
          'li',
          {
            class: `palette__item${i === selected ? ' is-selected' : ''}`,
            role: 'option',
            'aria-selected': String(i === selected),
            onMousedown: (e) => e.preventDefault(),
            onClick: () => run(i),
          },
          r.url ? favicon(r.url) : h('span', { class: 'palette__icon', 'aria-hidden': 'true' }, r.kind === 'action' ? '⚡' : r.kind === 'session' ? '▣' : r.kind === 'collection' ? '▤' : '•'),
          h(
            'span',
            { class: 'palette__text' },
            h('span', { class: 'palette__title' }, r.title),
            h('span', { class: 'palette__sub' }, [r.sub, r.url ? hostOf(r.url) : ''].filter(Boolean).join(' · ')),
          ),
          h('span', { class: `palette__kind palette__kind--${r.kind}` }, KIND_LABEL[r.kind]),
        ),
      ),
    );
    list.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' });
  }

  /** @param {number} index */
  async function run(index) {
    const r = results[index];
    if (!r) return;
    markOnboarding('usedSearch').catch(() => {});
    try {
      let message;
      switch (r.kind) {
        case 'action':
          message = await actions.find((a) => a.id === r.id)?.run();
          break;
        case 'tab':
          await focusTab(r.data.id, r.data.windowId);
          break;
        case 'vault':
          await openTabs([{ url: r.data.url }]);
          break;
        case 'collection': {
          const vault = await loadVault();
          const tabs = vault.tabsByCollection.get(r.id) ?? [];
          await openTabs(tabs, { newWindow: (await getSettings()).vault.openIn === 'new-window' });
          message = `Opened ${tabs.length} tabs.`;
          break;
        }
        case 'watch':
          await openTabs([{ url: r.data.url }]);
          if ((await getSettings()).watchLater.markWatchedOnOpen) await setWatched([r.id], true);
          break;
        case 'session':
          await restoreSession(r.data);
          break;
        case 'snoozed':
          await wakeNow(r.id);
          break;
        default:
          break;
      }
      if (message) toast(message);
      if (onDone) setTimeout(onDone, message ? 700 : 0);
      else {
        input.value = '';
        await refresh();
      }
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  const onInput = debounce(() => {
    selected = 0;
    render();
  }, 40);
  const onKey = (/** @type {KeyboardEvent} */ e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!results.length) return;
      e.preventDefault();
      selected = (selected + (e.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length;
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(selected);
    } else if (e.key === 'Escape' && onDone && !input.value) {
      onDone();
    }
  };
  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onKey);
  refresh().catch((err) => toast(errorMessage(err), 'error'));
  if (autofocus) input.focus();
  render();

  return {
    input,
    refresh,
    destroy() {
      input.removeEventListener('input', onInput);
      input.removeEventListener('keydown', onKey);
    },
  };
}
