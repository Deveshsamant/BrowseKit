/**
 * Saved playback positions (written by the Media Boost content script on
 * sites where it runs). Used to show progress in Watch Later.
 */
import { duplicateKey } from '../../shared/urls.js';

export const POSITIONS_KEY = 'media.positions'; // keep in sync with src/content/media-boost.js

/** @typedef {{ t: number, d: number, at: number }} Position */

/** @returns {Promise<Record<string, Position>>} */
export async function getPositions() {
  return (await chrome.storage.local.get(POSITIONS_KEY))[POSITIONS_KEY] ?? {};
}

/**
 * Pure: progress (0–1) for a URL, matching by duplicate key.
 * @param {Record<string, Position>} positions
 * @param {string} url
 * @returns {Position & { progress: number } | null}
 */
export function progressFor(positions, url) {
  const key = duplicateKey(url);
  for (const [page, pos] of Object.entries(positions)) {
    if (duplicateKey(page) === key && pos.d > 0) return { ...pos, progress: Math.min(1, pos.t / pos.d) };
  }
  return null;
}

export function clearPositions() {
  return chrome.storage.local.remove(POSITIONS_KEY);
}
