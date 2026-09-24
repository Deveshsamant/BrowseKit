/**
 * BrowseKit Media Boost — content script (classic script, isolated world).
 *
 * Injected on demand (popup / keyboard command via activeTab) or registered
 * for sites where the user granted automatic access. Idempotent: a second
 * injection reuses the existing controller.
 *
 * Exposes globalThis.__browsekitMedia.run(command) → status, called by the
 * extension through chrome.scripting.executeScript.
 *
 * Limits (reported to the user, never hidden):
 *  - media inside closed shadow roots or cross-origin iframes (without access) is unreachable
 *  - volume boost > 100% needs Web Audio, which outputs silence for cross-origin
 *    media served without CORS and cannot process DRM (EME) media
 *  - the AudioContext only starts after the user has interacted with the page
 */
(() => {
  'use strict';

  if (globalThis.__browsekitMedia) return;

  const MIN_SPEED = 0.25;
  const MAX_SPEED = 16;
  const MAX_VOLUME = 6; // 600 %
  const SITES_KEY = 'media.sites'; // keep in sync with src/features/media/media-sites.js
  const SETTINGS_KEY = 'settings';
  const host = location.hostname;
  const hasStorage = typeof chrome !== 'undefined' && !!chrome.storage?.local;

  /** User's requested values for this frame; null = leave the page's own value. */
  const desired = { speed: /** @type {number|null} */ (null), volume: /** @type {number|null} */ (null) };
  const options = { speedStep: 0.25, seekStep: 10, inPageShortcuts: true, showOverlay: true };
  let siteRemembered = false;

  /** @type {AudioContext | null} */
  let audioCtx = null;
  /** @type {WeakMap<HTMLMediaElement, GainNode>} */
  const gains = new WeakMap();
  /** @type {WeakSet<HTMLMediaElement>} */
  const tracked = new WeakSet();

  let applying = false;
  let lastUserInputAt = 0;
  let fightCount = 0;
  let fightWindowStart = 0;

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const round2 = (v) => Math.round(v * 100) / 100;

  // --- Discovery ----------------------------------------------------------------

  /** All <video>/<audio> elements, including inside open shadow roots. */
  function collectMedia() {
    /** @type {HTMLMediaElement[]} */
    const found = [];
    const visit = (/** @type {Document | ShadowRoot} */ root) => {
      root.querySelectorAll('video, audio').forEach((el) => found.push(/** @type {HTMLMediaElement} */ (el)));
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const shadow = /** @type {Element} */ (node).shadowRoot;
        if (shadow) visit(shadow);
      }
    };
    visit(document);
    return found;
  }

  /** @param {HTMLMediaElement} el */
  function area(el) {
    const r = el.getBoundingClientRect();
    return r.width * r.height;
  }

  /** The element status/seek/play act on: playing first, then the largest. */
  function primary(list = collectMedia()) {
    if (!list.length) return null;
    const playing = list.filter((el) => !el.paused && !el.ended);
    const pool = playing.length ? playing : list;
    return pool.reduce((best, el) => (area(el) > area(best) ? el : best), pool[0]);
  }

  // --- Volume boost (Web Audio) -------------------------------------------------

  /** @param {HTMLMediaElement} el */
  function boostSupport(el) {
    if (el.mediaKeys) return { ok: false, reason: 'DRM-protected media can’t be boosted.' };
    if (el.srcObject) return { ok: true, reason: '' };
    const src = el.currentSrc || el.src;
    if (!src) return { ok: false, reason: 'No media loaded yet.' };
    if (src.startsWith('blob:') || src.startsWith('data:')) return { ok: true, reason: '' };
    try {
      if (new URL(src, location.href).origin === location.origin) return { ok: true, reason: '' };
    } catch {
      // fall through
    }
    if (el.crossOrigin !== null) return { ok: true, reason: '' };
    return {
      ok: false,
      reason: 'This media is served from another site without CORS; Chrome would play silence if it were boosted.',
    };
  }

  /**
   * Route an element through a GainNode. Refuses when the AudioContext cannot
   * run yet — routing into a suspended context would mute the media.
   * @param {HTMLMediaElement} el
   */
  async function ensureGain(el) {
    const existing = gains.get(el);
    if (existing) return existing;
    const support = boostSupport(el);
    if (!support.ok) throw new Error(support.reason);
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state !== 'running') {
      await Promise.race([audioCtx.resume(), new Promise((r) => setTimeout(r, 400))]);
    }
    if (audioCtx.state !== 'running') {
      throw new Error('Chrome’s autoplay policy is blocking audio processing. Click anywhere on the page once, then try again.');
    }
    const source = audioCtx.createMediaElementSource(el);
    const gain = audioCtx.createGain();
    source.connect(gain).connect(audioCtx.destination);
    gains.set(el, gain);
    return gain;
  }

  // --- Applying settings --------------------------------------------------------

  /** @param {HTMLMediaElement} el */
  async function applyTo(el) {
    track(el);
    applying = true;
    try {
      if (desired.speed !== null && Math.abs(el.playbackRate - desired.speed) > 0.001) {
        el.playbackRate = desired.speed;
      }
      if (desired.volume !== null) {
        if (desired.volume <= 1) {
          el.volume = desired.volume;
          const gain = gains.get(el);
          if (gain) gain.gain.value = 1;
        } else {
          el.volume = 1;
          const gain = await ensureGain(el);
          gain.gain.value = desired.volume;
        }
      }
    } finally {
      applying = false;
    }
  }

  /**
   * Apply desired settings to every media element in the frame. Returns an
   * error only if the primary element (the one the user controls) failed;
   * other elements that can't be boosted simply stay at 100 %.
   */
  async function applyAll() {
    const list = collectMedia();
    const main = primary(list);
    let error = null;
    for (const el of list) {
      try {
        await applyTo(el);
      } catch (err) {
        if (el === main) error = err instanceof Error ? err.message : String(err);
      }
    }
    return error;
  }

  /** Listen once per element so site-initiated speed resets can be re-applied. */
  function track(el) {
    if (tracked.has(el)) return;
    tracked.add(el);
    el.addEventListener('ratechange', () => {
      if (applying || desired.speed === null || Math.abs(el.playbackRate - desired.speed) < 0.001) return;
      // The user just changed speed with the site's own controls: adopt it.
      if (Date.now() - lastUserInputAt < 1000) {
        desired.speed = clamp(el.playbackRate, MIN_SPEED, MAX_SPEED);
        return;
      }
      const now = Date.now();
      if (now - fightWindowStart > 5000) {
        fightWindowStart = now;
        fightCount = 0;
      }
      if (++fightCount > 30) return; // the player insists; stop fighting it
      applying = true;
      try {
        el.playbackRate = desired.speed;
      } finally {
        applying = false;
      }
    });
  }

  // New media (e.g. next video in a playlist) picks up the user's settings.
  const onMediaEvent = (/** @type {Event} */ e) => {
    const el = e.target;
    if (el instanceof HTMLMediaElement && (desired.speed !== null || desired.volume !== null)) {
      applyTo(el).catch(() => {});
    }
  };
  document.addEventListener('loadedmetadata', onMediaEvent, true);
  document.addEventListener('play', onMediaEvent, true);
  for (const type of ['pointerdown', 'keydown']) {
    window.addEventListener(type, (e) => { if (e.isTrusted) lastUserInputAt = Date.now(); }, true);
  }

  // --- Overlay ------------------------------------------------------------------

  let overlay = /** @type {HTMLElement | null} */ (null);
  let overlayTimer = 0;
  /** @param {string} text */
  function flash(text) {
    if (!options.showOverlay) return;
    if (!overlay) {
      overlay = document.createElement('browsekit-media-overlay');
      const shadow = overlay.attachShadow({ mode: 'closed' });
      const label = document.createElement('span');
      Object.assign(label.style, {
        position: 'fixed', top: '16px', left: '16px', zIndex: '2147483647', padding: '6px 12px',
        borderRadius: '8px', background: 'rgba(17,19,22,.85)', color: '#fff', pointerEvents: 'none',
        font: '600 15px/1.3 system-ui, sans-serif', transition: 'opacity .2s', opacity: '0',
      });
      shadow.append(label);
      /** @type {any} */ (overlay).__label = label;
    }
    const parent = document.fullscreenElement ?? document.documentElement;
    if (overlay.parentNode !== parent) parent.append(overlay);
    const label = /** @type {any} */ (overlay).__label;
    label.textContent = text;
    label.style.opacity = '1';
    clearTimeout(overlayTimer);
    overlayTimer = setTimeout(() => { label.style.opacity = '0'; }, 900);
  }

  // --- Status & commands --------------------------------------------------------

  function status(extra = {}) {
    const list = collectMedia();
    const el = primary(list);
    if (!el) return { count: 0, isTop: window.top === window.self, host, ...extra };
    const gain = gains.get(el);
    const live = !Number.isFinite(el.duration) && el.seekable.length === 0;
    return {
      count: list.length,
      isTop: window.top === window.self,
      host,
      kind: el instanceof HTMLVideoElement ? 'video' : 'audio',
      playing: !el.paused && !el.ended,
      speed: round2(el.playbackRate),
      volume: round2(el.volume * (gain ? gain.gain.value : 1)),
      muted: el.muted,
      currentTime: el.currentTime,
      duration: Number.isFinite(el.duration) ? el.duration : null,
      live,
      boost: boostSupport(el),
      siteRemembered,
      ...extra,
    };
  }

  /** @param {number} delta */
  function seek(delta) {
    const el = primary();
    if (!el) return;
    let min = 0;
    let max = Number.isFinite(el.duration) ? el.duration : 0;
    if (!Number.isFinite(el.duration)) {
      if (!el.seekable.length) throw new Error('This is a live stream without a seekable range.');
      min = el.seekable.start(0);
      max = el.seekable.end(el.seekable.length - 1);
    }
    el.currentTime = clamp(el.currentTime + delta, min, max);
  }

  const fmtSpeed = (v) => `${round2(v)}×`;

  /**
   * @param {{ op: string, value?: number, delta?: number, prefs?: { speed?: number|null, volume?: number|null }, options?: object }} cmd
   */
  async function run(cmd) {
    let error = null;
    try {
      const list = collectMedia();
      const el = primary(list);
      switch (cmd.op) {
        case 'status':
          break;
        case 'setSpeed':
          desired.speed = clamp(Number(cmd.value) || 1, MIN_SPEED, MAX_SPEED);
          error = await applyAll();
          if (el) flash(fmtSpeed(desired.speed));
          break;
        case 'stepSpeed': {
          const base = desired.speed ?? el?.playbackRate ?? 1;
          desired.speed = clamp(round2(base + (Number(cmd.delta) || 0)), MIN_SPEED, MAX_SPEED);
          error = await applyAll();
          if (el) flash(fmtSpeed(desired.speed));
          break;
        }
        case 'setVolume':
          desired.volume = clamp(Number(cmd.value), 0, MAX_VOLUME);
          if (!Number.isFinite(desired.volume)) desired.volume = 1;
          error = await applyAll();
          if (el) flash(`Volume ${Math.round(desired.volume * 100)}%`);
          break;
        case 'toggleMute':
          if (el) {
            const muted = !el.muted;
            list.forEach((m) => { m.muted = muted; });
            flash(muted ? 'Muted' : 'Unmuted');
          }
          break;
        case 'seek':
          seek(Number(cmd.delta) || 0);
          if (el) flash(`${cmd.delta > 0 ? '+' : '−'}${Math.abs(Number(cmd.delta))} s`);
          break;
        case 'togglePlay':
          if (el) {
            if (el.paused) await el.play();
            else el.pause();
          }
          break;
        case 'reset':
          desired.speed = 1;
          desired.volume = 1;
          error = await applyAll();
          desired.speed = null;
          desired.volume = null;
          if (el) flash('Reset');
          break;
        case 'applySite':
          siteRemembered = true;
          desired.speed = cmd.prefs?.speed ?? null;
          desired.volume = cmd.prefs?.volume ?? null;
          error = await applyAll();
          break;
        case 'forgetSite':
          siteRemembered = false;
          break;
        case 'configure':
          Object.assign(options, cmd.options ?? {});
          break;
        default:
          error = `Unknown command ${cmd.op}`;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    return status(error ? { error } : {});
  }

  globalThis.__browsekitMedia = { run };

  // --- In-page shortcuts: [ slower, ] faster, \ reset --------------------------

  window.addEventListener(
    'keydown',
    (e) => {
      if (!options.inPageShortcuts || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      if (!['[', ']', '\\'].includes(e.key)) return;
      const t = /** @type {HTMLElement} */ (e.composedPath()[0] ?? e.target);
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName ?? ''))) return;
      if (!primary()) return;
      e.preventDefault();
      e.stopPropagation();
      const op = e.key === '\\' ? { op: 'setSpeed', value: 1 } : { op: 'stepSpeed', delta: e.key === ']' ? options.speedStep : -options.speedStep };
      run(op).then(() => persistSpeed());
    },
    true,
  );

  /** Keep a remembered site's speed in sync with in-page shortcut changes. */
  function persistSpeed() {
    if (!hasStorage || !siteRemembered || desired.speed === null) return;
    chrome.storage.local.get(SITES_KEY).then((got) => {
      const sites = got[SITES_KEY] ?? {};
      if (!sites[host]) return;
      sites[host] = { ...sites[host], speed: desired.speed, updatedAt: Date.now() };
      return chrome.storage.local.set({ [SITES_KEY]: sites });
    }).catch(() => {});
  }

  // --- Load remembered settings for this site -----------------------------------

  if (hasStorage) {
    chrome.storage.local.get([SITES_KEY, SETTINGS_KEY]).then((got) => {
      const media = got[SETTINGS_KEY]?.media;
      if (media) Object.assign(options, {
        speedStep: media.speedStep ?? options.speedStep,
        seekStep: media.seekStep ?? options.seekStep,
        inPageShortcuts: media.inPageShortcuts ?? options.inPageShortcuts,
        showOverlay: media.showOverlay ?? options.showOverlay,
      });
      const prefs = got[SITES_KEY]?.[host];
      if (prefs) {
        siteRemembered = true;
        if (desired.speed === null) desired.speed = prefs.speed ?? null;
        if (desired.volume === null) desired.volume = prefs.volume ?? null;
        applyAll();
      }
    }).catch(() => {});
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[SETTINGS_KEY]?.newValue?.media) {
        const media = changes[SETTINGS_KEY].newValue.media;
        Object.assign(options, { speedStep: media.speedStep, seekStep: media.seekStep, inPageShortcuts: media.inPageShortcuts, showOverlay: media.showOverlay });
      }
      if (changes[SITES_KEY]) siteRemembered = !!changes[SITES_KEY].newValue?.[host];
    });
  }
})();
