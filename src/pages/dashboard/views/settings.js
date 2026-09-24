import { MSG } from '../../../shared/constants.js';
import { MAX_BACKUP_BYTES, buildBackup, validateBackup } from '../../../shared/db/backup.js';
import { clearAll, restore, snapshot } from '../../../shared/db/repository.js';
import { h, mount, toast } from '../../../shared/dom.js';
import { formatBytes, formatNumber, isoDay } from '../../../shared/format.js';
import { send } from '../../../shared/messages.js';
import { THEMES, ensureSettings, getSettings, onSettingsChanged, updateSettings } from '../../../shared/settings.js';

const THEME_LABELS = { system: 'System', light: 'Light', dark: 'Dark' };

/** @param {HTMLElement} root */
export async function render(root) {
  const settings = await getSettings();

  // Appearance
  const themeInputs = THEMES.map((theme) =>
    h('input', {
      type: 'radio',
      name: 'theme',
      value: theme,
      checked: settings.theme === theme,
      onChange: () => updateSettings({ theme }).catch((err) => toast(String(err), 'error')),
    }),
  );
  const themeControl = h(
    'div',
    { class: 'segmented', role: 'radiogroup', 'aria-label': 'Theme' },
    THEMES.map((theme, i) => h('label', null, themeInputs[i], THEME_LABELS[theme])),
  );

  // Data
  const importErrors = h('ul', { class: 'error-list', hidden: true });
  const fileInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    class: 'visually-hidden',
    onChange: () => importFile(fileInput, importMode.value, importErrors),
  });
  const importMode = h(
    'select',
    { class: 'btn', 'aria-label': 'Import mode' },
    h('option', { value: 'merge' }, 'Merge with existing data'),
    h('option', { value: 'replace' }, 'Replace all existing data'),
  );

  // About
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
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card__title' }, 'Appearance'),
        h('div', { class: 'setting-row' }, h('span', null, 'Theme'), themeControl),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card__title' }, 'Backup & data'),
        h(
          'p',
          { class: 'muted' },
          'Backups are plain JSON files saved to your computer. BrowseKit never uploads them anywhere.',
        ),
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
    loadDiagnostics(diagnostics);
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
    mount(dl, row('Background worker', `Unavailable: ${err instanceof Error ? err.message : err}`));
  }
}

async function exportBackup() {
  try {
    const backup = buildBackup({
      stores: await snapshot(),
      settings: await getSettings(),
      appVersion: chrome.runtime.getManifest().version,
    });
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, download: `browsekit-backup-${isoDay()}.json` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast(`Backup exported (${formatBytes(blob.size)}).`);
  } catch (err) {
    console.error('[BrowseKit] export', err);
    toast(`Export failed: ${err instanceof Error ? err.message : err}`, 'error');
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
  if (
    mode === 'replace' &&
    !confirm('Replace ALL BrowseKit data with this backup? Current data will be deleted.')
  ) {
    return;
  }
  try {
    await restore(result.backup.stores, mode === 'replace' ? 'replace' : 'merge');
    if (result.backup.settings) await updateSettings(result.backup.settings);
    const total = Object.values(result.backup.stores).reduce((n, rows) => n + rows.length, 0);
    toast(`Imported ${formatNumber(total)} records.`);
  } catch (err) {
    console.error('[BrowseKit] import', err);
    showErrors([`Could not write data: ${err instanceof Error ? err.message : err}`]);
  }
}

async function eraseAll() {
  if (!confirm('Erase ALL BrowseKit data on this device? This cannot be undone. Consider exporting a backup first.')) {
    return;
  }
  try {
    await clearAll();
    await chrome.storage.local.clear();
    await ensureSettings();
    toast('All BrowseKit data erased.');
  } catch (err) {
    toast(`Erase failed: ${err instanceof Error ? err.message : err}`, 'error');
  }
}
