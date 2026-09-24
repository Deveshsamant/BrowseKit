# BrowseKit Privacy Policy

_Last updated: 2026-09-24_

BrowseKit is a browser extension that works entirely on your device.

## What BrowseKit collects

**Nothing.** BrowseKit has no servers, no accounts, no analytics, no telemetry,
no advertising and no third-party services. It never sends your data anywhere.

## What BrowseKit stores (on your device only)

- Collections and saved tabs (TabVault), Watch Later items, saved sessions and
  autosaves, and snoozed tabs — in the browser's IndexedDB for the extension.
- Settings, per-site Media Boost preferences, video resume positions and local
  usage counters (for example "time saved") — in `chrome.storage.local`.
- Reader-view text you open — in memory (`chrome.storage.session`), cleared
  when the browser closes.

BrowseKit never uses `chrome.storage.sync`, so nothing is synced through your
Google account. Data is removed when you uninstall the extension or use
**Settings → Erase all data**. Backups are files you export yourself; they can
be password-encrypted (AES-256-GCM) and are never uploaded.

## Permissions and why

| Permission | Why |
| --- | --- |
| `tabs` | Read the URLs and titles of tabs you choose to save, search, snooze or de-duplicate. Chrome describes this as "Read your browsing history"; BrowseKit does not read or store your browser history. |
| `storage` | Keep your settings on this device. |
| `favicon` | Show site icons from Chrome's local cache instead of downloading them. |
| `contextMenus` | Right-click "Save to Watch Later" / "Save to TabVault". |
| `activeTab`, `scripting` | Act on the current page only after you click or press a shortcut (media controls, word count, reader view, link extraction). |
| `sessions` | Show and restore recently closed tabs. |
| `alarms` | Reopen snoozed tabs, autosave sessions and handle idle tabs on schedule. |
| `sidePanel` | Optional side-panel view. |
| Optional site access | Requested per site, only if you turn on automatic Media Boost for that site. You can revoke it any time. |

## Network activity

BrowseKit makes no network requests. Its Content Security Policy blocks
connections from extension pages. The only network activity is what you
trigger yourself by opening web pages.

## Contact

Questions or concerns: open an issue in the project repository.
