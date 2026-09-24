/**
 * Toolbar popup. Foundation phase: navigation into the dashboard. Feature
 * quick actions (save tab, media controls, tools) land with their phases.
 */
import { MSG, ROUTES } from '../../shared/constants.js';
import { h, mount, toast } from '../../shared/dom.js';
import { send } from '../../shared/messages.js';
import { initTheme } from '../../shared/theme.js';

const SECTIONS = [
  { route: ROUTES.VAULT, title: 'TabVault', hint: 'Saved tab collections', ready: false },
  { route: ROUTES.WATCH_LATER, title: 'Watch Later', hint: 'Your private queue', ready: false },
  { route: ROUTES.MEDIA, title: 'Media Boost', hint: 'Speed & volume controls', ready: false },
  { route: ROUTES.SESSIONS, title: 'Sessions', hint: 'Open tabs & sessions', ready: false },
  { route: ROUTES.TOOLS, title: 'Tools', hint: 'Copy, clean, count, QR', ready: false },
  { route: ROUTES.SETTINGS, title: 'Settings', hint: 'Theme, backup, data', ready: true },
];

/** @param {string} route */
async function openDashboard(route) {
  try {
    await send(MSG.OPEN_DASHBOARD, { route });
    window.close();
  } catch (err) {
    toast(`Could not open dashboard: ${err instanceof Error ? err.message : err}`, 'error');
  }
}

mount(
  /** @type {HTMLElement} */ (document.getElementById('sections')),
  SECTIONS.map(({ route, title, hint, ready }) =>
    h(
      'li',
      null,
      h(
        'button',
        { class: 'section-link', type: 'button', onClick: () => openDashboard(route) },
        h('span', { class: 'section-link__text' }, title, h('small', null, hint)),
        !ready && h('span', { class: 'badge badge--muted' }, 'Soon'),
      ),
    ),
  ),
);

document.getElementById('open-dashboard')?.addEventListener('click', () => openDashboard(ROUTES.HOME));
initTheme().catch((err) => console.error('[BrowseKit] theme', err));
