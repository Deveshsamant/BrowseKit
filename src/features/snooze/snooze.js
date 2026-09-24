/**
 * Tab snooze: close a tab now, reopen it at a chosen time. Wake-ups are
 * handled by the service worker's one-minute alarm tick, so they survive
 * browser restarts (overdue tabs open at the next tick after start-up).
 */
import { notifyChange, promisify, transaction } from '../../shared/db/database.js';
import { STORES } from '../../shared/db/schema.js';
import { bumpStat } from '../../shared/stats.js';
import { isSaveableUrl } from '../../shared/urls.js';

const S = STORES.SNOOZED;
const changed = (/** @type {string} */ op) => notifyChange({ stores: [S], op });

/** @typedef {{ id: string, url: string, title: string, wakeAt: number, createdAt: number }} SnoozedTab */

/**
 * Snooze a tab: store it, then close it.
 * @param {chrome.tabs.Tab} tab
 * @param {number} wakeAt epoch ms
 */
export async function snoozeTab(tab, wakeAt) {
  const url = tab.url || tab.pendingUrl || '';
  if (!isSaveableUrl(url)) throw new Error('This page can’t be snoozed (browser or extension page).');
  if (!(wakeAt > Date.now())) throw new Error('Pick a time in the future.');
  /** @type {SnoozedTab} */
  const record = { id: crypto.randomUUID(), url, title: tab.title || url, wakeAt, createdAt: Date.now() };
  await transaction(S, 'readwrite', (tx) => promisify(tx.objectStore(S).put(record)));
  changed('snooze');
  if (tab.id !== undefined) await chrome.tabs.remove(tab.id).catch(() => {});
  await bumpStat('tabsSnoozed');
  return record;
}

/** @returns {Promise<SnoozedTab[]>} soonest first */
export async function listSnoozed() {
  return transaction(S, 'readonly', (tx) => promisify(tx.objectStore(S).index('wakeAt').getAll()));
}

/** @param {string} id */
export async function cancelSnooze(id) {
  await transaction(S, 'readwrite', (tx) => promisify(tx.objectStore(S).delete(id)));
  changed('cancel');
}

/**
 * Remove and return snoozed tabs that are due.
 * @param {number} [now]
 * @returns {Promise<SnoozedTab[]>}
 */
export async function takeDue(now = Date.now()) {
  const due = await transaction(S, 'readwrite', async (tx) => {
    const store = tx.objectStore(S);
    const items = await promisify(store.index('wakeAt').getAll(IDBKeyRange.upperBound(now)));
    for (const item of items) store.delete(item.id);
    return items;
  });
  if (due.length) changed('wake');
  return due;
}

/**
 * Open snoozed tabs now (in the background of the last-focused window).
 * @param {SnoozedTab[]} items
 */
export async function openSnoozed(items) {
  let windowId;
  try {
    windowId = (await chrome.windows.getLastFocused({ windowTypes: ['normal'] })).id;
  } catch {
    windowId = undefined; // no normal window open: tabs.create makes one
  }
  for (const item of items) {
    await chrome.tabs.create({ url: item.url, active: false, ...(windowId !== undefined ? { windowId } : {}) }).catch(() => {});
  }
}

/** @param {string} id */
export async function wakeNow(id) {
  const [item] = await transaction(S, 'readwrite', async (tx) => {
    const store = tx.objectStore(S);
    const record = await promisify(store.get(id));
    if (record) store.delete(id);
    return record ? [record] : [];
  });
  if (item) {
    changed('wake');
    await openSnoozed([item]);
  }
}
