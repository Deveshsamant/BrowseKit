/**
 * App-wide constants shared by the service worker and extension pages.
 * Content scripts are classic scripts and must not import this file.
 */

export const APP_NAME = 'BrowseKit';

/** Dashboard routes (hash-based: dashboard.html#/vault). */
export const ROUTES = Object.freeze({
  HOME: 'home',
  VAULT: 'vault',
  WATCH_LATER: 'watch-later',
  MEDIA: 'media',
  SESSIONS: 'sessions',
  TOOLS: 'tools',
  SETTINGS: 'settings',
});

/** Message types understood by the service worker router. */
export const MSG = Object.freeze({
  PING: 'system/ping',
  DIAGNOSTICS: 'system/diagnostics',
  OPEN_DASHBOARD: 'system/openDashboard',
});

/** BroadcastChannel name used to announce IndexedDB writes. */
export const DB_CHANGE_CHANNEL = 'browsekit:db';

/**
 * Build the URL of a dashboard route.
 * @param {string} [route]
 * @returns {string}
 */
export function dashboardUrl(route = ROUTES.HOME) {
  return chrome.runtime.getURL(`src/pages/dashboard/dashboard.html#/${route}`);
}
