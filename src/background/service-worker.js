/**
 * BrowseKit service worker (MV3, ES module).
 *
 * Every listener is registered synchronously at top level so it is in place
 * when Chrome restarts the worker to deliver an event. No state that must
 * survive is kept in module variables — the worker is stopped when idle.
 */
import { syncRegisteredMediaScript } from '../features/media/media-sites.js';
import { createRouter } from '../shared/messages.js';
import { handleCommand } from './commands.js';
import { handlers } from './handlers.js';
import { handleInstalled } from './lifecycle.js';
import { handleMenuClick } from './menus.js';

const logError = (/** @type {string} */ what) => (/** @type {unknown} */ err) => console.error(`[BrowseKit] ${what}`, err);

chrome.runtime.onInstalled.addListener((details) => {
  handleInstalled(details).catch(logError('install/update failed'));
});

chrome.runtime.onMessage.addListener(createRouter(handlers, { extensionId: chrome.runtime.id }));

chrome.contextMenus.onClicked.addListener((info, tab) => {
  handleMenuClick(info, tab).catch(logError('context menu'));
});

chrome.commands.onCommand.addListener((command, tab) => {
  handleCommand(command, tab).catch(logError('command'));
});

// Per-site automatic Media Boost follows the host permissions the user grants/revokes.
chrome.permissions.onAdded.addListener(() => {
  syncRegisteredMediaScript().catch(logError('media script sync'));
});
chrome.permissions.onRemoved.addListener(() => {
  syncRegisteredMediaScript().catch(logError('media script sync'));
});
