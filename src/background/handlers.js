/**
 * Service-worker request handlers, keyed by message type.
 * Each handler receives (payload, sender) and returns data or throws.
 */
import { MSG, ROUTES, dashboardUrl } from '../shared/constants.js';
import { DB_VERSION } from '../shared/db/schema.js';
import { countAll } from '../shared/db/repository.js';
import { getSettings } from '../shared/settings.js';

/** @type {Record<string, (payload: any, sender: chrome.runtime.MessageSender) => any>} */
export const handlers = {
  [MSG.PING]: () => ({ pong: true, version: chrome.runtime.getManifest().version }),

  // Exercises IndexedDB + storage from the worker; shown on Settings → About.
  [MSG.DIAGNOSTICS]: async () => ({
    version: chrome.runtime.getManifest().version,
    dbVersion: DB_VERSION,
    counts: await countAll(),
    theme: (await getSettings()).theme,
    permissions: (await chrome.permissions.getAll()).permissions ?? [],
  }),

  [MSG.OPEN_DASHBOARD]: async (payload) => {
    const route = Object.values(ROUTES).includes(payload?.route) ? payload.route : ROUTES.HOME;
    const query = typeof payload?.query === 'string' && /^[\w=&%.-]*$/.test(payload.query) ? payload.query : '';
    // Reuse an open dashboard tab instead of piling up new ones.
    const base = chrome.runtime.getURL('src/pages/dashboard/dashboard.html');
    const existing = (await chrome.tabs.query({})).find((t) => t.url?.startsWith(base));
    const url = `${dashboardUrl(route)}${query ? `?${query}` : ''}`;
    if (existing?.id !== undefined) {
      await chrome.tabs.update(existing.id, { url, active: true });
      await chrome.windows.update(existing.windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url });
    }
    return true;
  },
};
