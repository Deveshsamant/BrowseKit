import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeQr, numDataCodewords, rsComputeDivisor, rsComputeRemainder } from '../src/shared/qr.js';

test('Reed–Solomon matches the ISO 18004 / Thonky “HELLO WORLD” 1-M example', () => {
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(rsComputeRemainder(data, rsComputeDivisor(10)), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

test('data capacity table matches the spec for key versions', () => {
  assert.equal(numDataCodewords(1, 'M'), 16);
  assert.equal(numDataCodewords(5, 'Q'), 62);
  assert.equal(numDataCodewords(10, 'H'), 122);
  assert.equal(numDataCodewords(40, 'L'), 2956);
  assert.equal(numDataCodewords(40, 'M'), 2334);
  assert.equal(numDataCodewords(40, 'Q'), 1666);
  assert.equal(numDataCodewords(40, 'H'), 1276);
});

test('symbol structure: size, finder patterns, dark module, timing', () => {
  const { version, size, modules } = encodeQr('https://example.com/path?q=1');
  assert.equal(size, version * 4 + 17);
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    assert.equal(modules[cy][cx], true, 'finder centre is dark');
    assert.equal(modules[cy - 2][cx], false, 'finder ring is light');
    assert.equal(modules[cy - 3][cx], true, 'finder border is dark');
  }
  assert.equal(modules[size - 8][8], true, 'dark module');
  for (let i = 8; i < size - 8; i += 1) assert.equal(modules[6][i], i % 2 === 0, 'timing pattern');
});

test('picks the smallest version and boosts ECC when free', () => {
  const small = encodeQr('hi', { ecc: 'L' });
  assert.equal(small.version, 1);
  assert.equal(small.ecc, 'H');
  assert.equal(encodeQr('hi', { ecc: 'L', boostEcc: false }).ecc, 'L');
});

test('handles UTF-8 and rejects oversize input', () => {
  assert.ok(encodeQr('ünïcødé ✓ 日本語 🎉').version >= 2);
  assert.throws(() => encodeQr('x'.repeat(3000), { ecc: 'L' }), RangeError);
});

test('deterministic output', () => {
  assert.deepEqual(encodeQr('same').modules, encodeQr('same').modules);
});
