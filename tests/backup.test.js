import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BACKUP_FORMAT, buildBackup, validateBackup } from '../src/shared/db/backup.js';
import { DB_VERSION, STORE_NAMES } from '../src/shared/db/schema.js';

const sample = () =>
  buildBackup({
    stores: {
      collections: [{ id: 'c1', name: 'Reading' }],
      vaultTabs: [{ id: 't1', collectionId: 'c1', url: 'about:blank', title: 'x' }],
      meta: [{ key: 'installedAt', value: 1 }],
    },
    settings: { theme: 'dark' },
    appVersion: '0.1.0',
    now: new Date('2026-01-01T00:00:00Z'),
  });

test('buildBackup includes every store and metadata', () => {
  const b = sample();
  assert.equal(b.format, BACKUP_FORMAT);
  assert.equal(b.schemaVersion, DB_VERSION);
  assert.equal(b.exportedAt, '2026-01-01T00:00:00.000Z');
  assert.deepEqual(Object.keys(b.stores).sort(), [...STORE_NAMES].sort());
  assert.deepEqual(b.stores.watchLater, []);
});

test('validateBackup accepts a built backup after a JSON round-trip', () => {
  const result = validateBackup(JSON.parse(JSON.stringify(sample())));
  assert.equal(result.ok, true);
});

test('validateBackup rejects non-backups', () => {
  for (const bad of [null, [], 'x', 1, {}, { format: 'other' }]) {
    assert.equal(validateBackup(bad).ok, false);
  }
});

test('validateBackup rejects newer schema versions', () => {
  const b = { ...sample(), schemaVersion: DB_VERSION + 1 };
  const r = validateBackup(b);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /newer BrowseKit/);
});

test('validateBackup rejects unknown stores, bad rows, missing and duplicate keys', () => {
  const b = sample();
  b.stores.evil = [];
  b.stores.collections.push('nope', { name: 'no id' }, { id: 'c1' });
  b.stores.meta.push({ key: '' });
  const r = validateBackup(b);
  assert.equal(r.ok, false);
  const text = r.errors.join('\n');
  assert.match(text, /Unknown store "evil"/);
  assert.match(text, /collections\[1\] is not an object/);
  assert.match(text, /collections\[2\] is missing a string "id"/);
  assert.match(text, /collections\[3\] duplicates id "c1"/);
  assert.match(text, /meta\[1\] is missing a string "key"/);
});

test('validateBackup rejects non-array store values and non-object settings', () => {
  const b = sample();
  b.stores.sessions = {};
  b.settings = 'dark';
  assert.equal(validateBackup(b).ok, false);
});
