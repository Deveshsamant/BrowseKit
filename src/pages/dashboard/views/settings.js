import { MSG } from '../../../shared/constants.js';
import { MAX_BACKUP_BYTES, buildBackup, validateBackup } from '../../../shared/db/backup.js';
import { clearAll, restore, snapshot } from '../../../shared/db/repository.js';
import { h, mount, toast } from '../../../shared/dom.js';
import { downloadFile } from '../../../shared/files.js';
import { formatBytes, formatDateTime, formatNumber, isoDay } from '../../../shared/format.js';
import { send } from '../../../shared/messages.js';
import {
  ACCENTS,
  THEMES,
  ensureSettings,
  getSettings,
  onSettingsChanged,
  updateSettings,
} from '../../../shared/settings.js';
import { decryptJson, encryptJson, isEncryptedBackup } from '../../../shared/crypto-backup.js';
import { confirmDialog, errorMessage } from '../../../shared/ui.js';
import { MEDIA_SITES_KEY, getSites, grantedOrigins } from '../../../features/media/media-sites.js';
import { backupStatus, markBackedUp } from '../../../features/backup/backup-status.js';
import { numberInput, selectControl, settingRow, toggle } from '../controls.js';

const THEME_LABELS = { system: 'System', light: 'Light', dark: 'Dark' };

/**
 * @param {HTMLElement} root
 * @param {{ params: URLSearchParams }} ctx
 */
export async function render(root, { params }) {
  const settings = await getSettings();
  const fail = (err) => toast(errorMessage(err), 'error');
  const save = (patch) => updateSettings(patch);

  // --- Appearance ------------------------------------------------------------
  const themeInputs = THEMES.map((theme) =>
    h('input', { type: 'radio', name: 'theme', value: theme, checked: settings.theme === theme, onChange: () => save({ theme }).catch(fail) }),
  );
  const themeControl = h(
    'div',
    { class: 'segmented', role: 'radiogroup', 'aria-label': 'Theme' },
    THEMES.map((theme, i) => h('label', null, themeInputs[i], THEME_LABELS[theme])),
  );
  const accentInputs = ACCENTS.map((accent) =>
    h('input', { type: 'radio', name: 'accent', value: accent, checked: settings.ui.accent === accent, 'aria-label': accent, onChange: () => save({ ui: { accent } }).catch(fail) }),
  );
  const accentControl = h(
    'div',
    { class: 'swatches', role: 'radiogroup', 'aria-label': 'Accent colour' },
    ACCENTS.map((accent, i) => h('label', { class: `swatch swatch--${accent}`, title: accent }, accentInputs[i])),
  );
  const densityControl = selectControl(
    [
      { value: 'comfortable', label: 'Comfortable' },
      { value: 'compact', label: 'Compact' },
    ],
    settings.ui.density,
    (v) => save({ ui: { density: v } }),
    'Density',
  );
  const actionControl = selectControl(
    [
      { value: 'popup', label: 'Popup' },
      { value: 'sidepanel', label: 'Side panel' },
    ],
    settings.ui.actionOpens,
    (v) => save({ ui: { actionOpens: v } }),
    'Toolbar button opens',
  );

  // --- Behaviour ---------------------------------------------------------------
  const openIn = selectControl(
    [
      { value: 'current-window', label: 'Current window' },
      { value: 'new-window', label: 'New window' },
    ],
    settings.vault.openIn,
    (v) => save({ vault: { openIn: v } }),
    'Open collections in',
  );
  const toggles = {
    skipDuplicates: toggle(settings.vault.skipDuplicates, (v) => save({ vault: { skipDuplicates: v } })),
    closeAfterSave: toggle(settings.vault.closeAfterSave, (v) => save({ vault: { closeAfterSave: v } })),
    markWatchedOnOpen: toggle(settings.watchLater.markWatchedOnOpen, (v) => save({ watchLater: { markWatchedOnOpen: v } })),
    cleanUrlsOnSave: toggle(settings.privacy.cleanUrlsOnSave, (v) => save({ privacy: { cleanUrlsOnSave: v } })),
  };
  const nums = {
    autoSuspend: numberInput(settings.tabs.autoSuspendMinutes, 0, 1440, 5, (v) => save({ tabs: { autoSuspendMinutes: v } }), 'Auto-suspend after minutes'),
    autoClose: numberInput(settings.tabs.autoCloseMinutes, 0, 10080, 15, (v) => save({ tabs: { autoCloseMinutes: v } }), 'Auto-close after minutes'),
    autosave: numberInput(settings.sessions.autosaveMinutes, 0, 1440, 5, (v) => save({ sessions: { autosaveMinutes: v } }), 'Autosave every minutes'),
    keep: numberInput(settings.sessions.autosaveKeep, 1, 50, 1, (v) => save({ sessions: { autosaveKeep: v } }), 'Autosaves to keep'),
    remind: numberInput(settings.backup.remindDays, 0, 365, 1, (v) => save({ backup: { remindDays: v } }), 'Backup reminder days'),
  };
  const neverTouch = /** @type {HTMLTextAreaElement} */ (
    h('textarea', {
      class: 'input textarea',
      rows: 2,
      placeholder: 'mail.example.com, docs.example.org',
      'aria-label': 'Sites never suspended or auto-closed',
      value: settings.tabs.neverTouchHosts.join(', '),
      onChange: () =>
        save({ tabs: { neverTouchHosts: neverTouch.value.split(/[\s,]+/).filter(Boolean) } })
          .then(() => toast('Saved.'))
          .catch(fail),
    })
  );

  // --- Data ------------------------------------------------------------------------
  const importErrors = h('ul', { class: 'error-list', hidden: true });
  const importMode = selectControl(
    [
      { value: 'merge', label: 'Merge with existing data' },
      { value: 'replace', label: 'Replace all existing data' },
    ],
    'merge',
    async () => {},
    'Import mode',
  );
  const fileInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    class: 'visually-hidden',
    onChange: () => importFile(fileInput, importMode.value, importErrors),
  });
  const password = /** @type {HTMLInputElement} */ (
    h('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: 'Password (optional, 8+ characters)', 'aria-label': 'Backup password' })
  );
  const lastBackup = h('p', { class: 'muted small' });
  const refreshBackupLine = async () => {
    const { lastBackupAt, due } = await backupStatus();
    lastBackup.textContent = lastBackupAt ? `Last backup: ${formatDateTime(lastBackupAt)}${due ? ' — time for a new one.' : '.'}` : 'No backup exported yet.';
    lastBackup.classList.toggle('error-text', due);
  };
  refreshBackupLine();

  const diagnostics = h('dl', { class: 'kv' }, h('dt', null, 'Status'), h('dd', null, 'Checking…'));
  loadDiagnostics(diagnostics);

  const backupCard = h(
    'section',
    { class: 'card', id: 'backup' },
    h('h2', { class: 'card__title' }, 'Backup & data'),
    h('p', { class: 'muted' }, 'Your data lives only in this browser profile. Backups are JSON files saved to your computer; BrowseKit never uploads them anywhere.'),
    lastBackup,
    h('div', { class: 'field-row field-row--wrap' }, password, h('button', { class: 'btn btn--primary', type: 'button', onClick: () => exportBackup(password.value).then(refreshBackupLine) }, 'Export backup')),
    h('p', { class: 'muted small' }, 'With a password, the file is encrypted with AES-256-GCM (key from PBKDF2-SHA-256). The password is never stored — if you lose it, the backup cannot be opened.'),
    h('div', { class: 'btn-row' }, importMode, h('button', { class: 'btn', type: 'button', onClick: () => fileInput.click() }, 'Import backup…'), fileInput),
    importErrors,
    settingRow('Remind me to back up every (days, 0 = never)', nums.remind),
    h(
      'div',
      { class: 'setting-row' },
      h('span', { class: 'muted' }, 'Permanently delete every collection, saved item, session and setting.'),
      h('button', { class: 'btn btn--danger', type: 'button', onClick: eraseAll }, 'Erase all data'),
    ),
  );

  mount(
    root,
    h('header', { class: 'page-header' }, h('div', null, h('h1', null, 'Settings'), h('p', { class: 'muted' }, 'Stored on this device only.'))),
    h(
      'div',
      { class: 'stack' },
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card__title' }, 'Appearance'),
        h('div', { class: 'setting-row' }, h('span', null, 'Theme'), themeControl),
        h('div', { class: 'setting-row' }, h('span', null, 'Accent colour'), accentControl),
        settingRow('Density', densityControl),
        settingRow('Toolbar button opens', actionControl, 'The side panel stays open next to the page while you browse.'),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card__title' }, 'Tabs & memory'),
        settingRow('Auto-suspend idle background tabs after (minutes, 0 = off)', nums.autoSuspend, 'Unloads tabs to free memory; they reload when you open them. Unsaved form input on those pages may be lost.'),
        settingRow('Auto-close idle tabs after (minutes, 0 = off)', nums.autoClose, 'Closed tabs go to the “Auto-closed tabs” collection in TabVault, so nothing is lost.'),
        h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Never suspend or auto-close these sites'), neverTouch),
        h('p', { class: 'muted small' }, 'Active, pinned and audio-playing tabs are never touched.'),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card__title' }, 'Sessions'),
        settingRow('Autosave all windows every (minutes, 0 = off)', nums.autosave, 'Only when something changed. Use it to recover after a crash.'),
        settingRow('Autosaves to keep', nums.keep),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card__title' }, 'TabVault'),
        settingRow('Open collections in', openIn),
        settingRow('Skip tabs already saved in the same collection', toggles.skipDuplicates),
        settingRow('Close tabs after saving them', toggles.closeAfterSave),
      ),
      h('section', { class: 'card' }, h('h2', { class: 'card__title' }, 'Watch Later'), settingRow('Mark items as watched when opened from BrowseKit', toggles.markWatchedOnOpen)),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card__title' }, 'Privacy'),
        settingRow('Remove tracking parameters from URLs when saving', toggles.cleanUrlsOnSave, 'Only well-known trackers (utm_*, fbclid, gclid…). Media Boost site access is under Media Boost.'),
      ),
      backupCard,
      h('section', { class: 'card' }, h('h2', { class: 'card__title' }, 'About'), diagnostics),
    ),
  );

  if (params.get('backup')) {
    requestAnimationFrame(() => {
      backupCard.scrollIntoView({ block: 'start' });
      backupCard.classList.add('is-highlighted');
      password.focus();
    });
  }

  return onSettingsChanged((next) => {
    for (const input of themeInputs) input.checked = input.value === next.theme;
    for (const input of accentInputs) input.checked = input.value === next.ui.accent;
    densityControl.value = next.ui.density;
    actionControl.value = next.ui.actionOpens;
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

/** @param {string} password optional; encrypts when set */
async function exportBackup(password) {
  try {
    const backup = buildBackup({
      stores: await snapshot(),
      settings: await getSettings(),
      mediaSites: await getSites(),
      appVersion: chrome.runtime.getManifest().version,
    });
    const payload = password ? await encryptJson(backup, password) : backup;
    const json = JSON.stringify(payload, null, 2);
    downloadFile(`browsekit-backup-${isoDay()}${password ? '.encrypted' : ''}.json`, json, 'application/json');
    await markBackedUp();
    toast(`${password ? 'Encrypted backup' : 'Backup'} exported (${formatBytes(json.length)}).`);
  } catch (err) {
    console.error('[BrowseKit] export', err);
    toast(`Export failed: ${errorMessage(err)}`, 'error');
  }
}

/** Ask for a password with a masked field. @returns {Promise<string | null>} */
function askPassword() {
  return new Promise((resolve) => {
    const input = /** @type {HTMLInputElement} */ (h('input', { class: 'input', type: 'password', autocomplete: 'current-password', 'aria-label': 'Backup password', required: true }));
    const dialog = h(
      'dialog',
      { class: 'dialog', 'aria-label': 'Backup password' },
      h(
        'form',
        { method: 'dialog', class: 'dialog__form' },
        h('h2', { class: 'dialog__title' }, 'This backup is encrypted'),
        h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Password'), input),
        h(
          'div',
          { class: 'dialog__actions' },
          h('button', { class: 'btn', type: 'submit', value: 'cancel', formNoValidate: true }, 'Cancel'),
          h('button', { class: 'btn btn--primary', type: 'submit', value: 'ok' }, 'Decrypt'),
        ),
      ),
    );
    document.body.append(dialog);
    dialog.addEventListener('close', () => {
      const value = dialog.returnValue === 'ok' ? input.value : null;
      dialog.remove();
      resolve(value);
    });
    dialog.showModal();
    input.focus();
  });
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
  if (isEncryptedBackup(parsed)) {
    const password = await askPassword();
    if (!password) return;
    try {
      parsed = await decryptJson(parsed, password);
    } catch (err) {
      showErrors([errorMessage(err)]);
      return;
    }
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
    body: 'This permanently deletes collections, Watch Later, sessions, snoozed tabs, remembered media sites, per-site access, stats and settings on this device. Consider exporting a backup first.',
    confirmLabel: 'Erase everything',
    danger: true,
  });
  if (!ok) return;
  try {
    await clearAll();
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
    const origins = await grantedOrigins();
    if (origins.length) await chrome.permissions.remove({ origins });
    await ensureSettings();
    toast('All BrowseKit data erased.');
  } catch (err) {
    toast(`Erase failed: ${errorMessage(err)}`, 'error');
  }
}
