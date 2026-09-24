# BrowseKit — Architecture

BrowseKit is a privacy-first Chrome extension (Manifest V3). Everything runs
inside the browser on the user's device. There is no server, no account, no
network API, no analytics and no remote code.

This document is the source of truth for *how* BrowseKit is built. `progress.md`
tracks *what* is built. `CLAUDE.md` holds the working rules for contributors.

---

## 1. Guiding constraints

| Constraint | How it is enforced |
| --- | --- |
| No backend / external API / AI API | No code performs network requests. `connect-src 'self'` in the extension-page CSP makes `fetch`/XHR/WebSocket to any other origin fail. `scripts/validate.mjs` fails the build if network primitives or `http(s)://` URLs appear in `src/`. |
| No remote JavaScript | MV3 already forbids it; our CSP is `script-src 'self'`. No CDN links, no `eval`, no `new Function`. Validated by `scripts/validate.mjs`. |
| No analytics / telemetry | No such code exists; validator bans `sendBeacon`, `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`. |
| No login / account | No identity APIs, no `identity` permission. |
| Data stays local | IndexedDB + `chrome.storage.local` only. **`chrome.storage.sync` is never used** (it would upload data to the user's Google account). Validator bans it. |
| Minimum permissions | Permissions are added only in the phase that needs them, and host access is *optional* and requested per site at runtime (see §4). |
| Zero dependencies | Plain JavaScript ES modules, no bundler, no framework, no runtime npm packages. The repo folder *is* the unpacked extension. |

---

## 2. Folder structure

```
BrowseKit/
├── manifest.json                 # MV3 manifest (extension root = repo root)
├── assets/icons/                 # icon16/32/48/128.png (generated, committed)
├── src/
│   ├── background/
│   │   ├── service-worker.js     # entry: registers every listener synchronously
│   │   ├── lifecycle.js          # onInstalled: settings, DB migrations, menus, media script sync
│   │   ├── handlers.js           # message-type → handler map (request/response API)
│   │   ├── menus.js              # right-click entries (Watch Later, TabVault)
│   │   ├── commands.js           # keyboard commands (Watch Later, TabVault, Media Boost)
│   │   └── badge.js              # short toolbar-badge feedback
│   ├── content/
│   │   └── media-boost.js        # classic, idempotent media controller (isolated world)
│   ├── features/                 # domain logic per feature, on top of shared/db
│   │   ├── vault/                # vault-model.js (pure), vault.js (IDB), save.js (flow)
│   │   ├── watch-later/          # watch-later.js
│   │   ├── tab-manager/          # tab-model.js (pure: duplicates, search)
│   │   ├── sessions/             # sessions.js
│   │   ├── media/                # media-control.js (inject/run), media-sites.js (prefs + access)
│   │   └── tools/                # page-tools.js (page text, print, screenshot)
│   ├── pages/
│   │   ├── dashboard/            # full-tab app (also the options page)
│   │   │   ├── dashboard.html/.css/.js   # shell + hash router
│   │   │   └── views/            # home, vault, watch-later, media, sessions, tools, settings
│   │   └── popup/                # toolbar popup: Save · Media · Tabs · Tools panels
│   ├── shared/                   # code usable by SW + pages (never by content scripts)
│   │   ├── constants.js          # app name, routes, message types
│   │   ├── messages.js           # request/response envelope + router factory
│   │   ├── settings.js           # chrome.storage.local settings with defaults
│   │   ├── theme.js              # dark/light/system theme application
│   │   ├── dom.js                # tiny safe DOM builder (no innerHTML)
│   │   ├── ui.js                 # <dialog> confirm/prompt/select, empty states, favicons
│   │   ├── tabs.js               # collect/open/focus tabs (never tab groups)
│   │   ├── urls.js               # saveability, duplicate keys, tracking-param cleaner (pure)
│   │   ├── text-stats.js         # word/char counts, reading time (pure)
│   │   ├── qr.js / qr-view.js    # offline QR encoder (pure) + SVG/PNG rendering
│   │   ├── files.js              # blob: downloads, file reading
│   │   ├── format.js             # date/number/byte formatting helpers
│   │   └── db/
│   │       ├── schema.js         # DB name, version, store names, migrations
│   │       ├── database.js       # open/upgrade, transactions, change broadcast
│   │       ├── repository.js     # generic CRUD over stores
│   │       └── backup.js         # backup format build + validation (pure)
│   └── styles/
│       ├── tokens.css            # colour/spacing tokens, light + dark
│       └── components.css        # buttons, cards, inputs shared by pages
├── scripts/
│   ├── validate.mjs              # static policy checks (manifest, CSP, banned APIs)
│   ├── generate-icons.mjs        # dependency-free PNG icon generator
│   └── smoke.mjs                 # loads the extension in Chromium and exercises it
└── tests/                        # node:test unit tests for pure modules
```

Why no build step: MV3 extension pages and the service worker support native ES
modules, so a bundler adds nothing but a dependency tree. Content scripts cannot
be ES modules, so they are written as self-contained classic scripts.

---

## 3. Storage architecture

Two stores, chosen by data shape:

### 3.1 IndexedDB — database `browsekit` (main data)

Opened from the extension origin (`chrome-extension://<id>`), so the service
worker, dashboard and popup all share one database. Content scripts run in the
*page's* origin and **cannot** reach it — they talk to the service worker by
message instead.

Schema v2 (`src/shared/db/schema.js`; v2 added `snoozed`, plus optional
fields `vaultTabs.note/tags`, `collections.starred`, `sessions.kind`):

| Store | keyPath | Indexes | Record |
| --- | --- | --- | --- |
| `collections` | `id` | `sortOrder`, `updatedAt` | `{ id, name, color, sortOrder, createdAt, updatedAt }` |
| `vaultTabs` | `id` | `collectionId`, `url`, `byCollectionOrder` = `[collectionId, sortOrder]` | `{ id, collectionId, url, title, sortOrder, createdAt, updatedAt }` |
| `watchLater` | `id` | `url`, `addedAt`, `watched` | `{ id, url, title, watched: 0\|1, addedAt, watchedAt }` |
| `snoozed` (v2) | `id` | `wakeAt` | `{ id, url, title, wakeAt, createdAt }` |
| `sessions` | `id` | `createdAt` | `{ id, name, createdAt, windows: [{ tabs: [{ url, title, pinned }] }] }` |
| `meta` | `key` | — | `{ key, value }` (install date, last backup, etc.) |

Notes:
- IDs are `crypto.randomUUID()`.
- Booleans that must be indexed are stored as `0|1` (IndexedDB cannot index booleans).
- Favicons are **not** stored and remote favicon URLs are **never** loaded
  (that would leak browsing to third parties). Pages will use Chrome's local
  favicon cache via `chrome-extension://<id>/_favicon/?pageUrl=…` once the
  `favicon` permission is added with TabVault.
- Migrations are a map `version → fn(db, tx)`, applied in order inside
  `onupgradeneeded`. Other open contexts close their connection on
  `versionchange` so upgrades are never blocked for long.
- Every write broadcasts `{ store, op }` on `BroadcastChannel('browsekit:db')`
  so open dashboards/popups refresh live.

### 3.2 `chrome.storage.local` — lightweight settings

- Key `settings`: one object, deep-merged with `DEFAULT_SETTINGS` on read, so
  new settings get defaults without migrations. Includes `theme`.
- Key `media.sites`: per-site `{ speed, volume, updatedAt }` (volume is a
  multiplier, >1 = boost).
  Kept here, not in IndexedDB, because **content scripts can read
  `chrome.storage.local` directly** at page load without waking the service
  worker, and the data is small.
- `chrome.storage.onChanged` propagates setting changes to every context
  (e.g. switching theme in Settings re-themes an open popup instantly).

### 3.3 Backup format

Export produces a JSON file generated in the page and downloaded via a `blob:`
URL (no `downloads` permission needed):

```json
{ "format": "browsekit-backup", "formatVersion": 1, "schemaVersion": 1,
  "exportedAt": "…ISO…", "appVersion": "0.1.0",
  "stores": { "collections": [], "vaultTabs": [], "watchLater": [], "sessions": [], "meta": [] },
  "settings": { … }, "mediaSites": { … } }
```

Import validates the whole file before writing anything (`backup.js`, pure and
unit-tested), then writes in one transaction per mode: **merge** (upsert by id)
or **replace** (clear then write). Unknown stores are rejected.

---

## 4. Permissions

Principle: request a permission only in the phase that uses it; prefer
`activeTab` (granted by a user gesture, no install warning) over host access;
make host access *optional* and per-site.

| Permission | Phase | Why | Install warning |
| --- | --- | --- | --- |
| `storage` | Foundation ✅ | Settings in `chrome.storage.local` | none |
| `tabs` | TabVault / Tab Manager ✅ | Read URL + title of *all* tabs (save window / all windows, search open tabs, duplicates). `activeTab` only covers the current tab. | "Read your browsing history" — unavoidable for these features |
| `favicon` | TabVault ✅ | Show favicons from Chrome's local cache instead of fetching remote icons | none |
| `contextMenus` | Watch Later ✅ | Right-click "Save to Watch Later" | none |
| `activeTab` | Watch Later / Media / Tools ✅ | Temporary access to the current tab after a click, shortcut or context-menu action | none |
| `scripting` | Media Boost / Tools ✅ | Inject content scripts on demand (activeTab) and register per-site scripts | none by itself |
| `alarms` | v0.3 ✅ | One-minute tick for snooze wake-ups, idle-tab handling and session autosave | none |
| `sidePanel` | v0.3 ✅ | Optional side-panel view of the popup tools | none |
| `sessions` | Tab Manager ✅ | Recently closed tabs/windows (`chrome.sessions`) | combined with tabs |
| `optional_host_permissions: ["https://*/*", "http://*/*"]` | Media Boost ✅ | Requested **per origin at runtime** only when the user turns on automatic apply for a remembered site. Never granted at install. | shown only when user opts in |

Explicitly **not** requested: `<all_urls>` at install, `tabGroups`, `history`,
`bookmarks`, `downloads`, `identity`, `webRequest`, `declarativeNetRequest`,
`clipboardRead`, `unlimitedStorage` (add only if real users hit quota).

Clipboard writes happen in the popup/dashboard via `navigator.clipboard` during
a user click, which needs no permission. Keyboard shortcuts (`commands` manifest
key) need no permission and grant `activeTab` when pressed.

### Content Security Policy (extension pages + service worker)

```
default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none';
form-action 'none'; frame-src 'none'; connect-src 'self';
img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self'; font-src 'self'
```

Consequences for code: no inline `<script>`, no inline `style=""` attributes or
`<style>` blocks (use classes or `element.style.x = …` from JS), no remote images.

---

## 5. Service-worker architecture

File: `src/background/service-worker.js` (`"type": "module"`).

- **All listeners are registered synchronously at top level.** MV3 service
  workers are terminated after ~30 s idle and restarted on the next event; a
  listener registered after an `await` would be missed on restart.
- **No in-memory state is trusted.** Anything that must survive lives in
  IndexedDB or `chrome.storage`. Module-level caches (e.g. the DB connection
  promise) are only optimisations and are rebuilt transparently.
- **Lifecycle** (`lifecycle.js`): on install/update → write merged default
  settings, open the DB (runs migrations), record install/update time in
  `meta`, open the dashboard welcome page on first install. Later phases also
  (re)create context menus here, because `contextMenus.create` must run on
  install/update, not on every wake.
- **Message API** (`messages.js` + `handlers.js`): request/response envelope

  ```
  request:  { type: "domain/action", payload }
  response: { ok: true, data } | { ok: false, error: { code, message } }
  ```

  `createRouter(handlers)` returns the `onMessage` listener; it rejects
  messages whose `sender.id` is not this extension, returns `true` to keep the
  channel open for async handlers, and serialises errors. Pages call
  `send(type, payload)` which throws on `ok: false`.
- **Who does DB work?** Extension pages (dashboard, popup) use the repository
  directly — same origin, no SW round-trip. The service worker uses the same
  repository for events that have no page: context-menu clicks, keyboard
  commands, and requests from content scripts.
- Other listeners: `contextMenus.onClicked` (Watch Later / TabVault),
  `commands.onCommand` (Watch Later, TabVault, Media Boost), and
  `permissions.onAdded/onRemoved`, which keep the registered media content
  script's `matches` equal to the granted origins.
- Feedback for actions without a page (menu, shortcut) is a 2-second toolbar
  badge: ✓ saved, ↻ already saved, ✕ failed, or the new speed.

---

## 6. Content-script architecture

Content scripts are used **only** where page interaction is unavoidable:
media elements (Media Boost) and page text (word count / reading time).
Everything else — copying URL/title, cleaning URLs, QR codes, saving tabs —
is done from extension pages using tab metadata.

- **Injection on demand (default).** `chrome.scripting.executeScript` into the
  active tab after a user gesture (popup click, context menu, keyboard
  command), which grants `activeTab`. No host permission, no install warning.
- **Persistent per-site injection (opt-in).** When the user turns on
  "Remember on this site", we `chrome.permissions.request` that origin, then
  `chrome.scripting.registerContentScripts` with `matches` limited to granted
  origins and `persistAcrossSessions: true`. Revoking the permission
  unregisters the script.
- **Classic scripts, idempotent.** Each script guards with a
  `window.__browsekit*` flag so repeated injection is harmless, and runs in
  Chrome's isolated world (page JS cannot see our variables).
- **Communication:** the extension calls
  `executeScript({ func: cmd => __browsekitMedia.run(cmd) })` and reads the
  returned status per frame. Status comes back from every frame; commands then
  go to the chosen frame only (playing media first, else the top frame).
  Content scripts never touch IndexedDB (different origin); per-site settings
  come from `chrome.storage.local`.
- **Where scripts cannot run** (surfaced to the user, never hidden):
  `chrome://`, `chrome-extension://` of other extensions, the Chrome Web Store,
  `view-source:`, the PDF viewer, and other browser-internal pages. `file://`
  URLs only if the user enables "Allow access to file URLs".

---

## 7. Media-control architecture (Media Boost)

`src/content/media-boost.js` (classic script) + popup controls.

- **Discovery:** `querySelectorAll('video, audio')` plus traversal of *open*
  shadow roots, kept current by a `MutationObserver`. The "target" element is
  the one currently playing, else the largest visible video.
- **Speed:** `HTMLMediaElement.playbackRate`, clamped to **0.25–16** (Chrome's
  supported range is 0.0625–16; values outside throw). Any custom value in range
  is allowed, e.g. 1.37×. `preservesPitch` stays on. Some sites reset the rate
  (e.g. on ad/quality change); we listen for `ratechange` and re-apply the
  user's choice with a loop guard.
- **Volume 0–100 %:** `element.volume` / `element.muted`.
- **Volume boost > 100 %:** Web Audio `createMediaElementSource → GainNode →
  destination`. Honest limits, shown in the UI:
  - Cross-origin media without CORS headers outputs **silence** through Web
    Audio. Boost is only enabled when the source is same-origin, `blob:`/
    MediaSource (most streaming players), or has `crossOrigin` set; otherwise
    the control is disabled with an explanation.
  - DRM/EME-protected media (e.g. Netflix) cannot be boosted.
  - Once an element is routed through Web Audio it stays routed until reload;
    gain 1.0 = normal.
  - `AudioContext` may start suspended under the autoplay policy until the user
    interacts with the page.
- **Seek:** `currentTime` ± configurable step; not possible on live streams
  without a seekable range (checked via `element.seekable`).
- **Per-site memory:** `chrome.storage.local['media.sites'][hostname]`, applied
  at load only on sites where the user granted persistent access.
- **Keyboard shortcuts:** two layers.
  1. `commands` (manifest) — work on any page that allows injection; Chrome
     limits an extension to 4 suggested shortcuts, users can rebind in
     `chrome://extensions/shortcuts`.
  2. In-page keys (`[`/`]` speed, `\` reset) — active wherever the script is
     running (after using the popup/shortcut on that page, or automatically on
     sites with granted access); ignored while typing in inputs/contenteditable.
- **Site vs user speed changes:** a `ratechange` within 1 s of a real user
  input is treated as the user using the site's own controls and adopted; other
  resets are re-applied, and BrowseKit backs off after 30 fights in 5 s.
- **Not reachable:** media inside cross-origin iframes unless that iframe's
  origin is also granted; closed shadow roots; media rendered by plugins/canvas.

---

## 8. How TabVault differs from Chrome tab groups

| | Chrome tab groups | BrowseKit TabVault collections |
| --- | --- | --- |
| What it is | Live browser UI grouping of *open* tabs in one window | Saved records (URL + title) in BrowseKit's own IndexedDB |
| Lifetime | Tabs close → group is gone (unless saved to Chrome's own tab-group sync) | Persist until the user deletes them; tabs need not be open |
| API | `chrome.tabGroups` | Never used — BrowseKit does **not** request `tabGroups` |
| Storage / sync | Managed by Chrome, may sync via Google account | Local only, exported/imported as a JSON file by the user |
| Opening | Already open | One click opens every saved URL as ordinary tabs (current window or a new window) — no group is created |
| Organisation | Colour + title in the tab strip | Named collections, reorder, move tabs between collections, search across all |

---

## 9. How BrowseKit stays completely local

1. No code path performs a network request; CSP `connect-src 'self'` blocks
   any attempt from extension pages and the service worker.
2. No remote scripts, fonts, images or stylesheets; all assets ship in the
   package.
3. Data lives in IndexedDB and `chrome.storage.local` — both on-device.
   `chrome.storage.sync` is banned.
4. Favicons come from Chrome's local favicon cache, not from websites.
5. QR codes are generated by a bundled encoder; screenshots use
   `chrome.tabs.captureVisibleTab`; exports are `blob:` downloads.
6. `scripts/validate.mjs` enforces all of the above in CI/pre-commit.

The only network activity a user can observe is what they themselves trigger by
opening saved URLs — i.e. normal browsing.

---

## 10. Implementation plan

| Phase | Scope | New permissions |
| --- | --- | --- |
| **0 Foundation** ✅ | Manifest, SW + router, IndexedDB layer + migrations, settings, theme, dashboard shell with all sections, popup shell, backup export/import, validator, unit tests, Chromium smoke test | `storage` |
| 1 TabVault ✅ | Collections CRUD, save tab/window/all windows, open collection, search, rename/move/delete tabs, drag reorder, import/export (BrowseKit JSON + plain URL list) | `tabs`, `favicon` |
| 2 Watch Later ✅ | Save page (popup + context menu + shortcut), list, search, watched toggle, open / open-and-remove / open all | `contextMenus`, `activeTab` |
| 3 Tab Manager & Sessions ✅ | Search open tabs across windows, switch to tab, duplicate detection + close, recently closed, save/restore sessions | `sessions` |
| 4 Quick Tools ✅ | Copy URL/title/both, clean tracking params (local rule list), word/char count + reading time (selection or page), local QR encoder, screenshot visible area, print | `scripting` |
| 5 Media Boost ✅ | Content script, popup controls, custom speed, volume/boost, mute, seek, per-site memory with optional host permissions, commands + in-page keys | optional hosts |
| 6 Polish | Accessibility pass, keyboard navigation, i18n (`_locales`), large-data performance, packaging script, store listing/privacy policy text | — |


---

## 11. v0.3 additions

- **One alarm drives scheduled work** (`src/background/tick.js`): a
  one-minute `bk-tick` alarm wakes the worker; each step is idempotent and
  reads state from storage — snooze wake-ups (`snoozed` store), auto-close
  idle tabs into the "Auto-closed tabs" collection, auto-suspend
  (`chrome.tabs.discard`, using Chrome's `tab.lastAccessed`, Chrome 121+),
  and session autosave (skipped when the window/tab fingerprint is unchanged).
  Missed ticks (browser closed) simply catch up on the next one.
- **Search everything** (`src/features/search/search-model.js` pure ranking;
  `src/pages/palette/palette-ui.js` UI) is shared by the popup search box,
  the side panel, the dashboard's Ctrl+K dialog and a standalone palette
  window opened by the `open-palette` command.
- **Side panel** (`src/pages/sidepanel/sidepanel.html`) reuses the popup UI
  with `data-mode="sidepanel"` and follows tab switches. Settings can make the
  toolbar button open the side panel (`chrome.sidePanel.setPanelBehavior` +
  empty popup), applied by `src/background/action.js`.
- **Reader view** (`src/features/tools/reader.js`) extracts text blocks in
  the page on demand, stores them in `chrome.storage.session` (memory only)
  and renders them as text in `src/pages/reader/`. No images or embeds are
  loaded.
- **Media Boost** also keeps resume positions (`media.positions` in
  `chrome.storage.local`, media ≥ 2 min, capped at 300 pages), A–B loops,
  picture-in-picture and a local "time saved" counter (`stats`).
- **Encrypted backups** (`src/shared/crypto-backup.js`): PBKDF2-SHA-256
  (310k iterations) → AES-256-GCM via WebCrypto; the password is never stored.
- **Policies** are listed live by `npm run policies` (see `docs/POLICIES.md`);
  `npm run package` builds the Web Store zip after validation.
