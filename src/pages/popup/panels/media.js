/**
 * Popup "Media" panel: controls for HTML5 video/audio on the current tab.
 */
import { ROUTES } from '../../../shared/constants.js';
import { h, mount, toast } from '../../../shared/dom.js';
import { isScriptableUrl } from '../../../shared/urls.js';
import { errorMessage } from '../../../shared/ui.js';
import {
  friendlyInjectionError,
  injectMediaScript,
  pickFrame,
  runMediaCommand,
} from '../../../features/media/media-control.js';
import {
  getSite,
  hasAutoAccess,
  originPattern,
  removeSite,
  requestAutoAccess,
  saveSite,
} from '../../../features/media/media-sites.js';

const PRESETS = [0.5, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const MIN_SPEED = 0.25;
const MAX_SPEED = 16;

/** @param {number | null | undefined} s */
const fmtTime = (s) => {
  if (s === null || s === undefined || !Number.isFinite(s)) return '–';
  const t = Math.floor(s);
  const hh = Math.floor(t / 3600);
  const mm = Math.floor((t % 3600) / 60);
  const ss = String(t % 60).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
};

/**
 * @param {HTMLElement} root
 * @param {import('../popup.js').PopupContext} ctx
 */
export async function renderMediaPanel(root, ctx) {
  const { tab, settings } = ctx;
  const tabId = tab?.id;
  if (tabId === undefined || !isScriptableUrl(tab?.url)) {
    mount(root, notice('Media controls aren’t available here', 'Chrome doesn’t let extensions control browser pages, the Web Store, or other extensions.'));
    return;
  }

  try {
    await injectMediaScript(tabId);
  } catch (err) {
    mount(root, notice('Media controls aren’t available here', friendlyInjectionError(err)));
    return;
  }

  /** @type {import('../../../features/media/media-control.js').FrameStatus | null} */
  let status = null;
  let frameId = 0;

  async function refreshStatus() {
    const frames = await runMediaCommand(tabId, { op: 'status' });
    const frame = pickFrame(frames);
    status = frame;
    if (frame) frameId = frame.frameId;
    return frame;
  }

  /** @param {object} command */
  async function run(command) {
    try {
      const [result] = await runMediaCommand(/** @type {number} */ (tabId), command, [frameId]);
      if (result) status = { ...result, frameId };
      if (result?.error) toast(result.error, 'error');
      await persistIfRemembered();
      update();
    } catch (err) {
      toast(friendlyInjectionError(err), 'error');
    }
  }

  const initial = await refreshStatus().catch((err) => {
    mount(root, notice('Couldn’t read media on this page', friendlyInjectionError(err)));
    return undefined;
  });
  if (initial === undefined) return;
  if (!initial) {
    mount(
      root,
      notice(
        'No video or audio found',
        'Media Boost controls HTML5 <video> and <audio>. It can’t reach media in closed shadow DOM, plugins, or cross-origin iframes this tab hasn’t granted access to.',
      ),
      h('button', { class: 'btn btn--block', type: 'button', onClick: () => renderMediaPanel(root, ctx) }, 'Check again'),
    );
    return;
  }

  const host = initial.host;
  const pattern = originPattern(tab?.url ?? '');
  let remembered = !!(await getSite(host));
  let autoAccess = pattern ? await hasAutoAccess(pattern) : false;

  async function persistIfRemembered() {
    if (remembered && status) await saveSite(host, { speed: status.speed ?? null, volume: status.volume ?? null });
  }

  // --- Controls --------------------------------------------------------------------
  const speedValue = h('output', { class: 'speed-value', 'aria-live': 'polite' });
  const customSpeed = h('input', {
    class: 'input input--num',
    type: 'number',
    min: String(MIN_SPEED),
    max: String(MAX_SPEED),
    step: '0.05',
    'aria-label': 'Custom speed',
  });
  const presetButtons = PRESETS.map((p) =>
    h('button', { class: 'chip', type: 'button', onClick: () => run({ op: 'setSpeed', value: p }) }, `${p}×`),
  );

  const volume = h('input', {
    type: 'range',
    min: '0',
    max: '600',
    step: '5',
    class: 'range',
    'aria-label': 'Volume',
    onInput: () => {
      volumeLabel.textContent = `${volume.value}%`;
    },
    onChange: () => run({ op: 'setVolume', value: Number(volume.value) / 100 }),
  });
  const volumeLabel = h('output', { class: 'volume-value' });
  const boostNote = h('p', { class: 'muted small' });
  const muteBtn = h('button', { class: 'btn btn--sm', type: 'button', onClick: () => run({ op: 'toggleMute' }) });
  const playBtn = h('button', { class: 'btn btn--sm btn--primary', type: 'button', onClick: () => run({ op: 'togglePlay' }) });
  const timeLabel = h('span', { class: 'muted small mono' });
  const loopLabel = h('span', { class: 'muted small' });
  const loopOff = h('button', { class: 'btn btn--sm', type: 'button', onClick: () => run({ op: 'loopClear' }) }, 'Loop off');
  const pipBtn = h('button', { class: 'btn btn--sm', type: 'button', title: 'Picture-in-picture', onClick: () => run({ op: 'pip' }) }, 'PiP');
  const seekStep = settings.media.seekStep;

  const rememberBox = h('input', { type: 'checkbox', checked: remembered, onChange: toggleRemember });
  const autoBtn = h('button', { class: 'btn btn--sm', type: 'button', onClick: toggleAuto });
  const autoText = h('span', { class: 'muted small' });

  async function toggleRemember() {
    try {
      if (rememberBox.checked) {
        remembered = true;
        await persistIfRemembered();
        await run({ op: 'applySite', prefs: { speed: status?.speed ?? null, volume: status?.volume ?? null } });
        toast(`Speed & volume remembered for ${host}.`);
      } else {
        remembered = false;
        await removeSite(host);
        await run({ op: 'forgetSite' });
        toast(`Forgot settings for ${host}.`);
      }
      update();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  async function toggleAuto() {
    if (!pattern) return;
    try {
      if (autoAccess) {
        await chrome.permissions.remove({ origins: [pattern] });
        autoAccess = false;
        toast(`Automatic access to ${host} removed.`);
      } else {
        autoAccess = await requestAutoAccess(pattern);
        toast(autoAccess ? `Media Boost will run automatically on ${host}.` : 'Access not granted.');
      }
      update();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  function update() {
    if (!status) return;
    const loop = status.loop;
    loopOff.hidden = !loop;
    loopLabel.textContent = loop ? (loop.b === null ? `Loop start set at ${fmtTime(loop.a)} — press “Loop B” at the end point.` : `Looping ${fmtTime(loop.a)}–${fmtTime(loop.b)}`) : '';
    pipBtn.hidden = !status.pip && !status.inPip;
    pipBtn.textContent = status.inPip ? 'Exit PiP' : 'PiP';
    speedValue.textContent = `${status.speed ?? 1}×`;
    presetButtons.forEach((b, i) => b.classList.toggle('is-active', PRESETS[i] === status?.speed));
    const pct = Math.round((status.volume ?? 1) * 100);
    if (document.activeElement !== volume) {
      // Don't fight the user while they drag the slider.
      volume.value = String(pct);
      volumeLabel.textContent = `${pct}%`;
    }
    const boostOk = status.boost?.ok !== false;
    boostNote.textContent = boostOk
      ? 'Above 100% uses Web Audio boost; very high levels can distort.'
      : `Boost above 100% unavailable: ${status.boost?.reason ?? ''}`;
    volume.max = boostOk ? '600' : '100';
    muteBtn.textContent = status.muted ? 'Unmute' : 'Mute';
    playBtn.textContent = status.playing ? 'Pause' : 'Play';
    timeLabel.textContent = status.live ? 'Live' : `${fmtTime(status.currentTime)} / ${fmtTime(status.duration)}`;
    rememberBox.checked = remembered;
    autoBtn.hidden = !remembered || !pattern;
    autoBtn.textContent = autoAccess ? 'Turn off' : 'Turn on';
    autoText.textContent = !remembered
      ? ''
      : autoAccess
        ? `Applies automatically on ${host}. In-page keys: [ ] \\`
        : 'Applied when you open this popup or use a shortcut.';
  }

  mount(
    root,
    h(
      'section',
      { class: 'popup-section' },
      h('div', { class: 'popup-section__head' }, h('h2', null, `Speed`), h('span', { class: 'muted small' }, `${initial.count} ${initial.kind ?? 'media'} element${initial.count === 1 ? '' : 's'}`)),
      h(
        'div',
        { class: 'speed-row' },
        h('button', { class: 'btn btn--icon', type: 'button', 'aria-label': 'Slower', onClick: () => run({ op: 'stepSpeed', delta: -settings.media.speedStep }) }, '−'),
        speedValue,
        h('button', { class: 'btn btn--icon', type: 'button', 'aria-label': 'Faster', onClick: () => run({ op: 'stepSpeed', delta: settings.media.speedStep }) }, '+'),
      ),
      h('div', { class: 'chip-row' }, presetButtons),
      h(
        'form',
        {
          class: 'field-row',
          onSubmit: (e) => {
            e.preventDefault();
            const v = Number(customSpeed.value);
            if (!Number.isFinite(v) || v < MIN_SPEED || v > MAX_SPEED) {
              toast(`Enter a speed between ${MIN_SPEED} and ${MAX_SPEED}.`, 'error');
              return;
            }
            run({ op: 'setSpeed', value: v });
          },
        },
        customSpeed,
        h('button', { class: 'btn btn--sm', type: 'submit' }, 'Set custom'),
      ),
    ),
    h(
      'section',
      { class: 'popup-section' },
      h('div', { class: 'popup-section__head' }, h('h2', null, 'Volume'), volumeLabel),
      volume,
      boostNote,
    ),
    h(
      'section',
      { class: 'popup-section' },
      h(
        'div',
        { class: 'media-transport' },
        h('button', { class: 'btn btn--sm', type: 'button', onClick: () => run({ op: 'seek', delta: -seekStep }) }, `−${seekStep}s`),
        playBtn,
        h('button', { class: 'btn btn--sm', type: 'button', onClick: () => run({ op: 'seek', delta: seekStep }) }, `+${seekStep}s`),
        muteBtn,
        h('button', { class: 'btn btn--sm', type: 'button', onClick: () => run({ op: 'reset' }) }, 'Reset'),
      ),
      timeLabel,
      h(
        'div',
        { class: 'media-transport' },
        h('button', { class: 'btn btn--sm', type: 'button', title: 'Set loop start at the current time', onClick: () => run({ op: 'loopA' }) }, 'Loop A'),
        h('button', { class: 'btn btn--sm', type: 'button', title: 'Set loop end at the current time', onClick: () => run({ op: 'loopB' }) }, 'Loop B'),
        loopOff,
        pipBtn,
      ),
      loopLabel,
    ),
    h(
      'section',
      { class: 'popup-section' },
      h('label', { class: 'check' }, rememberBox, `Remember on ${host}`),
      h('div', { class: 'field-row' }, autoText, autoBtn),
      h('button', { class: 'link-btn', type: 'button', onClick: () => ctx.openDashboard(ROUTES.MEDIA) }, 'Shortcuts & remembered sites →'),
    ),
  );
  update();

  // Keep the time display fresh while the popup is open.
  const timer = setInterval(async () => {
    try {
      const [s] = await runMediaCommand(/** @type {number} */ (tabId), { op: 'status' }, [frameId]);
      if (s) {
        status = { ...s, frameId };
        update();
      }
    } catch {
      clearInterval(timer);
    }
  }, 1000);
  return () => clearInterval(timer);
}

/** @param {string} title @param {string} body */
function notice(title, body) {
  return h('div', { class: 'notice' }, h('p', { class: 'notice__title' }, title), h('p', { class: 'muted small' }, body));
}
