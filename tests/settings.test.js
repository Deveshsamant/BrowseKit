import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  deepMerge,
  getSettings,
  normalizeSettings,
  updateSettings,
} from '../src/shared/settings.js';

/** In-memory stand-in for chrome.storage.local. */
function fakeArea(initial = {}) {
  const data = structuredClone(initial);
  return {
    data,
    async get(key) {
      return key in data ? { [key]: structuredClone(data[key]) } : {};
    },
    async set(items) {
      Object.assign(data, structuredClone(items));
    },
  };
}

test('normalizeSettings fills defaults for missing or invalid input', () => {
  assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings('nope'), DEFAULT_SETTINGS);
  assert.equal(normalizeSettings({ theme: 'neon' }).theme, 'system');
  assert.equal(normalizeSettings({ theme: 'dark' }).theme, 'dark');
});

test('normalizeSettings keeps unknown keys for forward compatibility', () => {
  assert.equal(normalizeSettings({ future: { a: 1 } }).future.a, 1);
});

test('deepMerge merges nested objects, replaces arrays, ignores prototype keys', () => {
  const merged = deepMerge({ a: { x: 1, y: 2 }, list: [1, 2] }, { a: { y: 3 }, list: [9] });
  assert.deepEqual(merged, { a: { x: 1, y: 3 }, list: [9] });
  const polluted = deepMerge({}, JSON.parse('{"__proto__": {"hacked": true}}'));
  assert.equal(polluted.hacked, undefined);
  assert.equal({}.hacked, undefined);
});

test('getSettings / updateSettings round-trip through a storage area', async () => {
  const area = fakeArea();
  assert.equal((await getSettings(area)).theme, 'system');
  const next = await updateSettings({ theme: 'dark' }, area);
  assert.equal(next.theme, 'dark');
  assert.equal(area.data[SETTINGS_KEY].theme, 'dark');
  assert.equal((await getSettings(area)).theme, 'dark');
});

test('updateSettings rejects invalid theme values by falling back to default', async () => {
  const area = fakeArea({ [SETTINGS_KEY]: { theme: 'light' } });
  assert.equal((await updateSettings({ theme: 42 }, area)).theme, 'system');
});
