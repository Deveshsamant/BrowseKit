/**
 * Actions on open tabs: tidy, merge windows, close duplicates, idle handling.
 */
import { ownOrigin } from '../../shared/tabs.js';
import { bumpStat } from '../../shared/stats.js';
import { findDuplicateGroups, pickIdleTabs, planSortBySite } from './tab-model.js';

/**
 * Sort a window's tabs by site (pinned tabs stay first).
 * @param {number} windowId
 */
export async function sortWindowBySite(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  const order = planSortBySite(tabs);
  for (let i = 0; i < order.length; i += 1) {
    await chrome.tabs.move(order[i], { index: i });
  }
  return order.length;
}

/**
 * Move every tab from other normal windows into `targetWindowId`.
 * Pinned tabs are moved and re-pinned (Chrome unpins them when moving).
 * @param {number} targetWindowId
 */
export async function mergeWindowsInto(targetWindowId) {
  const tabs = await chrome.tabs.query({ windowType: 'normal' });
  const moving = tabs.filter((t) => t.windowId !== targetWindowId);
  for (const t of moving) {
    await chrome.tabs.move(/** @type {number} */ (t.id), { windowId: targetWindowId, index: -1 });
    if (t.pinned) await chrome.tabs.update(/** @type {number} */ (t.id), { pinned: true });
  }
  return moving.length;
}

/** Close duplicate tabs across all windows. @returns {Promise<number>} */
export async function closeAllDuplicates() {
  const tabs = await chrome.tabs.query({ windowType: 'normal' });
  const extras = findDuplicateGroups(tabs).flatMap((g) => g.extras);
  if (!extras.length) return 0;
  await chrome.tabs.remove(extras.map((t) => /** @type {number} */ (t.id)));
  await bumpStat('duplicatesClosed', extras.length);
  return extras.length;
}

/**
 * Discard idle tabs to free memory. Chrome reloads a discarded tab when you
 * return to it; unsaved form input on that page may be lost.
 * @param {{ minutes: number, neverTouchHosts: string[] }} options
 */
export async function suspendIdleTabs({ minutes, neverTouchHosts }) {
  const tabs = await chrome.tabs.query({ windowType: 'normal' });
  const idle = pickIdleTabs(tabs, { now: Date.now(), minutes, neverTouchHosts, forSuspend: true, skipOrigin: ownOrigin() });
  let count = 0;
  for (const t of idle) {
    try {
      if (await chrome.tabs.discard(/** @type {number} */ (t.id))) count += 1;
    } catch {
      // Chrome refuses some tabs (e.g. the only tab, or already discarding).
    }
  }
  await bumpStat('tabsSuspended', count);
  return count;
}

/** Suspend every background tab now (manual "free memory"). */
export async function suspendAllBackgroundTabs() {
  return suspendIdleTabs({ minutes: 1e-9, neverTouchHosts: [] });
}
