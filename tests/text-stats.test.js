import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatReadingTime, textStats } from '../src/shared/text-stats.js';

test('counts words, characters and lines', () => {
  const s = textStats('Hello, world! This is BrowseKit.\nSecond line');
  assert.equal(s.words, 7);
  assert.equal(s.lines, 2);
  assert.equal(s.characters, 44);
  assert.equal(s.charactersNoSpaces, 38);
});

test('counts graphemes, not UTF-16 units', () => {
  assert.equal(textStats('👍🏽é').characters, 2);
});

test('segments languages without spaces', () => {
  assert.ok(textStats('日本語のテキストです').words > 1);
});

test('empty input', () => {
  assert.deepEqual(textStats(''), { words: 0, characters: 0, charactersNoSpaces: 0, lines: 0, readingMinutes: 0 });
});

test('formatReadingTime', () => {
  assert.equal(formatReadingTime(0), '0 min');
  assert.equal(formatReadingTime(0.4), '< 1 min');
  assert.equal(formatReadingTime(4.4), '4 min');
  assert.equal(formatReadingTime(72), '1 h 12 min');
  assert.equal(formatReadingTime(120), '2 h');
});
