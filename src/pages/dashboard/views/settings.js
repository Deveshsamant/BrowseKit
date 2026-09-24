import { MSG } from '../../../shared/constants.js';
import { MAX_BACKUP_BYTES, buildBackup, validateBackup } from '../../../shared/db/backup.js';
import { clearAll, restore, snapshot } from '../../../shared/db/repository.js';
import { h, mount, toast } from '../../../shared/dom.js';
import { downloadFile } from '../../../shared/files.js';
import { formatBytes, formatNumber, isoDay } from '../../../shared/format.js';
import { send } from '../../../shared/messages.js';
import {
  THEMES,
  ensureSettings,
  getSettings,
  onSettingsChanged,
  updateSettings,
} from '../../../shared/settings.js';
import { confirmDialog, errorMessage } from '../../../shared/ui.js';
import { MEDIA_SITES_KEY, getSites, grantedOrigins } from '../../../features/media/media-sites.js';
import { settingRow, toggle } from './media.js';

const THEME_LABELS = { system: 'System', light: 'Light', dark: 'Dark' };

/** @param {HTMLElement} root */
export async function render(root) {
  const settings = await getSettings();
  const fail = (err) => toast(errorMessage(err), 'error');
  const save = (patch) => updateSettings(patch);

  // Appearance
  const themeInputs = THEMES.map((theme) =>
    h('input', {
      type: 'radio',
      name: 'theme',
      value: theme,
      checked: settings.theme === theme,
      onChange: () => save({ theme }).catch(fail),
    }),
  );
  const themeControl = h(
    'div',
    { class: 'segmented', role: 'radiogroup', 'aria-label': 'Theme' },
    THEMES.map((theme, i) => h('label', null, themeInputs[i], THEME_LABELS[theme])),
  );

  // Behaviour
  const openIn = h(
    'select',
    { class: 'btn select', 'aria-label': 'Open collections in', onChange: () => save({ vault: { openIn: openIn.value } }).catch(fail) },
    h('option', { value: 'current-window', selected: settings.vault.openIn === 'current-window' }, 'Current window'),
    h('option', { value: 'new-window', selected: settings.vault.openIn === 'new-window' }, 'New window'),
  );
  const toggles = {
    skipDuplicates: toggle(settings.vault.skipDuplicates, (v) => save({ vault: { skipDuplicates: v } })),
    closeAfterSave: toggle(settings.vault.closeAfterSave, (v) => save({ vault: { closeAfterSave: v } })),
    markWatchedOnOpen: toggle(settings.watchLater.markWatchedOnOpen, (v) => save({ watchLater: { markWatchedOnOpen: v } })),
    cleanUrlsOnSave: toggle(settings.privacy.cleanUrlsOnSave, (v) => save({ privacy: { cleanUrlsOnSave: v } })),
  };

  // Data
  const importErrors = h('ul', { class: 'error-list', hidden: true });
  const importMode = h(
    'select',
    { class: 'btn select', 'aria-label': 'Import mode' },
    h('option', { value: 'merge' }, 'Merge with existing data'),
    h('option', { value: 'replace' }, 'Replace all existing data'),
  );
  const fileInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    class: 'visually-hidden',
    onChange: () => importFile(fileInput, importMode.value, importErrors),
  });

  const diagnostics = h('dl', { class: 'kv' }, h('dt', null, 'Status'), h('dd', null, 'Checking…'));
  loadDiagnostics(diagnostics);

  mount(
    root,
    h(
      'header',
      { class: 'page-header' },
      h('div', null, h('h1', null, 'Settings'), h('p', { class: 'muted' }, 'Stored on this device only.')),
    ),
    h(
      'div',
      { class: 'stack' },
      h('section', { class: 'card' }, h('h2', { class: 'card__title' }, 'Appearance'), h('div', { class: 'setting-row' }, h('span', null, 'Theme'), themeControl)),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card__title' }, 'TabVault'),
        settingRow('Open collections in', openIn),
        settingRow('Skip tabs already saved in the same collection', toggles.skipDuplicates),
        settingRow('Close tabs after saving them', toggles.closeAfterSave),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card__title' }, 'Watch Later'),
        settingRow('Mark items as watched when opened from BrowseKit', toggles.markWatchedOnOpen),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card__title' }, 'Privacy'),
        settingRow('Remove tracking parameters from URLs when saving', toggles.cleanUrlsOnSave),
        h('p', { class: 'muted small' }, 'Only well-known trackers are removed (utm_*, fbclid, gclid…). Media Boost defaults and site access are under Media Boost.'),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card__title' }, 'Backup & data'),
        h('p', { class: 'muted' }, 'Backups are plain JSON files saved to your computer. BrowseKit never uploads them anywhere.'),
        h(
          'div',
          { class: 'btn-row' },
          h('button', { class: 'btn btn--primary', type: 'button', onClick: exportBackup }, 'Export backup'),
          importMode,
          h('button', { class: 'btn', type: 'button', onClick: () => fileInput.click() }, 'Import backup…'),
          fileInput,
        ),
        importErrors,
        h(
          'div',
          { class: 'setting-row' },
          h('span', { class: 'muted' }, 'Permanently delete every collection, saved item, session and setting.'),
          h('button', { class: 'btn btn--danger', type: 'button', onClick: eraseAll }, 'Erase all data'),
        ),
      ),
      h('section', { class: 'card' }, h('h2', { class: 'card__title' }, 'About'), diagnostics),
    ),
  );

  return onSettingsChanged((next) => {
    for (const input of themeInputs) input.checked = input.value === next.theme;
    openIn.value = next.vault.openIn;
    toggles.skipDuplicates.checked = next.vault.skipDuplicates;
    toggles.closeAfterSave.checked = next.vault.closeAfterSave;
    toggles.markWatchedOnOpen.checked = next.watchLater.markWatchedOnOpen;
    toggles.cleanUrlsOnSave.checked = next.privacy.cleanUrlsOnSave;
  });
}

/** Round-trips through the service worker to prove it can reach storage + DB. */
async function loadDiagnostics(/** @type {HTMLElement} */ dl) {
  const row = (/** @type {string} */ k, /** @type {any} */ v) => [h('dt', null, k), h('dd', null, v)];
  try {
    const d = await send(MSG.DIAGNOSTICS);
    const total = Object.values(d.counts).reduce((a, b) => a + b, 0);
    mount(
      dl,
      row('Version', d.version),
      row('Database schema', `v${d.dbVersion}`),
      row('Stored records', formatNumber(total)),
      row('Permissions', d.permissions.join(', ') || 'none'),
      row('Background worker', h('span', { class: 'badge' }, 'Running')),
    );
  } catch (err) {
    mount(dl, row('Background worker', `Unavailable: ${errorMessage(err)}`));
  }
}

async function exportBackup() {
  try {
    const backup = buildBackup({
      stores: await snapshot(),
      settings: await getSettings(),
      mediaSites: await getSites(),
      appVersion: chrome.runtime.getManifest().version,
    });
    const json = JSON.stringify(backup, null, 2);
    downloadFile(`browsekit-backup-${isoDay()}.json`, json, 'application/json');
    toast(`Backup exported (${formatBytes(json.length)}).`);
  } catch (err) {
    console.error('[BrowseKit] export', err);
    toast(`Export failed: ${errorMessage(err)}`, 'error');
  }
}

/**
 * @param {HTMLInputElement} input
 * @param {string} mode
 * @param {HTMLElement} errorList
 */
async function importFile(input, mode, errorList) {
  const file = input.files?.[0];
  input.value = ''; // allow re-selecting the same file
  errorList.hidden = true;
  if (!file) return;

  const showErrors = (/** @type {string[]} */ errors) => {
    mount(errorList, errors.map((e) => h('li', null, e)));
    errorList.hidden = false;
    toast('Import failed — nothing was changed.', 'error');
  };

  if (file.size > MAX_BACKUP_BYTES) {
    showErrors([`File is too large (${formatBytes(file.size)}; limit ${formatBytes(MAX_BACKUP_BYTES)}).`]);
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    showErrors(['File is not valid JSON.']);
    return;
  }
  const result = validateBackup(parsed);
  if (!result.ok) {
    showErrors(result.errors);
    return;
  }
  const replace = mode === 'replace';
  if (
    replace &&
    !(await confirmDialog({
      title: 'Replace all BrowseKit data?',
      body: 'Current collections, Watch Later, sessions and settings will be replaced by the backup.',
      confirmLabel: 'Replace',
      danger: true,
    }))
  ) {
    return;
  }
  try {
    await restore(result.backup.stores, replace ? 'replace' : 'merge');
    if (result.backup.settings) await updateSettings(result.backup.settings);
    if (result.backup.mediaSites) {
      const current = replace ? {} : await getSites();
      await chrome.storage.local.set({ [MEDIA_SITES_KEY]: { ...current, ...result.backup.mediaSites } });
    }
    const total = Object.values(result.backup.stores).reduce((n, rows) => n + rows.length, 0);
    toast(`Imported ${formatNumber(total)} records.`);
  } catch (err) {
    console.error('[BrowseKit] import', err);
    showErrors([`Could not write data: ${errorMessage(err)}`]);
  }
}

async function eraseAll() {
  const ok = await confirmDialog({
    title: 'Erase all BrowseKit data?',
    body: 'This permanently deletes collections, Watch Later, sessions, remembered media sites, per-site access and settings on this device. Consider exporting a backup first.',
    confirmLabel: 'Erase everything',
    danger: true,
  });
  if (!ok) return;
  try {
    await clearAll();
    await chrome.storage.local.clear();
    const origins = await grantedOrigins();
    if (origins.length) await chrome.permissions.remove({ origins });
    await ensureSettings();
    toast('All BrowseKit data erased.');
  } catch (err) {
    toast(`Erase failed: ${errorMessage(err)}`, 'error');
  }
}
