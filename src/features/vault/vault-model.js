/**
 * Pure TabVault logic: ordering, duplicate planning, search, import/export
 * formats. No chrome.* or IndexedDB access so it is unit-testable.
 *
 * TabVault collections are BrowseKit records, not Chrome tab groups.
 */
import { duplicateKey, isSaveableUrl } from '../../shared/urls.js';

/** @typedef {{ id: string, name: string, color: string, sortOrder: number, createdAt: number, updatedAt: number }} Collection */
/** @typedef {{ id: string, collectionId: string, url: string, title: string, sortOrder: number, createdAt: number, updatedAt: number }} VaultTab */
/** @typedef {{ url: string, title?: string }} NewTab */

export const COLLECTION_COLORS = Object.freeze(['indigo', 'blue', 'teal', 'green', 'amber', 'orange', 'red', 'pink', 'gray']);
export const MAX_TITLE_LENGTH = 500;
export const MAX_URL_LENGTH = 8192;
export const MAX_NAME_LENGTH = 120;

/**
 * @template {{ sortOrder: number, createdAt?: number }} T
 * @param {T[]} items
 * @returns {T[]}
 */
export function sortByOrder(items) {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder || (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

/** @param {{ sortOrder: number }[]} items */
export function nextSortOrder(items) {
  return items.reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1;
}

/** @param {string} name */
export function cleanName(name) {
  return String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
}

/**
 * Decide which new tabs to add to a collection.
 * @param {VaultTab[]} existing tabs already in the collection
 * @param {NewTab[]} incoming
 * @param {{ skipDuplicates: boolean }} options
 * @returns {{ toAdd: { url: string, title: string }[], duplicates: number, invalid: number }}
 */
export function planAddTabs(existing, incoming, { skipDuplicates }) {
  const seen = new Set(existing.map((t) => duplicateKey(t.url)));
  const toAdd = [];
  let duplicates = 0;
  let invalid = 0;
  for (const item of incoming) {
    const url = String(item?.url ?? '').trim();
    if (!url || url.length > MAX_URL_LENGTH || !isSaveableUrl(url)) {
      invalid += 1;
      continue;
    }
    const key = duplicateKey(url);
    if (skipDuplicates && seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    toAdd.push({ url, title: String(item.title || url).slice(0, MAX_TITLE_LENGTH) });
  }
  return { toAdd, duplicates, invalid };
}

/**
 * Case-insensitive AND search over title and URL.
 * @param {VaultTab[]} tabs
 * @param {string} query
 * @returns {VaultTab[]}
 */
export function searchTabs(tabs, query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return tabs.filter((t) => {
    const hay = `${t.title}\n${t.url}`.toLowerCase();
    return terms.every((term) => hay.includes(term));
  });
}

/**
 * Group tabs by collection id, each group sorted.
 * @param {VaultTab[]} tabs
 * @returns {Map<string, VaultTab[]>}
 */
export function groupTabs(tabs) {
  /** @type {Map<string, VaultTab[]>} */
  const map = new Map();
  for (const tab of tabs) {
    const list = map.get(tab.collectionId) ?? [];
    list.push(tab);
    map.set(tab.collectionId, list);
  }
  for (const [id, list] of map) map.set(id, sortByOrder(list));
  return map;
}

// --- Export ------------------------------------------------------------------

export const VAULT_FORMAT = 'browsekit-vault';

/**
 * @param {Collection[]} collections
 * @param {Map<string, VaultTab[]>} tabsByCollection
 * @param {Date} [now]
 */
export function exportVaultJson(collections, tabsByCollection, now = new Date()) {
  return {
    format: VAULT_FORMAT,
    formatVersion: 1,
    exportedAt: now.toISOString(),
    collections: sortByOrder(collections).map((c) => ({
      name: c.name,
      color: c.color,
      createdAt: c.createdAt,
      tabs: (tabsByCollection.get(c.id) ?? []).map((t) => ({ url: t.url, title: t.title })),
    })),
  };
}

/**
 * Plain text: "# Collection" headings followed by one URL per line.
 * @param {Collection[]} collections
 * @param {Map<string, VaultTab[]>} tabsByCollection
 */
export function exportUrlList(collections, tabsByCollection) {
  return sortByOrder(collections)
    .map((c) => [`# ${c.name}`, ...(tabsByCollection.get(c.id) ?? []).map((t) => t.url)].join('\n'))
    .join('\n\n')
    .concat('\n');
}

// --- Import ------------------------------------------------------------------

/** @typedef {{ name: string, color: string, tabs: { url: string, title: string }[] }} ImportedCollection */

/** @param {unknown} v */
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** @param {unknown} color */
const validColor = (color) => (COLLECTION_COLORS.includes(/** @type {string} */ (color)) ? /** @type {string} */ (color) : 'indigo');

/**
 * @param {unknown} rawTabs
 * @returns {{ url: string, title: string }[]}
 */
function sanitizeTabs(rawTabs) {
  if (!Array.isArray(rawTabs)) return [];
  return planAddTabs([], rawTabs.filter(isObject), { skipDuplicates: false }).toAdd;
}

/**
 * Parse an import file. Accepts:
 *  - BrowseKit vault export (JSON, format "browsekit-vault")
 *  - BrowseKit full backup (JSON, takes collections + vaultTabs)
 *  - OneTab export ("url | title" lines, blank line between groups)
 *  - Plain URL list (one per line; "# Name" starts a new collection)
 * @param {string} text
 * @param {string} [fallbackName]
 * @returns {{ collections: ImportedCollection[], errors: string[] }}
 */
export function parseVaultImport(text, fallbackName = 'Imported') {
  const trimmed = text.trim();
  if (!trimmed) return { collections: [], errors: ['The file is empty.'] };

  if (trimmed.startsWith('{')) {
    let data;
    try {
      data = JSON.parse(trimmed);
    } catch {
      return { collections: [], errors: ['The file looks like JSON but could not be parsed.'] };
    }
    if (data?.format === VAULT_FORMAT && Array.isArray(data.collections)) {
      const collections = data.collections.filter(isObject).map((c, i) => ({
        name: cleanName(c.name) || `${fallbackName} ${i + 1}`,
        color: validColor(c.color),
        tabs: sanitizeTabs(c.tabs),
      }));
      return { collections, errors: [] };
    }
    if (data?.format === 'browsekit-backup' && isObject(data.stores)) {
      const cols = Array.isArray(data.stores.collections) ? data.stores.collections.filter(isObject) : [];
      const tabs = Array.isArray(data.stores.vaultTabs) ? data.stores.vaultTabs.filter(isObject) : [];
      const grouped = groupTabs(
        tabs.map((t) => ({ ...t, sortOrder: Number(t.sortOrder) || 0 })),
      );
      const collections = sortByOrder(cols.map((c) => ({ ...c, sortOrder: Number(c.sortOrder) || 0 }))).map(
        (c, i) => ({
          name: cleanName(c.name) || `${fallbackName} ${i + 1}`,
          color: validColor(c.color),
          tabs: sanitizeTabs(grouped.get(c.id) ?? []),
        }),
      );
      return { collections, errors: [] };
    }
    return { collections: [], errors: ['This JSON file is not a BrowseKit TabVault export or backup.'] };
  }

  // Line-based formats.
  /** @type {ImportedCollection[]} */
  const collections = [];
  let current = null;
  let blankRun = false;
  const start = (/** @type {string} */ name) => {
    current = { name: cleanName(name) || fallbackName, color: 'indigo', tabs: [] };
    collections.push(current);
  };
  for (const rawLine of trimmed.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (!line) {
      blankRun = true;
      continue;
    }
    if (line.startsWith('#')) {
      start(line.replace(/^#+\s*/, ''));
      blankRun = false;
      continue;
    }
    // OneTab: "url | title"
    const sep = line.indexOf(' | ');
    const url = sep >= 0 ? line.slice(0, sep).trim() : line;
    const title = sep >= 0 ? line.slice(sep + 3).trim() : '';
    if (!current || (blankRun && current.tabs.length)) {
      start(collections.length ? `${fallbackName} ${collections.length + 1}` : fallbackName);
    }
    blankRun = false;
    /** @type {ImportedCollection} */ (current).tabs.push({ url, title });
  }
  const errors = [];
  let invalid = 0;
  for (const c of collections) {
    const plan = planAddTabs([], c.tabs, { skipDuplicates: false });
    invalid += plan.invalid;
    c.tabs = plan.toAdd;
  }
  if (invalid) errors.push(`${invalid} line(s) were not valid URLs and were skipped.`);
  return { collections: collections.filter((c) => c.tabs.length), errors };
}
