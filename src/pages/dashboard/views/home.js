/**
 * Home: overview, get-started checklist, insights and quick actions.
 */
import { ROUTES } from '../../../shared/constants.js';
import { onDatabaseChange } from '../../../shared/db/database.js';
import { h, mount, toast } from '../../../shared/dom.js';
import { formatBytes, formatDateTime, formatDuration, formatNumber } from '../../../shared/format.js';
import { getSettings, onSettingsChanged, updateSettings } from '../../../shared/settings.js';
import { STATS_KEY, getStats } from '../../../shared/stats.js';
import { openTabs } from '../../../shared/tabs.js';
import { debounce, errorMessage, favicon } from '../../../shared/ui.js';
import { hostOf } from '../../../shared/urls.js';
import { backupStatus } from '../../../features/backup/backup-status.js';
import { ONBOARDING_KEY, getOnboardingFlags, isPinned, onboardingSteps } from '../../../features/onboarding/onboarding.js';
import { loadVault } from '../../../features/vault/vault.js';
import { saveTabsToVault } from '../../../features/vault/save.js';
import { listWatchLater, setWatched } from '../../../features/watch-later/watch-later.js';
import { listSessions, saveCurrentSession, sessionTabCount } from '../../../features/sessions/sessions.js';
import { listSnoozed } from '../../../features/snooze/snooze.js';
import { closeAllDuplicates, suspendAllBackgroundTabs } from '../../../features/tab-manager/tab-actions.js';
import { findDuplicateGroups } from '../../../features/tab-manager/tab-model.js';

/** @param {number} n @param {string} word */
const plural = (n, word) => `${formatNumber(n)} ${word}${n === 1 ? '' : 's'}`;

function greeting() {
  const hour = new Date().getHours();
  return hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

/**
 * @param {HTMLElement} root
 * @param {{ params: URLSearchParams }} ctx
 */
export async function render(root, { params }) {
  const fail = (err) => toast(errorMessage(err), 'error');
  const banner = h('div');
  const checklist = h('div');
  const statsGrid = h('div', { class: 'grid grid--stats', 'aria-label': 'At a glance' });
  const insights = h('div', { class: 'insights' });
  const upNext = h('div');
  const recent = h('div');
  const tabHealth = h('div');
  const storageLine = h('p', { class: 'muted small' });

  async function refresh() {
    const [vault, queue, sessions, openTabsList, snoozed, stats, backup, flags, pinned, settings] = await Promise.all([
      loadVault(),
      listWatchLater(),
      listSessions(),
      chrome.tabs.query({ windowType: 'normal' }),
      listSnoozed(),
      getStats(),
      backupStatus(),
      getOnboardingFlags(),
      isPinned(),
      getSettings(),
    ]);
    const unwatched = queue.filter((i) => !i.watched);
    const dupes = findDuplicateGroups(openTabsList).reduce((n, g) => n + g.extras.length, 0);
    const manualSessions = sessions.filter((s) => s.kind !== 'autosave');

    // Backup reminder
    mount(
      banner,
      backup.due &&
        h(
          'div',
          { class: 'banner banner--warn' },
          h('span', null, backup.lastBackupAt ? `Last backup ${formatDateTime(backup.lastBackupAt)}. Your data lives only in this browser — export a fresh backup.` : 'Your data lives only in this browser. Export a backup so you never lose it.'),
          h('a', { class: 'btn btn--sm btn--primary', href: `#/${ROUTES.SETTINGS}?backup=1` }, 'Back up now'),
        ),
    );

    // Get-started checklist
    const steps = onboardingSteps({
      pinned,
      vaultTabs: vault.tabs.length,
      watchLater: queue.length,
      usedSearch: !!flags.usedSearch,
      viewedShortcuts: !!flags.viewedShortcuts,
      backedUp: !!backup.lastBackupAt,
    });
    const done = steps.filter((s) => s.done).length;
    const showChecklist = !settings.ui.onboardingDismissed && done < steps.length;
    const fill = h('span', { class: 'progress__fill' });
    fill.style.width = `${Math.round((done / steps.length) * 100)}%`; // CSSOM: allowed by CSP
    mount(
      checklist,
      showChecklist &&
        h(
          'section',
          { class: 'card onboarding' },
          h(
            'div',
            { class: 'card__head' },
            h('h2', { class: 'card__title' }, 'Get started'),
            h('button', { class: 'link-btn', type: 'button', onClick: () => updateSettings({ ui: { onboardingDismissed: true } }).catch(fail) }, 'Hide'),
          ),
          h('div', { class: 'progress progress--lg', role: 'progressbar', 'aria-valuenow': done, 'aria-valuemin': 0, 'aria-valuemax': steps.length, 'aria-label': `${done} of ${steps.length} done` }, fill),
          h(
            'ol',
            { class: 'checklist' },
            steps.map((s) =>
              h(
                'li',
                { class: `checklist__item${s.done ? ' is-done' : ''}` },
                h('span', { class: 'checklist__mark', 'aria-hidden': 'true' }, s.done ? '✓' : ''),
                h('span', null, h('span', { class: 'checklist__title' }, s.title), h('span', { class: 'muted small' }, s.hint)),
              ),
            ),
          ),
        ),
    );

    mount(
      statsGrid,
      stat(vault.tabs.length, 'Saved tabs', `in ${plural(vault.collections.length, 'collection')}`, ROUTES.VAULT),
      stat(unwatched.length, 'To watch', `${formatNumber(queue.length - unwatched.length)} watched`, ROUTES.WATCH_LATER),
      stat(openTabsList.length, 'Open tabs', dupes ? plural(dupes, 'duplicate') : 'no duplicates', `${ROUTES.SESSIONS}?tab=open`),
      stat(snoozed.length, 'Snoozed', snoozed[0] ? `next ${formatDateTime(snoozed[0].wakeAt)}` : 'nothing snoozed', `${ROUTES.SESSIONS}?tab=snoozed`),
      stat(manualSessions.length, 'Sessions', `${plural(sessions.length - manualSessions.length, 'autosave')}`, `${ROUTES.SESSIONS}?tab=saved`),
    );

    mount(
      insights,
      insight(formatDuration(stats.mediaSecondsSaved), 'saved by watching faster', '⏱'),
      insight(formatNumber(stats.tabsSuspended), 'tabs suspended to free memory', '💤'),
      insight(formatNumber(stats.duplicatesClosed), 'duplicate tabs closed', '🧹'),
      insight(formatNumber(stats.tabsAutoClosed), 'idle tabs auto-closed (kept in TabVault)', '📥'),
      insight(formatNumber(stats.tabsSnoozed), 'tabs snoozed', '⏰'),
      h('p', { class: 'muted small insights__note' }, `Counted on this device since ${formatDateTime(stats.since)}. Never sent anywhere.`),
    );

    mount(
      upNext,
      unwatched.length
        ? h(
            'ul',
            { class: 'rows rows--compact' },
            unwatched.slice(0, 5).map((item) =>
              h(
                'li',
                { class: 'row' },
                favicon(item.url),
                h(
                  'a',
                  {
                    class: 'row__main',
                    href: item.url,
                    onClick: (e) => {
                      e.preventDefault();
                      openTabs([item]).then(() => setWatched([item.id], true), fail);
                    },
                  },
                  h('span', { class: 'row__title' }, item.title),
                  h('span', { class: 'row__sub' }, hostOf(item.url)),
                ),
              ),
            ),
          )
        : h('p', { class: 'muted small' }, 'Nothing queued. Right-click a page → “Save page to Watch Later”.'),
    );

    const recentCollections = [...vault.collections].sort((a, b) => Number(!!b.starred) - Number(!!a.starred) || b.updatedAt - a.updatedAt).slice(0, 5);
    mount(
      recent,
      recentCollections.length
        ? h(
            'ul',
            { class: 'rows rows--compact' },
            recentCollections.map((c) => {
              const tabs = vault.tabsByCollection.get(c.id) ?? [];
              return h(
                'li',
                { class: 'row' },
                h('span', { class: `dot dot--${c.color}`, 'aria-hidden': 'true' }),
                h(
                  'a',
                  { class: 'row__main', href: `#/${ROUTES.VAULT}?c=${encodeURIComponent(c.id)}` },
                  h('span', { class: 'row__title' }, c.starred ? `★ ${c.name}` : c.name),
                  h('span', { class: 'row__sub' }, plural(tabs.length, 'tab')),
                ),
                h('button', { class: 'btn btn--sm', type: 'button', disabled: !tabs.length, onClick: () => openTabs(tabs).catch(fail) }, 'Open'),
              );
            }),
          )
        : h('p', { class: 'muted small' }, 'No collections yet. Save a window from the popup or above.'),
    );

    const discarded = openTabsList.filter((t) => t.discarded).length;
    mount(
      tabHealth,
      h('p', null, `${plural(openTabsList.length, 'tab')} across ${plural(new Set(openTabsList.map((t) => t.windowId)).size, 'window')}${discarded ? ` · ${formatNumber(discarded)} sleeping` : ''}.`),
      h(
        'div',
        { class: 'btn-row' },
        h('button', { class: 'btn btn--sm', type: 'button', disabled: !dupes, onClick: () => closeAllDuplicates().then((n) => toast(`Closed ${plural(n, 'duplicate')}.`), fail) }, dupes ? `Close ${plural(dupes, 'duplicate')}` : 'No duplicates'),
        h('button', { class: 'btn btn--sm', type: 'button', onClick: () => suspendAllBackgroundTabs().then((n) => toast(`Suspended ${plural(n, 'tab')}.`), fail) }, 'Free memory'),
        h('a', { class: 'btn btn--sm', href: `#/${ROUTES.SESSIONS}?tab=open` }, 'Manage tabs'),
      ),
    );

    if (navigator.storage?.estimate) {
      const { usage = 0 } = await navigator.storage.estimate();
      storageLine.textContent = `BrowseKit uses ${formatBytes(usage)} of local browser storage.`;
    }
  }

  async function quick(action) {
    try {
      if (action === 'save-all') {
        const r = await saveTabsToVault({ scope: 'all' });
        toast(`Saved ${r.added} tabs to “${r.collectionName}”.`);
      } else if (action === 'session') {
        const s = await saveCurrentSession(`Session · ${formatDateTime(Date.now())}`);
        toast(`Session saved (${sessionTabCount(s)} tabs).`);
      }
    } catch (err) {
      fail(err);
    }
  }

  await refresh();

  mount(
    root,
    h(
      'header',
      { class: 'page-header' },
      h('div', null, h('h1', null, greeting()), h('p', { class: 'muted' }, 'Your private browser toolkit. Everything stays on this device.')),
      h(
        'div',
        { class: 'btn-row' },
        h('button', { class: 'btn', type: 'button', onClick: () => quick('session') }, 'Save session'),
        h('button', { class: 'btn btn--primary', type: 'button', onClick: () => quick('save-all') }, 'Save all windows to TabVault'),
      ),
    ),
    h(
      'div',
      { class: 'stack' },
      params.get('welcome') &&
        h(
          'section',
          { class: 'card welcome' },
          h('h2', { class: 'card__title' }, 'Welcome to BrowseKit 👋'),
          h('p', null, 'A private toolkit for tabs, reading and media. No account, no servers — everything is stored in this browser.'),
          h(
            'ul',
            { class: 'plain-list' },
            h('li', null, h('kbd', { class: 'kbd' }, 'Alt+Shift+B'), ' open the popup: save tabs, media controls, tools'),
            h('li', null, h('kbd', { class: 'kbd' }, 'Ctrl+K'), ' on the dashboard (or the popup’s search box) searches everything'),
            h('li', null, h('kbd', { class: 'kbd' }, 'Alt+Shift+W'), ' saves the current page to Watch Later'),
            h('li', null, h('kbd', { class: 'kbd' }, '?'), ' shows every shortcut'),
          ),
        ),
      banner,
      checklist,
      statsGrid,
      h('section', { class: 'card' }, h('h2', { class: 'card__title' }, 'Insights'), insights),
      h(
        'div',
        { class: 'two-col' },
        h('section', { class: 'card' }, h('div', { class: 'card__head' }, h('h2', { class: 'card__title' }, 'Up next'), h('a', { href: `#/${ROUTES.WATCH_LATER}`, class: 'small' }, 'All →')), upNext),
        h('section', { class: 'card' }, h('div', { class: 'card__head' }, h('h2', { class: 'card__title' }, 'Collections'), h('a', { href: `#/${ROUTES.VAULT}`, class: 'small' }, 'All →')), recent),
      ),
      h(
        'div',
        { class: 'two-col' },
        h('section', { class: 'card' }, h('h2', { class: 'card__title' }, 'Open tabs'), tabHealth),
        h(
          'section',
          { class: 'card' },
          h('h2', { class: 'card__title' }, 'Privacy'),
          h(
            'ul',
            { class: 'privacy-list privacy-list--compact' },
            h('li', null, 'No account, servers or AI'),
            h('li', null, 'No analytics or telemetry'),
            h('li', null, 'No remote code'),
            h('li', null, 'Data stays on this device'),
          ),
          storageLine,
        ),
      ),
    ),
  );

  const debounced = debounce(() => refresh().catch(fail), 150);
  const unsubscribe = onDatabaseChange(debounced);
  const unsubscribeSettings = onSettingsChanged(debounced);
  const onStorage = (changes, area) => {
    if (area === 'local' && (changes[STATS_KEY] || changes[ONBOARDING_KEY])) debounced();
  };
  chrome.storage.onChanged.addListener(onStorage);
  const tabEvents = [chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onUpdated];
  tabEvents.forEach((ev) => ev.addListener(debounced));
  return () => {
    unsubscribe();
    unsubscribeSettings();
    chrome.storage.onChanged.removeListener(onStorage);
    tabEvents.forEach((ev) => ev.removeListener(debounced));
  };
}

/**
 * @param {number} value
 * @param {string} label
 * @param {string} sub
 * @param {string} route
 */
function stat(value, label, sub, route) {
  return h(
    'a',
    { class: 'card stat', href: `#/${route}` },
    h('span', { class: 'stat__value' }, formatNumber(value)),
    h('span', { class: 'stat__label' }, label),
    h('span', { class: 'muted small' }, sub),
  );
}

/** @param {string} value @param {string} label @param {string} icon */
function insight(value, label, icon) {
  return h(
    'div',
    { class: 'insight' },
    h('span', { class: 'insight__icon', 'aria-hidden': 'true' }, icon),
    h('span', { class: 'insight__value' }, value),
    h('span', { class: 'muted small' }, label),
  );
}
