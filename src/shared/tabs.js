/**
 * Thin wrappers over chrome.tabs/windows shared by TabVault, Watch Later,
 * Sessions and Tab Manager. Requires the "tabs" permission for URLs/titles of
 * tabs other than the active one.
 */
import { isSaveableUrl } from './urls.js';

/** @typedef {{ url: string, title: string, pinned?: boolean, windowId?: number, tabId?: number }} TabInfo */

/** chrome-extension://<id> — used to skip BrowseKit's own pages. */
export function ownOrigin() {
  return new URL(chrome.runtime.getURL('/')).origin;
}

/**
 * @param {chrome.tabs.Tab} tab
 * @returns {TabInfo}
 */
export function toTabInfo(tab) {
  const url = tab.url || tab.pendingUrl || '';
  return {
    url,
    title: tab.title || url,
    pinned: !!tab.pinned,
    windowId: tab.windowId,
    tabId: tab.id,
  };
}

/**
 * The last-focused normal browser window. From the popup this is the window the
 * popup belongs to; from the dashboard it is the dashboard's own window.
 */
export async function currentWindowId() {
  const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
  return win.id;
}

/**
 * The tab the user is looking at in the current window.
 * @returns {Promise<chrome.tabs.Tab | undefined>}
 */
export async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, windowId: await currentWindowId() });
  return tab;
}

/**
 * Collect saveable tabs for a scope. Skips blank/new-tab pages, script/data
 * URLs and BrowseKit's own pages.
 * @param {'tab' | 'window' | 'all'} scope
 * @returns {Promise<{ tabs: TabInfo[], skipped: number }>}
 */
export async function collectTabs(scope) {
  let raw;
  if (scope === 'tab') raw = [await activeTab()].filter(Boolean);
  else if (scope === 'window') raw = await chrome.tabs.query({ windowId: await currentWindowId() });
  else raw = await chrome.tabs.query({ windowType: 'normal' });
  const origin = ownOrigin();
  const infos = /** @type {chrome.tabs.Tab[]} */ (raw).map(toTabInfo);
  const tabs = infos.filter((t) => isSaveableUrl(t.url, origin));
  return { tabs, skipped: infos.length - tabs.length };
}

/**
 * Open URLs as ordinary tabs (never tab groups). Each URL is opened on its
 * own so one URL Chrome refuses (e.g. some chrome:// pages) does not stop the rest.
 * @param {{ url: string, pinned?: boolean }[]} items
 * @param {{ newWindow?: boolean, activateFirst?: boolean }} [options]
 * @returns {Promise<{ opened: number, failed: string[] }>}
 */
export async function openTabs(items, { newWindow = false, activateFirst = true } = {}) {
  const failed = [];
  let opened = 0;
  if (!items.length) return { opened, failed };
  let windowId;
  let startIndex = 0;
  if (newWindow) {
    for (; startIndex < items.length && windowId === undefined; startIndex += 1) {
      try {
        const win = await chrome.windows.create({ url: items[startIndex].url, focused: true });
        windowId = win.id;
        if (items[startIndex].pinned && win.tabs?.[0]?.id !== undefined) {
          await chrome.tabs.update(win.tabs[0].id, { pinned: true });
        }
        opened += 1;
      } catch {
        failed.push(items[startIndex].url);
      }
    }
  } else {
    windowId = await currentWindowId();
  }
  for (let i = startIndex; i < items.length; i += 1) {
    try {
      await chrome.tabs.create({
        windowId,
        url: items[i].url,
        pinned: !!items[i].pinned,
        active: !newWindow && activateFirst && opened === 0,
      });
      opened += 1;
    } catch {
      failed.push(items[i].url);
    }
  }
  return { opened, failed };
}

/**
 * Focus an existing tab and its window.
 * @param {number} tabId
 * @param {number} windowId
 */
export async function focusTab(tabId, windowId) {
  await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(windowId, { focused: true });
}
