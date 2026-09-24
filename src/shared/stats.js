/**
 * Local usage counters shown on Home → Insights. Stored only in
 * chrome.storage.local; never sent anywhere.
 */

export const STATS_KEY = 'stats'; // keep in sync with src/content/media-boost.js

/** @typedef {{ mediaSecondsSaved: number, tabsSuspended: number, tabsAutoClosed: number, duplicatesClosed: number, tabsSnoozed: number, since: number }} Stats */

/** @returns {Promise<Stats>} */
export async function getStats() {
  const got = await chrome.storage.local.get(STATS_KEY);
  const s = got[STATS_KEY] ?? {};
  return {
    mediaSecondsSaved: Number(s.mediaSecondsSaved) || 0,
    tabsSuspended: Number(s.tabsSuspended) || 0,
    tabsAutoClosed: Number(s.tabsAutoClosed) || 0,
    duplicatesClosed: Number(s.duplicatesClosed) || 0,
    tabsSnoozed: Number(s.tabsSnoozed) || 0,
    since: Number(s.since) || Date.now(),
  };
}

/**
 * Add to a counter. Best-effort: concurrent writers may occasionally lose an
 * increment, which is acceptable for informational stats.
 * @param {keyof Omit<Stats, 'since'>} key
 * @param {number} [amount]
 */
export async function bumpStat(key, amount = 1) {
  if (!amount) return;
  const got = await chrome.storage.local.get(STATS_KEY);
  const s = got[STATS_KEY] ?? { since: Date.now() };
  s[key] = (Number(s[key]) || 0) + amount;
  if (!s.since) s.since = Date.now();
  await chrome.storage.local.set({ [STATS_KEY]: s });
}
