/**
 * Dashboard shell: theme, hash router (#/route?query), view lifecycle.
 */
import { ROUTES } from '../../shared/constants.js';
import { toast } from '../../shared/dom.js';
import { initTheme } from '../../shared/theme.js';
import { views } from './views/index.js';

const main = /** @type {HTMLElement} */ (document.getElementById('main'));
const nav = /** @type {HTMLElement} */ (document.getElementById('nav'));

/** @type {(() => void) | void} */
let cleanup;
let renderToken = 0;

/** @returns {{ route: string, params: URLSearchParams }} */
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const route = views[path] ? path : ROUTES.HOME;
  return { route, params: new URLSearchParams(query) };
}

async function render() {
  const token = ++renderToken;
  const { route, params } = parseHash();
  const view = views[route];

  if (typeof cleanup === 'function') cleanup();
  cleanup = undefined;

  for (const link of nav.querySelectorAll('a[data-route]')) {
    if (link.getAttribute('data-route') === route) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.title = `${view.title} · BrowseKit`;

  const container = document.createElement('div');
  try {
    const result = await view.render(container, { params });
    if (token !== renderToken) {
      if (typeof result === 'function') result();
      return; // a newer navigation won
    }
    cleanup = result;
    main.replaceChildren(container);
    main.focus({ preventScroll: true });
  } catch (err) {
    console.error(`[BrowseKit] failed to render ${route}`, err);
    toast(`Could not load ${view.title}: ${err instanceof Error ? err.message : err}`, 'error');
  }
}

window.addEventListener('hashchange', render);
initTheme().catch((err) => console.error('[BrowseKit] theme', err));
render();
