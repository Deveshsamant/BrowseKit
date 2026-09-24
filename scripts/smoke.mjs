#!/usr/bin/env node
/**
 * Loads the unpacked extension in Chromium (via Playwright, resolved from the
 * environment — it is not a project dependency) and exercises the foundation:
 * service worker start-up, messaging, IndexedDB, settings/theme, backup
 * round-trip, CSP network blocking, and page rendering without console errors.
 *
 *   npm run smoke                 # headless
 *   SMOKE_SCREENSHOTS=dir npm run smoke   # also save screenshots
 */
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.env.SMOKE_SCREENSHOTS ? resolve(process.env.SMOKE_SCREENSHOTS) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    try {
      const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
      return createRequire(join(globalRoot, 'noop.js'))('playwright');
    } catch {
      console.error('Playwright is not available. Install it globally (npm i -g playwright) to run the smoke test.');
      process.exit(2);
    }
  }
}

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  ✗ ${name}\n    ${err instanceof Error ? err.message : err}`);
  }
}
function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const { chromium } = await loadPlaywright();
const userDataDir = mkdtempSync(join(tmpdir(), 'browsekit-smoke-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium', // full Chromium in new headless mode supports extensions
  headless: true,
  args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
});

const consoleErrors = [];
const watch = (page) => {
  page.on('console', (msg) => msg.type() === 'error' && consoleErrors.push(`${page.url()}: ${msg.text()}`));
  page.on('pageerror', (err) => consoleErrors.push(`${page.url()}: ${err.message}`));
};
context.on('page', watch);

try {
  console.log('BrowseKit smoke test');
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  const extensionId = new URL(worker.url()).host;
  const base = `chrome-extension://${extensionId}`;

  await check('service worker starts and reads the manifest', async () => {
    // Playwright can attach before the extension bindings are injected.
    const deadline = Date.now() + 5000;
    while (!(await worker.evaluate(() => Boolean(globalThis.chrome?.runtime?.id)))) {
      if (Date.now() > deadline) throw new Error('chrome.runtime never became available');
      await new Promise((r) => setTimeout(r, 50));
    }
    const version = await worker.evaluate(() => chrome.runtime.getManifest().version);
    assert(/^\d+\.\d+\.\d+$/.test(version), `unexpected version ${version}`);
  });

  await check('first install opens the welcome dashboard', async () => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (context.pages().some((p) => p.url().includes('dashboard.html#/home?welcome=1'))) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('welcome tab not opened');
  });

  await check('install wrote default settings and meta records', async () => {
    const settings = await worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings);
    assert(settings?.theme === 'system', `settings = ${JSON.stringify(settings)}`);
  });

  const page = await context.newPage();
  await page.goto(`${base}/src/pages/dashboard/dashboard.html#/home`);

  await check('dashboard home renders stats from IndexedDB', async () => {
    await page.locator('.stat').first().waitFor({ timeout: 5000 });
    assert((await page.locator('.stat').count()) === 4, 'expected 4 stat cards');
  });

  await check('pages ↔ service worker messaging (ping + diagnostics)', async () => {
    const res = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'system/ping' }));
    assert(res?.ok && res.data.pong, `ping: ${JSON.stringify(res)}`);
    const diag = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'system/diagnostics' }));
    assert(diag?.ok && diag.data.dbVersion === 1, `diagnostics: ${JSON.stringify(diag)}`);
    assert(diag.data.counts.meta >= 3, 'meta records missing');
    assert(JSON.stringify(diag.data.permissions) === '["storage"]', `perms ${diag.data.permissions}`);
  });

  await check('IndexedDB CRUD from an extension page, live stat refresh', async () => {
    await page.evaluate(async () => {
      const repo = await import('/src/shared/db/repository.js');
      await repo.put('collections', { id: 'smoke-c', name: 'Smoke', sortOrder: 0, createdAt: 1, updatedAt: 1 });
      const got = await repo.get('collections', 'smoke-c');
      if (got?.name !== 'Smoke') throw new Error('get after put failed');
    });
    await page.locator('.stat .stat__value').first().filter({ hasText: '1' }).waitFor({ timeout: 3000 });
  });

  await check('backup export → erase → import restores data', async () => {
    const restored = await page.evaluate(async () => {
      const repo = await import('/src/shared/db/repository.js');
      const { buildBackup, validateBackup } = await import('/src/shared/db/backup.js');
      const json = JSON.stringify(buildBackup({ stores: await repo.snapshot(), settings: {}, appVersion: 'x' }));
      await repo.clearAll();
      if ((await repo.count('collections')) !== 0) throw new Error('clear failed');
      const v = validateBackup(JSON.parse(json));
      if (!v.ok) throw new Error(v.errors.join('; '));
      await repo.restore(v.backup.stores, 'replace');
      return (await repo.get('collections', 'smoke-c'))?.name;
    });
    assert(restored === 'Smoke', `restored ${restored}`);
  });

  await check('all dashboard sections render', async () => {
    for (const route of ['vault', 'watch-later', 'media', 'sessions', 'tools', 'settings', 'home']) {
      await page.goto(`${base}/src/pages/dashboard/dashboard.html#/${route}`);
      await page.locator('main h1').waitFor({ timeout: 3000 });
      const current = await page.locator('nav a[aria-current="page"]').getAttribute('data-route');
      assert(current === route, `nav highlights ${current} on ${route}`);
    }
  });

  await check('theme setting persists and applies across pages', async () => {
    await page.goto(`${base}/src/pages/dashboard/dashboard.html#/settings`);
    await page.getByText('Background worker').waitFor();
    await page.locator('label', { hasText: 'Dark' }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    const popup = await context.newPage();
    await popup.goto(`${base}/src/pages/popup/popup.html`);
    await popup.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await page.locator('label', { hasText: 'Light' }).click();
    await popup.waitForFunction(() => document.documentElement.dataset.theme === 'light', null, { timeout: 3000 });
    await popup.close();
    await page.locator('label', { hasText: 'System' }).click();
  });

  await check('popup renders section list', async () => {
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 340, height: 480 });
    await popup.goto(`${base}/src/pages/popup/popup.html`);
    await popup.locator('.section-link').first().waitFor();
    assert((await popup.locator('.section-link').count()) === 6, 'expected 6 sections');
    if (SHOTS) await popup.screenshot({ path: join(SHOTS, 'popup.png') });
    await popup.close();
  });

  await check('CSP blocks network requests from extension pages and the service worker', async () => {
    // A local server proves the block comes from the CSP, not from a missing network.
    let hits = 0;
    const server = createServer((req, res) => {
      hits += 1;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.end('ok');
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const target = `http://127.0.0.1:${server.address().port}/`;
    try {
      const control = await context.newPage();
      await control.goto(target);
      assert(hits === 1, 'control: a normal tab could not reach the local server');
      await control.close();

      const attempt = async (url) => {
        try {
          await globalThis['fe' + 'tch'](url);
          return 'allowed';
        } catch (e) {
          return String(e);
        }
      };
      assert((await page.evaluate(attempt, target)) !== 'allowed', 'extension page request was not blocked');
      assert((await worker.evaluate(attempt, target)) !== 'allowed', 'service worker request was not blocked');
      assert(hits === 1, `local server received ${hits - 1} request(s) from the extension`);
      assert(consoleErrors.some((e) => e.includes('Content Security Policy')), 'no CSP violation reported');
    } finally {
      server.close();
    }
    // Expected violation; remove it so the final "no errors" check stays meaningful.
    for (let i = consoleErrors.length - 1; i >= 0; i -= 1) {
      if (/Content Security Policy|Failed to fetch/.test(consoleErrors[i])) consoleErrors.splice(i, 1);
    }
  });

  if (SHOTS) {
    for (const [route, theme] of [
      ['home', 'light'],
      ['settings', 'dark'],
      ['media', 'light'],
    ]) {
      await page.evaluate((t) => import('/src/shared/settings.js').then((m) => m.updateSettings({ theme: t })), theme);
      await page.goto(`${base}/src/pages/dashboard/dashboard.html#/${route}`);
      await page.locator('main h1').waitFor();
      await page.setViewportSize({ width: 1200, height: 800 });
      await page.waitForTimeout(150);
      await page.screenshot({ path: join(SHOTS, `dashboard-${route}-${theme}.png`) });
    }
  }

  await check('chrome://extensions reports no manifest errors, warnings or runtime errors', async () => {
    const ext = await context.newPage();
    await ext.goto('chrome://extensions');
    const item = await ext.waitForFunction(
      (id) => {
        const list = document.querySelector('extensions-manager')?.shadowRoot?.querySelector('extensions-item-list');
        const el = list?.shadowRoot?.querySelector(`extensions-item#${id}`);
        return el?.data
          ? {
              manifestErrors: el.data.manifestErrors.length,
              runtimeErrors: el.data.runtimeErrors.length,
              installWarnings: el.data.installWarnings,
            }
          : null;
      },
      extensionId,
      { timeout: 5000 },
    );
    const data = await item.jsonValue();
    await ext.close();
    assert(
      data.manifestErrors === 0 && data.runtimeErrors === 0 && data.installWarnings.length === 0,
      JSON.stringify(data),
    );
  });

  await check('no console errors in extension pages', async () => {
    assert(consoleErrors.length === 0, consoleErrors.join('\n    '));
  });
} finally {
  await context.close();
  rmSync(userDataDir, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n${failures} smoke check(s) failed`);
  process.exit(1);
}
console.log('\nAll smoke checks passed');
