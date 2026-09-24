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

/**
 * All http(s) links on the page (or in the selection), de-duplicated.
 * @param {number} tabId
 * @returns {Promise<{ url: string, title: string }[]>}
 */
export async function extractLinks(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const sel = globalThis.getSelection?.();
      let anchors = [...document.querySelectorAll('a[href]')];
      if (sel && !sel.isCollapsed && sel.rangeCount) {
        const range = sel.getRangeAt(0);
        const inSel = anchors.filter((a) => range.intersectsNode(a));
        if (inSel.length) anchors = inSel;
      }
      const seen = new Set();
      const out = [];
      for (const a of anchors) {
        const url = /** @type {HTMLAnchorElement} */ (a).href;
        if (!/^https?:/i.test(url)) continue;
        const key = url.split('#')[0];
        if (seen.has(key)) continue;
        seen.add(key);
        const title = (a.textContent || a.getAttribute('title') || a.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
        out.push({ url, title: title.slice(0, 300) || url });
        if (out.length >= 2000) break;
      }
      return out;
    },
  });
  return result?.result ?? [];
}
