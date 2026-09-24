/**
 * Per-site Media Boost preferences (chrome.storage.local, readable by the
 * content script) and optional per-site host access for automatic apply.
 */

export const MEDIA_SITES_KEY = 'media.sites'; // keep in sync with src/content/media-boost.js
export const MEDIA_SCRIPT = 'src/content/media-boost.js';
export const MEDIA_SCRIPT_ID = 'browsekit-media';

/** @typedef {{ speed: number | null, volume: number | null, updatedAt: number }} SitePrefs */

/** @returns {Promise<Record<string, SitePrefs>>} */
export async function getSites() {
  const got = await chrome.storage.local.get(MEDIA_SITES_KEY);
  return got[MEDIA_SITES_KEY] ?? {};
}

/** @param {string} host */
export async function getSite(host) {
  return (await getSites())[host] ?? null;
}

/**
 * @param {string} host
 * @param {{ speed?: number | null, volume?: number | null }} prefs
 */
export async function saveSite(host, prefs) {
  const sites = await getSites();
  sites[host] = {
    speed: prefs.speed ?? sites[host]?.speed ?? null,
    volume: prefs.volume ?? sites[host]?.volume ?? null,
    updatedAt: Date.now(),
  };
  await chrome.storage.local.set({ [MEDIA_SITES_KEY]: sites });
  return sites[host];
}

/** @param {string} host */
export async function removeSite(host) {
  const sites = await getSites();
  delete sites[host];
  await chrome.storage.local.set({ [MEDIA_SITES_KEY]: sites });
}

/**
 * Host-permission match pattern for a page URL (scheme://host/*).
 * Only http(s) pages can get automatic access.
 * @param {string} url
 * @returns {string | null}
 */
export function originPattern(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? `${u.protocol}//${u.hostname}/*` : null;
  } catch {
    return null;
  }
}

/**
 * https match pattern for a hostname (scheme://host/*). Built from parts so the
 * source stays free of literal remote URLs (see scripts/validate.mjs).
 * @param {string} host
 */
export function httpsPatternForHost(host) {
  return ['https:', '', host, '*'].join('/');
}

/** @param {string} pattern */
export function hasAutoAccess(pattern) {
  return chrome.permissions.contains({ origins: [pattern] });
}

/**
 * Must be called from a user gesture (click) in an extension page.
 * @param {string} pattern
 */
export function requestAutoAccess(pattern) {
  return chrome.permissions.request({ origins: [pattern] });
}

/** @param {string} pattern */
export function revokeAutoAccess(pattern) {
  return chrome.permissions.remove({ origins: [pattern] });
}

/** Granted per-site origins (excludes anything that is not a single-host pattern). */
export async function grantedOrigins() {
  const { origins = [] } = await chrome.permissions.getAll();
  return origins.filter((o) => /^https?:\/\/[^*/]+\/\*$/.test(o));
}

/**
 * Keep the registered content script's `matches` equal to the granted
 * origins. Called by the service worker on install and permission changes.
 */
export async function syncRegisteredMediaScript() {
  const origins = await grantedOrigins();
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [MEDIA_SCRIPT_ID] });
  if (!origins.length) {
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [MEDIA_SCRIPT_ID] });
    return [];
  }
  const script = {
    id: MEDIA_SCRIPT_ID,
    js: [MEDIA_SCRIPT],
    matches: origins,
    allFrames: true,
    runAt: /** @type {const} */ ('document_idle'),
    persistAcrossSessions: true,
  };
  if (existing.length) await chrome.scripting.updateContentScripts([script]);
  else await chrome.scripting.registerContentScripts([script]);
  return origins;
}
