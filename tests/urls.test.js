import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanUrl, duplicateKey, hostOf, isSaveableUrl, isScriptableUrl } from '../src/shared/urls.js';

test('isSaveableUrl accepts web/file/browser pages, rejects blanks and script URLs', () => {
  for (const u of ['https://a.com/', 'http://a.com/x', 'file:///tmp/a.html', 'chrome://settings/']) assert.ok(isSaveableUrl(u), u);
  for (const u of ['', undefined, 'about:blank', 'chrome://newtab/', 'javascript:alert(1)', 'data:text/html,x', 'not a url']) {
    assert.ok(!isSaveableUrl(u), String(u));
  }
  assert.ok(!isSaveableUrl('chrome-extension://abc/page.html', 'chrome-extension://abc'));
});

test('isScriptableUrl only allows http(s) and file', () => {
  assert.ok(isScriptableUrl('https://a.com'));
  assert.ok(!isScriptableUrl('chrome://extensions'));
  assert.ok(!isScriptableUrl(undefined));
});

test('duplicateKey ignores fragment, trailing slash and host case', () => {
  assert.equal(duplicateKey('https://A.com/x/#top'), duplicateKey('https://a.com/x'));
  assert.equal(duplicateKey('https://a.com:443/'), 'https://a.com/');
  assert.notEqual(duplicateKey('https://a.com/?q=1'), duplicateKey('https://a.com/?q=2'));
});

test('cleanUrl removes known trackers and keeps everything else byte-for-byte', () => {
  assert.deepEqual(cleanUrl('https://a.com/p?utm_source=x&q=a%20b+c&fbclid=1#h'), {
    url: 'https://a.com/p?q=a%20b+c#h',
    removed: ['utm_source', 'fbclid'],
  });
  assert.equal(cleanUrl('https://www.youtube.com/watch?v=abc&si=zzz').url, 'https://www.youtube.com/watch?v=abc');
  assert.equal(cleanUrl('https://a.com/?utm_a=1').url, 'https://a.com/');
  assert.deepEqual(cleanUrl('https://a.com/?x=1').removed, []);
  // Site rules only apply to their sites.
  assert.equal(cleanUrl('https://example.org/?si=1').url, 'https://example.org/?si=1');
  assert.equal(cleanUrl('https://www.amazon.de/dp/B0?ref_=abc&th=1').url, 'https://www.amazon.de/dp/B0');
  assert.equal(cleanUrl('chrome://settings/?utm_source=x').url, 'chrome://settings/?utm_source=x');
});

test('hostOf', () => {
  assert.equal(hostOf('https://sub.a.com/x'), 'sub.a.com');
  assert.equal(hostOf('garbage'), 'garbage');
});
