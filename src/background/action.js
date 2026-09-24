/**
 * Toolbar button behaviour: open the popup (default) or the side panel.
 */
import { getSettings } from '../shared/settings.js';

export const POPUP_PATH = 'src/pages/popup/popup.html';
export const PALETTE_PATH = 'src/pages/palette/palette.html';

/** @param {{ ui: { actionOpens: string } }} [settings] */
export async function applyActionBehavior(settings) {
  const s = settings ?? (await getSettings());
  const sidepanel = s.ui.actionOpens === 'sidepanel';
  await chrome.action.setPopup({ popup: sidepanel ? '' : POPUP_PATH });
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: sidepanel });
}

/** Open the search-everything palette in a small window. */
export async function openPaletteWindow() {
  const width = 640;
  const height = 520;
  let left;
  let top;
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    left = Math.round((win.left ?? 0) + ((win.width ?? width) - width) / 2);
    top = Math.round((win.top ?? 0) + 80);
  } catch {
    // no normal window: let Chrome place it
  }
  await chrome.windows.create({ url: chrome.runtime.getURL(PALETTE_PATH), type: 'popup', width, height, left, top, focused: true });
}
