/**
 * Pure TabVault logic: ordering, duplicate planning, search, import/export
 * formats. No chrome.* or IndexedDB access so it is unit-testable.
 *
 * TabVault collections are BrowseKit records, not Chrome tab groups.
 */
import { duplicateKey, isSaveableUrl } from '../../shared/urls.js';

/** @typedef {{ id: string, name: string, color: string, sortOrder: number, createdAt: number, updatedAt: number, starred?: boolean }} Collection */
/** @typedef {{ id: string, collectionId: string, url: string, title: string, sortOrder: number, createdAt: number, updatedAt: number, note?: string, tags?: string[] }} VaultTab */
/** @typedef {{ url: string, title?: string }} NewTab */

export const COLLECTION_COLORS = Object.freeze(['indigo', 'blue', 'teal', 'green', 'amber', 'orange', 'red', 'pink', 'gray']);
export const MAX_TITLE_LENGTH = 500;
export const MAX_URL_LENGTH = 8192;
export const MAX_NAME_LENGTH = 120;
export const MAX_NOTE_LENGTH = 2000;
export const MAX_TAGS = 20;

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
    /** @type {{ url: string, title: string, note?: string, tags?: string[] }} */
    const entry = { url, title: String(item.title || url).slice(0, MAX_TITLE_LENGTH) };
    const extra = /** @type {{ note?: unknown, tags?: unknown }} */ (item);
    if (typeof extra.note === 'string' && extra.note.trim()) entry.note = extra.note.trim().slice(0, MAX_NOTE_LENGTH);
    if (Array.isArray(extra.tags) && extra.tags.length) entry.tags = normalizeTags(extra.tags.map(String));
    toAdd.push(entry);
  }
  return { toAdd, duplicates, invalid };
}

/**
 * Normalise user-entered tags: lower-case, no leading '#', unique, bounded.
 * @param {string | string[] | undefined} input comma/space separated or array
 * @returns {string[]}
 */
export function normalizeTags(input) {
  const text = String(input ?? '');
  const raw = Array.isArray(input) ? input : text.includes(',') ? text.split(',') : text.split(/\s+/);
  const out = [];
  for (const t of raw) {
    const tag = String(t).trim().replace(/^#+/, '').replace(/\s+/g, ' ').toLowerCase().slice(0, 40);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/**
 * Case-insensitive AND search over title, URL, note and tags. A term
 * starting with '#' must match a tag exactly.
 * @param {VaultTab[]} tabs
 * @param {string} query
 * @returns {VaultTab[]}
 */
export function searchTabs(tabs, query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return tabs.filter((t) => {
    const hay = `${t.title}\n${t.url}\n${t.note ?? ''}`.toLowerCase();
    const tags = t.tags ?? [];
    return terms.every((term) => (term.startsWith('#') && term.length > 1 ? tags.includes(term.slice(1)) : hay.includes(term) || tags.some((g) => g.includes(term))));
  });
}

/** Every tag in use with its count, most used first. @param {VaultTab[]} tabs */
export function tagCounts(tabs) {
  const counts = new Map();
  for (const t of tabs) for (const tag of t.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/**
 * Starred collections first, then manual order.
 * @param {Collection[]} collections
 */
export function orderCollections(collections) {
  return [...sortByOrder(collections)].sort((a, b) => Number(!!b.starred) - Number(!!a.starred));
}

/**
 * New tab order within a collection.
 * @param {VaultTab[]} tabs
 * @param {'title' | 'site' | 'newest' | 'oldest'} by
 * @returns {string[]} ids
 */
export function planSortTabs(tabs, by) {
  const host = (u) => {
    try {
      return new URL(u).hostname.replace(/^www\./, '');
    } catch {
      return u;
    }
  };
  const list = sortByOrder(tabs);
  const cmp = {
    title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
    site: (a, b) => host(a.url).localeCompare(host(b.url)) || a.title.localeCompare(b.title),
    newest: (a, b) => b.createdAt - a.createdAt,
    oldest: (a, b) => a.createdAt - b.createdAt,
  }[by];
  if (!cmp) throw new Error(`Unknown sort ${by}`);
  return [...list].sort(cmp).map((t) => t.id);
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
      tabs: (tabsByCollection.get(c.id) ?? []).map((t) => ({
        url: t.url,
        title: t.title,
        ...(t.note ? { note: t.note } : {}),
        ...(t.tags?.length ? { tags: t.tags } : {}),
      })),
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

  if (/<!DOCTYPE NETSCAPE-Bookmark-file-1>|<DL\b/i.test(trimmed.slice(0, 2000))) {
    const collections = parseBookmarksHtml(trimmed, fallbackName);
    return collections.length
      ? { collections, errors: [] }
      : { collections: [], errors: ['No bookmarks found in this HTML file.'] };
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

// --- Bookmarks HTML (Netscape format, used by every browser) -------------------

/** @param {string} s */
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** @param {string} s */
function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/**
 * Export collections as a bookmarks HTML file (one folder per collection),
 * importable by Chrome, Firefox, Edge and Safari.
 * @param {Collection[]} collections
 * @param {Map<string, VaultTab[]>} tabsByCollection
 * @param {Date} [now]
 */
export function exportBookmarksHtml(collections, tabsByCollection, now = new Date()) {
  const ts = Math.floor(now.getTime() / 1000);
  const lines = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- Exported by BrowseKit. -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
    `    <DT><H3 ADD_DATE="${ts}">BrowseKit TabVault</H3>`,
    '    <DL><p>',
  ];
  for (const c of sortByOrder(collections)) {
    lines.push(`        <DT><H3 ADD_DATE="${Math.floor(c.createdAt / 1000)}">${escapeHtml(c.name)}</H3>`, '        <DL><p>');
    for (const t of tabsByCollection.get(c.id) ?? []) {
      lines.push(`            <DT><A HREF="${escapeHtml(t.url)}" ADD_DATE="${Math.floor(t.createdAt / 1000)}">${escapeHtml(t.title)}</A>`);
    }
    lines.push('        </DL><p>');
  }
  lines.push('    </DL><p>', '</DL><p>', '');
  return lines.join('\n');
}

/**
 * Parse a bookmarks HTML file into collections: one per folder that directly
 * contains links (named by its folder path). Links outside any folder go to
 * `fallbackName`.
 * @param {string} html
 * @param {string} [fallbackName]
 * @returns {ImportedCollection[]}
 */
export function parseBookmarksHtml(html, fallbackName = 'Bookmarks') {
  /** @type {string[]} */
  const path = [];
  let pendingFolder = null;
  /** @type {Map<string, { url: string, title: string }[]>} */
  const byFolder = new Map();
  const token = /<H3[^>]*>([\s\S]*?)<\/H3>|<DL[^>]*>|<\/DL>|<A\s[^>]*HREF\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/A>/gi;
  for (const m of html.matchAll(token)) {
    const tag = m[0].slice(0, 3).toUpperCase();
    if (m[1] !== undefined) {
      pendingFolder = decodeEntities(m[1].replace(/<[^>]*>/g, '')).trim() || 'Folder';
    } else if (tag === '<DL') {
      if (pendingFolder !== null) path.push(pendingFolder);
      else path.push('');
      pendingFolder = null;
    } else if (tag === '</D') {
      path.pop();
    } else if (m[2] !== undefined) {
      const url = decodeEntities(m[2]).trim();
      const title = decodeEntities(m[3].replace(/<[^>]*>/g, '')).trim();
      const name = path.filter(Boolean).join(' / ').replace(/^BrowseKit TabVault(?: \/ |$)/, '') || fallbackName;
      const list = byFolder.get(name) ?? [];
      list.push({ url, title });
      byFolder.set(name, list);
    }
  }
  const out = [];
  for (const [name, tabs] of byFolder) {
    const plan = planAddTabs([], tabs, { skipDuplicates: false });
    if (plan.toAdd.length) out.push({ name: cleanName(name) || fallbackName, color: 'indigo', tabs: plan.toAdd });
  }
  return out;
}
