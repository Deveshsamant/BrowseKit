/**
 * Install/update/startup work. Must be idempotent: it can run on every
 * update and after the browser restarts.
 */
import { ROUTES, dashboardUrl } from '../shared/constants.js';
import { openDatabase } from '../shared/db/database.js';
import { getMeta, setMeta } from '../shared/db/repository.js';
import { ensureSettings } from '../shared/settings.js';

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

  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
    await chrome.tabs.create({ url: `${dashboardUrl(ROUTES.HOME)}?welcome=1` });
  }
}
