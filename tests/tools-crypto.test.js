import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  base64Decode,
  base64Encode,
  convertCase,
  formatJson,
  generatePassword,
  hashText,
  parseTimestamp,
  urlDecode,
  urlEncode,
  uuid,
} from '../src/shared/dev-tools.js';
import { decryptJson, encryptJson, isEncryptedBackup } from '../src/shared/crypto-backup.js';

test('JSON format / minify / error', () => {
  assert.equal(formatJson('{"a":[1,2]}').text, '{\n  "a": [\n    1,\n    2\n  ]\n}');
  assert.equal(formatJson('{ "a" : 1 }', 0).text, '{"a":1}');
  assert.equal(formatJson('{bad').ok, false);
});

test('Base64 is UTF-8 safe and accepts URL-safe input without padding', () => {
  assert.equal(base64Encode('héllo ✓'), 'aMOpbGxvIOKckw==');
  assert.equal(base64Decode('aMOpbGxvIOKckw'), 'héllo ✓');
  assert.equal(base64Decode(base64Encode('😀 emoji')), '😀 emoji');
  assert.throws(() => base64Decode('////'), 'invalid UTF-8 rejected');
});

test('URL encode/decode', () => {
  assert.equal(urlEncode('a b&c=é'), 'a%20b%26c%3D%C3%A9');
  assert.equal(urlDecode('a+b%20c'), 'a b c');
});

test('hashes match known vectors', async () => {
  assert.equal(await hashText('SHA-256', 'abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(await hashText('SHA-1', 'abc'), 'a9993e364706816aba3e25717850c26c9cd0d89d');
});

test('password generator honours length and character sets', () => {
  for (let i = 0; i < 50; i += 1) {
    const p = generatePassword({ length: 24 });
    assert.equal(p.length, 24);
    assert.match(p, /[a-z]/);
    assert.match(p, /[A-Z]/);
    assert.match(p, /[2-9]/);
    assert.match(p, /[^a-zA-Z0-9]/);
    assert.doesNotMatch(p, /[0O1lI]/, 'no look-alikes');
  }
  assert.match(generatePassword({ length: 12, symbols: false, upper: false }), /^[a-z2-9]{12}$/);
  assert.throws(() => generatePassword({ lower: false, upper: false, digits: false, symbols: false }));
  assert.match(uuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('case conversion', () => {
  assert.equal(convertCase('hello world-wide', 'title'), 'Hello World-Wide');
  assert.equal(convertCase('HELLO. how are you', 'sentence'), 'Hello. How are you');
  assert.equal(convertCase('Hello World Example', 'camel'), 'helloWorldExample');
  assert.equal(convertCase('helloWorld example', 'snake'), 'hello_world_example');
  assert.equal(convertCase('Hello World', 'kebab'), 'hello-world');
});

test('timestamp parsing: seconds, millis, ISO', () => {
  assert.equal(parseTimestamp('0').iso, '1970-01-01T00:00:00.000Z');
  assert.equal(parseTimestamp('1700000000').seconds, 1700000000);
  assert.equal(parseTimestamp('1700000000000').seconds, 1700000000);
  assert.equal(parseTimestamp('2026-01-01T00:00:00Z').seconds, 1767225600);
  assert.equal(parseTimestamp('nope').ok, false);
});

test('encrypted backup round-trip; wrong password and tampering are rejected', async () => {
  const data = { stores: { collections: [{ id: 'c', name: 'Secret ✓' }] } };
  const env = await encryptJson(data, 'correct horse', { iterations: 20_000 });
  assert.ok(isEncryptedBackup(env));
  assert.ok(!JSON.stringify(env).includes('Secret'), 'ciphertext only');
  assert.deepEqual(await decryptJson(env, 'correct horse'), data);
  await assert.rejects(decryptJson(env, 'wrong horse'), /Wrong password/);
  const tampered = { ...env, data: env.data.slice(0, -4) + 'AAAA' };
  await assert.rejects(decryptJson(tampered, 'correct horse'), /Wrong password|damaged/);
  await assert.rejects(encryptJson(data, 'short'), /at least 8/);
  await assert.rejects(decryptJson({ format: 'x' }, 'p'), /Not a BrowseKit/);
});
