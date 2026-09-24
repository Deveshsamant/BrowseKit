/**
 * Drive the Media Boost content script from extension contexts (popup,
 * service worker). Uses activeTab + scripting: nothing runs in a page until
 * the user clicks or presses a shortcut, unless the site has automatic access.
 */
import { MEDIA_SCRIPT } from './media-sites.js';

/** @typedef {{ frameId: number, count: number, isTop: boolean, host: string, kind?: string, playing?: boolean, speed?: number, volume?: number, muted?: boolean, currentTime?: number, duration?: number | null, live?: boolean, boost?: { ok: boolean, reason: string }, siteRemembered?: boolean, error?: string }} FrameStatus */

/**
 * Translate Chrome's injection errors into something a user can act on.
 * @param {unknown} err
 */
export function friendlyInjectionError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (/cannot be scripted|Cannot access|chrome:\/\/|extensions gallery|webstore|Missing host permission|cannot access contents/i.test(msg)) {
    return 'Chrome doesn’t let extensions control this page (browser pages, the Web Store and some built-in viewers are protected).';
  }
  if (/No tab with id|Frame with ID|was removed/i.test(msg)) return 'The tab changed. Please try again.';
  return msg;
}

/** @param {number} tabId */
export async function injectMediaScript(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: [MEDIA_SCRIPT] });
  } catch (err) {
    // Some frames (e.g. cross-origin iframes without access) may refuse; the top frame is what matters most.
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: [MEDIA_SCRIPT] });
    } catch {
      throw new Error(friendlyInjectionError(err));
    }
  }
}

/**
 * Run a command in frames of a tab.
 * @param {number} tabId
 * @param {object} command
 * @param {number[]} [frameIds] omit for all frames
 * @returns {Promise<FrameStatus[]>}
 */
export async function runMediaCommand(tabId, command, frameIds) {
  const results = await chrome.scripting.executeScript({
    target: frameIds ? { tabId, frameIds } : { tabId, allFrames: true },
    func: (cmd) => (globalThis.__browsekitMedia ? globalThis.__browsekitMedia.run(cmd) : null),
    args: [command],
  });
  return results.filter((r) => r.result).map((r) => ({ frameId: r.frameId, ...r.result }));
}

/**
 * Pick the frame to control: one with playing media, else the top frame if it
 * has media, else the first frame that has media.
 * @param {FrameStatus[]} frames
 * @returns {FrameStatus | null}
 */
export function pickFrame(frames) {
  const withMedia = frames.filter((f) => f.count > 0);
  return withMedia.find((f) => f.playing) ?? withMedia.find((f) => f.isTop) ?? withMedia[0] ?? null;
}

/**
 * Inject if needed, find the best frame, and run a command there.
 * @param {number} tabId
 * @param {object} command
 * @returns {Promise<FrameStatus | null>} null when the page has no media
 */
export async function controlMedia(tabId, command) {
  await injectMediaScript(tabId);
  const frame = pickFrame(await runMediaCommand(tabId, { op: 'status' }));
  if (!frame) return null;
  if (command.op === 'status') return frame;
  const [result] = await runMediaCommand(tabId, command, [frame.frameId]);
  return result ?? null;
}
