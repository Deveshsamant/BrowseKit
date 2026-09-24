/**
 * "Save tabs to TabVault" flow shared by the popup, dashboard and keyboard
 * command: collect tabs, resolve/create the target collection, apply settings.
 */
import { ROUTES, dashboardUrl } from '../../shared/constants.js';
import { getSettings, updateSettings } from '../../shared/settings.js';
import { collectTabs, currentWindowId } from '../../shared/tabs.js';
import { addTabs, createCollection, defaultCollectionName, listCollections } from './vault.js';

/**
 * @param {{ scope: 'tab' | 'window' | 'all', collectionId?: string | null, newCollectionName?: string }} request
 * @returns {Promise<{ collectionId: string, collectionName: string, added: number, duplicates: number, skipped: number, closed: number }>}
 */
export async function saveTabsToVault({ scope, collectionId, newCollectionName }) {
  const settings = await getSettings();
  const { tabs, skipped } = await collectTabs(scope);
  if (!tabs.length) {
    throw new Error(scope === 'tab' ? 'This page can’t be saved (browser or extension page).' : 'No saveable tabs found.');
  }

  let collection;
  if (collectionId) {
    collection = (await listCollections()).find((c) => c.id === collectionId);
    if (!collection) throw new Error('That collection no longer exists.');
  } else {
    collection = await createCollection({ name: newCollectionName || defaultCollectionName(scope) });
  }

  const result = await addTabs(collection.id, tabs, {
    skipDuplicates: settings.vault.skipDuplicates,
    cleanUrls: settings.privacy.cleanUrlsOnSave,
  });
  await updateSettings({ vault: { lastCollectionId: collection.id } });

  let closed = 0;
  if (settings.vault.closeAfterSave) {
    const ids = tabs.map((t) => t.tabId).filter((id) => id !== undefined);
    const windowId = await currentWindowId();
    const remaining = await chrome.tabs.query({ windowType: 'normal' });
    // Never close the last tabs: Chrome would close the window (or the browser).
    const wouldCloseCurrentWindow = !remaining.some((t) => t.windowId === windowId && !ids.includes(t.id));
    if (wouldCloseCurrentWindow) {
      await chrome.tabs.create({ windowId, url: dashboardUrl(ROUTES.VAULT), active: true });
    }
    await chrome.tabs.remove(/** @type {number[]} */ (ids));
    closed = ids.length;
  }

  return {
    collectionId: collection.id,
    collectionName: collection.name,
    added: result.added,
    duplicates: result.duplicates,
    skipped: skipped + result.invalid,
    closed,
  };
}
