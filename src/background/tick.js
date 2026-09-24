/**
 * One periodic alarm drives all scheduled work. Every step is idempotent and
 * reads its state from storage, so missed ticks (browser closed, worker
 * stopped) are simply caught up on the next one.
 */
import { autoCloseIdleTabs } from '../features/tab-manager/auto-close.js';
import { suspendIdleTabs } from '../features/tab-manager/tab-actions.js';
import { autosaveSession } from '../features/sessions/sessions.js';
import { openSnoozed, takeDue } from '../features/snooze/snooze.js';
import { getMeta, setMeta } from '../shared/db/repository.js';
import { getSettings } from '../shared/settings.js';

export const TICK_ALARM = 'bk-tick';

/** Create the tick alarm if it is missing (alarms can be cleared on update). */
export async function ensureTickAlarm() {
  const existing = await chrome.alarms.get(TICK_ALARM);
  if (!existing) await chrome.alarms.create(TICK_ALARM, { periodInMinutes: 1, delayInMinutes: 1 });
}

/** @param {chrome.alarms.Alarm} alarm */
export async function handleAlarm(alarm) {
  if (alarm.name !== TICK_ALARM) return;
  const settings = await getSettings();
  const steps = [
    async () => {
      const due = await takeDue();
      if (due.length) await openSnoozed(due);
    },
    async () => {
      if (settings.tabs.autoCloseMinutes) {
        await autoCloseIdleTabs({ minutes: settings.tabs.autoCloseMinutes, neverTouchHosts: settings.tabs.neverTouchHosts });
      }
    },
    async () => {
      if (settings.tabs.autoSuspendMinutes) {
        await suspendIdleTabs({ minutes: settings.tabs.autoSuspendMinutes, neverTouchHosts: settings.tabs.neverTouchHosts });
      }
    },
    async () => {
      const every = settings.sessions.autosaveMinutes;
      if (!every) return;
      const last = Number(await getMeta('lastAutosaveCheck')) || 0;
      if (Date.now() - last < every * 60_000) return;
      await setMeta('lastAutosaveCheck', Date.now());
      await autosaveSession(settings.sessions.autosaveKeep);
    },
  ];
  // Each step is isolated so one failure doesn't block the others.
  for (const step of steps) {
    try {
      await step();
    } catch (err) {
      console.warn('[BrowseKit] tick step failed', err);
    }
  }
}
