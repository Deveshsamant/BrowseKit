/**
 * Pure open-tab logic: duplicate detection and search. Operates on
 * chrome.tabs.Tab-shaped objects so it is unit-testable without Chrome.
 */
import { duplicateKey } from '../../shared/urls.js';

/** @typedef {{ id?: number, windowId: number, index: number, url?: string, pendingUrl?: string, title?: string, active?: boolean, pinned?: boolean, audible?: boolean }} TabLike */

/** @param {TabLike} t */
const urlOf = (t) => t.url || t.pendingUrl || '';

/**
 * Group open tabs showing the same page (ignoring #fragment and trailing slash).
 * In each group one tab is kept: the active one, else a pinned one, else the
 * left-most. Browser-internal new-tab pages are ignored.
 * @param {TabLike[]} tabs
 * @returns {{ key: string, keep: TabLike, extras: TabLike[] }[]}
 */
export function findDuplicateGroups(tabs) {
  /** @type {Map<string, TabLike[]>} */
  const groups = new Map();
  for (const tab of tabs) {
    const url = urlOf(tab);
    if (!url || /^(chrome|edge|brave):\/\/newtab\/?$/.test(url) || url === 'about:blank') continue;
    const key = duplicateKey(url);
    const list = groups.get(key) ?? [];
    list.push(tab);
    groups.set(key, list);
  }
  const result = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const ranked = [...list].sort(
      (a, b) =>
        Number(!!b.active) - Number(!!a.active) ||
        Number(!!b.pinned) - Number(!!a.pinned) ||
        a.windowId - b.windowId ||
        a.index - b.index,
    );
    // Never close a pinned tab automatically.
    result.push({ key, keep: ranked[0], extras: ranked.slice(1).filter((t) => !t.pinned) });
  }
  return result.filter((g) => g.extras.length);
}

/**
 * @param {TabLike[]} tabs
 * @param {string} query
 */
export function searchOpenTabs(tabs, query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return tabs;
  return tabs.filter((t) => {
    const hay = `${t.title ?? ''}\n${urlOf(t)}`.toLowerCase();
    return terms.every((term) => hay.includes(term));
  });
}

/**
 * Tabs eligible for auto-suspend / auto-close: idle longer than `minutes`,
 * not active, pinned, audible, already discarded (for suspend) or on a
 * protected host. Uses Chrome's `lastAccessed` (Chrome 121+).
 * @param {(TabLike & { lastAccessed?: number, discarded?: boolean, autoDiscardable?: boolean })[]} tabs
 * @param {{ now: number, minutes: number, neverTouchHosts?: string[], forSuspend?: boolean, skipOrigin?: string }} options
 */
export function pickIdleTabs(tabs, { now, minutes, neverTouchHosts = [], forSuspend = false, skipOrigin }) {
  if (!minutes) return [];
  const cutoff = now - minutes * 60_000;
  const protectedHosts = new Set(neverTouchHosts.map((h) => h.toLowerCase()));
  return tabs.filter((t) => {
    const url = urlOf(t);
    if (!/^https?:/.test(url) || (skipOrigin && url.startsWith(skipOrigin))) return false;
    if (t.active || t.pinned || t.audible) return false;
    if (forSuspend && (t.discarded || t.autoDiscardable === false)) return false;
    if (typeof t.lastAccessed !== 'number' || t.lastAccessed > cutoff) return false;
    let host = '';
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return false;
    }
    return ![...protectedHosts].some((h) => host === h || host.endsWith(`.${h}`));
  });
}

/**
 * New order for a window's tabs: pinned tabs keep their order first, then the
 * rest grouped by site (alphabetical by hostname, stable within a site).
 * @param {TabLike[]} tabs tabs of one window
 * @returns {number[]} tab ids in the new order
 */
export function planSortBySite(tabs) {
  const ordered = [...tabs].sort((a, b) => a.index - b.index);
  const hostOf = (t) => {
    try {
      return new URL(urlOf(t)).hostname.replace(/^www\./, '');
    } catch {
      return '~';
    }
  };
  const pinned = ordered.filter((t) => t.pinned);
  const rest = ordered
    .filter((t) => !t.pinned)
    .map((t, i) => ({ t, i, host: hostOf(t) }))
    .sort((a, b) => a.host.localeCompare(b.host) || a.i - b.i)
    .map((x) => x.t);
  return [...pinned, ...rest].map((t) => /** @type {number} */ (t.id));
}
