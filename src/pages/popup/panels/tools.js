/**
 * Popup "Tools" panel: copy, clean URL, page stats, QR, screenshot, print.
 */
import { ROUTES } from '../../../shared/constants.js';
import { h, mount, toast } from '../../../shared/dom.js';
import { downloadFile } from '../../../shared/files.js';
import { formatNumber, isoDay } from '../../../shared/format.js';
import { qrPngBlob, renderQrSvg } from '../../../shared/qr-view.js';
import { formatReadingTime, textStats } from '../../../shared/text-stats.js';
import { errorMessage } from '../../../shared/ui.js';
import { cleanUrl, hostOf, isScriptableUrl } from '../../../shared/urls.js';
import { captureVisible, printTab, readPageText } from '../../../features/tools/page-tools.js';
import { friendlyInjectionError } from '../../../features/media/media-control.js';

/**
 * @param {HTMLElement} root
 * @param {import('../popup.js').PopupContext} ctx
 */
export async function renderToolsPanel(root, ctx) {
  const { tab } = ctx;
  const url = tab?.url ?? '';
  const title = tab?.title ?? '';
  const scriptable = isScriptableUrl(url);
  const cleaned = cleanUrl(url);

  /** @param {string} text @param {string} what */
  async function copy(text, what) {
    try {
      await navigator.clipboard.writeText(text);
      toast(`Copied ${what}.`);
    } catch (err) {
      toast(`Copy failed: ${errorMessage(err)}`, 'error');
    }
  }

  const statsOut = h('div', { class: 'stats-grid', hidden: true });
  async function countWords() {
    try {
      const { text, source, truncated } = await readPageText(/** @type {number} */ (tab?.id));
      const s = textStats(text);
      mount(
        statsOut,
        stat(formatNumber(s.words), 'words'),
        stat(formatNumber(s.characters), 'characters'),
        stat(formatNumber(s.charactersNoSpaces), 'no spaces'),
        stat(formatReadingTime(s.readingMinutes), 'reading time'),
        h('p', { class: 'muted small stats-grid__note' }, `${source === 'selection' ? 'Selected text' : 'Whole page text (incl. menus/footers)'}${truncated ? ', first 5 MB' : ''} · ${238} wpm`),
      );
      statsOut.hidden = false;
    } catch (err) {
      toast(friendlyInjectionError(err), 'error');
    }
  }

  const qrHost = h('div', { class: 'qr-box', hidden: true });
  function showQr() {
    if (!qrHost.hidden) {
      qrHost.hidden = true;
      return;
    }
    try {
      const { svg, qr } = renderQrSvg(cleaned.url, { label: `QR code for ${hostOf(url)}` });
      mount(
        qrHost,
        svg,
        h(
          'button',
          {
            class: 'btn btn--sm',
            type: 'button',
            onClick: async () => downloadFile(`qr-${hostOf(url)}.png`, await qrPngBlob(qr)),
          },
          'Download PNG',
        ),
      );
      qrHost.hidden = false;
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  async function screenshot(mode) {
    try {
      const blob = await captureVisible(/** @type {number} */ (tab?.windowId));
      if (mode === 'copy') {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast('Screenshot copied.');
      } else {
        downloadFile(`screenshot-${hostOf(url)}-${isoDay()}.png`, blob);
        toast('Screenshot saved to Downloads.');
      }
    } catch (err) {
      toast(`Screenshot unavailable: ${friendlyInjectionError(err)}`, 'error');
    }
  }

  const md = `[${title.replace(/([[\]])/g, '\\$1')}](${url})`;
  mount(
    root,
    h(
      'section',
      { class: 'popup-section' },
      h('h2', null, 'Copy'),
      h(
        'div',
        { class: 'btn-grid btn-grid--2' },
        h('button', { class: 'btn', type: 'button', disabled: !url, onClick: () => copy(url, 'URL') }, 'URL'),
        h('button', { class: 'btn', type: 'button', disabled: !title, onClick: () => copy(title, 'title') }, 'Title'),
        h('button', { class: 'btn', type: 'button', disabled: !url, onClick: () => copy(`${title}\n${url}`, 'title + URL') }, 'Title + URL'),
        h('button', { class: 'btn', type: 'button', disabled: !url, onClick: () => copy(md, 'Markdown link') }, 'Markdown link'),
      ),
      h(
        'button',
        {
          class: 'btn btn--block',
          type: 'button',
          disabled: !cleaned.removed.length,
          title: cleaned.removed.length ? `Removes: ${cleaned.removed.join(', ')}` : 'No known tracking parameters in this URL',
          onClick: () => copy(cleaned.url, 'clean URL'),
        },
        cleaned.removed.length ? `Copy clean URL (−${cleaned.removed.length} tracker${cleaned.removed.length === 1 ? '' : 's'})` : 'No trackers in this URL',
      ),
    ),
    h(
      'section',
      { class: 'popup-section' },
      h('h2', null, 'Page'),
      h(
        'div',
        { class: 'btn-grid btn-grid--2' },
        h('button', { class: 'btn', type: 'button', disabled: !scriptable, onClick: countWords }, 'Word count'),
        h('button', { class: 'btn', type: 'button', disabled: !url, onClick: showQr }, 'QR code'),
        h('button', { class: 'btn', type: 'button', onClick: () => screenshot('save') }, 'Save screenshot'),
        h('button', { class: 'btn', type: 'button', onClick: () => screenshot('copy') }, 'Copy screenshot'),
        h('button', { class: 'btn', type: 'button', disabled: !scriptable, onClick: () => printTab(/** @type {number} */ (tab?.id)).then(() => window.close(), (err) => toast(friendlyInjectionError(err), 'error')) }, 'Print / PDF'),
        h('button', { class: 'btn', type: 'button', onClick: () => ctx.openDashboard(ROUTES.TOOLS) }, 'More tools →'),
      ),
      statsOut,
      qrHost,
      h('p', { class: 'muted small' }, 'Screenshots capture the visible area only. Browser pages can’t be read or printed by extensions.'),
    ),
  );
}

/** @param {string} value @param {string} label */
function stat(value, label) {
  return h('div', { class: 'stat-mini' }, h('strong', null, value), h('span', { class: 'muted small' }, label));
}
