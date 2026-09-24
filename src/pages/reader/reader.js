/**
 * Reader page: renders extracted article blocks as text (never HTML).
 */
import { h, mount, toast } from '../../shared/dom.js';
import { initTheme } from '../../shared/theme.js';
import { applyUiPrefs } from '../../shared/ui-prefs.js';
import { errorMessage } from '../../shared/ui.js';
import { formatReadingTime, WORDS_PER_MINUTE } from '../../shared/text-stats.js';
import { loadArticle } from '../../features/tools/reader.js';
import { addToWatchLater } from '../../features/watch-later/watch-later.js';

const PREFS_KEY = 'reader.prefs';
const DEFAULT_PREFS = { size: 19, width: 'normal', font: 'serif', tone: 'auto' };

const bar = /** @type {HTMLElement} */ (document.getElementById('bar'));
const reader = /** @type {HTMLElement} */ (document.getElementById('reader'));

async function getPrefs() {
  const got = await chrome.storage.local.get(PREFS_KEY);
  return { ...DEFAULT_PREFS, ...(got[PREFS_KEY] ?? {}) };
}

function applyPrefs(p) {
  document.body.dataset.width = p.width;
  document.body.dataset.font = p.font;
  document.body.dataset.tone = p.tone;
  reader.style.fontSize = `${p.size}px`; // CSSOM property: allowed by CSP
}

async function main() {
  initTheme().catch(() => {});
  applyUiPrefs().catch(() => {});
  const id = new URLSearchParams(location.search).get('id') ?? '';
  const article = await loadArticle(id);
  if (!article) {
    mount(reader, h('div', { class: 'empty' }, h('p', { class: 'empty__title' }, 'This reader page has expired'), h('p', { class: 'muted' }, 'Reader articles are kept in memory only and are cleared when the browser closes. Open Reader view again from the page.')));
    return;
  }
  document.title = `${article.title} · Reader`;
  let prefs = await getPrefs();
  applyPrefs(prefs);
  const save = async (patch) => {
    prefs = { ...prefs, ...patch };
    applyPrefs(prefs);
    await chrome.storage.local.set({ [PREFS_KEY]: prefs });
  };

  const seg = (name, options, key) =>
    h(
      'div',
      { class: 'segmented segmented--sm', role: 'radiogroup', 'aria-label': name },
      options.map(([value, label]) =>
        h('label', null, h('input', { type: 'radio', name: key, value, checked: prefs[key] === value, onChange: () => save({ [key]: value }) }), label),
      ),
    );

  mount(
    bar,
    /^(https?|file):/i.test(article.url)
      ? h('a', { class: 'btn btn--sm', href: article.url, title: 'Open the original page' }, '← Original')
      : h('span'),
    h('div', { class: 'reader-bar__group' },
      h('button', { class: 'btn btn--sm', type: 'button', 'aria-label': 'Smaller text', onClick: () => save({ size: Math.max(14, prefs.size - 1) }) }, 'A−'),
      h('button', { class: 'btn btn--sm', type: 'button', 'aria-label': 'Larger text', onClick: () => save({ size: Math.min(28, prefs.size + 1) }) }, 'A+'),
      seg('Font', [['serif', 'Serif'], ['sans', 'Sans']], 'font'),
      seg('Width', [['narrow', 'Narrow'], ['normal', 'Normal'], ['wide', 'Wide']], 'width'),
      seg('Tone', [['auto', 'Auto'], ['sepia', 'Sepia']], 'tone'),
    ),
    h('div', { class: 'reader-bar__group' },
      h('button', { class: 'btn btn--sm', type: 'button', onClick: async () => {
        try {
          await addToWatchLater({ url: article.url, title: article.title, source: 'reader' });
          toast('Saved to Watch Later.');
        } catch (err) {
          toast(errorMessage(err), 'error');
        }
      } }, 'Watch Later'),
      h('button', { class: 'btn btn--sm', type: 'button', onClick: async () => {
        const text = [article.title, '', ...article.blocks.map((b) => (b.t === 'li' ? `• ${b.text}` : b.text))].join('\n\n');
        await navigator.clipboard.writeText(text).then(() => toast('Article text copied.'), (err) => toast(errorMessage(err), 'error'));
      } }, 'Copy text'),
      h('button', { class: 'btn btn--sm', type: 'button', onClick: () => print() }, 'Print / PDF'),
    ),
  );

  const blocks = [];
  let list = null;
  for (const b of article.blocks) {
    if (b.t === 'li') {
      if (!list) {
        list = h('ul');
        blocks.push(list);
      }
      list.append(h('li', null, b.text));
      continue;
    }
    list = null;
    if (b.t === 'h') {
      if (b.text === article.title) continue;
      blocks.push(h(`h${Math.min(4, Math.max(2, b.level ?? 2))}`, null, b.text));
    } else if (b.t === 'q') blocks.push(h('blockquote', null, b.text));
    else if (b.t === 'pre') blocks.push(h('pre', null, b.text));
    else blocks.push(h('p', null, b.text));
  }

  let host = article.site;
  try {
    host = article.site || new URL(article.url).hostname;
  } catch {
    // keep site
  }
  mount(
    reader,
    h(
      'article',
      { class: 'reader__article' },
      h('p', { class: 'reader__meta' }, [host, article.byline, `${formatReadingTime(article.words / WORDS_PER_MINUTE)} read`].filter(Boolean).join(' · ')),
      h('h1', { class: 'reader__title' }, article.title),
      blocks,
      h('p', { class: 'reader__note muted small' }, 'Reader view shows the page’s text only; images, videos and embeds are left out so nothing is loaded from the web.'),
    ),
  );
  reader.focus({ preventScroll: true });
}

main().catch((err) => mount(reader, h('p', { class: 'error-text' }, errorMessage(err))));
