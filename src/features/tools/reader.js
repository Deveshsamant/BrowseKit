/**
 * Reader view: extract the main article text from a page (on demand, via
 * activeTab + scripting) and show it in a clean extension page. Text only —
 * images, videos and embeds are left out so the reader never loads remote
 * content. Works best on article-style pages; results vary by site.
 */

const KEY_PREFIX = 'reader:';
const MAX_KEPT = 8;

/** @typedef {{ t: 'h' | 'p' | 'li' | 'q' | 'pre', text: string, level?: number }} ReaderBlock */
/** @typedef {{ title: string, byline: string, site: string, url: string, blocks: ReaderBlock[], words: number, createdAt: number }} ReaderArticle */

/**
 * Runs inside the page (must be self-contained).
 * @returns {Omit<ReaderArticle, 'createdAt'>}
 */
function extractInPage() {
  const SKIP = 'nav, aside, footer, header, form, [role=navigation], [role=complementary], [aria-hidden=true], .ad, .ads, .advert, .share, .social, .comments, .related, script, style, noscript';
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const textLen = (el) => clean(el.textContent).length;

  // Score candidate containers by the paragraph text they directly hold.
  let best = null;
  let bestScore = 0;
  for (const el of document.querySelectorAll('article, main, [role=main], div, section, td')) {
    if (el.closest(SKIP)) continue;
    let score = 0;
    for (const child of el.children) {
      if (child.tagName === 'P' || child.tagName === 'PRE' || child.tagName === 'BLOCKQUOTE') {
        const len = textLen(child);
        if (len > 40) score += len + (child.textContent.match(/,/g) || []).length * 10;
      }
    }
    const linkText = [...el.querySelectorAll('a')].reduce((n, a) => n + textLen(a), 0);
    const density = linkText / Math.max(1, textLen(el));
    score *= 1 - Math.min(0.9, density);
    if (el.tagName === 'ARTICLE' || el.getAttribute('role') === 'main') score *= 1.25;
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }
  const root = best ?? document.body;
  const selector = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, figcaption';
  const blocks = [];
  let last = '';
  for (const el of root.querySelectorAll(selector)) {
    if (el.closest(SKIP) && !root.closest(SKIP)) continue;
    if (el.tagName !== 'PRE' && el.querySelector(selector)) continue; // leaves only
    const text = el.tagName === 'PRE' ? (el.textContent || '').replace(/\s+$/, '') : clean(el.innerText || el.textContent);
    if (!text || text === last) continue;
    last = text;
    const tag = el.tagName;
    if (/^H[1-6]$/.test(tag)) blocks.push({ t: 'h', level: Number(tag[1]), text });
    else if (tag === 'LI') blocks.push({ t: 'li', text });
    else if (tag === 'BLOCKQUOTE') blocks.push({ t: 'q', text });
    else if (tag === 'PRE') blocks.push({ t: 'pre', text });
    else blocks.push({ t: 'p', text });
    if (blocks.length >= 3000) break;
  }
  const words = blocks.reduce((n, b) => n + (b.text.match(/\S+/g) || []).length, 0);
  const meta = (name) => document.querySelector(`meta[name="${name}"], meta[property="${name}"]`)?.getAttribute('content') || '';
  return {
    title: clean(document.querySelector('h1')?.innerText) || clean(meta('og:title')) || document.title,
    byline: clean(meta('author')),
    site: clean(meta('og:site_name')) || location.hostname,
    url: location.href,
    blocks,
    words,
  };
}

/**
 * @param {number} tabId
 * @returns {Promise<ReaderArticle>}
 */
export async function extractArticle(tabId) {
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: extractInPage });
  const article = result?.result;
  if (!article || !article.blocks.length) throw new Error('No readable article text was found on this page.');
  return { ...article, createdAt: Date.now() };
}

/**
 * Extract and open in the reader page next to the source tab.
 * @param {chrome.tabs.Tab} tab
 */
export async function openReaderForTab(tab) {
  if (tab.id === undefined) throw new Error('No tab.');
  const article = await extractArticle(tab.id);
  const id = crypto.randomUUID();
  // Session storage: in memory only, cleared when the browser closes.
  const all = await chrome.storage.session.get(null);
  const old = Object.entries(all)
    .filter(([k]) => k.startsWith(KEY_PREFIX))
    .sort((a, b) => (b[1]?.createdAt ?? 0) - (a[1]?.createdAt ?? 0))
    .slice(MAX_KEPT - 1)
    .map(([k]) => k);
  if (old.length) await chrome.storage.session.remove(old);
  await chrome.storage.session.set({ [`${KEY_PREFIX}${id}`]: article });
  await chrome.tabs.create({ url: chrome.runtime.getURL(`src/pages/reader/reader.html?id=${id}`), index: tab.index + 1, windowId: tab.windowId });
}

/** @param {string} id @returns {Promise<ReaderArticle | null>} */
export async function loadArticle(id) {
  const key = `${KEY_PREFIX}${id}`;
  return (await chrome.storage.session.get(key))[key] ?? null;
}
