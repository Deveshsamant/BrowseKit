/**
 * BrowseKit service worker (MV3, ES module).
 *
 * Every listener is registered synchronously at top level so it is in place
 * when Chrome restarts the worker to deliver an event. No state that must
 * survive is kept in module variables — the worker is stopped when idle.
 */
import { createRouter } from '../shared/messages.js';
import { handlers } from './handlers.js';
import { handleInstalled } from './lifecycle.js';

chrome.runtime.onInstalled.addListener((details) => {
  handleInstalled(details).catch((err) => console.error('[BrowseKit] install/update failed', err));
});

chrome.runtime.onMessage.addListener(createRouter(handlers, { extensionId: chrome.runtime.id }));
