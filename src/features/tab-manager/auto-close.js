/**
 * Auto-close idle tabs into a TabVault collection so nothing is lost
 * (Tab Wrangler-style). The collection is created on first use.
 */
import { addTabs, createCollection, listCollections } from '../vault/vault.js';
import { bumpStat } from '../../shared/stats.js';
import { ownOrigin, toTabInfo } from '../../shared/tabs.js';
import { pickIdleTabs } from './tab-model.js';

export const AUTO_CLOSED_NAME = 'Auto-closed tabs';

/** @returns {Promise<string>} id of the "Auto-closed tabs" collection */
export async function autoClosedCollectionId() {
  const existing = (await listCollections()).find((c) => c.name === AUTO_CLOSED_NAME);
  if (existing) return existing.id;
  return (await createCollection({ name: AUTO_CLOSED_NAME, color: 'gray' })).id;
}

/**
 * @param {{ minutes: number, neverTouchHosts: string[] }} options
 * @returns {Promise<number>} tabs closed
 */
export async function autoCloseIdleTabs({ minutes, neverTouchHosts }) {
  const tabs = await chrome.tabs.query({ windowType: 'normal' });
  const idle = pickIdleTabs(tabs, { now: Date.now(), minutes, neverTouchHosts, skipOrigin: ownOrigin() });
  if (!idle.length) return 0;
  // Never empty a window completely: Chrome would close it.
  const perWindow = new Map();
  for (const t of tabs) perWindow.set(t.windowId, (perWindow.get(t.windowId) ?? 0) + 1);
  const closing = idle.filter((t) => {
    const left = perWindow.get(t.windowId) ?? 0;
    if (left <= 1) return false;
    perWindow.set(t.windowId, left - 1);
    return true;
  });
  if (!closing.length) return 0;
  await addTabs(await autoClosedCollectionId(), closing.map(toTabInfo), { skipDuplicates: true });
  await chrome.tabs.remove(closing.map((t) => /** @type {number} */ (t.id)));
  await bumpStat('tabsAutoClosed', closing.length);
  return closing.length;
}
