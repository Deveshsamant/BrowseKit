# BrowseKit

A privacy-first Chrome extension (Manifest V3): tab collections, search everything,
snooze, Watch Later, video speed & volume, reader view and quick tools —
**100% local**. No backend, no account, no analytics, no remote code.

## Features

| Area | Highlights |
| --- | --- |
| TabVault | Save tab / window / all windows, one-click open, search, tags & notes, starred collections, sort, drag & drop, import (BrowseKit, OneTab, bookmarks HTML, URL lists) / export (JSON, bookmarks HTML, URL list) |
| Search everything | Ctrl+K on the dashboard, the popup search box, or a global shortcut window: open tabs, saved tabs, Watch Later, sessions, snoozed tabs and actions |
| Tabs & sessions | Snooze, close duplicates, sort by site, merge windows, free memory, auto-suspend / auto-close idle tabs, session autosave, workspaces |
| Watch Later | Popup, right-click, shortcut; watched/unwatched, progress from resume positions, open & remove, open all, "surprise me" |
| Media Boost | 0.25–16× custom speed, volume boost (where Chrome allows), A–B loop, picture-in-picture, resume position, per-site memory, shortcuts, time-saved stats |
| Tools | Reader view, link extractor, copy/clean URL, word count & reading time, offline QR, screenshot, print, developer & text tools |
| Dashboard | Home with insights & get-started checklist, side panel mode, dark/light, accent colours, compact density, keyboard shortcut sheet (`?`) |
| Data | Local only, encrypted backups, backup reminders, erase everything |

## Develop

```bash
npm run check     # policy validator + unit tests
npm run smoke     # end-to-end in Chromium (needs Playwright in the environment)
npm run package   # dist/browsekit-<version>.zip for the Chrome Web Store
```

Load unpacked: `chrome://extensions` → Developer mode → Load unpacked → this folder.

See [architecture.md](architecture.md), [progress.md](progress.md) and [PRIVACY.md](PRIVACY.md).
