/**
 * Popup "Save" panel: Watch Later + TabVault quick save.
 */
import { ROUTES } from '../../../shared/constants.js';
import { h, mount, toast } from '../../../shared/dom.js';
import { isSaveableUrl } from '../../../shared/urls.js';
import { addToWatchLater, listWatchLater } from '../../../features/watch-later/watch-later.js';
import { saveTabsToVault } from '../../../features/vault/save.js';
import { defaultCollectionName, listCollections } from '../../../features/vault/vault.js';

const NEW = '__new__';

/**
 * @param {HTMLElement} root
 * @param {import('../popup.js').PopupContext} ctx
 */
export async function renderSavePanel(root, ctx) {
  const { tab, settings, fail } = ctx;
  const [collections, queue] = await Promise.all([listCollections(), listWatchLater()]);
  const canSaveTab = isSaveableUrl(tab?.url);
  let unwatched = queue.filter((i) => !i.watched).length;
  const queuedLink = h('button', { class: 'link-btn', type: 'button', onClick: () => ctx.openDashboard(ROUTES.WATCH_LATER) }, `${unwatched} queued →`);
  const alreadyQueued = !!tab?.url && queue.some((i) => i.url === tab.url && !i.watched);

  // Watch Later
  const wlButton = h(
    'button',
    { class: 'btn btn--primary btn--block', type: 'button', disabled: !canSaveTab || alreadyQueued, onClick: saveWatchLater },
    alreadyQueued ? '✓ In Watch Later' : 'Save to Watch Later',
  );

  async function saveWatchLater() {
    if (!tab?.url) return;
    try {
      const { duplicate } = await addToWatchLater(
        { url: tab.url, title: tab.title, source: 'popup' },
        { cleanUrls: settings.privacy.cleanUrlsOnSave },
      );
      wlButton.textContent = '✓ In Watch Later';
      wlButton.disabled = true;
      if (!duplicate) queuedLink.textContent = `${(unwatched += 1)} queued →`;
      toast(duplicate ? 'Already queued — moved to the top.' : 'Saved to Watch Later.');
    } catch (err) {
      fail(err);
    }
  }

  // TabVault
  const lastId = collections.some((c) => c.id === settings.vault.lastCollectionId) ? settings.vault.lastCollectionId : NEW;
  const select = h(
    'select',
    { class: 'btn select btn--block', 'aria-label': 'Save into collection', onChange: syncName },
    h('option', { value: NEW, selected: lastId === NEW }, '+ New collection'),
    collections.map((c) => h('option', { value: c.id, selected: c.id === lastId }, c.name)),
  );
  const nameInput = h('input', {
    class: 'input',
    type: 'text',
    maxLength: 120,
    placeholder: 'New collection name (optional)',
    'aria-label': 'New collection name',
  });
  const nameRow = h('div', { class: 'field-row' }, nameInput);
  function syncName() {
    nameRow.hidden = select.value !== NEW;
  }
  syncName();

  /** @param {'tab' | 'window' | 'all'} scope */
  async function save(scope) {
    try {
      const r = await saveTabsToVault({
        scope,
        collectionId: select.value === NEW ? null : select.value,
        newCollectionName: nameInput.value.trim() || defaultCollectionName(scope),
      });
      const extra = [r.duplicates && `${r.duplicates} already saved`, r.skipped && `${r.skipped} skipped`, r.closed && `${r.closed} closed`]
        .filter(Boolean)
        .join(', ');
      toast(`Saved ${r.added} to “${r.collectionName}”${extra ? ` (${extra})` : ''}.`);
      if (!r.closed) {
        const refreshed = await listCollections();
        mount(select, h('option', { value: NEW }, '+ New collection'), refreshed.map((c) => h('option', { value: c.id, selected: c.id === r.collectionId }, c.name)));
        nameInput.value = '';
        syncName();
      }
    } catch (err) {
      fail(err);
    }
  }

  mount(
    root,
    h(
      'section',
      { class: 'popup-section' },
      h('div', { class: 'popup-section__head' }, h('h2', null, 'Watch Later'), queuedLink),
      wlButton,
      !canSaveTab && h('p', { class: 'muted small' }, 'Browser and extension pages can’t be saved.'),
    ),
    h(
      'section',
      { class: 'popup-section' },
      h('div', { class: 'popup-section__head' }, h('h2', null, 'TabVault'), h('button', { class: 'link-btn', type: 'button', onClick: () => ctx.openDashboard(ROUTES.VAULT) }, `${collections.length} collections →`)),
      select,
      nameRow,
      h(
        'div',
        { class: 'btn-grid' },
        h('button', { class: 'btn', type: 'button', disabled: !canSaveTab, onClick: () => save('tab') }, 'This tab'),
        h('button', { class: 'btn', type: 'button', onClick: () => save('window') }, 'This window'),
        h('button', { class: 'btn', type: 'button', onClick: () => save('all') }, 'All windows'),
      ),
      settings.vault.closeAfterSave && h('p', { class: 'muted small' }, 'Saved tabs will be closed (change in Settings).'),
    ),
  );
}
