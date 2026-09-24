/**
 * TabVault: BrowseKit collections of saved tabs (not Chrome tab groups).
 */
import { onDatabaseChange } from '../../../shared/db/database.js';
import { h, mount, toast } from '../../../shared/dom.js';
import { formatNumber, isoDay } from '../../../shared/format.js';
import { getSettings } from '../../../shared/settings.js';
import { openTabs } from '../../../shared/tabs.js';
import { confirmDialog, debounce, emptyState, errorMessage, favicon, promptDialog, selectDialog } from '../../../shared/ui.js';
import { hostOf } from '../../../shared/urls.js';
import { saveTabsToVault } from '../../../features/vault/save.js';
import {
  createCollection,
  deleteCollection,
  deleteTabs,
  importCollections,
  loadVault,
  moveTabs,
  reorderCollections,
  reorderTabs,
  updateCollection,
  updateTab,
} from '../../../features/vault/vault.js';
import {
  COLLECTION_COLORS,
  exportUrlList,
  exportVaultJson,
  parseVaultImport,
  searchTabs,
} from '../../../features/vault/vault-model.js';
import { downloadFile, readFileAsText } from '../../../shared/files.js';

const OPEN_CONFIRM_THRESHOLD = 20;

/**
 * @param {HTMLElement} root
 * @param {{ params: URLSearchParams }} ctx
 */
export async function render(root, { params }) {
  /** @type {Awaited<ReturnType<typeof loadVault>>} */
  let data = await loadVault();
  const state = {
    selectedId: params.get('c') || data.collections[0]?.id || null,
    query: '',
    /** @type {Set<string>} */
    checked: new Set(),
  };

  const summary = h('p', { class: 'muted' });
  const search = h('input', {
    class: 'input search',
    type: 'search',
    placeholder: 'Search saved tabs…  ( / )',
    'aria-label': 'Search saved tabs',
    onInput: debounce(() => {
      state.query = search.value.trim();
      renderMain();
    }, 120),
  });
  const fileInput = h('input', {
    type: 'file',
    accept: '.json,.txt,application/json,text/plain',
    class: 'visually-hidden',
    onChange: () => importFromFile(),
  });
  const sidebar = h('nav', { class: 'vault__sidebar', 'aria-label': 'Collections' });
  const main = h('section', { class: 'vault__main', 'aria-live': 'polite' });

  mount(
    root,
    h(
      'header',
      { class: 'page-header' },
      h('div', null, h('h1', null, 'TabVault'), summary),
      h(
        'div',
        { class: 'btn-row' },
        h('button', { class: 'btn', type: 'button', onClick: () => save('window') }, 'Save this window'),
        h('button', { class: 'btn', type: 'button', onClick: () => save('all') }, 'Save all windows'),
        h('button', { class: 'btn', type: 'button', onClick: () => fileInput.click() }, 'Import…'),
        h('button', { class: 'btn', type: 'button', onClick: exportAll }, 'Export all'),
        fileInput,
      ),
    ),
    h('div', { class: 'toolbar' }, search),
    h('div', { class: 'vault' }, sidebar, main),
  );

  const selected = () => data.collections.find((c) => c.id === state.selectedId) ?? null;

  function renderSummary() {
    summary.textContent = `${formatNumber(data.collections.length)} collections · ${formatNumber(data.tabs.length)} saved tabs · stored only in BrowseKit, not as Chrome tab groups`;
  }

  // --- Sidebar -----------------------------------------------------------------
  function renderSidebar() {
    const list = h(
      'ul',
      { class: 'collection-list' },
      data.collections.map((c) => {
        const count = data.tabsByCollection.get(c.id)?.length ?? 0;
        const item = h(
          'li',
          {
            class: `collection-item${c.id === state.selectedId && !state.query ? ' is-active' : ''}`,
            draggable: 'true',
            dataset: { id: c.id },
          },
          h(
            'button',
            {
              class: 'collection-item__btn',
              type: 'button',
              'aria-current': c.id === state.selectedId && !state.query ? 'true' : null,
              onClick: () => select(c.id),
            },
            h('span', { class: `dot dot--${c.color}`, 'aria-hidden': 'true' }),
            h('span', { class: 'collection-item__name' }, c.name),
            h('span', { class: 'collection-item__count' }, formatNumber(count)),
          ),
        );
        wireCollectionDrag(item, c.id);
        return item;
      }),
    );
    mount(
      sidebar,
      data.collections.length ? list : h('p', { class: 'muted small' }, 'No collections yet.'),
      h('button', { class: 'btn btn--block', type: 'button', onClick: newCollection }, '+ New collection'),
    );
  }

  /** Drag collections to reorder; drop tabs on a collection to move them. */
  function wireCollectionDrag(item, id) {
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('application/x-browsekit-collection', id);
      e.dataTransfer && (e.dataTransfer.effectAllowed = 'move');
    });
    item.addEventListener('dragover', (e) => {
      const types = e.dataTransfer?.types ?? [];
      if (types.includes('application/x-browsekit-collection') || types.includes('application/x-browsekit-tabs')) {
        e.preventDefault();
        item.classList.add('is-drop-target');
      }
    });
    item.addEventListener('dragleave', () => item.classList.remove('is-drop-target'));
    item.addEventListener('drop', async (e) => {
      e.preventDefault();
      item.classList.remove('is-drop-target');
      const draggedCollection = e.dataTransfer?.getData('application/x-browsekit-collection');
      const draggedTabs = e.dataTransfer?.getData('application/x-browsekit-tabs');
      try {
        if (draggedCollection && draggedCollection !== id) {
          const ids = data.collections.map((c) => c.id).filter((x) => x !== draggedCollection);
          ids.splice(ids.indexOf(id), 0, draggedCollection);
          await reorderCollections(ids);
        } else if (draggedTabs) {
          const ids = JSON.parse(draggedTabs);
          await moveTabs(ids, id);
          state.checked.clear();
          toast(`Moved ${ids.length} tab${ids.length === 1 ? '' : 's'}.`);
        }
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    });
  }

  // --- Main pane ---------------------------------------------------------------
  function renderMain() {
    renderSidebar();
    if (state.query) return renderSearch();
    const collection = selected();
    if (!collection) {
      mount(
        main,
        emptyState(
          'No collections yet',
          'Save tabs from the BrowseKit toolbar popup, or create an empty collection.',
          h('button', { class: 'btn btn--primary', type: 'button', onClick: newCollection }, 'New collection'),
        ),
      );
      return;
    }
    const tabs = data.tabsByCollection.get(collection.id) ?? [];
    for (const id of [...state.checked]) if (!tabs.some((t) => t.id === id)) state.checked.delete(id);

    const colorSelect = h(
      'select',
      {
        class: 'btn select select--compact',
        'aria-label': 'Collection colour',
        onChange: () => updateCollection(collection.id, { color: colorSelect.value }).catch(fail),
      },
      COLLECTION_COLORS.map((c) => h('option', { value: c, selected: c === collection.color }, c)),
    );

    const allChecked = tabs.length > 0 && tabs.every((t) => state.checked.has(t.id));
    const bulk = state.checked.size
      ? h(
          'div',
          { class: 'bulk-bar' },
          h('span', null, `${state.checked.size} selected`),
          h('button', { class: 'btn btn--sm', type: 'button', onClick: () => moveDialog([...state.checked]) }, 'Move to…'),
          h('button', { class: 'btn btn--sm', type: 'button', onClick: () => openSome(tabs.filter((t) => state.checked.has(t.id)), false) }, 'Open'),
          h('button', { class: 'btn btn--sm btn--danger', type: 'button', onClick: () => removeTabs([...state.checked]) }, 'Delete'),
        )
      : null;

    mount(
      main,
      h(
        'div',
        { class: 'collection-head' },
        h('span', { class: `dot dot--lg dot--${collection.color}`, 'aria-hidden': 'true' }),
        h('h2', { class: 'collection-head__title' }, collection.name),
        h('span', { class: 'badge badge--muted' }, `${formatNumber(tabs.length)} tab${tabs.length === 1 ? '' : 's'}`),
      ),
      h(
        'div',
        { class: 'btn-row' },
        h('button', { class: 'btn btn--primary', type: 'button', disabled: !tabs.length, onClick: () => openSome(tabs, null) }, 'Open all'),
        h('button', { class: 'btn', type: 'button', disabled: !tabs.length, onClick: () => openSome(tabs, true) }, 'Open in new window'),
        h('button', { class: 'btn', type: 'button', onClick: () => rename(collection) }, 'Rename'),
        colorSelect,
        h('button', { class: 'btn', type: 'button', disabled: !tabs.length, onClick: () => exportOne(collection) }, 'Export'),
        h('button', { class: 'btn btn--danger', type: 'button', onClick: () => removeCollection(collection) }, 'Delete'),
      ),
      tabs.length
        ? h(
            'div',
            { class: 'list-card' },
            h(
              'div',
              { class: 'list-toolbar' },
              h(
                'label',
                { class: 'check' },
                h('input', {
                  type: 'checkbox',
                  checked: allChecked,
                  'aria-label': 'Select all tabs',
                  onChange: (e) => {
                    if (e.target.checked) tabs.forEach((t) => state.checked.add(t.id));
                    else state.checked.clear();
                    renderMain();
                  },
                }),
                'Select all',
              ),
              bulk,
              h('span', { class: 'muted small list-toolbar__hint' }, 'Drag to reorder · Alt+↑/↓ to move'),
            ),
            h('ul', { class: 'rows', 'aria-label': `Tabs in ${collection.name}` }, tabs.map((t, i) => tabRow(t, tabs, i))),
          )
        : emptyState('This collection is empty', 'Use the toolbar popup to save the current tab or window here.'),
    );
  }

  /**
   * @param {import('../../../features/vault/vault-model.js').VaultTab} tab
   * @param {import('../../../features/vault/vault-model.js').VaultTab[]} siblings
   * @param {number} index
   */
  function tabRow(tab, siblings, index) {
    const row = h(
      'li',
      { class: `row${state.checked.has(tab.id) ? ' is-checked' : ''}`, draggable: 'true', tabIndex: 0, dataset: { id: tab.id } },
      h('input', {
        type: 'checkbox',
        checked: state.checked.has(tab.id),
        'aria-label': `Select ${tab.title}`,
        onChange: (e) => {
          if (e.target.checked) state.checked.add(tab.id);
          else state.checked.delete(tab.id);
          renderMain();
        },
      }),
      h('span', { class: 'drag-handle', 'aria-hidden': 'true' }, '⋮⋮'),
      favicon(tab.url),
      h(
        'a',
        {
          class: 'row__main',
          href: tab.url,
          title: tab.url,
          onClick: (e) => {
            e.preventDefault();
            openSome([tab], false, { quiet: true });
          },
        },
        h('span', { class: 'row__title' }, tab.title),
        h('span', { class: 'row__sub' }, hostOf(tab.url)),
      ),
      h(
        'span',
        { class: 'row__actions' },
        h('button', { class: 'icon-btn', type: 'button', title: 'Edit', 'aria-label': `Edit ${tab.title}`, onClick: () => editTab(tab) }, '✎'),
        h('button', { class: 'icon-btn', type: 'button', title: 'Move', 'aria-label': `Move ${tab.title}`, onClick: () => moveDialog([tab.id]) }, '⇄'),
        h('button', { class: 'icon-btn icon-btn--danger', type: 'button', title: 'Delete', 'aria-label': `Delete ${tab.title}`, onClick: () => removeTabs([tab.id]) }, '✕'),
      ),
    );

    row.addEventListener('dragstart', (e) => {
      const ids = state.checked.has(tab.id) ? [...state.checked] : [tab.id];
      e.dataTransfer?.setData('application/x-browsekit-tabs', JSON.stringify(ids));
      e.dataTransfer?.setData('text/uri-list', tab.url);
      row.classList.add('is-dragging');
    });
    row.addEventListener('dragend', () => row.classList.remove('is-dragging'));
    row.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('application/x-browsekit-tabs')) return;
      e.preventDefault();
      const after = e.offsetY > row.clientHeight / 2;
      row.classList.toggle('drop-before', !after);
      row.classList.toggle('drop-after', after);
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      const after = row.classList.contains('drop-after');
      row.classList.remove('drop-before', 'drop-after');
      const dragged = JSON.parse(e.dataTransfer?.getData('application/x-browsekit-tabs') || '[]');
      if (!dragged.length || dragged.includes(tab.id)) return;
      const ids = siblings.map((t) => t.id).filter((id) => !dragged.includes(id));
      const at = ids.indexOf(tab.id) + (after ? 1 : 0);
      const outsiders = dragged.filter((id) => !siblings.some((t) => t.id === id));
      ids.splice(at, 0, ...dragged.filter((id) => !outsiders.includes(id)));
      const collectionId = tab.collectionId;
      (outsiders.length ? moveTabs(outsiders, collectionId) : Promise.resolve())
        .then(() => reorderTabs(collectionId, outsiders.length ? [...ids, ...outsiders] : ids))
        .catch(fail);
    });
    row.addEventListener('keydown', (e) => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      const target = index + (e.key === 'ArrowUp' ? -1 : 1);
      if (target < 0 || target >= siblings.length) return;
      const ids = siblings.map((t) => t.id);
      [ids[index], ids[target]] = [ids[target], ids[index]];
      focusAfterRender = tab.id;
      reorderTabs(tab.collectionId, ids).catch(fail);
    });
    return row;
  }

  function renderSearch() {
    const results = searchTabs(data.tabs, state.query);
    const names = new Map(data.collections.map((c) => [c.id, c]));
    mount(
      main,
      h('div', { class: 'collection-head' }, h('h2', { class: 'collection-head__title' }, `Results for “${state.query}”`), h('span', { class: 'badge badge--muted' }, formatNumber(results.length))),
      results.length
        ? h(
            'div',
            { class: 'list-card' },
            h(
              'ul',
              { class: 'rows' },
              results.slice(0, 500).map((tab) => {
                const col = names.get(tab.collectionId);
                return h(
                  'li',
                  { class: 'row' },
                  favicon(tab.url),
                  h(
                    'a',
                    { class: 'row__main', href: tab.url, title: tab.url, onClick: (e) => { e.preventDefault(); openSome([tab], false, { quiet: true }); } },
                    h('span', { class: 'row__title' }, tab.title),
                    h('span', { class: 'row__sub' }, hostOf(tab.url)),
                  ),
                  col &&
                    h(
                      'button',
                      { class: 'chip', type: 'button', onClick: () => { search.value = ''; state.query = ''; select(col.id); } },
                      h('span', { class: `dot dot--${col.color}`, 'aria-hidden': 'true' }),
                      col.name,
                    ),
                );
              }),
            ),
            results.length > 500 && h('p', { class: 'muted small pad' }, 'Showing the first 500 results. Refine your search to see more.'),
          )
        : emptyState('No saved tabs match', 'Search looks at titles and URLs across all collections.'),
    );
  }

  // --- Actions -----------------------------------------------------------------
  const fail = (err) => toast(errorMessage(err), 'error');
  /** @type {string | null} */
  let focusAfterRender = null;

  function select(id) {
    state.selectedId = id;
    state.checked.clear();
    history.replaceState(null, '', `#/vault?c=${encodeURIComponent(id)}`);
    renderMain();
  }

  async function newCollection() {
    const name = await promptDialog({ title: 'New collection', label: 'Name', placeholder: 'e.g. Research', confirmLabel: 'Create' });
    if (!name) return;
    try {
      const c = await createCollection({ name });
      state.selectedId = c.id;
    } catch (err) {
      fail(err);
    }
  }

  async function rename(collection) {
    const name = await promptDialog({ title: 'Rename collection', label: 'Name', value: collection.name });
    if (name) updateCollection(collection.id, { name }).catch(fail);
  }

  async function removeCollection(collection) {
    const count = data.tabsByCollection.get(collection.id)?.length ?? 0;
    const ok = await confirmDialog({
      title: `Delete “${collection.name}”?`,
      body: `This permanently deletes the collection and its ${count} saved tab${count === 1 ? '' : 's'}.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteCollection(collection.id);
      state.selectedId = data.collections.find((c) => c.id !== collection.id)?.id ?? null;
      toast('Collection deleted.');
    } catch (err) {
      fail(err);
    }
  }

  async function editTab(tab) {
    const title = await promptDialog({ title: 'Edit saved tab', label: 'Title', value: tab.title });
    if (title === null) return;
    const url = await promptDialog({ title: 'Edit saved tab', label: 'URL', value: tab.url });
    if (url === null) return;
    updateTab(tab.id, { title, url }).catch(fail);
  }

  async function moveDialog(ids) {
    const others = data.collections.filter((c) => c.id !== state.selectedId);
    const NEW = '__new__';
    const target = await selectDialog({
      title: `Move ${ids.length} tab${ids.length === 1 ? '' : 's'}`,
      label: 'Destination collection',
      options: [...others.map((c) => ({ value: c.id, label: c.name })), { value: NEW, label: '+ New collection…' }],
      confirmLabel: 'Move',
    });
    if (!target) return;
    try {
      let targetId = target;
      if (target === NEW) {
        const name = await promptDialog({ title: 'New collection', label: 'Name', confirmLabel: 'Create' });
        if (!name) return;
        targetId = (await createCollection({ name })).id;
      }
      await moveTabs(ids, targetId);
      state.checked.clear();
      toast(`Moved ${ids.length} tab${ids.length === 1 ? '' : 's'}.`);
    } catch (err) {
      fail(err);
    }
  }

  async function removeTabs(ids) {
    if (ids.length > 1) {
      const ok = await confirmDialog({ title: `Delete ${ids.length} saved tabs?`, confirmLabel: 'Delete', danger: true });
      if (!ok) return;
    }
    try {
      await deleteTabs(ids);
      ids.forEach((id) => state.checked.delete(id));
    } catch (err) {
      fail(err);
    }
  }

  /**
   * @param {{ url: string }[]} tabs
   * @param {boolean | null} newWindow null = use the setting
   * @param {{ quiet?: boolean }} [options]
   */
  async function openSome(tabs, newWindow, { quiet = false } = {}) {
    if (tabs.length > OPEN_CONFIRM_THRESHOLD) {
      const ok = await confirmDialog({ title: `Open ${tabs.length} tabs?`, body: 'Opening many tabs at once can slow down your browser.', confirmLabel: 'Open all' });
      if (!ok) return;
    }
    const useNewWindow = newWindow ?? (await getSettings()).vault.openIn === 'new-window';
    const { opened, failed } = await openTabs(tabs, { newWindow: useNewWindow, activateFirst: true });
    if (failed.length) toast(`Opened ${opened}; Chrome refused ${failed.length} (e.g. restricted browser pages).`, 'error');
    else if (!quiet) toast(`Opened ${opened} tab${opened === 1 ? '' : 's'}.`);
  }

  async function save(scope) {
    try {
      const r = await saveTabsToVault({ scope });
      state.selectedId = r.collectionId;
      toast(`Saved ${r.added} tab${r.added === 1 ? '' : 's'} to “${r.collectionName}”${r.duplicates ? ` (${r.duplicates} duplicates skipped)` : ''}.`);
    } catch (err) {
      fail(err);
    }
  }

  function exportAll() {
    if (!data.collections.length) return toast('Nothing to export yet.');
    downloadFile(`browsekit-tabvault-${isoDay()}.json`, JSON.stringify(exportVaultJson(data.collections, data.tabsByCollection), null, 2), 'application/json');
  }

  async function exportOne(collection) {
    const format = await selectDialog({
      title: `Export “${collection.name}”`,
      label: 'Format',
      options: [
        { value: 'json', label: 'BrowseKit JSON (re-importable, keeps titles)' },
        { value: 'txt', label: 'Plain URL list (.txt)' },
      ],
      confirmLabel: 'Export',
    });
    if (!format) return;
    const safe = collection.name.replace(/[^\w.-]+/g, '-').slice(0, 40) || 'collection';
    if (format === 'json') {
      downloadFile(`${safe}-${isoDay()}.json`, JSON.stringify(exportVaultJson([collection], data.tabsByCollection), null, 2), 'application/json');
    } else {
      downloadFile(`${safe}-${isoDay()}.txt`, exportUrlList([collection], data.tabsByCollection), 'text/plain');
    }
  }

  async function importFromFile() {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      const parsed = parseVaultImport(text, file.name.replace(/\.[^.]+$/, '') || 'Imported');
      if (!parsed.collections.length) {
        toast(parsed.errors[0] ?? 'No tabs found in that file.', 'error');
        return;
      }
      const tabCount = parsed.collections.reduce((n, c) => n + c.tabs.length, 0);
      const ok = await confirmDialog({
        title: 'Import tabs?',
        body: [
          `Create ${parsed.collections.length} new collection${parsed.collections.length === 1 ? '' : 's'} with ${tabCount} tab${tabCount === 1 ? '' : 's'}. Existing collections are not changed.`,
          ...parsed.errors.map((e) => h('p', { class: 'muted small' }, e)),
        ],
        confirmLabel: 'Import',
      });
      if (!ok) return;
      const result = await importCollections(parsed.collections);
      toast(`Imported ${result.tabs} tabs into ${result.collections} collection${result.collections === 1 ? '' : 's'}.`);
    } catch (err) {
      fail(err);
    }
  }

  // --- Lifecycle ---------------------------------------------------------------
  const refresh = debounce(async () => {
    data = await loadVault();
    if (state.selectedId && !data.collections.some((c) => c.id === state.selectedId)) {
      state.selectedId = data.collections[0]?.id ?? null;
    }
    if (!state.selectedId) state.selectedId = data.collections[0]?.id ?? null;
    renderSummary();
    renderMain();
    if (focusAfterRender) {
      main.querySelector(`.row[data-id="${CSS.escape(focusAfterRender)}"]`)?.focus();
      focusAfterRender = null;
    }
  }, 50);

  const onKey = (/** @type {KeyboardEvent} */ e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    if (e.key === '/' && !target.closest('input, textarea, select, [contenteditable]')) {
      e.preventDefault();
      search.focus();
    }
  };
  document.addEventListener('keydown', onKey);

  renderSummary();
  renderMain();
  const unsubscribe = onDatabaseChange((d) => {
    if (d.stores.some((s) => s === 'collections' || s === 'vaultTabs')) refresh();
  });
  return () => {
    unsubscribe();
    document.removeEventListener('keydown', onKey);
  };
}
