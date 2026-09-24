/**
 * Right-click menu entries. Created on install/update (Chrome persists them
 * across service-worker restarts); clicks are handled by handleMenuClick.
 */
import { addToWatchLater } from '../features/watch-later/watch-later.js';
import { saveTabsToVault } from '../features/vault/save.js';
import { getSettings } from '../shared/settings.js';
import { flashBadge } from './badge.js';

export const MENU = Object.freeze({
  WATCH_PAGE: 'bk-watch-later-page',
  WATCH_LINK: 'bk-watch-later-link',
  VAULT_TAB: 'bk-vault-tab',
});

export async function createMenus() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: MENU.WATCH_PAGE,
    title: 'Save page to Watch Later',
    contexts: ['page', 'frame', 'selection', 'video', 'audio', 'image'],
  });
  chrome.contextMenus.create({ id: MENU.WATCH_LINK, title: 'Save link to Watch Later', contexts: ['link'] });
  chrome.contextMenus.create({ id: MENU.VAULT_TAB, title: 'Save tab to TabVault', contexts: ['page'] });
}

/**
 * @param {chrome.contextMenus.OnClickData & { linkText?: string }} info
 * @param {chrome.tabs.Tab | undefined} tab
 */
export async function handleMenuClick(info, tab) {
  const settings = await getSettings();
  try {
    if (info.menuItemId === MENU.WATCH_LINK && info.linkUrl) {
      const { duplicate } = await addToWatchLater(
        { url: info.linkUrl, title: info.linkText || info.selectionText || info.linkUrl, source: 'context-menu' },
        { cleanUrls: settings.privacy.cleanUrlsOnSave },
      );
      await flashBadge(tab?.id, duplicate ? '↻' : '✓');
    } else if (info.menuItemId === MENU.WATCH_PAGE) {
      const url = info.pageUrl ?? tab?.url;
      if (!url) throw new Error('No page URL');
      const { duplicate } = await addToWatchLater(
        { url, title: tab?.url === url ? tab?.title : url, source: 'context-menu' },
        { cleanUrls: settings.privacy.cleanUrlsOnSave },
      );
      await flashBadge(tab?.id, duplicate ? '↻' : '✓');
    } else if (info.menuItemId === MENU.VAULT_TAB) {
      await saveActiveTabToLastCollection();
      await flashBadge(tab?.id, '✓');
    }
  } catch (err) {
    console.warn('[BrowseKit] menu action failed', err);
    await flashBadge(tab?.id, '✕', true);
  }
}

/** Save the active tab to the last-used collection (or a new one). */
export async function saveActiveTabToLastCollection() {
  const { vault } = await getSettings();
  try {
    return await saveTabsToVault({ scope: 'tab', collectionId: vault.lastCollectionId });
  } catch (err) {
    if (vault.lastCollectionId && /no longer exists/.test(String(err))) {
      return saveTabsToVault({ scope: 'tab', collectionId: null });
    }
    throw err;
  }
}
