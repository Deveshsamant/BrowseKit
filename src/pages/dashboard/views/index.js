/**
 * Route → view registry. A view is { title, render(root, ctx) } where render
 * may return a cleanup function (called when navigating away).
 */
import { ROUTES } from '../../../shared/constants.js';
import * as home from './home.js';
import * as media from './media.js';
import * as sessions from './sessions.js';
import * as settings from './settings.js';
import * as tools from './tools.js';
import * as vault from './vault.js';
import * as watchLater from './watch-later.js';

/** @type {Record<string, { title: string, render: (root: HTMLElement, ctx: { params: URLSearchParams }) => any }>} */
export const views = {
  [ROUTES.HOME]: { title: 'Home', render: home.render },
  [ROUTES.VAULT]: { title: 'TabVault', render: vault.render },
  [ROUTES.WATCH_LATER]: { title: 'Watch Later', render: watchLater.render },
  [ROUTES.MEDIA]: { title: 'Media Boost', render: media.render },
  [ROUTES.SESSIONS]: { title: 'Sessions', render: sessions.render },
  [ROUTES.TOOLS]: { title: 'Tools', render: tools.render },
  [ROUTES.SETTINGS]: { title: 'Settings', render: settings.render },
};
