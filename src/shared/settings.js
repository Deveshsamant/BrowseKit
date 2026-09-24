/**
 * Lightweight user settings stored in chrome.storage.local under one key.
 * Stored values are deep-merged over DEFAULT_SETTINGS on every read, so new
 * settings only need a default here — no migration.
 *
 * Never use chrome.storage.sync: it uploads data to the user's Google account.
 */

export const SETTINGS_KEY = 'settings';

export const THEMES = Object.freeze(['system', 'light', 'dark']);
export const OPEN_TARGETS = Object.freeze(['current-window', 'new-window']);
export const ACCENTS = Object.freeze(['indigo', 'blue', 'teal', 'green', 'rose', 'amber']);
export const DENSITIES = Object.freeze(['comfortable', 'compact']);
export const ACTION_TARGETS = Object.freeze(['popup', 'sidepanel']);

export const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: 1,
  theme: 'system',
  vault: Object.freeze({
    /** Where "Open collection" puts the tabs. */
    openIn: 'current-window',
    /** Close tabs after saving them (OneTab-style). */
    closeAfterSave: false,
    /** Skip URLs already present in the target collection. */
    skipDuplicates: true,
    /** Collection preselected in the popup. */
    lastCollectionId: null,
  }),
  watchLater: Object.freeze({
    /** Mark items watched when opened from BrowseKit. */
    markWatchedOnOpen: true,
  }),
  media: Object.freeze({
    speedStep: 0.25,
    seekStep: 10,
    /** [ ] \ keys on sites with automatic access. */
    inPageShortcuts: true,
    /** Brief on-page indicator when speed/volume changes. */
    showOverlay: true,
    /** Resume videos where you left off (sites where Media Boost runs). */
    resumePlayback: true,
  }),
  tabs: Object.freeze({
    /** Discard (unload) background tabs idle this long; 0 = off. */
    autoSuspendMinutes: 0,
    /** Close background tabs idle this long into the "Auto-closed" collection; 0 = off. */
    autoCloseMinutes: 0,
    /** Hostnames never suspended or auto-closed. */
    neverTouchHosts: Object.freeze([]),
  }),
  sessions: Object.freeze({
    /** Snapshot all windows every N minutes when something changed; 0 = off. */
    autosaveMinutes: 30,
    /** Autosaves kept (oldest removed first). */
    autosaveKeep: 10,
  }),
  backup: Object.freeze({
    /** Remind to export a backup after N days; 0 = never. */
    remindDays: 30,
  }),
  ui: Object.freeze({
    accent: 'indigo',
    density: 'comfortable',
    /** What the toolbar button opens. */
    actionOpens: 'popup',
    onboardingDismissed: false,
  }),
  privacy: Object.freeze({
    /** Strip known tracking parameters from URLs saved to TabVault/Watch Later. */
    cleanUrlsOnSave: false,
  }),
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
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 */
function clampNumber(value, min, max, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** @param {unknown} value @param {boolean} fallback */
const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);

/**
 * Merge stored settings with defaults and coerce invalid values back to defaults.
 * @param {unknown} stored
 */
export function normalizeSettings(stored) {
  const d = DEFAULT_SETTINGS;
  // Merge onto a fresh copy: DEFAULT_SETTINGS is frozen and must never be mutated.
  const s = deepMerge(JSON.parse(JSON.stringify(d)), isPlainObject(stored) ? stored : {});
  for (const section of ['vault', 'watchLater', 'media', 'privacy', 'tabs', 'sessions', 'backup', 'ui']) {
    if (!isPlainObject(s[section])) s[section] = { ...d[section] };
  }
  if (!THEMES.includes(s.theme)) s.theme = d.theme;
  s.schemaVersion = d.schemaVersion;

  if (!OPEN_TARGETS.includes(s.vault.openIn)) s.vault.openIn = d.vault.openIn;
  s.vault.closeAfterSave = bool(s.vault.closeAfterSave, d.vault.closeAfterSave);
  s.vault.skipDuplicates = bool(s.vault.skipDuplicates, d.vault.skipDuplicates);
  if (typeof s.vault.lastCollectionId !== 'string') s.vault.lastCollectionId = null;

  s.watchLater.markWatchedOnOpen = bool(s.watchLater.markWatchedOnOpen, d.watchLater.markWatchedOnOpen);

  s.media.speedStep = clampNumber(s.media.speedStep, 0.05, 4, d.media.speedStep);
  s.media.seekStep = clampNumber(s.media.seekStep, 1, 600, d.media.seekStep);
  s.media.inPageShortcuts = bool(s.media.inPageShortcuts, d.media.inPageShortcuts);
  s.media.showOverlay = bool(s.media.showOverlay, d.media.showOverlay);

  s.privacy.cleanUrlsOnSave = bool(s.privacy.cleanUrlsOnSave, d.privacy.cleanUrlsOnSave);
  s.media.resumePlayback = bool(s.media.resumePlayback, d.media.resumePlayback);

  s.tabs.autoSuspendMinutes = Math.round(clampNumber(s.tabs.autoSuspendMinutes, 0, 1440, 0));
  s.tabs.autoCloseMinutes = Math.round(clampNumber(s.tabs.autoCloseMinutes, 0, 10080, 0));
  s.tabs.neverTouchHosts = Array.isArray(s.tabs.neverTouchHosts)
    ? [...new Set(s.tabs.neverTouchHosts.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().toLowerCase()))].slice(0, 200)
    : [];

  s.sessions.autosaveMinutes = Math.round(clampNumber(s.sessions.autosaveMinutes, 0, 1440, d.sessions.autosaveMinutes));
  s.sessions.autosaveKeep = Math.round(clampNumber(s.sessions.autosaveKeep, 1, 50, d.sessions.autosaveKeep));
  s.backup.remindDays = Math.round(clampNumber(s.backup.remindDays, 0, 365, d.backup.remindDays));

  if (!ACCENTS.includes(s.ui.accent)) s.ui.accent = d.ui.accent;
  if (!DENSITIES.includes(s.ui.density)) s.ui.density = d.ui.density;
  if (!ACTION_TARGETS.includes(s.ui.actionOpens)) s.ui.actionOpens = d.ui.actionOpens;
  s.ui.onboardingDismissed = bool(s.ui.onboardingDismissed, d.ui.onboardingDismissed);
  return s;
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
