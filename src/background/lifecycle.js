/**
 * Install/update/startup work. Must be idempotent: it can run on every
 * update and after the browser restarts.
 */
import { ROUTES, dashboardUrl } from '../shared/constants.js';
import { openDatabase } from '../shared/db/database.js';
import { getMeta, setMeta } from '../shared/db/repository.js';
import { ensureSettings } from '../shared/settings.js';
import { syncRegisteredMediaScript } from '../features/media/media-sites.js';
import { applyActionBehavior } from './action.js';
import { createMenus } from './menus.js';
import { ensureTickAlarm } from './tick.js';

/**
 * @param {chrome.runtime.InstalledDetails} details
 */
export async function handleInstalled(details) {
  await ensureSettings();
  await openDatabase(); // runs any pending migrations now rather than on first use

  const now = Date.now();
  if (!(await getMeta('installedAt'))) await setMeta('installedAt', now);
  await setMeta('lastUpdatedAt', now);
  await setMeta('appVersion', chrome.runtime.getManifest().version);
  await createMenus();
  await syncRegisteredMediaScript();
  await ensureTickAlarm();
  await applyActionBehavior();

  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
    await chrome.tabs.create({ url: `${dashboardUrl(ROUTES.HOME)}?welcome=1` });
  }
}

/** Browser start: make sure scheduled work and the toolbar behaviour are in place. */
export async function handleStartup() {
  await ensureTickAlarm();
  await applyActionBehavior();
}
