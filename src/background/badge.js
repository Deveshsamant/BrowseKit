/**
 * Short-lived toolbar badge feedback for actions without a visible page
 * (context menu, keyboard shortcuts). No permission needed.
 */

/**
 * @param {number | undefined} tabId
 * @param {string} text up to ~4 characters
 * @param {boolean} [isError]
 */
export async function flashBadge(tabId, text, isError = false) {
  if (tabId === undefined) return;
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: isError ? '#c62828' : '#4f46e5' });
    await chrome.action.setBadgeTextColor?.({ tabId, color: '#ffffff' });
    await chrome.action.setBadgeText({ tabId, text });
    setTimeout(() => {
      chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    }, 1800);
  } catch {
    // The tab may have closed; feedback is best-effort.
  }
}
