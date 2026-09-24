/**
 * Watch Later queue stored in IndexedDB.
 * Record: { id, url, title, watched: 0|1, addedAt, watchedAt, source }
 */
import { notifyChange, promisify, transaction } from '../../shared/db/database.js';
import { STORES } from '../../shared/db/schema.js';
import { cleanUrl, duplicateKey, isSaveableUrl } from '../../shared/urls.js';

const W = STORES.WATCH_LATER;
const changed = (/** @type {string} */ op) => notifyChange({ stores: [W], op });

/** @typedef {{ id: string, url: string, title: string, watched: 0 | 1, addedAt: number, watchedAt: number | null, source: string }} WatchItem */
/** @typedef {'all' | 'unwatched' | 'watched'} WatchFilter */

/**
 * Add a page. If the same page is already queued it is moved back to the top
 * and marked unwatched instead of creating a duplicate.
 * @param {{ url: string, title?: string, source?: string }} input
 * @param {{ cleanUrls?: boolean }} [options]
 * @returns {Promise<{ item: WatchItem, duplicate: boolean }>}
 */
export async function addToWatchLater({ url, title, source = 'popup' }, { cleanUrls = false } = {}) {
  const finalUrl = cleanUrls ? cleanUrl(url).url : String(url ?? '').trim();
  if (!isSaveableUrl(finalUrl)) throw new Error('This page can’t be saved (browser or extension page).');
  const key = duplicateKey(finalUrl);
  const now = Date.now();
  const result = await transaction(W, 'readwrite', async (tx) => {
    const store = tx.objectStore(W);
    const all = /** @type {WatchItem[]} */ (await promisify(store.getAll()));
    const existing = all.find((i) => duplicateKey(i.url) === key);
    if (existing) {
      const item = { ...existing, title: title || existing.title, watched: /** @type {0} */ (0), watchedAt: null, addedAt: now };
      store.put(item);
      return { item, duplicate: true };
    }
    /** @type {WatchItem} */
    const item = {
      id: crypto.randomUUID(),
      url: finalUrl,
      title: String(title || finalUrl).slice(0, 500),
      watched: 0,
      addedAt: now,
      watchedAt: null,
      source,
    };
    store.put(item);
    return { item, duplicate: false };
  });
  changed('add');
  return result;
}

/** @returns {Promise<WatchItem[]>} newest first */
export async function listWatchLater() {
  const all = await transaction(W, 'readonly', (tx) => promisify(tx.objectStore(W).getAll()));
  return all.sort((a, b) => b.addedAt - a.addedAt);
}

/**
 * Pure filter + search, newest first.
 * @param {WatchItem[]} items
 * @param {{ filter?: WatchFilter, query?: string }} options
 */
export function filterWatchLater(items, { filter = 'all', query = '' }) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((i) => {
    if (filter === 'watched' && !i.watched) return false;
    if (filter === 'unwatched' && i.watched) return false;
    const hay = `${i.title}\n${i.url}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

/**
 * @param {string[]} ids
 * @param {boolean} watched
 */
export async function setWatched(ids, watched) {
  const now = Date.now();
  await transaction(W, 'readwrite', async (tx) => {
    const store = tx.objectStore(W);
    for (const id of ids) {
      const item = await promisify(store.get(id));
      if (item) store.put({ ...item, watched: watched ? 1 : 0, watchedAt: watched ? now : null });
    }
  });
  changed('watched');
}

/** @param {string[]} ids */
export async function removeFromWatchLater(ids) {
  await transaction(W, 'readwrite', (tx) => {
    for (const id of ids) tx.objectStore(W).delete(id);
  });
  changed('delete');
}

/** Delete every watched item. @returns {Promise<number>} */
export async function clearWatched() {
  const removed = await transaction(W, 'readwrite', async (tx) => {
    const keys = await promisify(tx.objectStore(W).index('watched').getAllKeys(1));
    for (const key of keys) tx.objectStore(W).delete(key);
    return keys.length;
  });
  changed('clear-watched');
  return removed;
}
