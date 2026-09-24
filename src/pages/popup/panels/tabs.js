/**
 * Popup "Tabs" panel: snooze the current tab, tidy windows, free memory,
 * sessions, and tabs currently playing audio.
 */
import { ROUTES } from '../../../shared/constants.js';
import { h, mount, toast } from '../../../shared/dom.js';
import { formatDateTime } from '../../../shared/format.js';
import { currentWindowId, focusTab } from '../../../shared/tabs.js';
import { favicon } from '../../../shared/ui.js';
import { hostOf, isSaveableUrl } from '../../../shared/urls.js';
import { findDuplicateGroups } from '../../../features/tab-manager/tab-model.js';
import {
  closeAllDuplicates,
  mergeWindowsInto,
  sortWindowBySite,
  suspendAllBackgroundTabs,
} from '../../../features/tab-manager/tab-actions.js';
import { saveCurrentSession, sessionTabCount } from '../../../features/sessions/sessions.js';
import { listSnoozed, snoozeTab } from '../../../features/snooze/snooze.js';
import { SNOOZE_PRESETS, wakeTimeFor } from '../../../features/snooze/snooze-model.js';

/**
 * @param {HTMLElement} root
 * @param {import('../popup.js').PopupContext} ctx
 */
export async function renderTabsPanel(root, ctx) {
  const { fail, tab } = ctx;
  const [tabs, snoozed] = await Promise.all([chrome.tabs.query({ windowType: 'normal' }), listSnoozed()]);
  const extras = findDuplicateGroups(tabs).flatMap((g) => g.extras);
  const windows = new Set(tabs.map((t) => t.windowId)).size;
  const audible = tabs.filter((t) => t.audible);
  const canSnooze = !!tab && isSaveableUrl(tab.url);

  /** @param {number} wakeAt */
  async function snooze(wakeAt) {
    if (!tab) return;
    try {
      await snoozeTab(tab, wakeAt);
      toast(`Snoozed until ${formatDateTime(wakeAt)}.`);
      setTimeout(() => ctx.close(), 900);
    } catch (err) {
      fail(err);
    }
  }

  const custom = h('input', { class: 'input', type: 'datetime-local', 'aria-label': 'Custom snooze time' });

  /** @param {() => Promise<number>} fn @param {(n: number) => string} msg */
  const act = (fn, msg) => async () => {
    try {
      toast(msg(await fn()));
      await renderTabsPanel(root, ctx);
    } catch (err) {
      fail(err);
    }
  };

  mount(
    root,
    h(
      'section',
      { class: 'popup-section' },
      h('div', { class: 'popup-section__head' }, h('h2', null, 'Snooze this tab'), snoozed.length ? h('button', { class: 'link-btn', type: 'button', onClick: () => ctx.openDashboard(ROUTES.SESSIONS, 'tab=snoozed') }, `${snoozed.length} snoozed →`) : null),
      canSnooze
        ? [
            h(
              'div',
              { class: 'snooze-grid' },
              SNOOZE_PRESETS.map((p) =>
                h(
                  'button',
                  { class: 'snooze-btn', type: 'button', onClick: () => snooze(wakeTimeFor(/** @type {any} */ (p.id))) },
                  h('span', { class: 'snooze-btn__label' }, p.label),
                  h('span', { class: 'snooze-btn__hint' }, p.hint),
                ),
              ),
            ),
            h(
              'form',
              {
                class: 'field-row',
                onSubmit: (e) => {
                  e.preventDefault();
                  const t = new Date(custom.value).getTime();
                  if (!Number.isFinite(t)) return toast('Pick a date and time.', 'error');
                  snooze(t);
                },
              },
              custom,
              h('button', { class: 'btn btn--sm', type: 'submit' }, 'Snooze'),
            ),
          ]
        : h('p', { class: 'muted small' }, 'Browser and extension pages can’t be snoozed.'),
    ),
    h(
      'section',
      { class: 'popup-section' },
      h('div', { class: 'popup-section__head' }, h('h2', null, 'Tidy up'), h('span', { class: 'muted small' }, `${tabs.length} tabs · ${windows} window${windows === 1 ? '' : 's'}`)),
      h(
        'div',
        { class: 'btn-grid btn-grid--2' },
        h('button', { class: 'btn', type: 'button', disabled: !extras.length, onClick: act(closeAllDuplicates, (n) => `Closed ${n} duplicate${n === 1 ? '' : 's'}.`) }, extras.length ? `Close ${extras.length} duplicate${extras.length === 1 ? '' : 's'}` : 'No duplicates'),
        h('button', { class: 'btn', type: 'button', onClick: act(async () => sortWindowBySite(await currentWindowId()), () => 'Sorted by site.') }, 'Sort by site'),
        h('button', { class: 'btn', type: 'button', disabled: windows < 2, onClick: act(async () => mergeWindowsInto(await currentWindowId()), (n) => `Moved ${n} tabs here.`) }, 'Merge windows'),
        h('button', { class: 'btn', type: 'button', title: 'Unload background tabs; they reload when opened', onClick: act(suspendAllBackgroundTabs, (n) => `Suspended ${n} tab${n === 1 ? '' : 's'}.`) }, 'Free memory'),
      ),
    ),
    h(
      'section',
      { class: 'popup-section' },
      h('h2', null, 'Sessions'),
      h(
        'div',
        { class: 'btn-grid btn-grid--2' },
        h(
          'button',
          {
            class: 'btn',
            type: 'button',
            onClick: async () => {
              try {
                const s = await saveCurrentSession(`Session · ${formatDateTime(Date.now())}`);
                toast(`Session saved (${sessionTabCount(s)} tabs).`);
              } catch (err) {
                fail(err);
              }
            },
          },
          'Save session',
        ),
        h('button', { class: 'btn', type: 'button', onClick: () => ctx.openDashboard(ROUTES.SESSIONS, 'tab=saved') }, 'Workspaces →'),
      ),
    ),
    audible.length > 0 &&
      h(
        'section',
        { class: 'popup-section' },
        h('h2', null, 'Playing audio'),
        h(
          'ul',
          { class: 'rows rows--compact' },
          audible.map((t) =>
            h(
              'li',
              { class: 'row' },
              favicon(t.url ?? ''),
              h(
                'button',
                { class: 'row__main row__main--button', type: 'button', onClick: () => focusTab(/** @type {number} */ (t.id), t.windowId).then(ctx.close, fail) },
                h('span', { class: 'row__title' }, t.title || t.url),
                h('span', { class: 'row__sub' }, hostOf(t.url ?? '')),
              ),
              h(
                'button',
                {
                  class: 'icon-btn',
                  type: 'button',
                  title: t.mutedInfo?.muted ? 'Unmute tab' : 'Mute tab',
                  'aria-label': `${t.mutedInfo?.muted ? 'Unmute' : 'Mute'} ${t.title}`,
                  onClick: () => chrome.tabs.update(/** @type {number} */ (t.id), { muted: !t.mutedInfo?.muted }).then(() => renderTabsPanel(root, ctx), fail),
                },
                t.mutedInfo?.muted ? '🔇' : '🔊',
              ),
            ),
          ),
        ),
      ),
  );
}
