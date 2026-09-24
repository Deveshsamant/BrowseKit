/**
 * Route → view registry. A view is { title, render(root, ctx) } where render
 * may return a cleanup function (called when navigating away).
 */
import { ROUTES } from '../../../shared/constants.js';
import { comingSoon } from './coming-soon.js';
import * as home from './home.js';
import * as settings from './settings.js';

/** @type {Record<string, { title: string, render: (root: HTMLElement, ctx: { params: URLSearchParams }) => any }>} */
export const views = {
  [ROUTES.HOME]: { title: 'Home', render: home.render },

  [ROUTES.VAULT]: comingSoon({
    title: 'TabVault',
    summary: 'Save tabs into BrowseKit collections and reopen them with one click.',
    phase: 'Phase 1',
    features: [
      'Save the current tab, current window, or all windows',
      'Named collections stored only in BrowseKit (not Chrome tab groups)',
      'Open a whole collection with one click',
      'Search across every saved tab',
      'Rename, move between collections, reorder, delete',
      'Import/export (BrowseKit JSON and plain URL lists)',
    ],
    permissions: [
      'tabs — read the URL and title of tabs you choose to save (Chrome shows "Read your browsing history")',
      'favicon — show icons from Chrome’s local cache instead of fetching them from websites',
    ],
    limits: [
      'Reopening restores the URL only — not scroll position, form data or page state.',
      'Some browser-internal pages (e.g. chrome://settings) can be saved but Chrome may refuse to reopen them from an extension.',
    ],
  }),

  [ROUTES.WATCH_LATER]: comingSoon({
    title: 'Watch Later',
    summary: 'A private reading and watching queue.',
    phase: 'Phase 2',
    features: [
      'Save the current page from the popup or a keyboard shortcut',
      'Right-click any page or link → Save to Watch Later',
      'Search, mark watched/unwatched',
      'Open, open and remove, open all',
    ],
    permissions: [
      'contextMenus — add the right-click entry',
      'activeTab — read the current tab only after you click or press a shortcut',
    ],
    limits: [],
  }),

  [ROUTES.MEDIA]: comingSoon({
    title: 'Media Boost',
    summary: 'Speed, volume and seek controls for HTML5 video and audio.',
    phase: 'Phase 5',
    features: [
      'Speed from 0.25× to 16×, including any custom value',
      'Volume, mute and seek controls',
      'Volume boost above 100% where the browser allows it',
      'Remember settings per website (opt-in per site)',
      'Keyboard shortcuts',
    ],
    permissions: [
      'activeTab + scripting — control media on the current tab after you click',
      'Optional per-site access — only if you turn on “Remember on this site”',
    ],
    limits: [
      'Does not work on chrome:// pages, the Chrome Web Store, or the built-in PDF viewer.',
      'Volume boost cannot work on DRM-protected media or cross-origin media served without CORS (the browser outputs silence).',
      'Media in cross-origin iframes needs access to that iframe’s site too.',
      'Some sites reset playback speed; BrowseKit re-applies it but cannot guarantee every player cooperates.',
    ],
  }),

  [ROUTES.SESSIONS]: comingSoon({
    title: 'Sessions',
    summary: 'Search open tabs, clean up duplicates, and save or restore sessions.',
    phase: 'Phase 3',
    features: [
      'Search open tabs across all windows and jump to one',
      'Detect and close duplicate tabs',
      'Recently closed tabs and windows',
      'Save and restore multi-window sessions',
    ],
    permissions: ['tabs — list open tabs', 'sessions — list recently closed tabs'],
    limits: ['Chrome keeps only a limited number of recently closed entries (currently 25).'],
  }),

  [ROUTES.TOOLS]: comingSoon({
    title: 'Tools',
    summary: 'Quick utilities for the current page.',
    phase: 'Phase 4',
    features: [
      'Copy URL, title, or title + URL',
      'Clean tracking parameters from URLs (local rule list)',
      'Word count, character count and reading time',
      'QR code generator (fully offline)',
      'Screenshot of the visible area and print',
    ],
    permissions: [
      'activeTab — act on the current tab after you click',
      'scripting — read page text for word counts',
    ],
    limits: [
      'Screenshots capture the visible area only and are blocked on chrome:// pages and the Web Store.',
      'Word counts use the page’s rendered text, which may include navigation and footers.',
    ],
  }),

  [ROUTES.SETTINGS]: { title: 'Settings', render: settings.render },
};
