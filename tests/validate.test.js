import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateExtension } from '../scripts/validate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Copy the extension to a temp dir, apply `mutate`, and validate it. */
function validateMutated(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'browsekit-'));
  try {
    for (const p of ['manifest.json', 'src', 'assets']) cpSync(join(ROOT, p), join(dir, p), { recursive: true });
    mutate(dir);
    return validateExtension(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const editManifest = (dir, fn) => {
  const path = join(dir, 'manifest.json');
  const m = JSON.parse(readFileSync(path, 'utf8'));
  fn(m);
  writeFileSync(path, JSON.stringify(m));
};

test('the repository passes validation', () => {
  assert.deepEqual(validateExtension(ROOT), []);
});

test('flags disallowed permissions and host permissions', () => {
  const errors = validateMutated((dir) =>
    editManifest(dir, (m) => {
      m.permissions.push('history');
      m.host_permissions = ['<all_urls>'];
    }),
  );
  assert.ok(errors.some((e) => e.includes('"history"')));
  assert.ok(errors.some((e) => e.includes('host_permissions')));
});

test('flags a weakened CSP', () => {
  const errors = validateMutated((dir) =>
    editManifest(dir, (m) => {
      m.content_security_policy.extension_pages = "script-src 'self' https://cdn.example; object-src 'self'";
    }),
  );
  assert.ok(errors.some((e) => e.includes('remote origins')));
});

test('flags network calls, storage.sync, innerHTML and remote URLs in source', () => {
  const errors = validateMutated((dir) =>
    writeFileSync(
      join(dir, 'src', 'bad.js'),
      [
        "fetch('/x');",
        'chrome.storage.sync.get();',
        'el.innerHTML = title;',
        "const u = 'https://tracker.example/p';",
        "import x from 'lodash';",
      ].join('\n'),
    ),
  );
  for (const needle of ['fetch', 'storage.sync', 'innerHTML', 'remote URL', 'bare/remote import']) {
    assert.ok(errors.some((e) => e.includes(needle)), `expected error mentioning ${needle}`);
  }
});

test('does not flag banned words that only appear in comments', () => {
  const errors = validateMutated((dir) =>
    writeFileSync(join(dir, 'src', 'ok.js'), '// we never call fetch() here\n/* eval( */\nexport const a = 1;\n'),
  );
  assert.deepEqual(errors, []);
});

test('flags missing referenced files', () => {
  const errors = validateMutated((dir) => rmSync(join(dir, 'assets', 'icons', 'icon48.png')));
  assert.ok(errors.some((e) => e.includes('icon48.png')));
});
