import assert from 'node:assert/strict';
import { test } from 'node:test';
import { wakeTimeFor } from '../src/features/snooze/snooze-model.js';
import { buildSearchItems, searchEverything } from '../src/features/search/search-model.js';
import { pickIdleTabs, planSortBySite } from '../src/features/tab-manager/tab-model.js';
import { sessionFingerprint } from '../src/features/sessions/sessions.js';
import { backupReminderDue } from '../src/features/backup/backup-status.js';
import { onboardingSteps } from '../src/features/onboarding/onboarding.js';
import { progressFor } from '../src/features/media/positions.js';
import { formatDuration } from '../src/shared/format.js';
import { normalizeSettings } from '../src/shared/settings.js';

test('snooze presets land on the right local times', () => {
  const wed = new Date(2026, 8, 23, 14, 30); // Wed 23 Sep 2026, 14:30
  assert.equal(wakeTimeFor('later', wed), wed.getTime() + 3 * 3600_000);
  assert.deepEqual(new Date(wakeTimeFor('evening', wed)).getHours(), 19);
  assert.equal(new Date(wakeTimeFor('evening', new Date(2026, 8, 23, 20))).getDate(), 24, 'after 6 PM → tomorrow evening');
  const tomorrow = new Date(wakeTimeFor('tomorrow', wed));
  assert.deepEqual([tomorrow.getDate(), tomorrow.getHours()], [24, 9]);
  const weekend = new Date(wakeTimeFor('weekend', wed));
  assert.deepEqual([weekend.getDay(), weekend.getDate(), weekend.getHours()], [6, 26, 9]);
  assert.equal(new Date(wakeTimeFor('weekend', new Date(2026, 8, 26, 10))).getDate(), 3, 'on Saturday → next Saturday');
  const nextWeek = new Date(wakeTimeFor('next-week', wed));
  assert.deepEqual([nextWeek.getDay(), nextWeek.getDate()], [1, 28]);
  const nextMonth = new Date(wakeTimeFor('next-month', wed));
  assert.deepEqual([nextMonth.getMonth(), nextMonth.getDate(), nextMonth.getHours()], [9, 1, 9]);
  assert.throws(() => wakeTimeFor('never', wed));
});

test('search everything ranks title prefix > host > URL and requires every term', () => {
  const items = buildSearchItems({
    openTabs: [
      { id: 1, windowId: 1, title: 'GitHub – pull requests', url: 'https://github.com/pulls' },
      { id: 2, windowId: 1, title: 'Docs', url: 'https://docs.example.com/github-guide' },
      { id: 3, windowId: 1, title: 'Me', url: 'chrome-extension://me/x.html' },
    ],
    collections: [{ id: 'c', name: 'Research', updatedAt: 1 }],
    vaultTabs: [{ id: 'v', collectionId: 'c', title: 'Paper', url: 'https://arxiv.org/abs/1', tags: ['ml'], note: 'transformers', createdAt: 1 }],
    watchLater: [{ id: 'w', title: 'GitHub Universe talk', url: 'https://youtube.com/watch?v=1', watched: 0, addedAt: 1 }],
    sessions: [{ id: 's', name: 'Work', createdAt: 1, windows: [{ tabs: [{}, {}] }] }],
    snoozed: [],
    actions: [{ id: 'dup', title: 'Close duplicate tabs', keywords: 'dedupe clean' }],
    ownOrigin: 'chrome-extension://me',
  });
  assert.ok(!items.some((i) => i.kind === 'tab' && i.id === '3'), 'own pages excluded');
  const gh = searchEverything(items, 'github', { now: 2 });
  assert.equal(gh[0].id, '1');
  assert.deepEqual(gh.map((r) => r.id).sort(), ['1', '2', 'w'].sort());
  assert.equal(searchEverything(items, 'github talk')[0].id, 'w');
  assert.equal(searchEverything(items, '#ml')[0].id, 'v', 'tag search');
  assert.equal(searchEverything(items, 'transformers')[0].id, 'v', 'note search');
  assert.equal(searchEverything(items, 'dedupe')[0].kind, 'action');
  assert.equal(searchEverything(items, 'research')[0].kind, 'collection');
  assert.deepEqual(searchEverything(items, '   '), []);
  assert.deepEqual(searchEverything(items, 'zzzz'), []);
});

test('pickIdleTabs skips active, pinned, audible, protected hosts, non-web and recent tabs', () => {
  const now = 10_000_000;
  const old = now - 60 * 60_000;
  const base = { windowId: 1, index: 0, lastAccessed: old };
  const tabs = [
    { ...base, id: 1, url: 'https://a.com/' },
    { ...base, id: 2, url: 'https://b.com/', active: true },
    { ...base, id: 3, url: 'https://c.com/', pinned: true },
    { ...base, id: 4, url: 'https://d.com/', audible: true },
    { ...base, id: 5, url: 'https://mail.work.com/' },
    { ...base, id: 6, url: 'chrome://settings/' },
    { ...base, id: 7, url: 'https://e.com/', lastAccessed: now - 60_000 },
    { ...base, id: 8, url: 'https://f.com/', discarded: true },
    { ...base, id: 9, url: 'https://g.com/', autoDiscardable: false },
  ];
  const pick = (o) => pickIdleTabs(tabs, { now, minutes: 30, neverTouchHosts: ['work.com'], ...o }).map((t) => t.id);
  assert.deepEqual(pick({}), [1, 8, 9]);
  assert.deepEqual(pick({ forSuspend: true }), [1]);
  assert.deepEqual(pickIdleTabs(tabs, { now, minutes: 0 }), []);
});

test('planSortBySite keeps pinned first and groups by host (www-insensitive, stable)', () => {
  const t = (id, index, url, pinned = false) => ({ id, index, windowId: 1, url, pinned });
  const order = planSortBySite([t(1, 0, 'https://z.com/'), t(2, 1, 'https://www.a.com/1'), t(3, 2, 'https://p.com/', true), t(4, 3, 'https://a.com/2'), t(5, 4, 'https://m.com/')]);
  assert.deepEqual(order, [3, 2, 4, 5, 1]);
});

test('sessionFingerprint changes with URL, order and pinned state only', () => {
  const w = (tabs) => [{ tabs: tabs.map(([url, pinned]) => ({ url, title: 'x', pinned: !!pinned })) }];
  assert.equal(sessionFingerprint(w([['a'], ['b']])), sessionFingerprint(w([['a'], ['b']])));
  assert.notEqual(sessionFingerprint(w([['a'], ['b']])), sessionFingerprint(w([['b'], ['a']])));
  assert.notEqual(sessionFingerprint(w([['a', true]])), sessionFingerprint(w([['a']])));
});

test('backup reminder is due only with data, after N days, and never when off', () => {
  const day = 86_400_000;
  const base = { now: 100 * day, installedAt: 0, lastBackupAt: null, remindDays: 30, hasData: true };
  assert.equal(backupReminderDue(base), true);
  assert.equal(backupReminderDue({ ...base, lastBackupAt: 90 * day }), false);
  assert.equal(backupReminderDue({ ...base, lastBackupAt: 60 * day }), true);
  assert.equal(backupReminderDue({ ...base, hasData: false }), false);
  assert.equal(backupReminderDue({ ...base, remindDays: 0 }), false);
});

test('onboarding steps complete from real data', () => {
  const steps = onboardingSteps({ pinned: true, vaultTabs: 2, watchLater: 0, usedSearch: false, viewedShortcuts: true, backedUp: false });
  assert.deepEqual(steps.filter((s) => s.done).map((s) => s.id), ['pin', 'vault', 'shortcuts']);
});

test('progressFor matches URLs ignoring #fragment', () => {
  const positions = { 'https://v.com/watch?v=1': { t: 150, d: 600, at: 1 } };
  assert.equal(progressFor(positions, 'https://v.com/watch?v=1#t=5').progress, 0.25);
  assert.equal(progressFor(positions, 'https://v.com/watch?v=2'), null);
});

test('formatDuration', () => {
  assert.equal(formatDuration(42), '42 s');
  assert.equal(formatDuration(600), '10 min');
  assert.equal(formatDuration(3 * 3600 + 5 * 60), '3 h 5 min');
  assert.equal(formatDuration(7200), '2 h');
});

test('new settings sections validate and clamp', () => {
  const s = normalizeSettings({
    tabs: { autoSuspendMinutes: -5, autoCloseMinutes: 99999, neverTouchHosts: 'x' },
    sessions: { autosaveMinutes: 7.6, autosaveKeep: 0 },
    backup: { remindDays: 'soon' },
    ui: { accent: 'neon', density: 'compact', actionOpens: 'sidepanel', onboardingDismissed: 1 },
    media: { resumePlayback: false },
  });
  assert.deepEqual(s.tabs, { autoSuspendMinutes: 0, autoCloseMinutes: 10080, neverTouchHosts: [] });
  assert.deepEqual(s.sessions, { autosaveMinutes: 8, autosaveKeep: 1 });
  assert.equal(s.backup.remindDays, 30);
  assert.deepEqual(s.ui, { accent: 'indigo', density: 'compact', actionOpens: 'sidepanel', onboardingDismissed: false });
  assert.equal(s.media.resumePlayback, false);
});
