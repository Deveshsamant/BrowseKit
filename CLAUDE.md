# CLAUDE.md — BrowseKit

BrowseKit is a privacy-first Chrome extension (Manifest V3): TabVault, Watch
Later, Media Boost, Tab Manager, Quick Tools and a Dashboard. Read
`architecture.md` before changing structure; update `progress.md` when a phase
or task lands.

## Non-negotiable rules

1. **Local only.** No backend, external API, AI API, analytics, telemetry,
   login, or remote JavaScript/CSS/fonts/images. No `fetch`/XHR/WebSocket/
   `sendBeacon` to anything. Never use `chrome.storage.sync`.
2. **Minimum permissions.** Add a permission only in the phase that needs it,
   document why in `architecture.md` §4, and prefer `activeTab` + on-demand
   `scripting` over host permissions. Host access is optional and per-site.
3. **No dependencies** at runtime, and no build step. Plain ES modules. Dev
   tooling uses Node built-ins only (`node:test`, `zlib`, …). Playwright used
   by `scripts/smoke.mjs` is resolved from the environment, not installed.
4. **Be honest about limits.** If Chrome or a site prevents something
   (chrome:// pages, cross-origin media boost, DRM, closed shadow DOM…), the UI
   must say so. Never claim universal support.
5. **TabVault collections are not Chrome tab groups.** Never use
   `chrome.tabGroups`.

## Commands

```bash
npm run check      # validate + unit tests (run before every commit)
npm run validate   # static policy checks: manifest, CSP, banned APIs, file refs
npm test           # node:test unit tests in tests/
npm run smoke      # load the unpacked extension in Chromium and exercise every feature
                   # (phase B uses a temp copy with test-server host access, because
                   #  automation can't grant activeTab or accept permission prompts)
npm run icons      # regenerate assets/icons/*.png
npm run policies   # list every policy (permissions, CSP, banned APIs); -- --write updates docs/POLICIES.md
npm run package    # validate, then build dist/browsekit-<version>.zip
```

Load in Chrome: `chrome://extensions` → Developer mode → Load unpacked → repo root.

## Code conventions

- Service worker: register every `chrome.*` listener synchronously at top level
  in `src/background/service-worker.js`; keep no state that must survive in
  module variables.
- Messaging: `{ type: 'domain/action', payload }` → `{ ok, data | error }`.
  Add handlers to `src/background/handlers.js`, type names to
  `src/shared/constants.js` (`MSG`).
- Extension pages access IndexedDB directly via `src/shared/db/repository.js`.
  Content scripts never touch IndexedDB (different origin) — they message the SW
  or read `chrome.storage.local`.
- Schema changes: bump `DB_VERSION` and add a migration in
  `src/shared/db/schema.js`; never edit an existing migration.
- Scheduled work goes into `src/background/tick.js` (one alarm, idempotent
  steps) — never add setInterval-based timers to the service worker.
- New permissions also need a reason in `WHY` (`scripts/policies.mjs`) and
  `PRIVACY.md`; run `npm run policies -- --write`.
- Settings: add defaults to `DEFAULT_SETTINGS` and validation to
  `normalizeSettings` in `src/shared/settings.js`.
- Put pure logic in `*-model.js` / shared modules and unit-test it; keep
  chrome.*/IndexedDB calls in thin feature modules.
- Use `confirmDialog`/`promptDialog`/`selectDialog` from `src/shared/ui.js`,
  never `window.confirm/prompt`. Favicons only via `favicon()` (Chrome's cache).
- Keep literal remote URLs out of `src/` (the validator fails on them); build
  permission patterns from parts (see `httpsPatternForHost`).
- DOM: build with `h()` from `src/shared/dom.js`. **Never** assign untrusted
  strings (page titles, URLs, imported data) to `innerHTML`.
- CSP forbids inline scripts, inline `style=""`, `<style>` blocks and remote
  assets. Use CSS classes and tokens from `src/styles/tokens.css`.
- Content scripts are classic scripts, idempotent (guard flag), self-contained.
- Match existing style: 2-space indent, single quotes, semicolons, JSDoc on
  exported functions.
