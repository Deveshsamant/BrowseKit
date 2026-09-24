/**
 * Media Boost settings: defaults, remembered sites + automatic access,
 * keyboard shortcuts, and the honest list of browser limits.
 */
import { h, mount, toast } from '../../../shared/dom.js';
import { formatDateTime } from '../../../shared/format.js';
import { getSettings, onSettingsChanged, updateSettings } from '../../../shared/settings.js';
import { confirmDialog, emptyState, errorMessage } from '../../../shared/ui.js';
import {
  MEDIA_SITES_KEY,
  getSites,
  grantedOrigins,
  httpsPatternForHost,
  removeSite,
  requestAutoAccess,
  revokeAutoAccess,
} from '../../../features/media/media-sites.js';

/** @param {HTMLElement} root */
export async function render(root) {
  const fail = (err) => toast(errorMessage(err), 'error');
  const sitesHost = h('div');
  const shortcutsHost = h('div');
  const settings = await getSettings();

  const speedStep = numberInput(settings.media.speedStep, 0.05, 4, 0.05, (v) => updateSettings({ media: { speedStep: v } }));
  const seekStep = numberInput(settings.media.seekStep, 1, 600, 1, (v) => updateSettings({ media: { seekStep: v } }));
  const inPage = toggle(settings.media.inPageShortcuts, (v) => updateSettings({ media: { inPageShortcuts: v } }));
  const overlay = toggle(settings.media.showOverlay, (v) => updateSettings({ media: { showOverlay: v } }));

  mount(
    root,
    h(
      'header',
      { class: 'page-header' },
      h('div', null, h('h1', null, 'Media Boost'), h('p', { class: 'muted' }, 'Speed, volume and seek for HTML5 video and audio. Controls live in the toolbar popup → Media.')),
    ),
    h(
      'div',
      { class: 'stack' },
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card__title' }, 'Defaults'),
        settingRow('Speed step (popup −/+, shortcuts, [ ] keys)', speedStep),
        settingRow('Seek step in seconds', seekStep),
        settingRow('In-page keys: [ slower, ] faster, \\ reset', inPage),
        settingRow('Show on-page indicator when changing speed or volume', overlay),
        h('p', { class: 'muted small' }, 'Speed can be anything from 0.25× to 16×. Volume goes to 600% where boosting is possible.'),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card__title' }, 'Remembered sites'),
        h(
          'p',
          { class: 'muted' },
          'Turn on “Remember on this site” in the popup to keep speed and volume per site. With automatic access, BrowseKit applies them as soon as the site loads; without it, they are applied when you open the popup or use a shortcut there.',
        ),
        sitesHost,
      ),
      h('section', { class: 'card' }, h('h2', { class: 'card__title' }, 'Keyboard shortcuts'), shortcutsHost),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card__title' }, 'What browsers don’t allow'),
        h(
          'ul',
          { class: 'plain-list muted' },
          h('li', null, 'Extensions can’t run on chrome:// pages, the Chrome Web Store, other extensions, or the built-in PDF viewer.'),
          h('li', null, 'Volume above 100% uses Web Audio. Chrome outputs silence for cross-origin media without CORS headers, so BrowseKit disables boost there instead of muting it. DRM-protected media (e.g. most paid streaming) can’t be boosted.'),
          h('li', null, 'Audio processing only starts after you have interacted with the page (Chrome’s autoplay policy).'),
          h('li', null, 'Media inside cross-origin iframes is only reachable if that iframe’s site is also granted; media in closed shadow DOM or canvas/WebGL players is unreachable.'),
          h('li', null, 'Some players reset the speed. BrowseKit re-applies your choice, adopts changes you make with the site’s own controls, and backs off if a player keeps overriding it.'),
          h('li', null, 'Live streams can only be seeked within their buffered window.'),
        ),
      ),
    ),
  );

  async function renderSites() {
    const [sites, origins] = await Promise.all([getSites(), grantedOrigins()]);
    const hosts = Object.keys(sites).sort();
    const originFor = (host) => origins.find((o) => new URL(o.replace('/*', '/')).hostname === host);
    const orphanOrigins = origins.filter((o) => !hosts.includes(new URL(o.replace('/*', '/')).hostname));
    if (!hosts.length && !orphanOrigins.length) {
      mount(sitesHost, emptyState('No remembered sites yet'));
      return;
    }
    mount(
      sitesHost,
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 'table' },
          h('thead', null, h('tr', null, h('th', null, 'Site'), h('th', null, 'Speed'), h('th', null, 'Volume'), h('th', null, 'Automatic'), h('th', null, 'Updated'), h('th', null, h('span', { class: 'visually-hidden' }, 'Actions')))),
          h(
            'tbody',
            null,
            hosts.map((host) => {
              const s = sites[host];
              const origin = originFor(host);
              return h(
                'tr',
                null,
                h('td', null, host),
                h('td', null, s.speed ? `${s.speed}×` : '—'),
                h('td', null, s.volume !== null && s.volume !== undefined ? `${Math.round(s.volume * 100)}%` : '—'),
                h(
                  'td',
                  null,
                  origin
                    ? h('button', { class: 'btn btn--sm', type: 'button', onClick: () => revokeAutoAccess(origin).then(renderSites, fail) }, 'On · turn off')
                    : h('button', { class: 'btn btn--sm', type: 'button', onClick: () => grant(host) }, 'Off · turn on'),
                ),
                h('td', { class: 'muted small' }, formatDateTime(s.updatedAt)),
                h('td', null, h('button', { class: 'btn btn--sm btn--danger', type: 'button', onClick: () => forget(host, origin) }, 'Forget')),
              );
            }),
            orphanOrigins.map((o) =>
              h(
                'tr',
                null,
                h('td', null, o),
                h('td', { colSpan: 3, class: 'muted small' }, 'Automatic access granted, no remembered settings'),
                h('td', null),
                h('td', null, h('button', { class: 'btn btn--sm btn--danger', type: 'button', onClick: () => revokeAutoAccess(o).then(renderSites, fail) }, 'Revoke')),
              ),
            ),
          ),
        ),
      ),
    );
  }

  async function grant(host) {
    try {
      // https first; most media sites are https-only.
      const ok = await requestAutoAccess(httpsPatternForHost(host));
      toast(ok ? `Media Boost will run automatically on ${host}.` : 'Access not granted.');
      renderSites();
    } catch (err) {
      fail(err);
    }
  }

  async function forget(host, origin) {
    const ok = await confirmDialog({ title: `Forget ${host}?`, body: 'Removes the remembered speed/volume and any automatic access.', confirmLabel: 'Forget', danger: true });
    if (!ok) return;
    try {
      await removeSite(host);
      if (origin) await revokeAutoAccess(origin);
      renderSites();
    } catch (err) {
      fail(err);
    }
  }

  async function renderShortcuts() {
    const commands = await chrome.commands.getAll();
    mount(
      shortcutsHost,
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 'table' },
          h('thead', null, h('tr', null, h('th', null, 'Action'), h('th', null, 'Shortcut'))),
          h(
            'tbody',
            null,
            commands.map((c) =>
              h(
                'tr',
                null,
                h('td', null, c.name === '_execute_action' ? 'Open the BrowseKit popup' : c.description),
                h('td', null, c.shortcut ? h('kbd', { class: 'kbd' }, c.shortcut) : h('span', { class: 'muted small' }, 'Not set')),
              ),
            ),
          ),
        ),
      ),
      h(
        'p',
        { class: 'muted small' },
        'Chrome lets an extension suggest at most four shortcuts; set the rest yourself. Shortcuts are managed by Chrome at chrome://extensions/shortcuts.',
      ),
      h(
        'button',
        { class: 'btn', type: 'button', onClick: () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }).catch(fail) },
        'Change shortcuts',
      ),
    );
  }

  await Promise.all([renderSites(), renderShortcuts()]);

  const onStorage = (changes, area) => {
    if (area === 'local' && changes[MEDIA_SITES_KEY]) renderSites().catch(fail);
  };
  chrome.storage.onChanged.addListener(onStorage);
  const onPerms = () => renderSites().catch(fail);
  chrome.permissions.onAdded.addListener(onPerms);
  chrome.permissions.onRemoved.addListener(onPerms);
  const unsubscribe = onSettingsChanged((s) => {
    speedStep.value = String(s.media.speedStep);
    seekStep.value = String(s.media.seekStep);
    inPage.checked = s.media.inPageShortcuts;
    overlay.checked = s.media.showOverlay;
  });
  return () => {
    chrome.storage.onChanged.removeListener(onStorage);
    chrome.permissions.onAdded.removeListener(onPerms);
    chrome.permissions.onRemoved.removeListener(onPerms);
    unsubscribe();
  };
}

/** @param {string} label @param {HTMLElement} control */
export function settingRow(label, control) {
  return h('label', { class: 'setting-row' }, h('span', null, label), control);
}

/**
 * @param {boolean} checked
 * @param {(v: boolean) => Promise<unknown>} onChange
 */
export function toggle(checked, onChange) {
  const input = h('input', {
    type: 'checkbox',
    class: 'switch',
    role: 'switch',
    checked,
    onChange: () => onChange(input.checked).catch((err) => toast(errorMessage(err), 'error')),
  });
  return input;
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @param {number} step
 * @param {(v: number) => Promise<unknown>} onChange
 */
function numberInput(value, min, max, step, onChange) {
  const input = h('input', {
    class: 'input input--num',
    type: 'number',
    value: String(value),
    min: String(min),
    max: String(max),
    step: String(step),
    onChange: () => {
      const v = Number(input.value);
      if (!Number.isFinite(v) || v < min || v > max) {
        toast(`Enter a value between ${min} and ${max}.`, 'error');
        return;
      }
      onChange(v).catch((err) => toast(errorMessage(err), 'error'));
    },
  });
  return input;
}
