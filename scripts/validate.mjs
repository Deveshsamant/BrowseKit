#!/usr/bin/env node
/**
 * Static policy checks for BrowseKit. Fails (exit 1) if the extension:
 * - is not MV3 or requests permissions outside the allow-list,
 * - weakens the CSP or allows remote code,
 * - references files that don't exist (manifest, HTML, ES imports),
 * - uses network/telemetry primitives, eval, chrome.storage.sync, or HTML sinks,
 * - contains remote http(s) URLs in shipped source.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Permissions BrowseKit may ever request (see architecture.md §4). */
export const ALLOWED_PERMISSIONS = new Set([
  'storage',
  'tabs',
  'favicon',
  'contextMenus',
  'activeTab',
  'scripting',
  'sessions',
]);
export const ALLOWED_OPTIONAL_HOSTS = new Set(['https://*/*', 'http://*/*']);

/** Remote URLs allowed to appear in source (XML namespaces, not fetched). */
const URL_ALLOWLIST = [/^http:\/\/www\.w3\.org\//];

const BANNED_CODE = [
  [/\bfetch\s*\(/, 'network request (fetch)'],
  [/\bXMLHttpRequest\b/, 'network request (XMLHttpRequest)'],
  [/\bWebSocket\b/, 'network connection (WebSocket)'],
  [/\bEventSource\b/, 'network connection (EventSource)'],
  [/\bsendBeacon\b/, 'telemetry primitive (sendBeacon)'],
  [/\beval\s*\(/, 'eval'],
  [/\bnew\s+Function\s*\(/, 'new Function'],
  [/chrome\.storage\.sync\b/, 'chrome.storage.sync (uploads data to Google)'],
  [/chrome\.tabGroups\b/, 'chrome.tabGroups (TabVault must not use tab groups)'],
  [/\.(innerHTML|outerHTML)\s*[+]?=/, 'innerHTML/outerHTML assignment (XSS sink)'],
  [/\binsertAdjacentHTML\b/, 'insertAdjacentHTML (XSS sink)'],
  [/\bdocument\.write\b/, 'document.write'],
  [/\bimportScripts\s*\(/, 'importScripts'],
];

/** Remove comments so documentation can mention banned APIs. Naive but adequate. */
function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/**
 * @param {string} root extension root (folder containing manifest.json)
 * @returns {string[]} errors
 */
export function validateExtension(root) {
  const errors = [];
  const err = (msg) => errors.push(msg);
  const rel = (p) => relative(root, p) || '.';

  const manifestPath = join(root, 'manifest.json');
  if (!existsSync(manifestPath)) return ['manifest.json not found'];
  let m;
  try {
    m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    return [`manifest.json is not valid JSON: ${e.message}`];
  }

  // --- Manifest basics
  if (m.manifest_version !== 3) err('manifest_version must be 3');
  for (const key of ['name', 'version', 'description']) if (!m[key]) err(`manifest.${key} is required`);
  for (const p of m.permissions ?? []) {
    if (!ALLOWED_PERMISSIONS.has(p)) err(`permission "${p}" is not in the allow-list (architecture.md §4)`);
  }
  if ((m.host_permissions ?? []).length) {
    err('host_permissions must be empty; use optional_host_permissions requested at runtime');
  }
  for (const h of m.optional_host_permissions ?? []) {
    if (!ALLOWED_OPTIONAL_HOSTS.has(h)) err(`optional host permission "${h}" is not allowed`);
  }
  for (const cs of m.content_scripts ?? []) {
    if ((cs.matches ?? []).some((x) => x === '<all_urls>' || /^\*:\/\/\*\//.test(x))) {
      err('static content_scripts must not match every site; inject on demand instead');
    }
  }
  if (m.externally_connectable) err('externally_connectable must not be declared');
  if (m.update_url) err('update_url must not be set (no remote update server)');

  // --- CSP
  const csp = m.content_security_policy?.extension_pages;
  if (!csp) err('content_security_policy.extension_pages must be set explicitly');
  else {
    const directives = Object.fromEntries(
      csp
        .split(';')
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => {
          const [name, ...values] = d.split(/\s+/);
          return [name, values];
        }),
    );
    if (/https?:|\*|'unsafe-eval'|'unsafe-inline'/.test(csp)) {
      err('CSP must not allow remote origins, wildcards, unsafe-eval or unsafe-inline');
    }
    if ((directives['script-src'] ?? []).join(' ') !== "'self'") err("CSP script-src must be exactly 'self'");
    if ((directives['connect-src'] ?? []).join(' ') !== "'self'") err("CSP connect-src must be exactly 'self'");
    if ((directives['object-src'] ?? []).join(' ') !== "'none'") err("CSP object-src must be 'none'");
  }

  // --- Files referenced by the manifest
  const refs = [
    ...Object.values(m.icons ?? {}),
    ...Object.values(m.action?.default_icon ?? {}),
    m.action?.default_popup,
    m.options_page,
    m.options_ui?.page,
    m.background?.service_worker,
    ...(m.content_scripts ?? []).flatMap((cs) => [...(cs.js ?? []), ...(cs.css ?? [])]),
  ].filter(Boolean);
  for (const ref of refs) {
    if (!existsSync(join(root, ref))) err(`manifest references missing file: ${ref}`);
  }
  if (m.background?.service_worker && m.background.type !== 'module') {
    err('background.type must be "module"');
  }

  // --- Source files
  const srcDir = join(root, 'src');
  const files = existsSync(srcDir) ? walk(srcDir) : [];
  for (const file of files) {
    const ext = extname(file);
    if (!['.js', '.html', '.css'].includes(ext)) continue;
    const text = readFileSync(file, 'utf8');

    for (const match of text.matchAll(/https?:\/\/[^\s'"`)<>]+/g)) {
      if (!URL_ALLOWLIST.some((re) => re.test(match[0]))) err(`${rel(file)}: remote URL ${match[0]}`);
    }

    if (ext === '.js') {
      const code = stripComments(text);
      for (const [re, what] of BANNED_CODE) {
        if (re.test(code)) err(`${rel(file)}: banned API — ${what}`);
      }
      const specifiers = [
        ...code.matchAll(/\bimport\s+(?:[^'"`]*?\sfrom\s+)?['"]([^'"]+)['"]/g),
        ...code.matchAll(/\bexport\s+[^'"`;]*?\sfrom\s+['"]([^'"]+)['"]/g),
        ...code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
      ].map((x) => x[1]);
      for (const spec of specifiers) {
        if (!spec.startsWith('.')) err(`${rel(file)}: bare/remote import "${spec}" (no dependencies allowed)`);
        else if (!existsSync(resolve(dirname(file), spec))) err(`${rel(file)}: import not found "${spec}"`);
      }
    }

    if (ext === '.html') {
      if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(text)) err(`${rel(file)}: inline <script> is blocked by CSP`);
      if (/<style[\s>]/i.test(text)) err(`${rel(file)}: <style> blocks are blocked by CSP`);
      if (/\sstyle\s*=/i.test(text)) err(`${rel(file)}: inline style="" is blocked by CSP`);
      if (/\son[a-z]+\s*=/i.test(text)) err(`${rel(file)}: inline event handler is blocked by CSP`);
      for (const match of text.matchAll(/\b(?:src|href)\s*=\s*"([^"#][^"]*)"/g)) {
        const ref = match[1];
        if (/^[a-z]+:/i.test(ref)) continue; // remote URLs are reported above
        if (!existsSync(resolve(dirname(file), ref))) err(`${rel(file)}: missing file "${ref}"`);
      }
    }

    if (ext === '.css' && /@import|url\(\s*['"]?(?!data:)[a-z]+:/i.test(text)) {
      err(`${rel(file)}: CSS must not import or load remote resources`);
    }
  }

  return errors;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const errors = validateExtension(root);
  if (errors.length) {
    console.error(`✗ BrowseKit validation failed (${errors.length}):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log('✓ BrowseKit validation passed');
}
