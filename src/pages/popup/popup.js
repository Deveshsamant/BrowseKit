/**
 * Toolbar popup and side panel (same UI; <body data-mode="sidepanel"> for the
 * panel). Opening the popup grants activeTab for the current tab, which
 * Media Boost and page tools rely on. In the side panel the current tab
 * changes, so the view follows tab switches.
 */
import { MSG, ROUTES } from '../../shared/constants.js';
import { h, mount, toast } from '../../shared/dom.js';
import { send } from '../../shared/messages.js';
import { getSettings } from '../../shared/settings.js';
import { activeTab } from '../../shared/tabs.js';
import { initTheme } from '../../shared/theme.js';
import { applyUiPrefs } from '../../shared/ui-prefs.js';
import { debounce, errorMessage, favicon } from '../../shared/ui.js';
import { hostOf, isSaveableUrl } from '../../shared/urls.js';
import { backupStatus } from '../../features/backup/backup-status.js';
import { mountPalette } from '../palette/palette-ui.js';
import { renderMediaPanel } from './panels/media.js';
import { renderSavePanel } from './panels/save.js';
import { renderTabsPanel } from './panels/tabs.js';
import { renderToolsPanel } from './panels/tools.js';

const PANEL_KEY = 'browsekit.popup.panel';
const PANELS = { save: renderSavePanel, media: renderMediaPanel, tabs: renderTabsPanel, tools: renderToolsPanel };
const isSidePanel = document.body.dataset.mode === 'sidepanel';

/** @typedef {{ tab: chrome.tabs.Tab | undefined, settings: Awaited<ReturnType<typeof getSettings>>, fail: (err: unknown) => void, openDashboard: (route: string, query?: string) => Promise<void>, isSidePanel: boolean, close: () => void }} PopupContext */

const panelEl = /** @type {HTMLElement} */ (document.getElementById('panel'));
const tabsBar = /** @type {HTMLElement} */ (document.getElementById('panel-tabs'));
const searchInput = /** @type {HTMLInputElement} */ (document.getElementById('search'));
const resultsEl = /** @type {HTMLElement} */ (document.getElementById('search-results'));
const tabButtons = /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('[data-panel]')]);

/** @type {(() => void) | void} */
let cleanup;
let currentPanel = 'save';

const close = () => {
  if (!isSidePanel) window.close();
};

/** @param {string} route @param {string} [query] */
async function openDashboard(route, query = '') {
  try {
    await send(MSG.OPEN_DASHBOARD, { route, query });
    close();
  } catch (err) {
    toast(`Could not open dashboard: ${errorMessage(err)}`, 'error');
  }
}

/** @param {PopupContext} ctx @param {string} name */
async function showPanel(ctx, name) {
  const panel = PANELS[name] ? name : 'save';
  currentPanel = panel;
  try {
    localStorage.setItem(PANEL_KEY, panel);
  } catch {
    // optional
  }
  for (const btn of tabButtons) {
    const selected = btn.dataset.panel === panel;
    btn.setAttribute('aria-selected', String(selected));
    btn.tabIndex = selected ? 0 : -1;
  }
  panelEl.setAttribute('aria-labelledby', `tab-${panel}`);
  if (typeof cleanup === 'function') cleanup();
  cleanup = undefined;
  mount(panelEl, h('div', { class: 'skeleton' }, h('span'), h('span'), h('span')));
  try {
    cleanup = await PANELS[panel](panelEl, ctx);
  } catch (err) {
    mount(panelEl, h('p', { class: 'error-text pad' }, errorMessage(err)));
  }
}

function renderPageCard(/** @type {chrome.tabs.Tab | undefined} */ tab) {
  const card = /** @type {HTMLElement} */ (document.getElementById('page-card'));
  const url = tab?.url ?? '';
  mount(
    card,
    url ? favicon(url, 16) : null,
    h(
      'div',
      { class: 'page-card__text' },
      h('span', { class: 'page-card__title' }, tab?.title || 'No page'),
      h('span', { class: 'page-card__host' }, url ? (isSaveableUrl(url) ? hostOf(url) : 'Browser page') : ''),
    ),
  );
}

async function renderBackupBanner(/** @type {PopupContext} */ ctx) {
  const host = document.getElementById('banner');
  if (!host) return;
  const { due, lastBackupAt } = await backupStatus().catch(() => ({ due: false, lastBackupAt: null }));
  if (!due) {
    mount(host);
    return;
  }
  mount(
    host,
    h(
      'div',
      { class: 'banner' },
      h('span', null, lastBackupAt ? 'It’s been a while since your last backup.' : 'Your data lives only in this browser. Export a backup?'),
      h('button', { class: 'link-btn', type: 'button', onClick: () => ctx.openDashboard(ROUTES.SETTINGS, 'backup=1') }, 'Back up →'),
    ),
  );
}

async function main() {
  initTheme().catch(() => {});
  applyUiPrefs().catch(() => {});
  const [tab, settings] = await Promise.all([activeTab(), getSettings()]);
  /** @type {PopupContext} */
  const ctx = { tab, settings, fail: (err) => toast(errorMessage(err), 'error'), openDashboard, isSidePanel, close };
  renderPageCard(tab);
  renderBackupBanner(ctx);

  document.getElementById('open-dashboard')?.addEventListener('click', () => openDashboard(ROUTES.HOME));
  const sideBtn = document.getElementById('open-sidepanel');
  if (sideBtn) {
    sideBtn.hidden = isSidePanel || !chrome.sidePanel?.open;
    sideBtn.addEventListener('click', async () => {
      try {
        const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
        await chrome.sidePanel.open({ windowId: /** @type {number} */ (win.id) });
        close();
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    });
  }
  tabButtons.forEach((btn, i) => {
    btn.addEventListener('click', () => showPanel(ctx, /** @type {string} */ (btn.dataset.panel)));
    btn.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const next = tabButtons[(i + (e.key === 'ArrowRight' ? 1 : tabButtons.length - 1)) % tabButtons.length];
      next.focus();
      showPanel(ctx, /** @type {string} */ (next.dataset.panel));
    });
  });

  // Search everything: results replace the panel while the box has text.
  const palette = mountPalette(resultsEl, {
    input: searchInput,
    autofocus: false,
    emptyHint: false,
    onDone: isSidePanel
      ? () => {
          searchInput.value = '';
          searchInput.dispatchEvent(new Event('input'));
        }
      : close,
  });
  const syncSearchMode = () => {
    const searching = searchInput.value.trim().length > 0;
    document.body.classList.toggle('is-searching', searching);
  };
  searchInput.addEventListener('input', syncSearchMode);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && searchInput.value) {
      e.preventDefault();
      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input'));
    }
  });
  document.addEventListener('keydown', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    if (e.key === '/' && !target.closest('input, textarea, select, [contenteditable]')) {
      e.preventDefault();
      searchInput.focus();
    }
  });

  let initial = 'save';
  try {
    initial = localStorage.getItem(PANEL_KEY) ?? 'save';
  } catch {
    // optional
  }
  await showPanel(ctx, initial);
  tabsBar.hidden = false;

  if (isSidePanel) {
    // Follow the user's current tab.
    const follow = debounce(async () => {
      const next = await activeTab();
      if (next?.id === ctx.tab?.id && next?.url === ctx.tab?.url && next?.title === ctx.tab?.title) return;
      ctx.tab = next;
      ctx.settings = await getSettings();
      renderPageCard(next);
      palette.refresh().catch(() => {});
      await showPanel(ctx, currentPanel);
    }, 250);
    chrome.tabs.onActivated.addListener(follow);
    chrome.tabs.onUpdated.addListener((_id, info, t) => {
      if (t.active && (info.status === 'complete' || info.title)) follow();
    });
    chrome.windows.onFocusChanged.addListener(follow);
  }
}

main().catch((err) => mount(panelEl, h('p', { class: 'error-text pad' }, errorMessage(err))));
