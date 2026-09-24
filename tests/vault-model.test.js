import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  exportUrlList,
  exportVaultJson,
  groupTabs,
  nextSortOrder,
  parseVaultImport,
  planAddTabs,
  searchTabs,
  sortByOrder,
} from '../src/features/vault/vault-model.js';

const tab = (id, collectionId, url, title, sortOrder) => ({ id, collectionId, url, title, sortOrder, createdAt: 0, updatedAt: 0 });

test('ordering helpers', () => {
  assert.deepEqual(sortByOrder([{ sortOrder: 2 }, { sortOrder: 0 }, { sortOrder: 1 }]).map((x) => x.sortOrder), [0, 1, 2]);
  assert.equal(nextSortOrder([]), 0);
  assert.equal(nextSortOrder([{ sortOrder: 4 }, { sortOrder: 1 }]), 5);
});

test('planAddTabs skips duplicates (incl. within the batch) and invalid URLs', () => {
  const existing = [tab('1', 'c', 'https://a.com/x', 'A', 0)];
  const plan = planAddTabs(
    existing,
    [
      { url: 'https://a.com/x#frag', title: 'dup' },
      { url: 'https://b.com/', title: 'B' },
      { url: 'https://b.com', title: 'B again' },
      { url: 'javascript:alert(1)' },
      { url: 'about:blank' },
      { url: 'https://c.com/' },
    ],
    { skipDuplicates: true },
  );
  assert.deepEqual(plan.toAdd.map((t) => t.url), ['https://b.com/', 'https://c.com/']);
  assert.equal(plan.toAdd[1].title, 'https://c.com/', 'title falls back to URL');
  assert.equal(plan.duplicates, 2);
  assert.equal(plan.invalid, 2);
  assert.equal(planAddTabs(existing, [{ url: 'https://a.com/x' }], { skipDuplicates: false }).toAdd.length, 1);
});

test('searchTabs is case-insensitive AND over title and URL', () => {
  const tabs = [tab('1', 'c', 'https://github.com/x', 'My Repo', 0), tab('2', 'c', 'https://docs.dev', 'GitHub docs', 1)];
  assert.deepEqual(searchTabs(tabs, 'github').map((t) => t.id), ['1', '2']);
  assert.deepEqual(searchTabs(tabs, 'github repo').map((t) => t.id), ['1']);
  assert.deepEqual(searchTabs(tabs, '   '), []);
});

test('export → import round-trip (JSON)', () => {
  const collections = [{ id: 'c', name: 'Research', color: 'teal', sortOrder: 0, createdAt: 1, updatedAt: 1 }];
  const grouped = groupTabs([tab('2', 'c', 'https://b.com/', 'B', 1), tab('1', 'c', 'https://a.com/', 'A', 0)]);
  const json = JSON.stringify(exportVaultJson(collections, grouped));
  const parsed = parseVaultImport(json);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.collections, [
    { name: 'Research', color: 'teal', tabs: [{ url: 'https://a.com/', title: 'A' }, { url: 'https://b.com/', title: 'B' }] },
  ]);
  assert.equal(exportUrlList(collections, grouped), '# Research\nhttps://a.com/\nhttps://b.com/\n');
});

test('imports plain URL lists with # headings and OneTab format', () => {
  const plain = parseVaultImport('# Work\nhttps://a.com\nnot a url\n\n# Fun\nhttps://b.com\n', 'File');
  assert.deepEqual(plain.collections.map((c) => [c.name, c.tabs.length]), [['Work', 1], ['Fun', 1]]);
  assert.match(plain.errors[0], /1 line/);

  const onetab = parseVaultImport('https://a.com | A title\nhttps://b.com | B\n\nhttps://c.com | C\n', 'OneTab');
  assert.deepEqual(onetab.collections.map((c) => c.tabs.length), [2, 1]);
  assert.equal(onetab.collections[0].tabs[0].title, 'A title');
});

test('imports TabVault data from a full BrowseKit backup', () => {
  const backup = {
    format: 'browsekit-backup',
    stores: {
      collections: [{ id: 'x', name: 'From backup', color: 'nope', sortOrder: 0 }],
      vaultTabs: [{ id: 't', collectionId: 'x', url: 'https://a.com/', title: 'A', sortOrder: 0 }],
    },
  };
  const r = parseVaultImport(JSON.stringify(backup));
  assert.equal(r.collections[0].name, 'From backup');
  assert.equal(r.collections[0].color, 'indigo', 'invalid colours are replaced');
  assert.equal(r.collections[0].tabs.length, 1);
});

test('rejects unknown JSON and empty files', () => {
  assert.equal(parseVaultImport('{"a":1}').collections.length, 0);
  assert.equal(parseVaultImport('{bad json').errors.length, 1);
  assert.equal(parseVaultImport('   ').errors.length, 1);
});
