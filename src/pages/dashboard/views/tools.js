/**
 * Standalone utilities: URL cleaner, text counter, QR generator.
 * Page-specific tools (copy, word count, screenshot, print) live in the popup
 * because they act on the tab the user is looking at.
 */
import { h, mount, toast } from '../../../shared/dom.js';
import { downloadFile } from '../../../shared/files.js';
import { formatNumber } from '../../../shared/format.js';
import { qrPngBlob, qrSvgFile, renderQrSvg } from '../../../shared/qr-view.js';
import { WORDS_PER_MINUTE, formatReadingTime, textStats } from '../../../shared/text-stats.js';
import { debounce, errorMessage } from '../../../shared/ui.js';
import { cleanUrl } from '../../../shared/urls.js';

/** @param {string} text @param {string} what */
async function copy(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copied ${what}.`);
  } catch (err) {
    toast(`Copy failed: ${errorMessage(err)}`, 'error');
  }
}

/** @param {HTMLElement} root */
export function render(root) {
  mount(
    root,
    h(
      'header',
      { class: 'page-header' },
      h('div', null, h('h1', null, 'Tools'), h('p', { class: 'muted' }, 'Everything runs on this device — nothing is sent anywhere.')),
    ),
    h(
      'div',
      { class: 'stack' },
      urlCleaner(),
      h('div', { class: 'two-col' }, textCounter(), qrGenerator()),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card__title' }, 'Tools for the current page'),
        h(
          'p',
          { class: 'muted' },
          'Open the BrowseKit toolbar popup → Tools to copy the URL/title/Markdown link, copy a clean URL, count words and reading time (selection or whole page), show a QR code, save or copy a screenshot of the visible area, or print / save as PDF.',
        ),
      ),
    ),
  );
}

function urlCleaner() {
  const input = h('textarea', { class: 'input textarea', rows: 3, placeholder: 'Paste one or more URLs (one per line)…', 'aria-label': 'URLs to clean', onInput: debounce(update, 80) });
  const output = h('textarea', { class: 'input textarea mono', rows: 3, readOnly: true, 'aria-label': 'Cleaned URLs' });
  const removedLine = h('p', { class: 'muted small' }, 'Removes known tracking parameters (utm_*, fbclid, gclid, YouTube “si”, Amazon ref tags…). Unknown parameters are kept so links keep working.');
  function update() {
    const lines = input.value.split(/\r?\n/);
    const results = lines.map((l) => (l.trim() ? cleanUrl(l.trim()) : { url: '', removed: [] }));
    output.value = results.map((r) => r.url).join('\n');
    const removed = [...new Set(results.flatMap((r) => r.removed))];
    removedLine.textContent = removed.length ? `Removed: ${removed.join(', ')}` : input.value.trim() ? 'No known tracking parameters found.' : removedLine.textContent;
  }
  return h(
    'section',
    { class: 'card' },
    h('h2', { class: 'card__title' }, 'URL cleaner'),
    input,
    output,
    removedLine,
    h('div', { class: 'btn-row' }, h('button', { class: 'btn btn--primary', type: 'button', onClick: () => output.value && copy(output.value, 'clean URLs') }, 'Copy result')),
  );
}

function textCounter() {
  const input = h('textarea', { class: 'input textarea', rows: 8, placeholder: 'Paste or type text…', 'aria-label': 'Text to count', onInput: debounce(update, 60) });
  const out = h('div', { class: 'stats-grid' });
  function update() {
    const s = textStats(input.value);
    mount(
      out,
      [
        [formatNumber(s.words), 'words'],
        [formatNumber(s.characters), 'characters'],
        [formatNumber(s.charactersNoSpaces), 'without spaces'],
        [formatNumber(s.lines), 'lines'],
        [formatReadingTime(s.readingMinutes), 'reading time'],
      ].map(([v, l]) => h('div', { class: 'stat-mini' }, h('strong', null, v), h('span', { class: 'muted small' }, l))),
    );
  }
  update();
  return h(
    'section',
    { class: 'card' },
    h('h2', { class: 'card__title' }, 'Word & character counter'),
    input,
    out,
    h('p', { class: 'muted small' }, `Reading time assumes ${WORDS_PER_MINUTE} words per minute. Words are counted with the browser’s language-aware segmenter.`),
  );
}

function qrGenerator() {
  const input = h('textarea', { class: 'input textarea', rows: 3, placeholder: 'Text or URL…', 'aria-label': 'QR code content', onInput: debounce(update, 120) });
  const ecc = h(
    'select',
    { class: 'btn select', 'aria-label': 'Error correction', onChange: update },
    h('option', { value: 'L' }, 'Low (7%)'),
    h('option', { value: 'M', selected: true }, 'Medium (15%)'),
    h('option', { value: 'Q' }, 'Quartile (25%)'),
    h('option', { value: 'H' }, 'High (30%)'),
  );
  const preview = h('div', { class: 'qr-box qr-box--lg' });
  const info = h('p', { class: 'muted small' });
  /** @type {any} */
  let current = null;
  function update() {
    const text = input.value;
    current = null;
    if (!text) {
      mount(preview, h('p', { class: 'muted small' }, 'Your QR code appears here.'));
      info.textContent = 'Generated locally — the text is never sent to a QR service.';
      return;
    }
    try {
      const { svg, qr } = renderQrSvg(text, { ecc: /** @type {any} */ (ecc.value), label: 'Generated QR code' });
      current = qr;
      mount(preview, svg);
      info.textContent = `Version ${qr.version} · ${qr.size}×${qr.size} modules · error correction ${qr.ecc}`;
    } catch (err) {
      mount(preview, h('p', { class: 'error-text' }, errorMessage(err)));
    }
  }
  update();
  return h(
    'section',
    { class: 'card' },
    h('h2', { class: 'card__title' }, 'QR code generator'),
    input,
    h('label', { class: 'field field--inline' }, h('span', { class: 'field__label' }, 'Error correction'), ecc),
    preview,
    info,
    h(
      'div',
      { class: 'btn-row' },
      h('button', { class: 'btn btn--primary', type: 'button', onClick: async () => current && downloadFile('qr-code.png', await qrPngBlob(current, 12)) }, 'Download PNG'),
      h('button', { class: 'btn', type: 'button', onClick: () => current && downloadFile('qr-code.svg', qrSvgFile(current), 'image/svg+xml') }, 'Download SVG'),
      h(
        'button',
        {
          class: 'btn',
          type: 'button',
          onClick: async () => {
            if (!current) return;
            try {
              await navigator.clipboard.write([new ClipboardItem({ 'image/png': await qrPngBlob(current, 12) })]);
              toast('QR code copied.');
            } catch (err) {
              toast(`Copy failed: ${errorMessage(err)}`, 'error');
            }
          },
        },
        'Copy image',
      ),
    ),
  );
}
