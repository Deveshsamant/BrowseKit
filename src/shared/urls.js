/**
 * Pure URL helpers: saveability, duplicate keys, tracking-parameter cleaning.
 * No chrome.* access so everything here is unit-testable in Node.
 */

/** Schemes BrowseKit will save and reopen. */
const SAVEABLE_PROTOCOLS = new Set(['http:', 'https:', 'file:', 'ftp:', 'chrome:', 'edge:', 'brave:', 'about:']);

/** Browser pages that are never worth saving. */
const IGNORED_URLS = new Set(['about:blank', 'chrome://newtab/', 'edge://newtab/', 'brave://newtab/']);

/**
 * @param {string} url
 * @returns {URL | null}
 */
export function parseUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * Whether a tab URL should be saved. Excludes blank/new-tab pages, script/data
 * URLs, and this extension's own pages.
 * @param {string | undefined} url
 * @param {string} [ownOrigin] e.g. chrome-extension://<id>
 */
export function isSaveableUrl(url, ownOrigin) {
  if (!url || IGNORED_URLS.has(url)) return false;
  const parsed = parseUrl(url);
  if (!parsed) return false;
  if (ownOrigin && url.startsWith(ownOrigin)) return false;
  return SAVEABLE_PROTOCOLS.has(parsed.protocol);
}

/**
 * Whether the URL can be controlled by an extension content script at all.
 * (Chrome also blocks the Web Store; that is detected when injection fails.)
 * @param {string | undefined} url
 */
export function isScriptableUrl(url) {
  const parsed = url ? parseUrl(url) : null;
  return !!parsed && ['http:', 'https:', 'file:'].includes(parsed.protocol);
}

/**
 * Key used to decide whether two URLs are "the same page": ignores the
 * fragment, a trailing slash, default ports and host case.
 * @param {string} url
 */
export function duplicateKey(url) {
  const parsed = parseUrl(url);
  if (!parsed) return url;
  parsed.hash = '';
  let key = parsed.href;
  if (parsed.pathname !== '/' && key.endsWith('/') && !parsed.search) key = key.slice(0, -1);
  return key;
}

/**
 * @param {string} url
 * @returns {string} hostname, or the raw URL if unparseable
 */
export function hostOf(url) {
  const parsed = parseUrl(url);
  return parsed?.hostname || url;
}

// --- Tracking-parameter cleaning -------------------------------------------

/** Parameters removed on every site. Conservative: only well-known trackers. */
const GLOBAL_PARAMS = new Set([
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'twclid', 'ttclid',
  'li_fat_id', 'igshid', 'igsh', 'mc_cid', 'mc_eid', '_hsenc', '_hsmi', 'hsctatracking', 'mkt_tok',
  'oly_anon_id', 'oly_enc_id', 'vero_id', 'vero_conv', '__s', 'rb_clickid', 's_cid', 'ef_id',
  '_ga', '_gl', 'wickedid', 'srsltid', 'spm', 'scm',
]);
const GLOBAL_PREFIXES = ['utm_', 'pk_', 'mtm_', 'stm_'];

/** Site-specific parameters, matched on registrable-domain suffix. */
const SITE_PARAMS = [
  { hosts: ['youtube.com', 'youtu.be'], params: ['si', 'pp', 'feature'] },
  { hosts: ['spotify.com'], params: ['si', 'context'] },
  { hosts: ['twitter.com', 'x.com'], params: ['s', 't', 'ref_src', 'ref_url'] },
  { hosts: ['instagram.com'], params: ['img_index'] },
  { hosts: ['linkedin.com'], params: ['trk', 'trkInfo', 'lipi', 'refId', 'trackingId'] },
  {
    hosts: ['amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.fr', 'amazon.it', 'amazon.es', 'amazon.ca',
      'amazon.in', 'amazon.co.jp', 'amazon.com.au', 'amazon.nl', 'amazon.se', 'amazon.com.br', 'amazon.com.mx'],
    params: ['ref', 'ref_', 'pd_rd_i', 'pd_rd_r', 'pd_rd_w', 'pd_rd_wg', 'pf_rd_i', 'pf_rd_m', 'pf_rd_p',
      'pf_rd_r', 'pf_rd_s', 'pf_rd_t', 'content-id', 'crid', 'sprefix', 'qid', 'sr', 'dib', 'dib_tag',
      'linkCode', 'tag', 'ascsubtag', 'th', 'psc', '_encoding'],
  },
  { hosts: ['aliexpress.com', 'aliexpress.us'], params: ['algo_pvid', 'algo_exp_id', 'pdp_npi', 'aff_platform', 'sk'] },
  { hosts: ['reddit.com'], params: ['share_id', 'rdt'] },
  { hosts: ['tiktok.com'], params: ['is_from_webapp', 'sender_device', 'sender_web_id', '_r', '_t'] },
];

/** @param {string} host @param {string} domain */
const hostMatches = (host, domain) => host === domain || host.endsWith(`.${domain}`);

/**
 * Remove known tracking parameters. Returns the input unchanged if it is not
 * an http(s) URL. Never removes parameters it does not recognise.
 * @param {string} url
 * @returns {{ url: string, removed: string[] }}
 */
export function cleanUrl(url) {
  const parsed = parseUrl(url.trim());
  if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) return { url, removed: [] };
  const host = parsed.hostname.toLowerCase();
  const siteParams = new Set(
    SITE_PARAMS.filter((rule) => rule.hosts.some((d) => hostMatches(host, d))).flatMap((rule) => rule.params),
  );
  const removed = [];
  // Work on the raw query so kept parameters keep their exact encoding.
  const kept = parsed.search
    .slice(1)
    .split('&')
    .filter((pair) => {
      if (!pair) return false;
      const rawKey = pair.split('=')[0];
      let key;
      try {
        key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
      } catch {
        return true;
      }
      const lower = key.toLowerCase();
      if (GLOBAL_PARAMS.has(lower) || GLOBAL_PREFIXES.some((p) => lower.startsWith(p)) || siteParams.has(key)) {
        if (!removed.includes(key)) removed.push(key);
        return false;
      }
      return true;
    });
  if (!removed.length) return { url: url.trim(), removed };
  parsed.search = kept.length ? `?${kept.join('&')}` : '';
  return { url: parsed.href, removed };
}
