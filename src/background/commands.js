/**
 * Keyboard commands (manifest "commands"). Pressing a command grants
 * activeTab for the current tab, which is what lets Media Boost inject.
 */
import { controlMedia, friendlyInjectionError } from '../features/media/media-control.js';
import { getSite, saveSite } from '../features/media/media-sites.js';
import { addToWatchLater } from '../features/watch-later/watch-later.js';
import { getSettings } from '../shared/settings.js';
import { flashBadge } from './badge.js';
import { saveActiveTabToLastCollection } from './menus.js';

/**
 * @param {string} command
 * @param {chrome.tabs.Tab | undefined} tab
 */
export async function handleCommand(command, tab) {
  const tabId = tab?.id;
  if (tabId === undefined) return;
  const settings = await getSettings();
  try {
    switch (command) {
      case 'save-to-watch-later': {
        if (!tab?.url) throw new Error('No URL');
        const { duplicate } = await addToWatchLater(
          { url: tab.url, title: tab.title, source: 'shortcut' },
          { cleanUrls: settings.privacy.cleanUrlsOnSave },
        );
        await flashBadge(tabId, duplicate ? '↻' : '✓');
        return;
      }
      case 'save-tab-to-vault':
        await saveActiveTabToLastCollection();
        await flashBadge(tabId, '✓');
        return;
      default:
        await handleMediaCommand(command, tab, settings);
    }
  } catch (err) {
    console.warn('[BrowseKit] command failed', command, friendlyInjectionError(err));
    await flashBadge(tabId, '✕', true);
  }
}

const MEDIA_COMMANDS = {
  'media-speed-up': (s) => ({ op: 'stepSpeed', delta: s.media.speedStep }),
  'media-speed-down': (s) => ({ op: 'stepSpeed', delta: -s.media.speedStep }),
  'media-speed-reset': () => ({ op: 'setSpeed', value: 1 }),
  'media-toggle-mute': () => ({ op: 'toggleMute' }),
  'media-seek-forward': (s) => ({ op: 'seek', delta: s.media.seekStep }),
  'media-seek-back': (s) => ({ op: 'seek', delta: -s.media.seekStep }),
  'media-toggle-play': () => ({ op: 'togglePlay' }),
};

/**
 * @param {string} command
 * @param {chrome.tabs.Tab} tab
 * @param {Awaited<ReturnType<typeof getSettings>>} settings
 */
async function handleMediaCommand(command, tab, settings) {
  const build = MEDIA_COMMANDS[command];
  if (!build) return;
  const tabId = /** @type {number} */ (tab.id);
  const status = await controlMedia(tabId, build(settings));
  if (!status) {
    await flashBadge(tabId, '–', true);
    return;
  }
  if (status.error) throw new Error(status.error);
  // Keep a remembered site's speed in sync.
  if (command.startsWith('media-speed') && status.host && (await getSite(status.host))) {
    await saveSite(status.host, { speed: status.speed ?? null });
  }
  const badge = command.startsWith('media-speed') ? String(status.speed).slice(0, 4) : '✓';
  await flashBadge(tabId, badge);
}
