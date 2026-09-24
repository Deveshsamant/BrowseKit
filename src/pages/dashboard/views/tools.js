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
import {
  base64Decode,
  base64Encode,
  convertCase,
  formatJson,
  generatePassword,
  hashText,
  parseTimestamp,
  urlDecode,
  urlEncode,
  uuid,
} from '../../../shared/dev-tools.js';

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
      devTools(),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card__title' }, 'Tools for the current page'),
        h(
          'p',
          { class: 'muted' },
          'Open the BrowseKit popup → Tools for Reader view, link extraction, copy URL/title/Markdown link, clean URL, word count and reading time, QR code, visible-area screenshot, and print / save as PDF.',
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

/** Developer & text utilities with one shared input/output. */
function devTools() {
  const input = h('textarea', { class: 'input textarea mono', rows: 6, placeholder: 'Input…', 'aria-label': 'Tool input', spellcheck: false });
  const output = h('textarea', { class: 'input textarea mono', rows: 6, readOnly: true, placeholder: 'Output', 'aria-label': 'Tool output', spellcheck: false });
  const errorLine = h('p', { class: 'error-text small', 'aria-live': 'polite' });
  const pwLength = h('input', { class: 'input input--num', type: 'number', min: '8', max: '128', value: '20', 'aria-label': 'Password length' });
  const pwSymbols = h('input', { type: 'checkbox', checked: true, 'aria-label': 'Include symbols' });

  /** @param {() => string | Promise<string>} fn */
  const run = (fn) => async () => {
    errorLine.textContent = '';
    try {
      output.value = await fn();
    } catch (err) {
      output.value = '';
      errorLine.textContent = errorMessage(err);
    }
  };
  const json = (indent) => () => {
    const r = formatJson(input.value, indent);
    if (!r.ok) throw new Error(`Invalid JSON: ${r.error}`);
    return r.text;
  };
  const group = (label, ...buttons) => h('div', { class: 'tool-group' }, h('span', { class: 'field__label' }, label), h('div', { class: 'btn-row' }, buttons));
  const btn = (label, fn) => h('button', { class: 'btn btn--sm', type: 'button', onClick: run(fn) }, label);

  return h(
    'section',
    { class: 'card' },
    h('h2', { class: 'card__title' }, 'Developer & text tools'),
    h('p', { class: 'muted small' }, 'Everything runs in this page. Nothing you paste is stored or sent anywhere.'),
    h('div', { class: 'two-col two-col--tight' }, input, output),
    errorLine,
    h(
      'div',
      { class: 'tool-groups' },
      group('JSON', btn('Format', json(2)), btn('Minify', json(0))),
      group('Base64', btn('Encode', () => base64Encode(input.value)), btn('Decode', () => base64Decode(input.value))),
      group('URL', btn('Encode', () => urlEncode(input.value)), btn('Decode', () => urlDecode(input.value))),
      group('Hash', ...['SHA-1', 'SHA-256', 'SHA-512'].map((a) => btn(a, () => hashText(/** @type {any} */ (a), input.value)))),
      group(
        'Case',
        ...[
          ['UPPER', 'upper'],
          ['lower', 'lower'],
          ['Title', 'title'],
          ['Sentence', 'sentence'],
          ['camelCase', 'camel'],
          ['snake_case', 'snake'],
          ['kebab-case', 'kebab'],
        ].map(([label, mode]) => btn(label, () => convertCase(input.value, /** @type {any} */ (mode)))),
      ),
      group(
        'Timestamp',
        btn('Convert', () => {
          const r = parseTimestamp(input.value);
          if (!r.ok) throw new Error(r.error);
          return `ISO:     ${r.iso}\nLocal:   ${new Date(r.ms).toString()}\nSeconds: ${r.seconds}\nMillis:  ${r.ms}`;
        }),
        btn('Now', () => {
          const now = Date.now();
          return `ISO:     ${new Date(now).toISOString()}\nSeconds: ${Math.floor(now / 1000)}\nMillis:  ${now}`;
        }),
      ),
      group(
        'Generate',
        btn('UUID', () => Array.from({ length: 5 }, uuid).join('\n')),
        btn('Password', () => generatePassword({ length: Number(pwLength.value) || 20, symbols: pwSymbols.checked })),
        h('label', { class: 'check small' }, 'Length', pwLength),
        h('label', { class: 'check small' }, pwSymbols, 'Symbols'),
      ),
    ),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', onClick: () => output.value && copy(output.value, 'output') }, 'Copy output'), h('button', { class: 'btn', type: 'button', onClick: () => { input.value = output.value; } }, 'Use output as input')),
  );
}
