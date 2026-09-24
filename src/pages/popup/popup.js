/**
 * Toolbar popup: quick actions on the current tab. Opening the popup grants
 * activeTab for that tab, which Media Boost and page tools rely on.
 */
import { MSG, ROUTES } from '../../shared/constants.js';
import { h, mount, toast } from '../../shared/dom.js';
import { send } from '../../shared/messages.js';
import { getSettings } from '../../shared/settings.js';
import { activeTab } from '../../shared/tabs.js';
import { initTheme } from '../../shared/theme.js';
import { errorMessage, favicon } from '../../shared/ui.js';
import { hostOf, isSaveableUrl } from '../../shared/urls.js';
import { renderMediaPanel } from './panels/media.js';
import { renderSavePanel } from './panels/save.js';
import { renderTabsPanel } from './panels/tabs.js';
import { renderToolsPanel } from './panels/tools.js';

const PANEL_KEY = 'browsekit.popup.panel';
const PANELS = { save: renderSavePanel, media: renderMediaPanel, tabs: renderTabsPanel, tools: renderToolsPanel };

/** @typedef {{ tab: chrome.tabs.Tab | undefined, settings: Awaited<ReturnType<typeof getSettings>>, fail: (err: unknown) => void, openDashboard: (route: string, query?: string) => Promise<void> }} PopupContext */

const panelEl = /** @type {HTMLElement} */ (document.getElementById('panel'));
const tabButtons = /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('[data-panel]')]);

/** @type {(() => void) | void} */
let cleanup;

/** @param {string} route @param {string} [query] */
async function openDashboard(route, query = '') {
  try {
    await send(MSG.OPEN_DASHBOARD, { route, query });
    window.close();
  } catch (err) {
    toast(`Could not open dashboard: ${errorMessage(err)}`, 'error');
  }
}

/** @param {PopupContext} ctx @param {string} name */
async function showPanel(ctx, name) {
  const panel = PANELS[name] ? name : 'save';
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
  mount(panelEl, h('p', { class: 'muted pad' }, 'Loading…'));
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

async function main() {
  initTheme().catch(() => {});
  const [tab, settings] = await Promise.all([activeTab(), getSettings()]);
  /** @type {PopupContext} */
  const ctx = { tab, settings, fail: (err) => toast(errorMessage(err), 'error'), openDashboard };
  renderPageCard(tab);

  document.getElementById('open-dashboard')?.addEventListener('click', () => openDashboard(ROUTES.HOME));
  tabButtons.forEach((btn, i) => {
    btn.addEventListener('click', () => showPanel(ctx, /** @type {string} */ (btn.dataset.panel)));
    btn.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const next = tabButtons[(i + (e.key === 'ArrowRight' ? 1 : tabButtons.length - 1)) % tabButtons.length];
      next.focus();
      showPanel(ctx, /** @type {string} */ (next.dataset.panel));
    });
  });

  let initial = 'save';
  try {
    initial = localStorage.getItem(PANEL_KEY) ?? 'save';
  } catch {
    // optional
  }
  await showPanel(ctx, initial);
}

main().catch((err) => mount(panelEl, h('p', { class: 'error-text pad' }, errorMessage(err))));
