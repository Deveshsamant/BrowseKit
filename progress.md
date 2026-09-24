# BrowseKit — Progress

Status legend: ✅ done · 🟡 partial · ⬜ not started

**Current version: 0.3.0.** Verified by:
- `npm run check`: policy validator plus 75 unit tests.
- `npm run smoke`: 41 end-to-end checks in real Chromium, run in two phases (see "Testing").

## Phase 0 — Foundation ✅

The manifest, service worker, message router, IndexedDB schema v1, settings, theme, dashboard shell, backup export/import, validator, and the icon generator. See `architecture.md`.

## Phase 1 — TabVault ✅

| Feature | Status | Notes |
| --- | --- | --- |
| Collections stored only in BrowseKit (not Chrome tab groups) | ✅ | Never calls `chrome.tabGroups`. The smoke test checks that opened tabs have `groupId === -1`. |
| Save current tab / current window / all windows | ✅ | From the popup (into a chosen or new collection), the dashboard, the right-click menu (current tab), or a shortcut (current tab, last-used collection). Skips new-tab, blank, script/data and BrowseKit pages. |
| Duplicate handling | ✅ | Optionally skips URLs already in the collection. Ignores `#fragment` and trailing slash. |
| Close tabs after saving (optional) | ✅ | Opens TabVault first if saving would close the last tab in the window. |
| Open a collection with one click | ✅ | In the current window or a new window (Settings). Asks for confirmation above 20 tabs. Reports URLs Chrome refuses to open. |
| Search saved tabs | ✅ | Matches title and URL across all collections; every word must match. Press `/` to focus. |
| Rename / move / delete tabs | ✅ | Edit title and URL; move via a dialog or by dragging onto a collection; select several for bulk move/open/delete. |
| Reorder | ✅ | Drag and drop, or Alt+↑/↓ from the keyboard. Collections can be reordered by drag. |
| Collection colour, rename, delete | ✅ | Deleting a collection removes its tabs in the same transaction. |
| Import / export | ✅ | Export: BrowseKit JSON or a plain URL list. Import: BrowseKit JSON, a full BrowseKit backup, OneTab exports, or plain URL lists with `# headings`. Import creates new collections and never overwrites. |
| Favicons | ✅ | Read from Chrome's local favicon cache (`favicon` permission). Never fetched from websites. |

## Phase 2 — Watch Later ✅

| Feature | Status | Notes |
| --- | --- | --- |
| Save current page | ✅ | Popup, Alt+Shift+W. Saving a page that's already queued moves it back to the top instead of duplicating it. |
| Save from right-click menu | ✅ | "Save page to Watch Later" and "Save link to Watch Later". Feedback via the toolbar badge. |
| Search, filter | ✅ | Filter by to watch / watched / all. |
| Mark watched / unwatched | ✅ | Checkbox. Optional auto-mark when opened. "Clear watched" removes watched items. |
| Open, open & remove, open all | ✅ | "Open all" applies to the current filter and search, with confirmation above 10. |

## Phase 3 — Tab Manager & Sessions ✅

| Feature | Status | Notes |
| --- | --- | --- |
| Search open tabs (all windows) | ✅ | Dashboard (grouped by window, live updates) and popup (Enter jumps to the first match). |
| Duplicate detection + close | ✅ | Keeps the active tab, else a pinned one, else the left-most. Never closes pinned tabs. |
| Recently closed tabs/windows | ✅ | From `chrome.sessions`, which keeps at most 25. Restore works for tabs and whole windows. |
| Save / restore sessions | ✅ | A snapshot of every window, including pinned state. Restore opens one new window per saved window. Sessions can be renamed or deleted. |
| Multiple windows | ✅ | Across saving, searching, duplicates and restore. |

## Phase 4 — Quick Tools ✅

| Feature | Status | Notes |
| --- | --- | --- |
| Copy URL / title / title + URL / Markdown link | ✅ | Popup, via `navigator.clipboard`. |
| Clean tracking parameters | ✅ | Removes a conservative, known list (global plus site rules for YouTube, Amazon, X, LinkedIn…). Parameters it keeps are left byte-for-byte unchanged. Available in the popup, as a batch cleaner in the dashboard, and optionally on save. |
| Word / character count, reading time | ✅ | Uses the selection, or the whole page's text otherwise. Counting is language-aware (`Intl.Segmenter`). Reading time uses 238 words per minute. |
| QR generator | ✅ | Built-in encoder (versions 1–40, error-correction levels L/M/Q/H). Cross-checked against OpenCV's decoder: 34 of 34 codes decoded. Export as PNG or SVG, or copy. |
| Screenshot | ✅ | Visible area only, via `captureVisibleTab`. Save as PNG or copy. |
| Print / Save as PDF | ✅ | Opens the page's print dialog. |

## Phase 5 — Media Boost ✅

| Feature | Status | Notes |
| --- | --- | --- |
| HTML5 video/audio controls | ✅ | Finds `<video>`/`<audio>`, including inside open shadow roots and same-access iframes. |
| Speed 0.25×–16×, any custom value | ✅ | Presets, −/+ step, and a custom input; values are clamped to the range. Re-applied when a page script resets it. A change made with the site's own controls is adopted. BrowseKit stops fighting a player that keeps overriding it. |
| Volume, mute, seek, play/pause, reset | ✅ | Seek respects live-stream seekable ranges. |
| Volume boost (to 600%) | ✅ where supported | Uses Web Audio gain. Refused, with the reason shown, for cross-origin media without CORS (Chrome would output silence) and for DRM media. Also refused while the autoplay policy blocks audio processing. |
| Remember per site | ✅ | Stores speed and volume per host. Optional per-site automatic access (runtime permission plus a registered content script) applies them on page load. |
| Keyboard shortcuts | ✅ | Chrome commands: speed up/down (Alt+Shift+. / ,), plus reset, play, mute and seek (no default keys; Chrome allows at most 4 suggested). In-page keys: `[` slower, `]` faster, `\` reset. |
| On-page indicator | ✅ | Optional. Uses a closed shadow DOM so the page's CSS can't affect it. |

## Phase 6 — Dashboard polish 🟡

| Item | Status | Notes |
| --- | --- | --- |
| Home overview | ✅ | Stats, Up next, Recent collections, open-tab health, quick actions, first-install welcome. |
| All sections functional | ✅ | Home, TabVault, Watch Later, Media Boost, Sessions, Tools, Settings. |
| Dark/light/system theme | ✅ | Live across the dashboard and popup. |
| Accessible dialogs, empty states, toasts | ✅ | Native `<dialog>` replaces `confirm`/`prompt`. `aria-live` status. |
| Keyboard | ✅ | `/` focuses search. Alt+↑/↓ reorders. Arrow keys move between popup tabs. |
| Responsive | ✅ | Sidebar collapses under 720px; TabVault stacks under 900px. |
| i18n (`_locales`) | ⬜ | Strings are English and inline. |
| Performance with very large vaults (10k+ tabs) | ⬜ | Views re-render whole lists; needs virtualisation if users hit it. |
| Packaging script / store listing / privacy policy text | ⬜ | |

## v0.3 — 20 growth features ✅

Picked from what users praise most in OneTab, Session Buddy, Workona, Tab Wrangler and Video Speed Controller, plus gaps reviewers keep citing (search, snapshots, automation). All local.

| # | Feature | Status | Notes / honest limits |
| --- | --- | --- | --- |
| 1 | Side panel mode | ✅ | Same tools as the popup, follows tab switches. Setting: toolbar button opens popup or side panel. Media/page tools in the side panel still need activeTab or site access. |
| 2 | Search everything | ✅ | Popup search box, side panel, dashboard Ctrl+K, and a global "Search everything" command (no default key). Covers open tabs, TabVault (incl. #tags and notes), Watch Later, sessions, snoozed tabs and 20 actions. |
| 3 | Tab snooze | ✅ | 6 presets + custom time. Reopened by the alarm tick; if the browser was closed at wake time, the tab opens shortly after start-up. |
| 4 | Auto-suspend idle tabs | ✅ | Off by default. Never touches active, pinned or audible tabs, or protected sites. Discarded tabs reload when opened, and unsaved form input may be lost (the UI says so). |
| 5 | Auto-close idle tabs | ✅ | Off by default. Closed tabs go to the "Auto-closed tabs" collection. Never empties a window. |
| 6 | Session autosave | ✅ | Every 30 min by default, only when something changed; keeps the last 10. |
| 7 | Workspaces | ✅ | "Switch" opens a session and closes everything else, after autosaving the current state. |
| 8 | Tidy tabs | ✅ | Sort by site (pinned tabs stay first), merge windows, free memory, close duplicates. |
| 9 | Tags & notes | ✅ | Edit dialog; `#tag` search; tag cloud; kept in JSON export/import. |
| 10 | Starred collections & sorting | ✅ | Starred collections stay on top. Sort by title, site, newest or oldest. |
| 11 | Bookmarks HTML | ✅ | Export (per collection or all) and import (any browser's bookmarks file, nested folders). |
| 12 | Reader view | ✅ | Text-only article view with font, width and sepia options. Results vary by site; images and embeds are left out. |
| 13 | Link extractor | ✅ | All links, or only those in the selection. Copy them or save to a new collection. |
| 14 | Developer & text tools | ✅ | JSON, Base64, URL, SHA hashes, UUID, passwords, case conversion, timestamps. |
| 15 | Encrypted backups | ✅ | AES-256-GCM with PBKDF2. The password is never stored and can't be recovered. |
| 16 | Backup reminder | ✅ | Home banner and popup banner after N days (30 by default); 0 turns it off. |
| 17 | Video resume position | ✅ | Media of 2+ minutes, on pages where Media Boost runs. Progress bars in Watch Later. Single-page apps that don't change the URL may not resume. |
| 18 | A–B loop + picture-in-picture | ✅ | PiP needs a recent click on the page, and sites can disable it; the error says so. |
| 19 | Insights | ✅ | Time saved by faster playback, tabs suspended, duplicates closed, auto-closed, snoozed. All counted locally. |
| 20 | Onboarding & personalisation | ✅ | Get-started checklist that completes itself, `?` shortcut sheet, 6 accent colours, compact density, greeting. |
| + | Release readiness | ✅ | `npm run package` (reproducible zip), `PRIVACY.md`, `docs/store-listing.md`, `README.md`, `docs/POLICIES.md` + `npm run policies`. |

New permissions: `alarms` and `sidePanel` (neither shows an install warning). Schema v2 adds a `snoozed` store. Minimum Chrome version is now 121, needed for `tab.lastAccessed`.

## Testing

- **Unit (node:test):** settings, messaging, backup, validator, URL cleaning and duplicates, text stats, QR (Reed–Solomon test vector, capacity table, structure), TabVault model (dedupe, search, import/export formats), open-tab duplicates, sessions, Watch Later filter, and frame selection.
- **Smoke phase A (real manifest):** install and permissions; every dashboard view; the TabVault flows (save, create, rename, move, delete, keyboard reorder, OneTab import, opening without tab groups); Watch Later flows; context menu and command registration; duplicates, recently closed and sessions; the Tools view; settings and backup round-trip; the popup Save, Tabs and Tools panels; CSP network blocking (checked against a local server); no `chrome://extensions` errors or warnings.
- **Smoke phase B (temporary copy that grants the test server as a host):** popup Media Boost (presets, custom speed, clamping); boost on same-origin media and refusal on cross-origin media; speed re-apply, seek, mute and reset; the registered script auto-applying a remembered site's speed plus the `]` key; popup word count and reading time.
- **v0.3 in smoke:** snooze wake-up via the alarm, autosave (including skip-when-unchanged), free memory and merge windows, Ctrl+K and palette window, tags/notes/star/#tag search, bookmarks HTML import, Watch Later progress, developer tools, accent colour, encrypted backup export → import with password, Get started + `?` sheet, side panel page, A–B loop, PiP (supported or an honest error), resume after reload plus time saved, reader view and link extraction.
- **Free memory in automation:** Playwright tears down the browser when a tab it controls is discarded. The smoke test therefore stubs only the final `chrome.tabs.discard` call; tab selection, exclusions and stats run for real.
- **Not automatable:**
  - The real `activeTab` grant, which comes from a user clicking the toolbar icon.
  - Accepting Chrome's permission prompt.
  - Actually clicking a context-menu entry or pressing a command shortcut.
  - Clipboard writes, the print dialog, and screenshots of a real window.

  These paths share code with the tested ones but were not exercised end to end.

## Next

1. Manual pass in desktop Chrome, covering the non-automatable paths above (toolbar-click `activeTab`, the permission prompt, context menu, shortcuts, clipboard, screenshot, print).
2. i18n via `_locales` and `chrome.i18n`.
3. List virtualisation for very large vaults and sessions.
4. Packaging script (zip) plus store listing and privacy policy text.
