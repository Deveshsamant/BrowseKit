/**
 * Lightweight user settings stored in chrome.storage.local under one key.
 * Stored values are deep-merged over DEFAULT_SETTINGS on every read, so new
 * settings only need a default here — no migration.
 *
 * Never use chrome.storage.sync: it uploads data to the user's Google account.
 */

export const SETTINGS_KEY = 'settings';

export const THEMES = Object.freeze(['system', 'light', 'dark']);

export const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: 1,
  theme: 'system',
});

/** @param {unknown} v */
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Deep-merge `patch` over `base`. Arrays and primitives replace; objects merge.
 * @param {Record<string, any>} base
 * @param {Record<string, any>} patch
 * @returns {Record<string, any>}
 */
export function deepMerge(base, patch) {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    out[key] = isPlainObject(value) && isPlainObject(base?.[key]) ? deepMerge(base[key], value) : value;
  }
  return out;
}

/**
 * Merge stored settings with defaults and coerce invalid values back to defaults.
 * @param {unknown} stored
 */
export function normalizeSettings(stored) {
  const merged = deepMerge(DEFAULT_SETTINGS, isPlainObject(stored) ? stored : {});
  if (!THEMES.includes(merged.theme)) merged.theme = DEFAULT_SETTINGS.theme;
  merged.schemaVersion = DEFAULT_SETTINGS.schemaVersion;
  return merged;
}

/**
 * @param {chrome.storage.StorageArea} [area]
 */
export async function getSettings(area = chrome.storage.local) {
  const { [SETTINGS_KEY]: stored } = await area.get(SETTINGS_KEY);
  return normalizeSettings(stored);
}

/**
 * Apply a partial update and persist the full normalized object.
 * @param {Record<string, any>} patch
 * @param {chrome.storage.StorageArea} [area]
 */
export async function updateSettings(patch, area = chrome.storage.local) {
  const next = normalizeSettings(deepMerge(await getSettings(area), patch));
  await area.set({ [SETTINGS_KEY]: next });
  return next;
}

/**
 * Persist normalized settings (fills in new defaults after an update).
 * @param {chrome.storage.StorageArea} [area]
 */
export async function ensureSettings(area = chrome.storage.local) {
  const settings = await getSettings(area);
  await area.set({ [SETTINGS_KEY]: settings });
  return settings;
}

/**
 * Subscribe to settings changes from any extension context.
 * @param {(settings: Record<string, any>) => void} callback
 * @returns {() => void} unsubscribe
 */
export function onSettingsChanged(callback) {
  /** @param {Record<string, chrome.storage.StorageChange>} changes @param {string} areaName */
  const listener = (changes, areaName) => {
    if (areaName === 'local' && changes[SETTINGS_KEY]) {
      callback(normalizeSettings(changes[SETTINGS_KEY].newValue));
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
