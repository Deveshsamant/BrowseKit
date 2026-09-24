/**
 * Tab Manager & Sessions: search open tabs across windows, close duplicates,
 * recently closed tabs/windows, and saved sessions.
 */
import { onDatabaseChange } from '../../../shared/db/database.js';
import { h, mount, toast } from '../../../shared/dom.js';
import { formatDateTime, formatNumber } from '../../../shared/format.js';
import { focusTab, ownOrigin } from '../../../shared/tabs.js';
import { confirmDialog, debounce, emptyState, errorMessage, favicon, promptDialog, selectDialog } from '../../../shared/ui.js';
import { getSettings } from '../../../shared/settings.js';
import { bumpStat } from '../../../shared/stats.js';
import { cancelSnooze, listSnoozed, snoozeTab, wakeNow } from '../../../features/snooze/snooze.js';
import { SNOOZE_PRESETS, wakeTimeFor } from '../../../features/snooze/snooze-model.js';
import { mergeWindowsInto, sortWindowBySite, suspendAllBackgroundTabs } from '../../../features/tab-manager/tab-actions.js';
import { hostOf } from '../../../shared/urls.js';
import { findDuplicateGroups, searchOpenTabs } from '../../../features/tab-manager/tab-model.js';
import {
  deleteSession,
  listSessions,
  renameSession,
  restoreSession,
  saveCurrentSession,
  sessionTabCount,
  switchToSession,
} from '../../../features/sessions/sessions.js';

const PANELS = [
  { id: 'open', label: 'Open tabs' },
  { id: 'duplicates', label: 'Duplicates' },
  { id: 'closed', label: 'Recently closed' },
  { id: 'snoozed', label: 'Snoozed' },
  { id: 'saved', label: 'Sessions & workspaces' },
];

/**
 * @param {HTMLElement} root
 * @param {{ params: URLSearchParams }} ctx
 */
export async function render(root, { params }) {
  const state = { panel: PANELS.some((p) => p.id === params.get('tab')) ? params.get('tab') : 'open', query: '' };
  const fail = (err) => toast(errorMessage(err), 'error');
  const panelHost = h('div', { class: 'stack' });
  const counts = { open: 0, duplicates: 0 };
  const tabButtons = PANELS.map((p) =>
    h(
      'button',
      {
        class: 'tabs__tab',
        type: 'button',
        role: 'tab',
        id: `panel-tab-${p.id}`,
        'aria-selected': String(p.id === state.panel),
        onClick: () => switchPanel(p.id),
      },
      p.label,
      h('span', { class: 'tabs__count', dataset: { count: p.id } }),
    ),
  );

  mount(
    root,
    h(
      'header',
      { class: 'page-header' },
      h('div', null, h('h1', null, 'Sessions'), h('p', { class: 'muted' }, 'Everything open right now, plus sessions you saved.')),
      h('button', { class: 'btn btn--primary', type: 'button', onClick: saveSession }, 'Save current session'),
    ),
    h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Sessions sections' }, tabButtons),
    h('div', { role: 'tabpanel' }, panelHost),
  );

  function switchPanel(id) {
    state.panel = id;
    history.replaceState(null, '', `#/sessions?tab=${id}`);
    tabButtons.forEach((b, i) => b.setAttribute('aria-selected', String(PANELS[i].id === id)));
    renderPanel();
  }

  function setCount(id, n) {
    const el = root.querySelector(`[data-count="${id}"]`);
    if (el) el.textContent = n ? String(n) : '';
  }

  async function allTabs() {
    const origin = ownOrigin();
    const tabs = await chrome.tabs.query({ windowType: 'normal' });
    return { tabs, origin };
  }

  async function renderPanel() {
    try {
      const { tabs } = await allTabs();
      const groups = findDuplicateGroups(tabs);
      counts.open = tabs.length;
      counts.duplicates = groups.reduce((n, g) => n + g.extras.length, 0);
      setCount('open', counts.open);
      setCount('duplicates', counts.duplicates);
      if (state.panel === 'open') renderOpen(tabs);
      else if (state.panel === 'duplicates') renderDuplicates(groups);
      else if (state.panel === 'closed') await renderClosed();
      else if (state.panel === 'snoozed') await renderSnoozed();
      else await renderSaved();
      setCount('snoozed', (await listSnoozed()).length);
    } catch (err) {
      fail(err);
    }
  }

  // --- Open tabs -----------------------------------------------------------------
  const search = h('input', {
    class: 'input search',
    type: 'search',
    placeholder: 'Search open tabs…  ( / )',
    'aria-label': 'Search open tabs',
    onInput: debounce(() => {
      state.query = search.value.trim();
      renderPanel();
    }, 100),
  });

  const openCount = h('span', { class: 'muted small' });
  const tidyAction = (fn, done) => async () => {
    try {
      toast(done(await fn()));
    } catch (err) {
      fail(err);
    }
  };
  const openToolbar = h(
    'div',
    { class: 'toolbar' },
    search,
    h(
      'div',
      { class: 'btn-row' },
      openCount,
      h('button', { class: 'btn btn--sm', type: 'button', title: 'Group this window’s tabs by site (pinned tabs stay first)', onClick: tidyAction(async () => sortWindowBySite((await chrome.windows.getCurrent()).id), (n) => `Sorted ${n} tabs by site.`) }, 'Sort by site'),
      h('button', { class: 'btn btn--sm', type: 'button', title: 'Move every tab into this window', onClick: tidyAction(async () => mergeWindowsInto((await chrome.windows.getCurrent()).id), (n) => `Moved ${n} tabs into this window.`) }, 'Merge windows'),
      h('button', { class: 'btn btn--sm', type: 'button', title: 'Unload background tabs; they reload when you open them', onClick: tidyAction(suspendAllBackgroundTabs, (n) => `Suspended ${n} background tabs.`) }, 'Free memory'),
    ),
  );
  const openList = h('div', { class: 'stack' });

  /** @param {chrome.tabs.Tab[]} tabs */
  function renderOpen(tabs) {
    const matches = searchOpenTabs(tabs, state.query);
    const windowIds = [...new Set(tabs.map((t) => t.windowId))];
    const list = windowIds
      .map((wid, i) => {
        const inWindow = matches.filter((t) => t.windowId === wid).sort((a, b) => a.index - b.index);
        if (!inWindow.length) return null;
        return h(
          'section',
          { class: 'list-card' },
          h(
            'div',
            { class: 'list-toolbar' },
            h('strong', null, `Window ${i + 1}`),
            h('span', { class: 'muted small' }, `${inWindow.length} tab${inWindow.length === 1 ? '' : 's'}`),
          ),
          h('ul', { class: 'rows' }, inWindow.map((t) => openTabRow(t))),
        );
      })
      .filter(Boolean);
    // Keep the toolbar mounted so the search box never loses focus while typing.
    if (openToolbar.parentNode !== panelHost) mount(panelHost, openToolbar, openList);
    openCount.textContent = `${formatNumber(tabs.length)} tabs in ${windowIds.length} window${windowIds.length === 1 ? '' : 's'}`;
    mount(openList, list.length ? list : emptyState('No open tabs match', 'Search checks titles and URLs in every window.'));
  }

  const own = ownOrigin();

  /** @param {chrome.tabs.Tab} t */
  function openTabRow(t) {
    const url = t.url || t.pendingUrl || '';
    const where = url.startsWith(own) ? 'BrowseKit' : hostOf(url);
    return h(
      'li',
      { class: `row${t.active ? ' is-current' : ''}` },
      favicon(url),
      h(
        'button',
        { class: 'row__main row__main--button', type: 'button', title: url, onClick: () => focusTab(/** @type {number} */ (t.id), t.windowId).catch(fail) },
        h('span', { class: 'row__title' }, t.title || url),
        h('span', { class: 'row__sub' }, where),
      ),
      h(
        'span',
        { class: 'row__badges' },
        t.active && h('span', { class: 'badge' }, 'Active'),
        t.pinned && h('span', { class: 'badge badge--muted' }, 'Pinned'),
        t.audible && h('span', { class: 'badge badge--muted' }, 'Playing'),
        t.mutedInfo?.muted && h('span', { class: 'badge badge--muted' }, 'Muted'),
        t.discarded && h('span', { class: 'badge badge--muted' }, 'Sleeping'),
      ),
      h(
        'span',
        { class: 'row__actions' },
        h('button', { class: 'icon-btn', type: 'button', title: 'Snooze', 'aria-label': `Snooze ${t.title}`, onClick: () => snoozeDialog(t) }, '⏰'),
        h('button', { class: 'icon-btn icon-btn--danger', type: 'button', title: 'Close tab', 'aria-label': `Close ${t.title}`, onClick: () => chrome.tabs.remove(/** @type {number} */ (t.id)).catch(fail) }, '✕'),
      ),
    );
  }

  // --- Duplicates ----------------------------------------------------------------
  /** @param {ReturnType<typeof findDuplicateGroups>} groups */
  function renderDuplicates(groups) {
    const total = groups.reduce((n, g) => n + g.extras.length, 0);
    if (!groups.length) {
      mount(panelHost, emptyState('No duplicate tabs', 'Tabs showing the same page (ignoring #anchors) appear here.'));
      return;
    }
    mount(
      panelHost,
      h(
        'div',
        { class: 'toolbar' },
        h('span', null, `${total} duplicate tab${total === 1 ? '' : 's'} across ${groups.length} page${groups.length === 1 ? '' : 's'}.`),
        h('button', { class: 'btn btn--primary', type: 'button', onClick: () => closeExtras(groups.flatMap((g) => g.extras)) }, `Close ${total} duplicate${total === 1 ? '' : 's'}`),
      ),
      h('p', { class: 'muted small' }, 'BrowseKit keeps the active tab (or a pinned one, else the left-most) and never closes pinned tabs.'),
      groups.map((g) =>
        h(
          'section',
          { class: 'list-card' },
          h(
            'div',
            { class: 'list-toolbar' },
            favicon(g.keep.url ?? ''),
            h('strong', { class: 'truncate' }, g.keep.title || g.key),
            h('button', { class: 'btn btn--sm', type: 'button', onClick: () => closeExtras(g.extras) }, `Close ${g.extras.length}`),
          ),
          h(
            'ul',
            { class: 'rows' },
            [g.keep, ...g.extras].map((t, i) =>
              h(
                'li',
                { class: 'row' },
                h('span', { class: `badge ${i === 0 ? '' : 'badge--muted'}` }, i === 0 ? 'Keep' : 'Close'),
                h(
                  'button',
                  { class: 'row__main row__main--button', type: 'button', onClick: () => focusTab(/** @type {number} */ (t.id), t.windowId).catch(fail) },
                  h('span', { class: 'row__title' }, t.url),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  async function closeExtras(extras) {
    try {
      await chrome.tabs.remove(extras.map((t) => /** @type {number} */ (t.id)));
      await bumpStat('duplicatesClosed', extras.length);
      toast(`Closed ${extras.length} duplicate tab${extras.length === 1 ? '' : 's'}.`);
    } catch (err) {
      fail(err);
    }
  }

  // --- Recently closed -----------------------------------------------------------
  async function renderClosed() {
    const entries = await chrome.sessions.getRecentlyClosed({ maxResults: chrome.sessions.MAX_SESSION_RESULTS });
    const origin = ownOrigin();
    const rows = entries
      .map((e) => {
        if (e.tab) {
          if (e.tab.url?.startsWith(origin)) return null;
          return h(
            'li',
            { class: 'row' },
            favicon(e.tab.url ?? ''),
            h('span', { class: 'row__main' }, h('span', { class: 'row__title' }, e.tab.title || e.tab.url), h('span', { class: 'row__sub' }, `${hostOf(e.tab.url ?? '')} · closed ${formatDateTime((e.lastModified ?? 0) * 1000)}`)),
            h('span', { class: 'row__actions row__actions--visible' }, h('button', { class: 'btn btn--sm', type: 'button', onClick: () => restoreClosed(e.tab?.sessionId) }, 'Restore')),
          );
        }
        if (e.window) {
          const n = e.window.tabs?.length ?? 0;
          return h(
            'li',
            { class: 'row' },
            h('span', { class: 'window-icon', 'aria-hidden': 'true' }, '▣'),
            h('span', { class: 'row__main' }, h('span', { class: 'row__title' }, `Window with ${n} tab${n === 1 ? '' : 's'}`), h('span', { class: 'row__sub' }, (e.window.tabs ?? []).slice(0, 3).map((t) => t.title).join(' · '))),
            h('span', { class: 'row__actions row__actions--visible' }, h('button', { class: 'btn btn--sm', type: 'button', onClick: () => restoreClosed(e.window?.sessionId) }, 'Restore window')),
          );
        }
        return null;
      })
      .filter(Boolean);
    mount(
      panelHost,
      h('p', { class: 'muted small' }, `Chrome keeps up to ${chrome.sessions.MAX_SESSION_RESULTS} recently closed tabs and windows. This list comes from Chrome, not BrowseKit.`),
      rows.length ? h('div', { class: 'list-card' }, h('ul', { class: 'rows' }, rows)) : emptyState('Nothing closed recently'),
    );
  }

  async function restoreClosed(sessionId) {
    if (!sessionId) return;
    try {
      await chrome.sessions.restore(sessionId);
    } catch (err) {
      fail(err);
    }
  }

  // --- Snoozed ---------------------------------------------------------------------
  async function snoozeDialog(tab) {
    const choice = await selectDialog({
      title: 'Snooze tab',
      label: 'Reopen it',
      options: SNOOZE_PRESETS.map((p) => ({ value: p.id, label: `${p.label} (${formatDateTime(wakeTimeFor(/** @type {any} */ (p.id)))})` })),
      value: 'tomorrow',
      confirmLabel: 'Snooze',
    });
    if (!choice) return;
    try {
      await snoozeTab(tab, wakeTimeFor(/** @type {any} */ (choice)));
      toast('Tab snoozed. It will reopen automatically.');
    } catch (err) {
      fail(err);
    }
  }

  async function renderSnoozed() {
    const items = await listSnoozed();
    mount(
      panelHost,
      h('p', { class: 'muted small' }, 'Snoozed tabs reopen in the background at their time. If the browser is closed then, they open shortly after it starts.'),
      items.length
        ? h(
            'div',
            { class: 'list-card' },
            h(
              'ul',
              { class: 'rows' },
              items.map((z) =>
                h(
                  'li',
                  { class: 'row' },
                  favicon(z.url),
                  h('span', { class: 'row__main' }, h('span', { class: 'row__title' }, z.title), h('span', { class: 'row__sub' }, `${hostOf(z.url)} · reopens ${formatDateTime(z.wakeAt)}`)),
                  h(
                    'span',
                    { class: 'row__actions row__actions--visible' },
                    h('button', { class: 'btn btn--sm', type: 'button', onClick: () => wakeNow(z.id).catch(fail) }, 'Open now'),
                    h('button', { class: 'icon-btn icon-btn--danger', type: 'button', title: 'Cancel snooze', 'aria-label': `Cancel snooze for ${z.title}`, onClick: () => cancelSnooze(z.id).catch(fail) }, '✕'),
                  ),
                ),
              ),
            ),
          )
        : emptyState('No snoozed tabs', 'Snooze a tab from the popup (Tabs → Snooze), the ⏰ button in Open tabs, or the “Snooze tab” shortcut.'),
    );
  }

  // --- Saved sessions ------------------------------------------------------------
  async function renderSaved() {
    const all = await listSessions();
    const sessions = all.filter((x) => x.kind !== 'autosave');
    const autosaves = all.filter((x) => x.kind === 'autosave');
    const { autosaveMinutes } = (await getSettings()).sessions;
    const autosaveSection = h(
      'section',
      { class: 'stack' },
      h('h2', { class: 'section-title' }, 'Autosaves'),
      h(
        'p',
        { class: 'muted small' },
        autosaveMinutes
          ? `Every ${autosaveMinutes} minutes (when something changed), BrowseKit snapshots your windows so you can recover after a crash or an accidental close. Change this in Settings.`
          : 'Autosave is off. Turn it on in Settings to recover windows after a crash.',
      ),
      autosaves.length ? autosaves.map(sessionCard) : h('p', { class: 'muted small' }, 'No autosaves yet.'),
    );
    if (!sessions.length) {
      mount(
        panelHost,
        emptyState(
          'No saved sessions',
          'A session is a snapshot of every open window. Save one before a restart or to switch between projects.',
          h('button', { class: 'btn btn--primary', type: 'button', onClick: saveSession }, 'Save current session'),
        ),
        autosaveSection,
      );
      return;
    }
    mount(
      panelHost,
      h('p', { class: 'muted small' }, 'Use sessions as workspaces: “Switch” opens a session and closes everything else — what was open is kept as an autosave, so nothing is lost.'),
      sessions.map(sessionCard),
      autosaveSection,
    );
  }

  /** @param {import('../../../features/sessions/sessions.js').Session} s */
  function sessionCard(s) {
    const n = sessionTabCount(s);
    return h(
      'section',
      { class: 'list-card' },
      h(
        'div',
        { class: 'list-toolbar' },
        h('div', { class: 'grow' }, h('strong', null, s.name), h('div', { class: 'muted small' }, `${formatDateTime(s.createdAt)} · ${s.windows.length} window${s.windows.length === 1 ? '' : 's'} · ${n} tab${n === 1 ? '' : 's'}`)),
        h('button', { class: 'btn btn--sm btn--primary', type: 'button', onClick: () => restore(s) }, 'Restore'),
        h('button', { class: 'btn btn--sm', type: 'button', title: 'Open this session and close everything else', onClick: () => switchTo(s) }, 'Switch'),
        h('button', { class: 'btn btn--sm', type: 'button', onClick: () => rename(s) }, 'Rename'),
        h('button', { class: 'btn btn--sm btn--danger', type: 'button', onClick: () => remove(s) }, 'Delete'),
      ),
      h(
        'details',
        { class: 'details' },
        h('summary', null, 'Show tabs'),
        s.windows.map((w, i) =>
          h(
            'div',
            null,
            h('p', { class: 'muted small pad' }, `Window ${i + 1}`),
            h('ul', { class: 'rows' }, w.tabs.map((t) => h('li', { class: 'row' }, favicon(t.url), h('span', { class: 'row__main' }, h('span', { class: 'row__title' }, t.title), h('span', { class: 'row__sub' }, hostOf(t.url))), t.pinned && h('span', { class: 'badge badge--muted' }, 'Pinned')))),
          ),
        ),
      ),
    );
  }

  async function switchTo(session) {
    const ok = await confirmDialog({
      title: `Switch to “${session.name}”?`,
      body: 'BrowseKit saves what is open now as an autosave, opens this session, then closes the previous windows (including this dashboard).',
      confirmLabel: 'Switch',
    });
    if (!ok) return;
    try {
      await switchToSession(session, (await getSettings()).sessions.autosaveKeep);
    } catch (err) {
      fail(err);
    }
  }

  async function saveSession() {
    const name = await promptDialog({
      title: 'Save current session',
      label: 'Name',
      value: `Session · ${formatDateTime(Date.now())}`,
    });
    if (!name) return;
    try {
      const s = await saveCurrentSession(name);
      toast(`Saved “${s.name}” (${sessionTabCount(s)} tabs).`);
      switchPanel('saved');
    } catch (err) {
      fail(err);
    }
  }

  async function restore(session) {
    const n = sessionTabCount(session);
    if (n > 20 && !(await confirmDialog({ title: `Restore ${n} tabs?`, body: `Opens ${session.windows.length} new window(s).`, confirmLabel: 'Restore' }))) return;
    const { opened, failed } = await restoreSession(session).catch((err) => (fail(err), { opened: 0, failed: [] }));
    if (failed.length) toast(`Restored ${opened} tabs; Chrome refused ${failed.length}.`, 'error');
    else if (opened) toast(`Restored ${opened} tabs.`);
  }

  async function rename(session) {
    const name = await promptDialog({ title: 'Rename session', label: 'Name', value: session.name });
    if (name) renameSession(session.id, name).catch(fail);
  }

  async function remove(session) {
    if (await confirmDialog({ title: `Delete “${session.name}”?`, confirmLabel: 'Delete', danger: true })) {
      deleteSession(session.id).catch(fail);
    }
  }

  // --- Live updates ----------------------------------------------------------------
  const refresh = debounce(() => renderPanel(), 150);
  const tabEvents = [chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onUpdated, chrome.tabs.onMoved, chrome.tabs.onAttached, chrome.tabs.onActivated];
  tabEvents.forEach((ev) => ev.addListener(refresh));
  chrome.sessions.onChanged.addListener(refresh);
  const unsubscribe = onDatabaseChange((d) => {
    if ((d.stores.includes('sessions') && state.panel === 'saved') || d.stores.includes('snoozed')) refresh();
  });
  const onKey = (/** @type {KeyboardEvent} */ e) => {
    if (e.key === '/' && state.panel === 'open' && !/** @type {HTMLElement} */ (e.target).closest('input, textarea, select, [contenteditable]')) {
      e.preventDefault();
      search.focus();
    }
  };
  document.addEventListener('keydown', onKey);

  await renderPanel();
  return () => {
    tabEvents.forEach((ev) => ev.removeListener(refresh));
    chrome.sessions.onChanged.removeListener(refresh);
    unsubscribe();
    document.removeEventListener('keydown', onKey);
  };
}
