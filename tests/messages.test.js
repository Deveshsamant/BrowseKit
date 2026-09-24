import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRouter, serializeError } from '../src/shared/messages.js';

/** Invoke a router listener and resolve with what it sent back (or undefined). */
function dispatch(router, message, sender = { id: 'ext' }) {
  return new Promise((resolve) => {
    const keepOpen = router(message, sender, resolve);
    if (!keepOpen) setTimeout(() => resolve(undefined), 10);
  });
}

test('router dispatches to handler and wraps the result', async () => {
  const router = createRouter({ 'a/b': (payload) => payload * 2 }, { extensionId: 'ext' });
  assert.deepEqual(await dispatch(router, { type: 'a/b', payload: 21 }), { ok: true, data: 42 });
});

test('router serializes thrown and rejected errors', async () => {
  const router = createRouter({
    sync: () => {
      throw Object.assign(new Error('boom'), { code: 'BOOM' });
    },
    async: async () => {
      throw new TypeError('bad');
    },
  });
  assert.deepEqual(await dispatch(router, { type: 'sync' }), {
    ok: false,
    error: { code: 'BOOM', message: 'boom' },
  });
  assert.deepEqual(await dispatch(router, { type: 'async' }), {
    ok: false,
    error: { code: 'TypeError', message: 'bad' },
  });
});

test('router ignores unknown types and malformed messages', async () => {
  const router = createRouter({ known: () => 1 });
  assert.equal(await dispatch(router, { type: 'unknown' }), undefined);
  assert.equal(await dispatch(router, null), undefined);
  assert.equal(await dispatch(router, { type: 5 }), undefined);
  assert.equal(await dispatch(router, { type: 'toString' }), undefined, 'no prototype lookups');
});

test('router rejects senders from other extensions', async () => {
  const router = createRouter({ known: () => 1 }, { extensionId: 'ext' });
  const res = await dispatch(router, { type: 'known' }, { id: 'evil' });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'FORBIDDEN');
});

test('serializeError handles non-Error values', () => {
  assert.deepEqual(serializeError('x'), { code: 'ERROR', message: 'x' });
  assert.deepEqual(serializeError(null), { code: 'ERROR', message: 'null' });
});
