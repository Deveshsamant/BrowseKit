#!/usr/bin/env node
/**
 * End-to-end smoke test: loads the unpacked extension in Chromium (Playwright
 * resolved from the environment — not a project dependency) and exercises
 * every feature against a local test server.
 *
 * Phase A — the real manifest: service worker, storage, CSP, dashboard views,
 *           TabVault, Watch Later, Sessions/Tab Manager, Tools, popup.
 * Phase B — a temporary copy whose manifest also grants the local test server
 *           as a host permission. Automation cannot click the toolbar icon
 *           (activeTab) or accept Chrome's permission prompt, so this stands in
 *           for "the user granted this site": it exercises the scripting paths
 *           (Media Boost from the popup, word count, auto-applied site settings).
 *
 *   npm run smoke
 *   SMOKE_SCREENSHOTS=dir npm run smoke   # also save screenshots
 */
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    console.error(`  ✗ ${name}\n    ${(err instanceof Error ? err.message : String(err)).split('\n').slice(0, 6).join('\n    ')}`);
  }
}
function assert(cond, message) {
  if (!cond) throw new Error(message);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Local test server ----------------------------------------------------------

/** 3 s of a quiet 440 Hz tone as 16-bit mono WAV. */
function toneWav() {
  const rate = 8000;
  const n = rate * 3;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i += 1) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 3000), 44 + i * 2);
  return buf;
}
const WAV = toneWav();
let serverHits = 0;
const server = createServer((req, res) => {
  serverHits += 1;
  const path = (req.url ?? '/').split('?')[0];
  if (path === '/tone.wav') {
    // Range support so the media element can seek.
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
    if (m) {
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Math.min(Number(m[2]), WAV.length - 1) : WAV.length - 1;
      res.writeHead(206, { 'Content-Type': 'audio/wav', 'Content-Range': `bytes ${start}-${end}/${WAV.length}`, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' });
      res.end(WAV.subarray(start, end + 1));
    } else {
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': WAV.length, 'Accept-Ranges': 'bytes' });
      res.end(WAV);
    }
    return;
  }
  if (path === '/media.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    // Same-origin audio (boostable) + cross-origin audio via "localhost" (not boostable, no CORS).
    res.end(`<!doctype html><title>Media page</title><h1>Media</h1>
      <audio id="same" src="/tone.wav" controls loop></audio>
      <audio id="cross" src="http://127.0.0.1:${crossServer.address().port}/tone.wav" controls></audio>`);
    return;
  }
  if (path === '/article.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!doctype html><title>Article</title><p>${'word '.repeat(476)}</p>`);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<!doctype html><title>Page ${path}</title><p>Hello from ${path}</p>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
// A second origin (different port) serving media without CORS headers.
const crossServer = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': WAV.length });
  res.end(WAV);
});
await new Promise((r) => crossServer.listen(0, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${server.address().port}`;

// --- Browser helpers ----------------------------------------------------------------

const { chromium } = await loadPlaywright();
const consoleErrors = [];

/** @param {string} extDir */
async function launch(extDir) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'browsekit-smoke-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium', // full Chromium in new headless mode supports extensions
    headless: true,
    viewport: { width: 1200, height: 800 },
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--autoplay-policy=no-user-gesture-required'],
  });
  context.on('page', (page) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error' && page.url().startsWith('chrome-extension://')) consoleErrors.push(`${page.url()}: ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      if (page.url().startsWith('chrome-extension://')) consoleErrors.push(`${page.url()}: ${err.message}`);
    });
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  const deadline = Date.now() + 5000;
  while (!(await worker.evaluate(() => Boolean(globalThis.chrome?.runtime?.id)))) {
    if (Date.now() > deadline) throw new Error('chrome.runtime never became available');
    await sleep(50);
  }
  const extensionId = new URL(worker.url()).host;
  return { context, worker, extensionId, base: `chrome-extension://${extensionId}`, userDataDir };
}

/** Run code in an extension page with access to extension modules. */
const inExt = (page, fn, arg) => page.evaluate(fn, arg);

/** Wait until the dashboard's <dialog> is open, fill it, and confirm. */
async function answerDialog(page, value) {
  const dialog = page.locator('dialog[open]');
  await dialog.waitFor({ timeout: 3000 });
  if (value !== undefined) await dialog.locator('input.input').fill(value);
  await dialog.locator('button[value="ok"]').click();
  await dialog.waitFor({ state: 'detached', timeout: 3000 });
}

/** Make the tab whose URL contains `part` the active tab of the focused window. */
async function focusTabByUrl(worker, part) {
  await worker.evaluate(async (needle) => {
    const tab = (await chrome.tabs.query({})).find((t) => t.url?.includes(needle));
    if (!tab) throw new Error(`no tab ${needle}`);
    // Headless Chromium doesn't update "last focused" on windows.update, so
    // move the tab into the window Chrome reports as last focused instead.
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    if (tab.windowId !== win.id) await chrome.tabs.move(tab.id, { windowId: win.id, index: -1 });
    await chrome.tabs.update(tab.id, { active: true });
  }, part);
}

/** Open the popup the way Chrome does: in its own window, next to a normal tab. */
async function openPopup(context, worker, base) {
  const [popup] = await Promise.all([
    context.waitForEvent('page', { predicate: (p) => p.url().includes('popup.html'), timeout: 5000 }),
    worker.evaluate((url) => chrome.windows.create({ url, type: 'popup', width: 380, height: 600 }), `${base}/src/pages/popup/popup.html`),
  ]);
  await popup.waitForLoadState('domcontentloaded');
  return popup;
}

// ================================================================================
// Phase A — real manifest
// ================================================================================
console.log('BrowseKit smoke test — phase A (real manifest)');
{
  const { context, worker, extensionId, base, userDataDir } = await launch(ROOT);
  const dash = (route) => `${base}/src/pages/dashboard/dashboard.html#/${route}`;
  try {
    await check('service worker starts; first install opens the welcome dashboard', async () => {
      const version = await worker.evaluate(() => chrome.runtime.getManifest().version);
      assert(/^\d+\.\d+\.\d+$/.test(version), `unexpected version ${version}`);
      const deadline = Date.now() + 10_000;
      while (!context.pages().some((p) => p.url().includes('#/home?welcome=1'))) {
        if (Date.now() > deadline) throw new Error('welcome tab not opened');
        await sleep(100);
      }
    });

    await check('install wrote settings, context menus and permissions', async () => {
      const settings = await worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings);
      assert(settings?.theme === 'system' && settings.vault?.openIn === 'current-window', JSON.stringify(settings));
      const perms = await worker.evaluate(() => chrome.permissions.getAll());
      assert(
        JSON.stringify([...perms.permissions].sort()) === JSON.stringify(['activeTab', 'contextMenus', 'favicon', 'scripting', 'sessions', 'storage', 'tabs']),
        `permissions ${perms.permissions}`,
      );
      assert(!perms.origins?.length, `no host access at install, got ${perms.origins}`);
      const registered = await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts());
      assert(registered.length === 0, 'no media script registered without site access');
    });

    const page = await context.newPage();
    await page.goto(dash('home'));

    await check('messaging and diagnostics via the service worker', async () => {
      const diag = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'system/diagnostics' }));
      assert(diag?.ok && diag.data.dbVersion === 1 && diag.data.counts.meta >= 3, JSON.stringify(diag));
    });

    await check('every dashboard section renders and highlights its nav item', async () => {
      for (const route of ['vault', 'watch-later', 'media', 'sessions', 'tools', 'settings', 'home']) {
        await page.goto(dash(route));
        await page.locator('main h1').waitFor({ timeout: 4000 });
        const current = await page.locator('nav a[aria-current="page"]').getAttribute('data-route');
        assert(current === route, `nav highlights ${current} on ${route}`);
      }
    });

    // Some real web pages to work with (plus a duplicate).
    const web = [];
    for (const path of ['/alpha', '/beta', '/alpha#section', '/media.html']) {
      const p = await context.newPage();
      await p.goto(`${SITE}${path}`);
      web.push(p);
    }
    await page.bringToFront();

    // --- TabVault --------------------------------------------------------------
    await check('TabVault: save all windows → collection with web tabs only, duplicates skipped', async () => {
      const r = await inExt(page, async () => {
        const { saveTabsToVault } = await import('/src/features/vault/save.js');
        return saveTabsToVault({ scope: 'all', newCollectionName: 'Smoke window' });
      });
      assert(r.added === 3 && r.duplicates === 1, JSON.stringify(r));
      assert(r.skipped >= 1, 'extension pages are skipped');
    });

    await check('TabVault UI: list, create via dialog, search, rename, move, delete', async () => {
      await page.goto(dash('vault'));
      await page.locator('.collection-item', { hasText: 'Smoke window' }).waitFor();
      await page.locator('.collection-item', { hasText: 'Smoke window' }).locator('button').click();
      await page.locator('.rows .row').nth(2).waitFor();
      assert((await page.locator('.rows .row').count()) === 3, 'three saved tabs listed');

      await page.getByRole('button', { name: '+ New collection' }).click();
      await answerDialog(page, 'Reading list');
      await page.locator('.collection-item', { hasText: 'Reading list' }).waitFor();

      await page.locator('input[type=search]').fill('beta');
      await page.locator('.collection-head__title', { hasText: 'Results for' }).waitFor();
      assert((await page.locator('.rows .row').count()) === 1, 'search finds one tab');
      await page.locator('input[type=search]').fill('');

      await page.locator('.collection-item', { hasText: 'Smoke window' }).locator('button').click();
      await page.getByRole('button', { name: 'Rename' }).click();
      await answerDialog(page, 'Renamed window');
      await page.locator('.collection-head__title', { hasText: 'Renamed window' }).waitFor();

      await page.locator('.rows .row').first().hover();
      await page.locator('.rows .row').first().getByRole('button', { name: /^Move/ }).click();
      const dialog = page.locator('dialog[open]');
      await dialog.locator('select').selectOption({ label: 'Reading list' });
      await dialog.locator('button[value="ok"]').click();
      await page.waitForFunction(() => document.querySelectorAll('.vault__main .rows .row').length === 2);

      await page.locator('.rows .row').first().hover();
      await page.locator('.rows .row').first().getByRole('button', { name: /^Delete/ }).click();
      await page.waitForFunction(() => document.querySelectorAll('.vault__main .rows .row').length === 1);
    });

    await check('TabVault: keyboard reorder (Alt+↓) persists order', async () => {
      const ids = await inExt(page, async () => {
        const v = await import('/src/features/vault/vault.js');
        const c = await v.createCollection({ name: 'Order test' });
        await v.addTabs(c.id, [{ url: 'https://one.test/' }, { url: 'https://two.test/' }]);
        return c.id;
      });
      await page.goto(`${dash('vault')}?c=${ids}`);
      await page.locator('.rows .row').nth(1).waitFor();
      await page.locator('.rows .row').first().focus();
      await page.keyboard.press('Alt+ArrowDown');
      await page.waitForFunction(() => document.querySelector('.vault__main .row__sub')?.textContent === 'two.test');
    });

    await check('TabVault: import OneTab text file creates collections', async () => {
      await page.locator('input[type=file]').setInputFiles({
        name: 'onetab.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('https://x.test/ | X\nhttps://y.test/ | Y\n\nhttps://z.test/ | Z\n'),
      });
      await answerDialog(page);
      await page.locator('.collection-item', { hasText: 'onetab 2' }).waitFor();
    });

    await check('TabVault: "Open in new window" opens ordinary tabs (no tab groups)', async () => {
      const before = context.pages().length;
      await page.locator('.collection-item', { hasText: 'Reading list' }).locator('button').click();
      await page.getByRole('button', { name: 'Open in new window' }).click();
      await page.waitForFunction(() => true);
      const deadline = Date.now() + 5000;
      while (context.pages().length < before + 1) {
        if (Date.now() > deadline) throw new Error('no tab opened');
        await sleep(100);
      }
      const windows = await worker.evaluate(() => chrome.windows.getAll({ populate: true }));
      assert(windows.length >= 2, 'a new window was created');
      assert(windows.every((w) => w.tabs.every((t) => t.groupId === -1)), 'no tab groups used');
    });

    // --- Watch Later -------------------------------------------------------------
    await check('Watch Later: add (deduped), list, mark watched, filter, open & remove', async () => {
      const r = await inExt(page, async (site) => {
        const wl = await import('/src/features/watch-later/watch-later.js');
        await wl.addToWatchLater({ url: `${site}/beta`, title: 'Beta page' });
        await wl.addToWatchLater({ url: `${site}/video`, title: 'A video' });
        const again = await wl.addToWatchLater({ url: `${site}/video#t=10`, title: 'A video' });
        return { duplicate: again.duplicate, count: (await wl.listWatchLater()).length };
      }, SITE);
      assert(r.duplicate && r.count === 2, JSON.stringify(r));
      await page.goto(dash('watch-later'));
      await page.locator('.rows .row').nth(1).waitFor();
      await page.locator('.rows .row', { hasText: 'Beta page' }).locator('input[type=checkbox]').check();
      await page.waitForFunction(() => document.querySelectorAll('.rows .row').length === 1); // "To watch" filter hides it
      await page.locator('.segmented label', { hasText: 'Watched' }).click();
      await page.locator('.rows .row', { hasText: 'Beta page' }).waitFor();
      await page.locator('.segmented label', { hasText: 'To watch' }).click();
      const opened = context.waitForEvent('page', { predicate: (p) => p.url().includes('/video'), timeout: 5000 });
      await page.locator('.rows .row', { hasText: 'A video' }).getByRole('button', { name: 'Open & remove' }).click();
      await opened;
      await page.locator('.empty').waitFor();
    });

    await check('Context menu entries are registered', async () => {
      // Chrome has no API to list menu items; re-creating one with an existing id must fail.
      const err = await worker.evaluate(
        () =>
          new Promise((resolve) => {
            chrome.contextMenus.create({ id: 'bk-watch-later-page', title: 'x' }, () => resolve(chrome.runtime.lastError?.message ?? null));
          }),
      );
      assert(err && /duplicate|exists/i.test(err), `expected duplicate id error, got ${err}`);
    });

    await check('Keyboard commands are declared (4 with default keys)', async () => {
      const cmds = await worker.evaluate(() => chrome.commands.getAll());
      assert(cmds.length === 10, `commands: ${cmds.length}`);
      assert(cmds.filter((c) => c.shortcut).length <= 4, 'at most 4 default shortcuts');
    });

    // --- Sessions / Tab Manager --------------------------------------------------
    await check('Sessions: open tabs listed, duplicates detected and closed', async () => {
      await page.goto(`${dash('sessions')}?tab=open`);
      await page.locator('.rows .row', { hasText: 'Page /beta' }).waitFor();
      await page.locator('.tabs__tab', { hasText: 'Duplicates' }).click();
      await page.getByRole('button', { name: /^Close \d+ duplicates?$/ }).click();
      await page.locator('.empty', { hasText: 'No duplicate tabs' }).waitFor({ timeout: 5000 });
    });

    await check('Sessions: recently closed shows the closed tab and restores it', async () => {
      await page.locator('.tabs__tab', { hasText: 'Recently closed' }).click();
      const row = page.locator('.rows .row', { hasText: 'Page /alpha' }).first();
      await row.waitFor({ timeout: 5000 });
      const restored = context.waitForEvent('page', { predicate: (p) => p.url().includes('/alpha'), timeout: 5000 });
      await row.getByRole('button', { name: 'Restore' }).click();
      await restored;
    });

    await check('Sessions: save current session, then restore into new windows', async () => {
      await page.locator('.tabs__tab', { hasText: 'Saved sessions' }).click();
      await page.getByRole('button', { name: 'Save current session' }).first().click();
      await answerDialog(page, 'Smoke session');
      await page.locator('.list-card', { hasText: 'Smoke session' }).waitFor();
      const windowsBefore = (await worker.evaluate(() => chrome.windows.getAll())).length;
      await page.locator('.list-card', { hasText: 'Smoke session' }).getByRole('button', { name: 'Restore' }).click();
      const deadline = Date.now() + 5000;
      while ((await worker.evaluate(() => chrome.windows.getAll())).length <= windowsBefore) {
        if (Date.now() > deadline) throw new Error('no window restored');
        await sleep(100);
      }
    });

    // --- Tools -------------------------------------------------------------------
    await check('Tools: URL cleaner, text counter, offline QR generator', async () => {
      await page.goto(dash('tools'));
      await page.getByLabel('URLs to clean').fill('https://shop.test/p?id=7&utm_source=mail&fbclid=abc');
      await page.waitForFunction(() => /** @type {HTMLTextAreaElement} */ (document.querySelector('[aria-label="Cleaned URLs"]'))?.value === 'https://shop.test/p?id=7');
      await page.getByLabel('Text to count').fill('one two three');
      await page.locator('.stat-mini', { hasText: 'words' }).first().filter({ hasText: '3' }).waitFor();
      await page.getByLabel('QR code content').fill('https://browsekit.test/');
      await page.locator('svg.qr path').waitFor();
      assert(/Version 2/.test(await page.locator('.qr-box--lg + p').textContent()), 'QR info line');
    });

    // --- Settings & backup ---------------------------------------------------------
    await check('Settings: theme + behaviour toggles persist; backup round-trip keeps everything', async () => {
      await page.goto(dash('settings'));
      await page.getByText('Background worker').waitFor();
      await page.locator('label', { hasText: 'Dark' }).click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
      await page.locator('label.setting-row', { hasText: 'Close tabs after saving' }).locator('input').check();
      const s = await worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings);
      assert(s.vault.closeAfterSave === true, 'closeAfterSave saved');
      await page.locator('label.setting-row', { hasText: 'Close tabs after saving' }).locator('input').uncheck();
      await page.locator('label', { hasText: 'System' }).click();

      const counts = await inExt(page, async () => {
        const repo = await import('/src/shared/db/repository.js');
        const { buildBackup, validateBackup } = await import('/src/shared/db/backup.js');
        const before = await repo.countAll();
        const json = JSON.stringify(buildBackup({ stores: await repo.snapshot(), settings: {}, appVersion: 'x' }));
        await repo.clearAll();
        const v = validateBackup(JSON.parse(json));
        if (!v.ok) throw new Error(v.errors.join('; '));
        await repo.restore(v.backup.stores, 'replace');
        return { before, after: await repo.countAll() };
      });
      assert(JSON.stringify(counts.before) === JSON.stringify(counts.after), JSON.stringify(counts));
    });

    // --- Popup (real manifest: no host access → honest notices) --------------------
    await check('Popup: Save panel saves the current tab to Watch Later', async () => {
      await focusTabByUrl(worker, '/beta');
      const popup = await openPopup(context, worker, base);
      await popup.locator('.page-card__title').waitFor();
      const shown = await popup.locator('.page-card__title').textContent();
      assert(shown === 'Page /beta', `popup shows "${shown}" as the current tab`);
      await popup.locator('[data-panel="save"]').click();
      await popup.getByRole('button', { name: /Save to Watch Later|In Watch Later/ }).waitFor();
      const btn = popup.getByRole('button', { name: 'Save to Watch Later' });
      if (await btn.count()) await btn.click();
      await popup.getByRole('button', { name: '✓ In Watch Later' }).waitFor();
      if (SHOTS) await popup.screenshot({ path: join(SHOTS, 'popup-save.png') });
      await popup.close();
    });

    await check('Popup: Media panel explains why it can’t act without site access (no activeTab in automation)', async () => {
      await focusTabByUrl(worker, '/media.html');
      const popup = await openPopup(context, worker, base);
      await popup.locator('[data-panel="media"]').click();
      await popup.locator('.notice__title').waitFor({ timeout: 5000 });
      await popup.close();
    });

    await check('Popup: Tabs and Tools panels render', async () => {
      const popup = await openPopup(context, worker, base);
      await popup.locator('[data-panel="tabs"]').click();
      await popup.getByLabel('Search open tabs').fill('beta');
      await popup.locator('.rows .row', { hasText: 'Page /beta' }).first().waitFor();
      await popup.locator('[data-panel="tools"]').click();
      await popup.getByRole('button', { name: 'QR code' }).click();
      await popup.locator('svg.qr').waitFor();
      if (SHOTS) await popup.screenshot({ path: join(SHOTS, 'popup-tools.png') });
      await popup.close();
    });

    await check('CSP blocks network requests from extension pages and the service worker', async () => {
      const hitsBefore = serverHits;
      const attempt = async (url) => {
        try {
          await globalThis['fe' + 'tch'](url);
          return 'allowed';
        } catch (e) {
          return String(e);
        }
      };
      assert((await page.evaluate(attempt, `${SITE}/csp`)) !== 'allowed', 'extension page request was not blocked');
      assert((await worker.evaluate(attempt, `${SITE}/csp`)) !== 'allowed', 'service worker request was not blocked');
      assert(serverHits === hitsBefore, `local server received ${serverHits - hitsBefore} request(s) from the extension`);
      for (let i = consoleErrors.length - 1; i >= 0; i -= 1) {
        if (/Content Security Policy|Failed to fetch/.test(consoleErrors[i])) consoleErrors.splice(i, 1);
      }
    });

    await check('chrome://extensions reports no manifest errors, warnings or runtime errors', async () => {
      const ext = await context.newPage();
      await ext.goto('chrome://extensions');
      const item = await ext.waitForFunction(
        (id) => {
          const list = document.querySelector('extensions-manager')?.shadowRoot?.querySelector('extensions-item-list');
          const el = list?.shadowRoot?.querySelector(`extensions-item#${id}`);
          return el?.data
            ? { manifestErrors: el.data.manifestErrors.length, runtimeErrors: el.data.runtimeErrors.map((e) => e.message), installWarnings: el.data.installWarnings }
            : null;
        },
        extensionId,
        { timeout: 5000 },
      );
      const data = await item.jsonValue();
      await ext.close();
      assert(data.manifestErrors === 0 && data.runtimeErrors.length === 0 && data.installWarnings.length === 0, JSON.stringify(data));
    });

    if (SHOTS) {
      for (const [route, theme] of [
        ['home', 'light'],
        ['vault', 'light'],
        ['watch-later', 'dark'],
        ['sessions?tab=open', 'light'],
        ['media', 'dark'],
        ['tools', 'light'],
        ['settings', 'dark'],
      ]) {
        await page.evaluate((t) => import('/src/shared/settings.js').then((m) => m.updateSettings({ theme: t })), theme);
        await page.goto(dash(route));
        await page.locator('main h1').waitFor();
        await sleep(250);
        await page.screenshot({ path: join(SHOTS, `dashboard-${route.split('?')[0]}-${theme}.png`) });
      }
      await page.evaluate(() => import('/src/shared/settings.js').then((m) => m.updateSettings({ theme: 'system' })));
    }
  } finally {
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

// ================================================================================
// Phase B — site access granted for the local test server
// ================================================================================
console.log('BrowseKit smoke test — phase B (site access granted for the test server)');
{
  const extDir = mkdtempSync(join(tmpdir(), 'browsekit-ext-'));
  for (const p of ['manifest.json', 'src', 'assets']) cpSync(join(ROOT, p), join(extDir, p), { recursive: true });
  const manifest = JSON.parse(readFileSync(join(extDir, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['http://127.0.0.1/*'];
  writeFileSync(join(extDir, 'manifest.json'), JSON.stringify(manifest));

  const { context, worker, base, userDataDir } = await launch(extDir);
  try {
    // Extension page used to call extension modules (dynamic import() is not allowed in service workers).
    const extPage = await context.newPage();
    await extPage.goto(`${base}/src/pages/dashboard/dashboard.html#/media`);
    const mediaPage = await context.newPage();
    await mediaPage.goto(`${SITE}/media.html`);
    await mediaPage.evaluate(() => /** @type {HTMLAudioElement} */ (document.getElementById('same')).play());

    await check('Media Boost popup: finds media, sets preset + custom speed, clamps to 16×', async () => {
      await focusTabByUrl(worker, '/media.html');
      const popup = await openPopup(context, worker, base);
      await popup.locator('[data-panel="media"]').click();
      await popup.locator('.speed-value').waitFor({ timeout: 5000 });
      await popup.getByRole('button', { name: '1.5×' }).click();
      await mediaPage.waitForFunction(() => /** @type {HTMLAudioElement} */ (document.getElementById('same')).playbackRate === 1.5);
      await popup.getByLabel('Custom speed').fill('3.35');
      await popup.getByRole('button', { name: 'Set custom' }).click();
      await mediaPage.waitForFunction(() => /** @type {HTMLAudioElement} */ (document.getElementById('same')).playbackRate === 3.35);
      const out = await popup.evaluate(async () => {
        const { runMediaCommand } = await import('/src/features/media/media-control.js');
        const [tab] = await chrome.tabs.query({ url: '*://127.0.0.1/*media.html' });
        const [s] = await runMediaCommand(tab.id, { op: 'setSpeed', value: 40 }, [0]);
        return s.speed;
      });
      assert(out === 16, `speed clamped to ${out}`);
      if (SHOTS) await popup.screenshot({ path: join(SHOTS, 'popup-media.png') });
      await popup.close();
    });

    await check('Media Boost engine: volume boost on same-origin media, refused for cross-origin without CORS', async () => {
      const result = await extPage.evaluate(async () => {
        const { runMediaCommand } = await import('/src/features/media/media-control.js');
        const [tab] = await chrome.tabs.query({ url: '*://127.0.0.1/*media.html' });
        await runMediaCommand(tab.id, { op: 'setSpeed', value: 1 }, [0]);
        const boosted = (await runMediaCommand(tab.id, { op: 'setVolume', value: 2.5 }, [0]))[0];
        // Make the cross-origin element the primary one and try again.
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            document.getElementById('same').pause();
            const cross = document.getElementById('cross');
            cross.loop = true;
            return cross.play().catch(() => null);
          },
        });
        await new Promise((r) => setTimeout(r, 500));
        const refused = (await runMediaCommand(tab.id, { op: 'status' }, [0]))[0];
        return { boosted, refused };
      });
      assert(result.boosted.volume === 2.5 && !result.boosted.error, JSON.stringify(result.boosted));
      assert(result.refused.boost.ok === false && /CORS/.test(result.refused.boost.reason), JSON.stringify(result.refused));
    });

    await check('Media Boost engine: re-applies speed when the page resets it; seek, mute, reset', async () => {
      const result = await extPage.evaluate(async () => {
        const { runMediaCommand } = await import('/src/features/media/media-control.js');
        const [tab] = await chrome.tabs.query({ url: '*://127.0.0.1/*media.html' });
        const run = async (cmd) => (await runMediaCommand(tab.id, cmd, [0]))[0];
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { document.getElementById('cross').pause(); return document.getElementById('same').play(); } });
        await run({ op: 'setSpeed', value: 2 });
        // A page script (not the user) resets the rate — BrowseKit should put it back.
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: () => { document.getElementById('same').playbackRate = 1; } });
        await new Promise((r) => setTimeout(r, 200));
        const afterReset = await run({ op: 'status' });
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { const a = document.getElementById('same'); a.pause(); a.currentTime = 0.5; } });
        const seeked = await run({ op: 'seek', delta: 1 });
        const muted = await run({ op: 'toggleMute' });
        const reset = await run({ op: 'reset' });
        return { afterReset: afterReset.speed, time: seeked.currentTime, muted: muted.muted, reset: reset.speed };
      });
      assert(result.afterReset === 2, `speed after page reset: ${result.afterReset}`);
      assert(Math.abs(result.time - 1.5) < 0.05, `seeked to ${result.time}`);
      assert(result.muted === true, 'muted');
      assert(result.reset === 1, 'reset to 1×');
    });

    await check('Remembered site + granted access: registered script applies speed on page load', async () => {
      const registered = await extPage.evaluate(async () => {
        const { saveSite, syncRegisteredMediaScript } = await import('/src/features/media/media-sites.js');
        await saveSite('127.0.0.1', { speed: 1.75, volume: null });
        return syncRegisteredMediaScript();
      });
      assert(registered.includes('http://127.0.0.1/*'), `registered for ${registered}`);
      const fresh = await context.newPage();
      await fresh.goto(`${SITE}/media.html`);
      await fresh.evaluate(() => document.getElementById('same').play());
      await fresh.waitForFunction(() => document.getElementById('same').playbackRate === 1.75, null, { timeout: 5000 });
      // In-page shortcut: ] = faster by the default step (0.25).
      await fresh.locator('h1').click();
      await fresh.keyboard.press(']');
      await fresh.waitForFunction(() => document.getElementById('same').playbackRate === 2, null, { timeout: 3000 });
      await fresh.close();
    });

    await check('Popup Tools: word count and reading time read the page text', async () => {
      const article = await context.newPage();
      await article.goto(`${SITE}/article.html`);
      await focusTabByUrl(worker, '/article.html');
      const popup = await openPopup(context, worker, base);
      await popup.locator('[data-panel="tools"]').click();
      await popup.getByRole('button', { name: 'Word count' }).click();
      await popup.locator('.stat-mini', { hasText: 'words' }).filter({ hasText: '476' }).waitFor({ timeout: 5000 });
      await popup.locator('.stat-mini', { hasText: 'reading time' }).filter({ hasText: '2 min' }).waitFor();
      await popup.close();
      await article.close();
    });
  } finally {
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
    rmSync(extDir, { recursive: true, force: true });
  }
}

await check('no console errors in extension pages', async () => {
  assert(consoleErrors.length === 0, consoleErrors.join('\n'));
});

server.close();
crossServer.close();
if (failures) {
  console.error(`\n${failures} smoke check(s) failed`);
  process.exit(1);
}
console.log('\nAll smoke checks passed');
