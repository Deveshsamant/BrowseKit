/**
 * Theme handling for extension pages. `system` follows prefers-color-scheme via
 * CSS; `light`/`dark` set data-theme on <html>. The last theme is mirrored in
 * this page-origin's localStorage purely to avoid a flash before storage loads.
 */
import { getSettings, onSettingsChanged } from './settings.js';

const CACHE_KEY = 'browsekit.theme';

/** @param {string} theme */
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  try {
    localStorage.setItem(CACHE_KEY, theme);
  } catch {
    // localStorage can be unavailable; the flash-avoidance cache is optional.
  }
}

/** Apply the cached theme immediately, then the stored one, then follow changes. */
export async function initTheme() {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) applyTheme(cached);
  } catch {
    // ignore
  }
  applyTheme((await getSettings()).theme);
  onSettingsChanged((settings) => applyTheme(settings.theme));
}
