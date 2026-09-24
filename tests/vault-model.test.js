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

import { exportBookmarksHtml, normalizeTags, orderCollections, parseBookmarksHtml, planSortTabs, tagCounts } from '../src/features/vault/vault-model.js';

test('tags: normalise, search with #tag, notes searchable, counts', () => {
  assert.deepEqual(normalizeTags('#Work, read  Later, work'), ['work', 'read later']);
  assert.deepEqual(normalizeTags('a b #c'), ['a', 'b', 'c']);
  const tabs = [
    { ...tab('1', 'c', 'https://a.com/', 'Alpha', 0), tags: ['work'], note: 'pricing table' },
    { ...tab('2', 'c', 'https://b.com/', 'Beta', 1), tags: ['workshop'] },
  ];
  assert.deepEqual(searchTabs(tabs, '#work').map((t) => t.id), ['1'], '#tag is exact');
  assert.deepEqual(searchTabs(tabs, 'work').map((t) => t.id), ['1', '2'], 'plain term matches tag substrings');
  assert.deepEqual(searchTabs(tabs, 'pricing').map((t) => t.id), ['1']);
  assert.deepEqual(tagCounts(tabs), [['work', 1], ['workshop', 1]]);
});

test('starred collections come first; sorting tabs by title/site/date', () => {
  const cols = [
    { id: 'a', name: 'A', sortOrder: 0, createdAt: 0 },
    { id: 'b', name: 'B', sortOrder: 1, createdAt: 0, starred: true },
  ];
  assert.deepEqual(orderCollections(cols).map((c) => c.id), ['b', 'a']);
  const tabs = [
    { ...tab('1', 'c', 'https://www.z.com/', 'beta', 0), createdAt: 3 },
    { ...tab('2', 'c', 'https://a.com/', 'Alpha', 1), createdAt: 1 },
    { ...tab('3', 'c', 'https://m.com/', 'gamma', 2), createdAt: 2 },
  ];
  assert.deepEqual(planSortTabs(tabs, 'title'), ['2', '1', '3']);
  assert.deepEqual(planSortTabs(tabs, 'site'), ['2', '3', '1']);
  assert.deepEqual(planSortTabs(tabs, 'newest'), ['1', '3', '2']);
  assert.deepEqual(planSortTabs(tabs, 'oldest'), ['2', '3', '1']);
});

test('bookmarks HTML: export escapes, re-import round-trips, nested folders and loose links', () => {
  const collections = [{ id: 'c', name: 'R&D <x>', color: 'teal', sortOrder: 0, createdAt: 1e12, updatedAt: 1 }];
  const grouped = groupTabs([{ ...tab('1', 'c', 'https://a.com/?a=1&b=2', 'A "q" & more', 0), createdAt: 1e12 }]);
  const html = exportBookmarksHtml(collections, grouped);
  assert.match(html, /R&amp;D &lt;x&gt;/);
  assert.match(html, /HREF="https:\/\/a.com\/\?a=1&amp;b=2"/);
  assert.deepEqual(parseVaultImport(html).collections, [{ name: 'R&D <x>', color: 'indigo', tabs: [{ url: 'https://a.com/?a=1&b=2', title: 'A "q" & more' }] }]);

  const chrome = `<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p>
    <DT><A HREF="https://loose.test/">Loose</A>
    <DT><H3>Bookmarks bar</H3><DL><p>
      <DT><A HREF="https://bar.test/">Bar &#8211; one</A>
      <DT><H3>Dev</H3><DL><p><DT><A HREF="https://dev.test/">Dev</A><DT><A HREF="javascript:alert(1)">bad</A></DL><p>
    </DL><p></DL><p>`;
  const parsed = parseBookmarksHtml(chrome, 'Imported');
  assert.deepEqual(parsed.map((c) => [c.name, c.tabs.map((t) => t.title)]), [
    ['Imported', ['Loose']],
    ['Bookmarks bar', ['Bar – one']],
    ['Bookmarks bar / Dev', ['Dev']],
  ]);
});

test('JSON export keeps tags and notes through re-import', () => {
  const collections = [{ id: 'c', name: 'N', color: 'teal', sortOrder: 0, createdAt: 1, updatedAt: 1 }];
  const grouped = groupTabs([{ ...tab('1', 'c', 'https://a.com/', 'A', 0), tags: ['x'], note: 'hi' }]);
  const parsed = parseVaultImport(JSON.stringify(exportVaultJson(collections, grouped)));
  assert.deepEqual(parsed.collections[0].tabs[0], { url: 'https://a.com/', title: 'A', note: 'hi', tags: ['x'] });
});
