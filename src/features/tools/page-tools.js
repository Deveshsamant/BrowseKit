/**
 * Quick tools that act on a tab. Page text is read with activeTab +
 * scripting only after the user clicks.
 */

/** Maximum page text returned, to keep counting fast on huge pages. */
export const MAX_PAGE_TEXT = 5_000_000;

/**
 * Read the user's selection, or the page's visible text if nothing is selected.
 * @param {number} tabId
 * @returns {Promise<{ text: string, source: 'selection' | 'page', truncated: boolean }>}
 */
export async function readPageText(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (max) => {
      const selection = String(globalThis.getSelection?.() ?? '').trim();
      const text = selection || document.body?.innerText || '';
      return { text: text.slice(0, max), source: selection ? 'selection' : 'page', truncated: text.length > max };
    },
    args: [MAX_PAGE_TEXT],
  });
  return result?.result ?? { text: '', source: 'page', truncated: false };
}

/**
 * Open the page's print dialog (the user can choose "Save as PDF").
 * @param {number} tabId
 */
export async function printTab(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      setTimeout(() => window.print(), 0);
    },
  });
}

/**
 * Capture the visible part of the active tab in a window as PNG.
 * @param {number} windowId
 * @returns {Promise<Blob>}
 */
export async function captureVisible(windowId) {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  const [, base64] = dataUrl.split(',');
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: 'image/png' });
}
