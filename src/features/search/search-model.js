/**
 * "Search everything": pure ranking over open tabs, TabVault, Watch Later,
 * sessions, snoozed tabs and actions. Unit-tested; no chrome.* access.
 */

/** @typedef {'action' | 'tab' | 'watch' | 'vault' | 'collection' | 'session' | 'snoozed'} ResultKind */
/**
 * @typedef {{
 *   kind: ResultKind,
 *   id: string,
 *   title: string,
 *   url?: string,
 *   sub?: string,
 *   extra?: string,
 *   recency?: number,
 *   data?: any,
 * }} SearchItem
 */

/** Small boost per kind so the most actionable things rank first on ties. */
const KIND_WEIGHT = { action: 7, tab: 6, watch: 3, collection: 3, vault: 2, snoozed: 2, session: 1 };

/** @param {string} s */
const norm = (s) => (s ?? '').toLowerCase();

/**
 * Score one item; 0 means "no match". Every query term must match the title,
 * URL or extra text (tags, notes, keywords).
 * @param {SearchItem} item
 * @param {string[]} terms lower-case
 * @param {number} [now]
 */
export function scoreItem(item, terms, now = Date.now()) {
  if (!terms.length) return 0;
  const title = norm(item.title);
  const url = norm(item.url);
  const extra = norm(item.extra);
  let host = '';
  try {
    host = item.url ? new URL(item.url).hostname.toLowerCase() : '';
  } catch {
    host = '';
  }
  let score = 0;
  for (const term of terms) {
    let best = 0;
    if (title.startsWith(term)) best = 30;
    else if (title.includes(` ${term}`) || title.includes(`-${term}`)) best = 20;
    else if (title.includes(term)) best = 12;
    if (host.startsWith(term) || host.includes(`.${term}`)) best = Math.max(best, 10);
    else if (url.includes(term)) best = Math.max(best, 4);
    if (extra.includes(term)) best = Math.max(best, term.startsWith('#') ? 25 : 8);
    if (!best) return 0;
    score += best;
  }
  score += KIND_WEIGHT[item.kind] ?? 0;
  if (item.recency) {
    const days = (now - item.recency) / 86_400_000;
    // Small tie-breaker only: it must never outweigh the kind weights above.
    score += Math.max(0, 2 - Math.log2(1 + Math.max(0, days)) / 3);
  }
  return score;
}

/**
 * @param {SearchItem[]} items
 * @param {string} query
 * @param {{ limit?: number, now?: number }} [options]
 * @returns {(SearchItem & { score: number })[]}
 */
export function searchEverything(items, query, { limit = 50, now = Date.now() } = {}) {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return items
    .map((item) => ({ ...item, score: scoreItem(item, terms, now) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || (b.recency ?? 0) - (a.recency ?? 0))
    .slice(0, limit);
}

/**
 * Turn stored data into search items.
 * @param {{
 *   openTabs?: { id?: number, windowId: number, title?: string, url?: string, lastAccessed?: number }[],
 *   collections?: { id: string, name: string, updatedAt: number }[],
 *   vaultTabs?: { id: string, collectionId: string, title: string, url: string, note?: string, tags?: string[], createdAt: number }[],
 *   watchLater?: { id: string, title: string, url: string, watched: number, addedAt: number }[],
 *   sessions?: { id: string, name: string, createdAt: number, windows: { tabs: unknown[] }[] }[],
 *   snoozed?: { id: string, title: string, url: string, wakeAt: number }[],
 *   actions?: { id: string, title: string, keywords?: string }[],
 *   ownOrigin?: string,
 * }} sources
 * @returns {SearchItem[]}
 */
export function buildSearchItems(sources) {
  const names = new Map((sources.collections ?? []).map((c) => [c.id, c.name]));
  /** @type {SearchItem[]} */
  const items = [];
  for (const a of sources.actions ?? []) {
    items.push({ kind: 'action', id: a.id, title: a.title, extra: a.keywords ?? '' });
  }
  for (const t of sources.openTabs ?? []) {
    if (!t.url || (sources.ownOrigin && t.url.startsWith(sources.ownOrigin))) continue;
    items.push({ kind: 'tab', id: String(t.id), title: t.title || t.url, url: t.url, sub: 'Open tab', recency: t.lastAccessed, data: t });
  }
  for (const c of sources.collections ?? []) {
    items.push({ kind: 'collection', id: c.id, title: c.name, sub: 'TabVault collection', recency: c.updatedAt, data: c });
  }
  for (const t of sources.vaultTabs ?? []) {
    const tags = (t.tags ?? []).map((x) => `#${x}`).join(' ');
    items.push({
      kind: 'vault',
      id: t.id,
      title: t.title,
      url: t.url,
      sub: `TabVault · ${names.get(t.collectionId) ?? ''}`,
      extra: `${tags} ${t.note ?? ''}`,
      recency: t.createdAt,
      data: t,
    });
  }
  for (const w of sources.watchLater ?? []) {
    items.push({ kind: 'watch', id: w.id, title: w.title, url: w.url, sub: w.watched ? 'Watch Later · watched' : 'Watch Later', recency: w.addedAt, data: w });
  }
  for (const s of sources.sessions ?? []) {
    const n = s.windows.reduce((sum, win) => sum + win.tabs.length, 0);
    items.push({ kind: 'session', id: s.id, title: s.name, sub: `Session · ${n} tabs`, recency: s.createdAt, data: s });
  }
  for (const z of sources.snoozed ?? []) {
    items.push({ kind: 'snoozed', id: z.id, title: z.title, url: z.url, sub: 'Snoozed', data: z });
  }
  return items;
}
