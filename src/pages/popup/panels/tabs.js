/**
 * Popup "Tabs" panel: search open tabs, close duplicates, save a session.
 */
import { ROUTES } from '../../../shared/constants.js';
import { h, mount, toast } from '../../../shared/dom.js';
import { formatDateTime } from '../../../shared/format.js';
import { focusTab } from '../../../shared/tabs.js';
import { debounce, favicon } from '../../../shared/ui.js';
import { hostOf } from '../../../shared/urls.js';
import { findDuplicateGroups, searchOpenTabs } from '../../../features/tab-manager/tab-model.js';
import { saveCurrentSession, sessionTabCount } from '../../../features/sessions/sessions.js';

const MAX_RESULTS = 8;

/**
 * @param {HTMLElement} root
 * @param {import('../popup.js').PopupContext} ctx
 */
export async function renderTabsPanel(root, ctx) {
  const { fail } = ctx;
  let tabs = await chrome.tabs.query({ windowType: 'normal' });

  const results = h('ul', { class: 'rows rows--compact' });
  const dupButton = h('button', { class: 'btn btn--block', type: 'button', onClick: closeDuplicates });
  const summary = h('p', { class: 'muted small' });
  const search = h('input', {
    class: 'input search',
    type: 'search',
    placeholder: 'Search open tabs…',
    'aria-label': 'Search open tabs',
    onInput: debounce(renderResults, 80),
    onKeydown: (e) => {
      if (e.key === 'Enter') /** @type {HTMLButtonElement | null} */ (results.querySelector('button'))?.click();
    },
  });

  function renderResults() {
    const q = search.value.trim();
    const matches = q ? searchOpenTabs(tabs, q) : tabs.filter((t) => t.audible);
    const shown = matches.slice(0, MAX_RESULTS);
    mount(
      results,
      shown.length
        ? shown.map((t) =>
            h(
              'li',
              { class: 'row' },
              favicon(t.url ?? ''),
              h(
                'button',
                {
                  class: 'row__main row__main--button',
                  type: 'button',
                  onClick: () => focusTab(/** @type {number} */ (t.id), t.windowId).then(() => window.close(), fail),
                },
                h('span', { class: 'row__title' }, t.title || t.url),
                h('span', { class: 'row__sub' }, `${t.audible ? '🔊 ' : ''}${hostOf(t.url ?? '')}`),
              ),
            ),
          )
        : h('li', { class: 'muted small pad' }, q ? 'No open tabs match.' : 'Type to search every open tab. Tabs playing audio show here.'),
      matches.length > MAX_RESULTS && h('li', { class: 'muted small pad' }, `+${matches.length - MAX_RESULTS} more — refine your search`),
    );
  }

  function renderCounts() {
    const extras = findDuplicateGroups(tabs).flatMap((g) => g.extras);
    const windows = new Set(tabs.map((t) => t.windowId)).size;
    summary.textContent = `${tabs.length} tabs open in ${windows} window${windows === 1 ? '' : 's'}`;
    dupButton.textContent = extras.length ? `Close ${extras.length} duplicate tab${extras.length === 1 ? '' : 's'}` : 'No duplicate tabs';
    dupButton.disabled = !extras.length;
    return extras;
  }

  async function closeDuplicates() {
    const extras = renderCounts();
    if (!extras.length) return;
    try {
      await chrome.tabs.remove(extras.map((t) => /** @type {number} */ (t.id)));
      tabs = await chrome.tabs.query({ windowType: 'normal' });
      renderCounts();
      renderResults();
      toast(`Closed ${extras.length} duplicate${extras.length === 1 ? '' : 's'}.`);
    } catch (err) {
      fail(err);
    }
  }

  async function saveSession() {
    try {
      const s = await saveCurrentSession(`Session · ${formatDateTime(Date.now())}`);
      toast(`Session saved (${sessionTabCount(s)} tabs).`);
    } catch (err) {
      fail(err);
    }
  }

  mount(
    root,
    h('section', { class: 'popup-section' }, search, results),
    h(
      'section',
      { class: 'popup-section' },
      summary,
      dupButton,
      h(
        'div',
        { class: 'btn-grid btn-grid--2' },
        h('button', { class: 'btn', type: 'button', onClick: saveSession }, 'Save session'),
        h('button', { class: 'btn', type: 'button', onClick: () => ctx.openDashboard(ROUTES.SESSIONS) }, 'All sessions →'),
      ),
    ),
  );
  renderCounts();
  renderResults();
  search.focus();
}
