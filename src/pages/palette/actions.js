/**
 * Actions offered by search-everything. Each runs on the tab the user was
 * looking at (the active tab of the last-focused normal window).
 */
import { ROUTES, dashboardUrl } from '../../shared/constants.js';
import { getSettings, updateSettings } from '../../shared/settings.js';
import { activeTab, currentWindowId } from '../../shared/tabs.js';
import { addToWatchLater } from '../../features/watch-later/watch-later.js';
import { saveTabsToVault } from '../../features/vault/save.js';
import { saveCurrentSession } from '../../features/sessions/sessions.js';
import { snoozeTab } from '../../features/snooze/snooze.js';
import { wakeTimeFor } from '../../features/snooze/snooze-model.js';
import {
  closeAllDuplicates,
  mergeWindowsInto,
  sortWindowBySite,
  suspendAllBackgroundTabs,
} from '../../features/tab-manager/tab-actions.js';
import { openReaderForTab } from '../../features/tools/reader.js';

/** @typedef {{ id: string, title: string, keywords?: string, run: () => Promise<string | void> }} PaletteAction */

async function requireTab() {
  const tab = await activeTab();
  if (!tab?.id) throw new Error('No current tab.');
  return tab;
}

/** Open (or focus) a dashboard route. */
async function openRoute(route) {
  await chrome.tabs.create({ url: dashboardUrl(route) });
}

/** @returns {PaletteAction[]} */
export function paletteActions() {
  return [
    {
      id: 'save-watch-later',
      title: 'Save current tab to Watch Later',
      keywords: 'watch later queue read save',
      run: async () => {
        const tab = await requireTab();
        const { cleanUrlsOnSave } = (await getSettings()).privacy;
        const { duplicate } = await addToWatchLater({ url: tab.url ?? '', title: tab.title, source: 'palette' }, { cleanUrls: cleanUrlsOnSave });
        return duplicate ? 'Already in Watch Later — moved to top.' : 'Saved to Watch Later.';
      },
    },
    {
      id: 'save-tab-vault',
      title: 'Save current tab to TabVault',
      keywords: 'tabvault collection save tab',
      run: async () => {
        const { vault } = await getSettings();
        const r = await saveTabsToVault({ scope: 'tab', collectionId: vault.lastCollectionId }).catch(() =>
          saveTabsToVault({ scope: 'tab', collectionId: null }),
        );
        return `Saved to “${r.collectionName}”.`;
      },
    },
    {
      id: 'save-window-vault',
      title: 'Save this window to TabVault',
      keywords: 'tabvault collection save window onetab',
      run: async () => `Saved ${(await saveTabsToVault({ scope: 'window' })).added} tabs.`,
    },
    {
      id: 'save-all-vault',
      title: 'Save all windows to TabVault',
      keywords: 'tabvault collection save all windows',
      run: async () => `Saved ${(await saveTabsToVault({ scope: 'all' })).added} tabs.`,
    },
    {
      id: 'snooze',
      title: 'Snooze current tab until tomorrow 9 AM',
      keywords: 'snooze later remind tomorrow',
      run: async () => {
        await snoozeTab(await requireTab(), wakeTimeFor('tomorrow'));
        return 'Snoozed until tomorrow.';
      },
    },
    {
      id: 'duplicates',
      title: 'Close duplicate tabs',
      keywords: 'duplicates dedupe clean close',
      run: async () => `Closed ${await closeAllDuplicates()} duplicate tabs.`,
    },
    {
      id: 'sort',
      title: 'Sort tabs in this window by site',
      keywords: 'tidy sort organize arrange domain',
      run: async () => {
        await sortWindowBySite(await currentWindowId());
        return 'Tabs sorted by site.';
      },
    },
    {
      id: 'merge',
      title: 'Merge all windows into this one',
      keywords: 'merge combine windows tidy',
      run: async () => `Moved ${await mergeWindowsInto(await currentWindowId())} tabs.`,
    },
    {
      id: 'free-memory',
      title: 'Free memory: suspend background tabs',
      keywords: 'suspend discard memory ram sleep performance',
      run: async () => `Suspended ${await suspendAllBackgroundTabs()} tabs.`,
    },
    {
      id: 'save-session',
      title: 'Save current session',
      keywords: 'session snapshot backup windows',
      run: async () => {
        const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
        await saveCurrentSession(`Session · ${when}`);
        return 'Session saved.';
      },
    },
    {
      id: 'reader',
      title: 'Open current page in Reader view',
      keywords: 'reader read clean article distraction',
      run: async () => {
        await openReaderForTab(await requireTab());
      },
    },
    {
      id: 'theme',
      title: 'Toggle dark / light theme',
      keywords: 'theme dark light mode appearance',
      run: async () => {
        const s = await getSettings();
        const dark = s.theme === 'dark' || (s.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
        await updateSettings({ theme: dark ? 'light' : 'dark' });
        return `Theme: ${dark ? 'light' : 'dark'}.`;
      },
    },
    ...[
      [ROUTES.HOME, 'Open dashboard'],
      [ROUTES.VAULT, 'Open TabVault'],
      [ROUTES.WATCH_LATER, 'Open Watch Later'],
      [ROUTES.SESSIONS, 'Open Sessions'],
      [ROUTES.MEDIA, 'Open Media Boost settings'],
      [ROUTES.TOOLS, 'Open Tools'],
      [ROUTES.SETTINGS, 'Open Settings'],
    ].map(([route, title]) => ({
      id: `go-${route}`,
      title,
      keywords: `go navigate dashboard ${route}`,
      run: () => openRoute(route),
    })),
  ];
}
