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
