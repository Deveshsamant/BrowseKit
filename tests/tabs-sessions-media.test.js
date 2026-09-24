import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findDuplicateGroups, searchOpenTabs } from '../src/features/tab-manager/tab-model.js';
import { sessionTabCount, windowsFromTabs } from '../src/features/sessions/sessions.js';
import { filterWatchLater } from '../src/features/watch-later/watch-later.js';
import { friendlyInjectionError, pickFrame } from '../src/features/media/media-control.js';
import { originPattern, httpsPatternForHost } from '../src/features/media/media-sites.js';

const t = (id, windowId, index, url, extra = {}) => ({ id, windowId, index, url, title: `T${id}`, ...extra });

test('findDuplicateGroups keeps active/pinned/left-most and never closes pinned tabs', () => {
  const tabs = [
    t(1, 1, 0, 'https://a.com/'),
    t(2, 1, 1, 'https://a.com/#x', { active: true }),
    t(3, 2, 0, 'https://a.com'),
    t(4, 1, 2, 'https://b.com/', { pinned: true }),
    t(5, 1, 3, 'https://b.com/'),
    t(6, 1, 4, 'chrome://newtab/'),
    t(7, 1, 5, 'chrome://newtab/'),
    t(8, 1, 6, 'https://c.com/', { pinned: true }),
    t(9, 1, 7, 'https://c.com/', { pinned: true }),
  ];
  const groups = findDuplicateGroups(tabs);
  const a = groups.find((g) => g.key === 'https://a.com/');
  assert.equal(a.keep.id, 2);
  assert.deepEqual(a.extras.map((x) => x.id), [1, 3]);
  const b = groups.find((g) => g.key === 'https://b.com/');
  assert.equal(b.keep.id, 4);
  assert.deepEqual(b.extras.map((x) => x.id), [5]);
  assert.equal(groups.length, 2, 'new-tab pages and all-pinned groups are ignored');
});

test('searchOpenTabs', () => {
  const tabs = [t(1, 1, 0, 'https://news.site/'), t(2, 1, 1, 'https://mail.site/')];
  assert.deepEqual(searchOpenTabs(tabs, 'MAIL').map((x) => x.id), [2]);
  assert.equal(searchOpenTabs(tabs, '').length, 2);
});

test('windowsFromTabs groups by window in tab order and drops unsaveable pages', () => {
  const windows = windowsFromTabs(
    [t(1, 2, 1, 'https://b.com/'), t(2, 1, 0, 'https://a.com/', { pinned: true }), t(3, 2, 0, 'https://c.com/'), t(4, 1, 1, 'chrome://newtab/'), t(5, 1, 2, 'chrome-extension://me/x.html')],
    'chrome-extension://me',
  );
  assert.deepEqual(windows.map((w) => w.tabs.map((x) => x.url)), [['https://a.com/'], ['https://c.com/', 'https://b.com/']]);
  assert.equal(windows[0].tabs[0].pinned, true);
  assert.equal(sessionTabCount({ windows }), 3);
});

test('filterWatchLater by state and query', () => {
  const items = [
    { id: '1', url: 'https://a.com', title: 'Talk about Rust', watched: 0, addedAt: 2 },
    { id: '2', url: 'https://b.com', title: 'Cooking', watched: 1, addedAt: 1 },
  ];
  assert.deepEqual(filterWatchLater(items, { filter: 'unwatched' }).map((i) => i.id), ['1']);
  assert.deepEqual(filterWatchLater(items, { filter: 'watched' }).map((i) => i.id), ['2']);
  assert.deepEqual(filterWatchLater(items, { filter: 'all', query: 'rust' }).map((i) => i.id), ['1']);
});

test('pickFrame prefers playing media, then the top frame', () => {
  const frames = [
    { frameId: 0, count: 1, isTop: true, host: 'a', playing: false },
    { frameId: 5, count: 1, isTop: false, host: 'b', playing: true },
    { frameId: 6, count: 0, isTop: false, host: 'c' },
  ];
  assert.equal(pickFrame(frames).frameId, 5);
  assert.equal(pickFrame(frames.map((f) => ({ ...f, playing: false }))).frameId, 0);
  assert.equal(pickFrame([{ frameId: 1, count: 0, isTop: true, host: 'x' }]), null);
});

test('media permission patterns and friendly errors', () => {
  assert.equal(originPattern('https://www.youtube.com/watch?v=1'), 'https://www.youtube.com/*');
  assert.equal(originPattern('chrome://settings'), null);
  assert.equal(httpsPatternForHost('a.com'), 'https://a.com/*');
  assert.match(friendlyInjectionError(new Error('Cannot access a chrome:// URL')), /doesn’t let extensions/);
  assert.match(friendlyInjectionError(new Error('The extensions gallery cannot be scripted.')), /doesn’t let extensions/);
});
