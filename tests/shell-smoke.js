// Headless smoke test for the shell + the WMP9 chrome. CJS on purpose (global playwright
// install + NODE_PATH).
//   npm run build && NODE_PATH=$(npm root -g) node tests/shell-smoke.js [outprefix]
// The page is dist/index.html (React + the store): window.Alchemy.Shell is its read-only shim
// (settings, engine, level, fps, source = the capture), window.Alchemy.store the store itself.
// ESM (package.json "type": "module"); playwright comes from the global install via NODE_PATH,
// which only the CommonJS resolver honours, hence createRequire.
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const __dirname = require('path').dirname(fileURLToPath(import.meta.url));
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');

const PAGE = 'file://' + path.resolve(__dirname, '..', 'dist', 'index.html');
const HTML = PAGE + '?src=tone';
const OUT = process.argv[2] || path.resolve(__dirname, '..', 'shot');
// A menu item is a button of three spans (checkmark, label, accelerator), so match the label.
const item = (depth, text) => `[role=menu][data-depth="${depth}"] [role^=menuitem]:has(span:text-is("${text}"))`;
const MENUS = '[role=menu]';

// The only browser audio source is getDisplayMedia, so the test page fakes it. window.__share
// picks the outcome: a real audio track (an oscillator through a MediaStreamDestination),
// a share with no audio track at all, or the user cancelling the picker.
const MOCK = () => {
  window.__share = 'reject';
  // The page's AudioContexts, counted: the host-socket audio path must never make one.
  window.__actx = 0;
  const AC = window.AudioContext;
  window.AudioContext = class extends AC { constructor(...a) { super(...a); if (!window.__mockAC) window.__actx++; } };
  // Bin 43 of a 2048-point FFT, whatever the sample rate: a bin-centred tone at -20 dBFS lands on
  // one byte both audio paths must agree on (194, per tools/gen_frames.py).
  window.__tone = ctx => ({ freq: 43 * ctx.sampleRate / 2048, amp: 0.1 });
  navigator.mediaDevices.getDisplayMedia = function () {
    if (window.__share === 'reject') {
      const e = new Error('denied'); e.name = 'NotAllowedError';
      return Promise.reject(e);
    }
    const s = new MediaStream();
    if (window.__share === 'ok' || window.__share === 'tone') {
      window.__mockAC = true;
      const c = window.__shareCtx || (window.__shareCtx = new AudioContext());
      window.__mockAC = false;
      const d = c.createMediaStreamDestination(), o = c.createOscillator(), g = c.createGain();
      const t = window.__tone(c);
      o.frequency.value = window.__share === 'tone' ? t.freq : 220;
      g.gain.value = window.__share === 'tone' ? t.amp : 1;
      o.connect(g); g.connect(d); o.start();
      d.stream.getAudioTracks().forEach(t => s.addTrack(t));
    }
    return Promise.resolve(s);
  };

  // The screensaver host binds these into the page; stub them to check the title bar drives them
  // (deno-webview/main.ts, win32.ts caption()).
  window.__win = [];
  window.alchemyWinDrag = () => window.__win.push('drag');
  window.alchemyWinMin = () => window.__win.push('min');
  window.alchemyWinMax = () => window.__win.push('max');
  window.alchemyWinSize = () => window.__win.push('size');
  window.alchemyWinClose = () => window.__win.push('close');

  // The screensaver's system-audio path (src/90-shell.js Shell.useLocalAudio) with the Deno host
  // and its WASAPI helper replaced by this: the {"rate":n} message, then interleaved stereo f32 of
  // the same tone, paced off the wall clock so the page's ring holds a full, continuous window.
  window.WebSocket = class {
    constructor(url) {
      this.url = url; this.binaryType = 'blob'; this.bufferedAmount = 0;
      this.readyState = 1; this.sent = [];        // OPEN; text frames the page sends back (v4/v5)
      window.__ws = this;
      setTimeout(() => {
        if (this.onopen) this.onopen();
        // The helper's rate, not the page's: this path never touches an AudioContext, and bin 43
        // is bin 43 at any sample rate.
        const r = 48000;
        const { freq, amp } = window.__tone({ sampleRate: r });
        this.onmessage({ data: JSON.stringify({ rate: r }) });
        const lead = Math.round(r * 0.1);          // 100 ms of slack against timer jitter
        const t0 = performance.now();
        let sent = 0;
        const pump = () => {
          const want = Math.round((performance.now() - t0) / 1000 * r) + lead;
          const n = want - sent;
          if (n <= 0) return;
          const pcm = new Float32Array(n * 2);
          for (let i = 0; i < n; i++) {
            const v = amp * Math.sin(2 * Math.PI * freq * (sent + i) / r);
            pcm[i * 2] = v; pcm[i * 2 + 1] = v;
          }
          sent = want;
          this.onmessage({ data: pcm.buffer });
        };
        pump();
        this.timer = setInterval(pump, 10);
      }, 0);
    }
    send(d) { this.sent.push(d); }
    close() { clearInterval(this.timer); this.readyState = 3; if (this.onclose) this.onclose(); }
  };
};

(async () => {
  const browser = await chromium.launch({
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream',
           '--use-fake-ui-for-media-stream', '--mute-audio']
  });

  // There is one frame now — the Luna one — in every mode, and no setting for it: a stale
  // `frame` key in a settings blob saved by an older build must be ignored, not written back.
  {
    const fresh = await browser.newContext();
    const p = await fresh.newPage();
    await p.addInitScript(MOCK);
    await p.addInitScript(() => localStorage.setItem('alchemy.settings',
                                                     JSON.stringify({ frame: true, frameSet: true })));
    await p.goto(HTML);
    await p.waitForFunction(() => window.Alchemy && Alchemy.Shell.engine);
    assert.deepStrictEqual(await p.evaluate(() => ['frame', 'frameSet'].filter(k => k in Alchemy.Shell.settings)),
                           [], 'a stale frame key must be dropped from the settings');
    assert(!(await p.locator('#frame').count()), 'the "Show player frame" checkbox must be gone');
    assert(!(await p.locator('body.noframe').count()), 'body.noframe must be gone');
    // The Luna frame is always drawn: 4px of title-bar blue down the left edge, rounded top
    // corners over a transparent page (the host clips the window to match — NOTES-ui.md).
    const frame = await p.evaluate(() => {
      const c = getComputedStyle(document.getElementById('chrome'));
      const b = getComputedStyle(document.getElementById('framebody'));
      return { radius: c.borderTopLeftRadius + ' ' + c.borderBottomLeftRadius,
               margin: b.marginLeft + ' ' + b.marginRight + ' ' + b.marginBottom,
               page: getComputedStyle(document.body).backgroundColor };
    });
    assert.strictEqual(frame.radius, '8px 0px', 'title bar rounds on top and squares below: ' + frame.radius);
    assert.strictEqual(frame.margin, '4px 4px 4px', 'Luna border should be 4px: ' + frame.margin);
    assert.strictEqual(frame.page, 'rgba(0, 0, 0, 0)', 'the page behind the corners must be transparent');
    await fresh.close();
  }

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => m.type() === 'error' && errors.push('console: ' + m.text()));
  await page.addInitScript(MOCK);
  await page.goto(HTML);
  await page.waitForFunction(() => window.Alchemy && Alchemy.Shell.engine);

  // 1. 0x00RRGGBB -> RGBA conversion, through the real blit/present path.
  const px = await page.evaluate(() => {
    const S = Alchemy.Shell, was = S.paused;
    S.paused = true;
    const s = S.engine.render(S.level);          // the engine's own surface, which present() paints
    s.px.fill(0x123456);
    S.engine.present();
    // read in the same task as the draw: WebGL2 (engine/gl.ts) where there is one, else the 2D path
    const view = document.getElementById('view'), gl = view.getContext('webgl2');
    let d;
    if (gl) { d = new Uint8Array(4); gl.readPixels(view.width >> 1, view.height >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, d); }
    else { const c = view.getContext('2d'); d = c.getImageData(view.width >> 1, view.height >> 1, 1, 1).data; }
    S.paused = was;
    return [d[0], d[1], d[2], d[3]];
  });
  // (headless WebGL is software, which the page declines: this is the 2D path; tests/gl.smoke.js has the GPU one)
  assert.deepStrictEqual(px, [0x12, 0x34, 0x56, 255], 'RGBA conversion: got ' + px);

  // 2. the ticker runs, ?src=tone reaches the analysers, the engine reacts to it.
  await page.waitForTimeout(2500);
  const st = await page.evaluate(() => ({
    fps: Alchemy.Shell.fps,
    state: Alchemy.Shell.level.state,
    src: Alchemy.Shell.source && Alchemy.Shell.source.kind,
    freqSum: Alchemy.Shell.level.freq[0].reduce((a, b) => a + b, 0),
    waveSpread: Math.max(...Alchemy.Shell.level.wave[1]) - Math.min(...Alchemy.Shell.level.wave[1]),
    bass: Alchemy.Shell.engine.debug().bass,
    buf: [Alchemy.Shell.engine.width, Alchemy.Shell.engine.height],
    time: document.getElementById('time').textContent,
    label: document.getElementById('vizlabel').textContent
  }));
  assert.strictEqual(st.src, 'tone', '?src=tone did not attach');
  assert.strictEqual(st.state, 2, 'TimedLevel.state should be 2 while playing');
  // The ticker targets 60 fps; under heavy host load (other jobs on the box) the renderer is starved and the
  // number says nothing about the page, so relax the floor when the 1-minute load average exceeds the core count.
  { const load = require('os').loadavg()[0], cores = require('os').cpus().length;
    const floor = load > cores ? 10 : 45;
    if (load > cores) console.log(`  (host load ${load.toFixed(1)} on ${cores} cores: fps floor relaxed to ${floor})`);
    assert(st.fps > floor && st.fps <= 65, 'fps out of range: ' + st.fps + ' (load ' + load.toFixed(1) + ')'); }
  assert(st.freqSum > 0, 'analyser channel 0 got no frequency data');
  assert(st.waveSpread > 0, 'analyser channel 1 got no waveform (mono up-mix broken)');
  assert(st.bass > 0, 'engine saw no bass');
  assert.deepStrictEqual(st.buf, [640, 480], 'original mode should use the DLL\'s fixed 640x480 surface: ' + st.buf);
  assert(/^00:0[0-9]$/.test(st.time), 'capture clock is not counting: ' + st.time);
  assert.strictEqual(st.label, 'Alchemy : Random', 'visualization label: ' + st.label);

  // 3. the removed sources really are gone: no file picker, no drag-drop, no microphone,
  //    no visible test-tone button.
  const gone = await page.evaluate(() => ({
    api: ['useMic', 'playFile', 'useDisplay'].filter(k => typeof Alchemy.Shell[k] !== 'undefined'),
    dom: ['#file', '#mic', '#share', '#tone', 'input[type=file]'].filter(s => document.querySelector(s))
  }));
  assert.deepStrictEqual(gone.api, [], 'removed audio sources still on Shell: ' + gone.api);
  assert.deepStrictEqual(gone.dom, [], 'removed audio controls still in the DOM: ' + gone.dom);

  await page.screenshot({ path: OUT + '-tone.png' });

  // 4. debug overlay is gated on Options > Player > Show advanced settings
  await page.keyboard.press('d');
  assert(await page.locator('#dbg[hidden]').count(), 'D must do nothing until advanced settings are on');
  await page.evaluate(() => Alchemy.store.getState().actions.setSettings({ advanced: true }));
  await page.keyboard.press('d');
  assert((await page.textContent('#dbg')).includes('cycleFrame'), 'debug overlay empty');

  // 5. space pauses the ticker
  await page.keyboard.press('Space');
  const a = await page.evaluate(() => Alchemy.Shell.engine.debug().cycleFrame);
  await page.waitForTimeout(400);
  const b = await page.evaluate(() => Alchemy.Shell.engine.debug().cycleFrame);
  assert.strictEqual(a, b, 'space did not pause rendering');
  assert.strictEqual(await page.textContent('#status'), 'Paused', 'status should read Paused');
  await page.keyboard.press('Space');

  // 6. the menus: View > Visualizations > Bars and Waves > Fire Storm
  await page.click('#mtops [data-menu=view]');
  await page.click(item(0, 'Visualizations'));
  await page.click(item(1, 'Bars and Waves'));
  await page.click(item(2, 'Fire Storm'));
  await page.waitForTimeout(300);
  assert.strictEqual(await page.locator(MENUS).count(), 0, 'menus did not close after a choice');
  let vis = await page.evaluate(() => ({ name: Alchemy.Shell.engine.debug().presetName,
                                         s: [Alchemy.Shell.settings.vis, Alchemy.Shell.settings.preset],
                                         label: document.getElementById('vizlabel').textContent }));
  assert.strictEqual(vis.name, 'Fire Storm', 'the menu did not switch preset');
  assert.deepStrictEqual(vis.s, ['bars', 2], 'vis settings not stored: ' + vis.s);
  assert.strictEqual(vis.label, 'Bars and Waves : Fire Storm', 'label not updated: ' + vis.label);
  // the checkmark follows
  await page.click('#mtops [data-menu=view]');
  await page.click(item(0, 'Visualizations'));
  await page.click(item(1, 'Bars and Waves'));
  assert.strictEqual(await page.textContent(item(2, 'Fire Storm') + ' > span:first-child'), '✓',
                     'no checkmark on the current preset');
  await page.keyboard.press('Escape');
  assert.strictEqual(await page.locator(MENUS).count(), 0, 'Escape did not close the menus');
  // the ▾ beside the visualization name opens the same list; a choice switches and closes it
  await page.click('#vpick');
  assert.strictEqual(await page.locator(MENUS + '[data-depth="0"]').count(), 1, 'the picker did not open a menu');
  await page.click(item(0, 'Alchemy'));
  await page.click(item(1, 'Random'));
  await page.waitForTimeout(300);
  assert.strictEqual(await page.locator(MENUS).count(), 0, 'picker menus did not close after a choice');
  assert.strictEqual(await page.textContent('#vizlabel'), 'Alchemy : Random', 'the picker did not switch the visualization');
  await page.click('#vizlabel');
  assert.strictEqual(await page.locator(MENUS + '[data-depth="0"]').count(), 1, 'clicking the name did not open the picker');
  await page.keyboard.press('Escape');
  await page.click('#mtops [data-menu=view]');
  await page.click(item(0, 'Visualizations'));
  await page.click(item(1, 'Bars and Waves'));
  await page.click(item(2, 'Fire Storm'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + '-bars-scope.png' });

  // 7. Next/Previous walk the flat preset list across all three engines
  await page.click('#bnext');                      // Fire Storm -> Scope
  await page.waitForTimeout(250);
  assert.strictEqual(await page.evaluate(() => Alchemy.Shell.engine.debug().presetName), 'Scope',
                     'Next did not advance the preset');
  await page.click('#vnext');                      // Scope -> Battery > Randomization
  await page.waitForTimeout(400);
  assert.deepStrictEqual(await page.evaluate(() => [Alchemy.Shell.settings.vis, Alchemy.Shell.settings.preset]),
                         ['battery', 0], 'Next did not cross into the next visualizer');
  await page.click('#vprev');
  await page.waitForTimeout(400);
  assert.deepStrictEqual(await page.evaluate(() => [Alchemy.Shell.settings.vis, Alchemy.Shell.settings.preset]),
                         ['bars', 3], 'Previous did not cross back');

  // 8. Battery: 384x288 native, nearest-neighbour, 26 presets, the scale label follows the engine
  await page.evaluate(() => Alchemy.Shell.setVis('battery', 18));
  await page.waitForTimeout(600);
  // the 'Original' label lives in Options > Advanced (rendered while the dialog is up)
  await page.evaluate(() => Alchemy.store.getState().actions.setUi({ dialog: 'options' }));
  await page.click('#tabAdv');
  const bat = await page.evaluate(() => ({
    wh: [Alchemy.Shell.engine.width, Alchemy.Shell.engine.height],
    n: document.querySelectorAll('#visList [data-vis=battery]').length,
    d: Alchemy.Shell.engine.debug(),
    sampling: Alchemy.Shell.engine.debug().sampling,
    label: document.querySelector('#scale option[value=original]').textContent,
    viz: document.getElementById('vizlabel').textContent
  }));
  assert.deepStrictEqual(bat.wh, [384, 288], 'Battery "original" is the DLL\'s 384x288: ' + bat.wh);
  assert.strictEqual(bat.n, 26, 'Battery exposes 26 presets');
  assert.strictEqual(bat.d.presetName, 'relatively calm', 'Battery preset 18 not selected');
  assert.strictEqual(bat.sampling, 'nearest', 'Battery must stretch nearest-neighbour (STRETCH_DELETESCANS)');
  assert.strictEqual(bat.label, 'Original 384x288', 'the scale label follows the engine: ' + bat.label);
  assert.strictEqual(bat.viz, 'Battery : relatively calm', 'viz label: ' + bat.viz);
  await page.evaluate(() => Alchemy.store.getState().actions.setUi({ dialog: null }));
  assert((await page.textContent('#dbg')).includes('Battery'), 'overlay does not show the Battery debug');
  await page.screenshot({ path: OUT + '-battery.png' });

  // 9. Options dialog: advanced controls + persistence through a reload
  await page.click('#mtops [data-menu=tools]');
  await page.click(item(0, 'Options...'));
  assert(await page.locator('#dlgOptions:visible').count(), 'Options dialog did not open');
  await page.click('#tabAdv');
  await page.selectOption('#scale', '0.25');
  await page.selectOption('#fps', '30');
  await page.click('#intended');
  await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + '-intended-quarter.png' });
  await page.click('#optOK');
  assert(!(await page.locator('#dlgOptions:visible').count()), 'OK did not close the dialog');

  const quarter = await page.evaluate(() => Math.round(document.getElementById('view').clientWidth * 0.25));
  await page.reload();
  await page.waitForFunction(() => window.Alchemy && Alchemy.Shell.engine);
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => [Alchemy.Shell.settings.scale, Alchemy.Shell.settings.fps,
                                           Alchemy.Shell.settings.intended, Alchemy.Shell.settings.advanced,
                                           Alchemy.Shell.settings.vis, Alchemy.Shell.engine.width]);
  assert.deepStrictEqual(after, [0.25, 30, true, true, 'battery', quarter],
                         'settings did not persist: ' + after);

  // 10. the visualization pane drives the buffer: a viewport resize reaches engine.resize
  await page.setViewportSize({ width: 900, height: 640 });
  await page.waitForTimeout(500);
  assert.strictEqual(await page.evaluate(() => Alchemy.Shell.engine.width),
                     await page.evaluate(() => Math.round(document.getElementById('view').clientWidth * 0.25)),
                     'engine.resize not called on window resize');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(400);

  // 11. fullscreen: chrome-free, and Escape brings the player back
  await page.keyboard.press('f');
  await page.waitForFunction(() => Alchemy.store.getState().ui.bare, null, { timeout: 5000 })
            .catch(() => { throw new Error('F did not go chrome-free'); });
  assert(!(await page.locator('#transport').isVisible()), 'transport still visible in fullscreen');
  await page.screenshot({ path: OUT + '-fullscreen.png' });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !Alchemy.store.getState().ui.bare, null, { timeout: 5000 })
            .catch(() => { throw new Error('Escape did not leave fullscreen'); });

  // 12. capture: the picker rejecting leaves the instructions on the status line
  await page.goto(PAGE);                        // no ?src=, so nothing is attached
  await page.waitForFunction(() => window.Alchemy && Alchemy.Shell.engine);
  assert.strictEqual(await page.textContent('#status'), 'No audio — animating',
                     'idle status should say it is animating on silence');
  await page.waitForTimeout(400);
  assert.strictEqual(await page.evaluate(() => Alchemy.Shell.level.state), 2,
                     'the engines must keep running on digital silence');
  await page.click('#bplay');
  await page.waitForTimeout(300);
  assert.strictEqual(await page.textContent('#status'),
                     'Choose a tab or your screen and tick "Share audio"',
                     'a rejected share must leave the instructions up');

  // 13. capture: a share with no audio track says so; a share with one attaches
  await page.evaluate(() => { window.__share = 'noaudio'; });
  await page.click('#bplay');
  await page.waitForTimeout(300);
  assert.strictEqual(await page.textContent('#status'),
                     'No audio in that share — share again with "Share audio" ticked',
                     'audio-less share not reported');
  await page.evaluate(() => { window.__share = 'ok'; });
  await page.click('#bplay');
  await page.waitForTimeout(600);
  const cap = await page.evaluate(() => ({
    kind: Alchemy.Shell.source && Alchemy.Shell.source.kind,
    status: document.getElementById('status').textContent,
    paused: !document.getElementById('icpause')                          // the pause glyph shows while playing
  }));
  assert.strictEqual(cap.kind, 'display', 'the shared stream did not attach');
  assert(/^Sharing: /.test(cap.status), 'status should name the share: ' + cap.status);
  assert.strictEqual(cap.paused, false, 'Play should have become Pause');

  // 14. the volume slider is capture sensitivity on the input gain node (measured at the analysers:
  //     half the gain is -6 dB, lower bytes; mute is silence); Stop goes back to silence
  const energy = async () => { await page.waitForTimeout(250); return page.evaluate(() => Alchemy.Shell.level.freq[0].reduce((a, b) => a + b, 0)); };
  const e100 = await energy();
  await page.fill('#vol', '50');
  await page.dispatchEvent('#vol', 'input');
  assert.deepStrictEqual(await page.evaluate(() => [Alchemy.Shell.settings.volume, Alchemy.Shell.settings.muted]), [50, false], 'volume not stored');
  const e50 = await energy();
  assert(e50 < e100, 'volume did not reach the gain node: ' + e100 + ' -> ' + e50);
  await page.click('#bmute');
  assert.strictEqual(await energy(), 0, 'mute did not reach the gain node');
  await page.click('#bstop');
  await page.waitForTimeout(300);
  assert.strictEqual(await page.evaluate(() => Alchemy.Shell.source), null, 'Stop did not end the capture');
  assert.strictEqual(await page.textContent('#time'), '00:00', 'Stop did not reset the clock');
  assert.strictEqual(await page.evaluate(() => Alchemy.Shell.level.state), 2,
                     'after Stop the engines keep animating on silence');

  // 15. the CI query hooks still work end to end
  await page.goto(HTML + '&vis=battery&preset=23&scale=0.5');
  await page.waitForFunction(() => window.Alchemy && Alchemy.Shell.engine);
  await page.waitForTimeout(300);
  assert.deepStrictEqual(await page.evaluate(() => [Alchemy.Shell.settings.vis, Alchemy.Shell.settings.preset,
                                                    Alchemy.Shell.settings.scale,
                                                    Alchemy.Shell.engine.debug().presetName]),
                         ['battery', 23, 0.5, 'the world'], '?vis=battery&preset=23&scale=0.5 did not take');

  // 16. ?mode=screensaver: visualization only, no chrome, no prompt
  await page.goto(HTML + '&mode=screensaver');
  await page.waitForFunction(() => window.Alchemy && Alchemy.Shell.engine);
  await page.waitForTimeout(300);
  assert(await page.evaluate(() => Alchemy.store.getState().ui.bare), '?mode=screensaver did not go chrome-free');
  assert(!(await page.locator('#titlebar').isVisible()), 'screensaver still shows the title bar');
  // ?mode=app (WmpVisualizers.exe) is the other end of the same switch: the full player chrome.
  await page.goto(HTML + '&mode=app');
  await page.waitForFunction(() => window.Alchemy && Alchemy.Shell.engine);
  assert(!(await page.evaluate(() => Alchemy.store.getState().ui.bare)), '?mode=app must keep the full chrome');
  assert(await page.locator('#titlebar').isVisible(), '?mode=app lost the title bar');

  // 17. system audio: ?audio=ws feeds the analysers through the AudioWorklet, with the same byte
  //     calibration as the share path, and a dropped socket falls back to the silence animation.
  await page.goto(PAGE + '?audio=ws&vis=bars&preset=3');
  await page.waitForFunction(() => Alchemy && Alchemy.Shell.source &&
                                   Alchemy.Shell.source.kind === 'wsaudio', null, { timeout: 5000 })
            .catch(() => { throw new Error('?audio=ws did not attach the local audio source'); });
  assert.strictEqual(await page.textContent('#status'), 'System audio (local)',
                     'the local audio source must name itself on the status line');
  // No AudioContext at all on this path: a screensaver cannot resume one (see Shell.useLocalAudio).
  assert.strictEqual(await page.evaluate(() => window.__actx), 0, 'the local audio path must not build an audio graph');
  // Step 14 left the player muted, and mute is capture sensitivity here too: every byte below
  // would be 0. Unmute the way the user does.
  await page.evaluate(() => {
    if (Alchemy.Shell.settings.muted) document.getElementById('bmute').click();
    const v = document.getElementById('vol');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(v, 100);
    v.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.deepStrictEqual(await page.evaluate(() => [Alchemy.Shell.settings.muted, Alchemy.Shell.settings.volume]),
                         [false, 100], 'capture sensitivity is not back to 1');
  const peak = () => page.evaluate(() => {
    const f = Alchemy.Shell.level.freq[0];
    let at = 0;
    for (let i = 1; i < f.length; i++) if (f[i] > f[at]) at = i;
    return { bin: at, byte: f[at], sum: f.reduce((a, b) => a + b, 0) };
  });
  // A discontinuity in the ring buffer would smear one frame's spectrum; take the best of a few.
  let ws = { bin: 0, byte: 0, sum: 0 };
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(150);
    const p = await peak();
    if (p.byte > ws.byte) ws = p;
  }
  assert.strictEqual(ws.bin, 43, 'the tone should peak in bin 43: ' + JSON.stringify(ws));
  assert(Math.abs(ws.byte - 194) <= 6,
         'analyser byte off the -20 dBFS ground truth of 194 (tools/gen_frames.py): ' + ws.byte);
  // the same tone through getDisplayMedia, for the byte-for-byte comparison
  await page.evaluate(() => { window.__share = 'tone'; });
  await page.click('#bstop');            // Play is Pause while a source is attached
  await page.click('#bplay');
  await page.waitForFunction(() => Alchemy.Shell.source && Alchemy.Shell.source.kind === 'display',
                             null, { timeout: 5000 });
  let sh = { bin: 0, byte: 0 };
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(150);
    const p = await peak();
    if (p.byte > sh.byte) sh = p;
  }
  assert.strictEqual(sh.bin, ws.bin, 'share path peaks in a different bin: ' + sh.bin + ' vs ' + ws.bin);
  assert(Math.abs(sh.byte - ws.byte) <= 4,
         'system audio and the share path disagree: ' + ws.byte + ' vs ' + sh.byte);
  console.log('  system audio: bin %d byte %d, share path byte %d, ground truth 194',
              ws.bin, ws.byte, sh.byte);

  // a dropped socket must go back to animating on silence, not freeze on the last frame
  await page.goto(PAGE + '?audio=ws');
  await page.waitForFunction(() => Alchemy && Alchemy.Shell.source &&
                                   Alchemy.Shell.source.kind === 'wsaudio', null, { timeout: 5000 });
  await page.evaluate(() => window.__ws.close());
  await page.waitForTimeout(200);
  assert.strictEqual(await page.evaluate(() => Alchemy.Shell.source), null,
                     'a closed socket must detach the source');
  assert.strictEqual(await page.textContent('#status'), 'No audio — animating',
                     'after the socket drops the page should say it is animating on silence');
  assert.strictEqual(await page.evaluate(() => Alchemy.Shell.level.state), 2,
                     'the engines must keep running after the socket drops');

  // 18. the XP title bar is the host window's real title bar when the host binds the calls
  await page.goto(PAGE);
  await page.waitForFunction(() => window.Alchemy && Alchemy.Shell.engine);
  await page.click('#wmin');
  await page.click('#wmax');
  await page.click('#wclose');
  assert.deepStrictEqual(await page.evaluate(() => window.__win), ['min', 'max', 'close'],
                         'caption buttons did not reach the host');
  await page.evaluate(() => { window.__win.length = 0; });
  // a drag from the bar itself, and a double-click that maximizes instead of dragging twice
  await page.mouse.move(400, 15);
  await page.mouse.down();
  await page.mouse.up();
  await page.mouse.down();
  await page.mouse.up();
  assert.deepStrictEqual(await page.evaluate(() => window.__win), ['drag', 'max'],
                         'title bar drag / double-click did not reach the host');
  // ...and the status-bar grip is the host window's resize corner, not just a picture of one.
  await page.evaluate(() => { window.__win.length = 0; });
  await page.locator('#grip').dispatchEvent('mousedown', { button: 0 });
  assert.deepStrictEqual(await page.evaluate(() => window.__win), ['size'],
                         'the resize grip did not reach the host');

  // 19. Now Playing (CONTRACT.md v4) and synced lyrics (v5): the host's JSON text frames on the
  //     audio socket drive the right pane, the status line, the clock and the seek bar; Prev/Next
  //     become track skip while a session exists; a "none" frame puts today's player back.
  const ART = 'data:image/svg+xml;base64,' + Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><defs><linearGradient id="g" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#F4A23C"/><stop offset="1" stop-color="#6A1E74"/></linearGradient></defs>' +
    '<rect width="8" height="8" fill="url(#g)"/><circle cx="4" cy="4" r="2.2" fill="none" stroke="#fff" stroke-width=".5"/></svg>'
  ).toString('base64');
  const TRACK = { title: 'Windowlicker', artist: 'Aphex Twin', album: 'Windowlicker EP' };
  const media = o => Object.assign({ type: 'media', status: 'paused', app: 'Spotify.exe', position: 65,
                                     duration: 130, art: ART, canSeek: true, canNext: true, canPrev: true }, TRACK, o);
  const LYR = { type: 'lyrics', status: 'synced', source: 'lrclib', plain: null,
                lines: [{ t: 4, text: 'First line' }, { t: 10, text: 'Second line' }, { t: 16, text: 'Third line' }],
                track: Object.assign({ duration: 130 }, TRACK) };
  const hostSends = o => page.evaluate(o => window.__ws.onmessage({ data: JSON.stringify(o) }), o);
  const sent = () => page.evaluate(() => window.__ws.sent.map(d => JSON.parse(d)));
  const lastSent = async () => (await sent()).pop();
  const seekFrac = () => page.evaluate(() => {
    const t = document.getElementById('seekthumb').getBoundingClientRect();
    const r = document.getElementById('seektrack').getBoundingClientRect();
    return (t.left - r.left) / (r.width - t.width);
  });
  const lyr = () => page.evaluate(() => ({
    shown: !document.getElementById('lyr').hidden,
    cur: document.getElementById('lyrcur').textContent, next: document.getElementById('lyrnext').textContent,
    plain: !document.getElementById('pllyr').hidden && document.getElementById('pllyr').textContent
  }));
  const visNow = () => page.evaluate(() => [Alchemy.Shell.settings.vis, Alchemy.Shell.settings.preset].join());

  await page.evaluate(() => localStorage.removeItem('alchemy.settings'));   // no debug overlay, unmuted
  await page.goto(PAGE + '?audio=ws');
  await page.waitForFunction(() => Alchemy && Alchemy.Shell.source && Alchemy.Shell.source.kind === 'wsaudio',
                             null, { timeout: 5000 });
  assert.deepStrictEqual(await sent(), [{ type: 'lyricsPref', enabled: true }],
                         'the lyrics preference must go to the host on connect');
  const vizBefore = await page.textContent('#vizlabel');
  await hostSends(media());
  const np = await page.evaluate(() => ({
    band: document.getElementById('plband').textContent,
    meta: ['pltitle', 'plartist', 'plalbum'].map(i => document.getElementById(i).textContent),
    art: !!document.getElementById('plimg') && document.getElementById('plimg').src.slice(0, 25),
    ph: getComputedStyle(document.getElementById('plph')).display === 'none',
    status: document.getElementById('status').textContent,
    time: document.getElementById('time').textContent, len: document.getElementById('time').title,
    viz: document.getElementById('vizlabel').textContent, playTitle: document.getElementById('bplay').title
  }));
  assert.deepStrictEqual(np, { band: 'Now Playing', meta: ['Windowlicker', 'Aphex Twin', 'Windowlicker EP'],
                               art: 'data:image/svg+xml;base64', ph: true, status: 'Paused: Aphex Twin – Windowlicker',
                               time: '01:05', len: '02:10', viz: vizBefore, playTitle: 'Play' },
                         'Now Playing pane / status / clock: ' + JSON.stringify(np));
  assert(Math.abs(await seekFrac() - 0.5) < 0.01, 'seek thumb should sit halfway: ' + await seekFrac());
  // track skip and play/pause go to the host; the preset stays where it was
  const vis0 = await visNow();
  await page.click('#bnext');
  assert.deepStrictEqual(await lastSent(), { type: 'mediaCmd', cmd: 'next' }, 'Next did not send mediaCmd next');
  await page.click('#bprev');
  assert.deepStrictEqual(await lastSent(), { type: 'mediaCmd', cmd: 'prev' }, 'Previous did not send mediaCmd prev');
  await page.click('#bplay');
  assert.deepStrictEqual(await lastSent(), { type: 'mediaCmd', cmd: 'playpause' }, 'Play did not send playpause');
  assert.strictEqual(await visNow(), vis0, 'track skip must not change the visualizer');
  // ...while the arrows beside the visualizer label still walk the presets
  await page.click('#vnext');
  assert.notStrictEqual(await visNow(), vis0, 'the visualization arrows must keep cycling presets');
  await page.click('#vprev');
  // a click at a quarter of the groove seeks there
  {
    // (the Play click above may have the player playing by now: then the click pauses, seeks, resumes)
    const r = await page.locator('#seektrack').boundingBox(), n = (await sent()).length;
    await page.mouse.click(r.x + 10.5 + (r.width - 21) * 0.25, r.y + r.height / 2);
    await page.waitForFunction((n) => window.__ws.sent.slice(n).some((d) => JSON.parse(d).cmd === 'seek'), n, { timeout: 3000 });
    const sk = (await sent()).slice(n).find((m) => m.cmd === 'seek');
    assert(Math.abs(sk.position - 32.5) < 1, 'seek not sent: ' + JSON.stringify(sk));
  }
  // while playing, holding the seek bar pauses; the release seeks, then resumes
  {
    await hostSends(media({ status: 'playing' }));
    const n = (await sent()).length;
    const r = await page.locator('#seektrack').boundingBox();
    await page.mouse.move(r.x + 10.5 + (r.width - 21) * 0.25, r.y + r.height / 2);
    await page.mouse.down();
    await page.mouse.move(r.x + 10.5 + (r.width - 21) * 0.5, r.y + r.height / 2, { steps: 3 });
    assert.deepStrictEqual((await sent()).slice(n).map((m) => m.cmd), ['pause'], 'held: paused, no seek yet');
    await page.mouse.up();
    await page.waitForFunction((n) => window.__ws.sent.length >= n + 3, n);
    const seq = (await sent()).slice(n).map((m) => m.cmd + (m.cmd === 'seek' ? ' ' + Math.round(m.position) : ''));
    assert.deepStrictEqual(seq, ['pause', 'seek 65', 'play'], 'released: seek, then resume: ' + JSON.stringify(seq));
    await hostSends(media());
  }
  // synced lyrics follow the position: the current line and the next one under it
  await hostSends(LYR);
  await hostSends(media({ position: 5 }));
  assert.deepStrictEqual(await lyr(), { shown: true, cur: 'First line', next: 'Second line', plain: false },
                         'lyrics at 5 s: ' + JSON.stringify(await lyr()));
  // karaoke (no word stamps: 'First line' spread over 1.92 s from t 4): 'First' fills until 5.05 s, then 'line'
  const words = () => page.evaluate(() => [...document.querySelectorAll('#lyrcur span')].map(s => s.dataset.k));
  assert.deepStrictEqual(await words(), ['now', ''], 'word classes at 5 s: ' + JSON.stringify(await words()));
  await hostSends(media({ position: 5.5 }));
  assert.deepStrictEqual(await words(), ['sung', 'now'], 'word classes at 5.5 s: ' + JSON.stringify(await words()));
  await hostSends(media({ position: 12 }));
  assert.deepStrictEqual(await lyr(), { shown: true, cur: 'Second line', next: 'Third line', plain: false },
                         'lyrics at 12 s: ' + JSON.stringify(await lyr()));
  await page.waitForTimeout(200);
  await page.screenshot({ path: OUT + '-nowplaying.png' });
  // playing: the position runs on between the host's frames, and the lyric line with it
  await hostSends(media({ status: 'playing', position: 15.5 }));
  assert.strictEqual(await page.textContent('#status'), 'Playing: Aphex Twin – Windowlicker', 'playing status');
  assert.strictEqual(await page.evaluate(() => document.getElementById('bplay').title), 'Pause', 'Play should show Pause');
  const f0 = await seekFrac();
  await page.waitForTimeout(1200);
  assert.strictEqual(await page.textContent('#time'), '00:16', 'the clock must extrapolate while playing');
  assert(await seekFrac() > f0, 'the seek thumb must move between frames');
  assert.strictEqual((await lyr()).cur, 'Third line', 'the lyric line must follow the extrapolated position');
  // karaoke highlight (Ctrl+K): off, the line is one plain lit line; on, word spans again
  const spans = () => page.evaluate(() => document.querySelectorAll('#lyrcur span').length);
  assert(await spans() > 0, 'karaoke on: word spans');
  await page.keyboard.press('Control+k');
  assert.deepStrictEqual([await spans(), (await lyr()).cur], [0, 'Third line'], 'karaoke off: a plain line');
  await page.keyboard.press('Control+k');
  assert(await spans() > 0, 'karaoke back on');
  // Options > Player > Fetch lyrics: off hides them at once and tells the host
  await page.click('#mtops [data-menu=tools]');
  await page.click(item(0, 'Options...'));
  await page.click('#lyrics');
  assert.deepStrictEqual(await lastSent(), { type: 'lyricsPref', enabled: false }, 'pref off not sent');
  assert.strictEqual((await lyr()).shown, false, 'lyrics must hide when the option goes off');
  await page.click('#lyrics');
  assert.deepStrictEqual(await lastSent(), { type: 'lyricsPref', enabled: true }, 'pref on not sent');
  await page.click('#optOK');
  // Ctrl+L is the same setting as the Options checkbox (the website has no lyrics button: it
  // shows only where lyrics exist, the desktop host and Spotify; the RTL tests cover it)
  const lit = () => page.evaluate(() => Alchemy.Shell.settings.lyrics);
  assert.strictEqual(await page.locator('#blyrics').count(), 0, 'no lyrics button on the website');
  assert.strictEqual(await page.$eval('#brepeat', (b) => [b.title, b.getAttribute('aria-hidden')].join()), 'Repeat: Off,true',
                     'the repeat disc is decoration without Spotify');
  await page.keyboard.press('Control+l');
  assert.deepStrictEqual(await lastSent(), { type: 'lyricsPref', enabled: false }, 'Ctrl+L: pref off not sent');
  assert.strictEqual((await lyr()).shown, false, 'Ctrl+L: lyrics must hide at once');
  assert(!(await lit()), 'lyrics off');
  await page.evaluate(() => Alchemy.store.getState().actions.setUi({ dialog: 'options' }));
  assert.strictEqual(await page.$eval('#lyrics', (c) => c.checked), false, 'Options checkbox follows Ctrl+L');
  assert.strictEqual(await page.$eval('#karaoke', (c) => c.disabled), true, 'karaoke option disabled while lyrics are off');
  await page.click('#optOK');
  await page.keyboard.press('Control+l');
  assert.deepStrictEqual(await lastSent(), { type: 'lyricsPref', enabled: true }, 'Ctrl+L: pref on not sent');
  assert(await lit(), 'Ctrl+L turns lyrics on again');
  // plain lyrics are a block in the pane, not the overlay; "none" hides both
  await hostSends(Object.assign({}, LYR, { status: 'plain', lines: null, plain: 'la la\nla la la' }));
  assert.deepStrictEqual(await lyr(), { shown: false, cur: '', next: '', plain: 'la la\nla la la' },
                         'plain lyrics: ' + JSON.stringify(await lyr()));
  await hostSends(Object.assign({}, LYR, { status: 'none', lines: null }));
  const nl = await lyr();
  assert(!nl.shown && !nl.plain, 'lyrics "none" must hide everything: ' + JSON.stringify(nl));
  // "none": everything back to the visualizer-only player
  await hostSends({ type: 'media', status: 'none' });
  const back = await page.evaluate(() => ({
    meta: document.getElementById('plmeta').hidden, img: !document.getElementById('plimg'),
    ph: getComputedStyle(document.getElementById('plph')).display === 'none', status: document.getElementById('status').textContent,
    time: document.getElementById('time').textContent, len: document.getElementById('time').title,
    next: document.getElementById('bnext').title
  }));
  assert.strictEqual(back.meta && back.img && !back.ph, true, 'the pane must go back to the placeholder: ' + JSON.stringify(back));
  assert.strictEqual(back.status, 'System audio (local)', 'status after none: ' + back.status);
  assert(/^\d\d:\d\d$/.test(back.time) && back.len === '', 'the capture clock must come back: ' + JSON.stringify(back));
  assert.strictEqual(back.next, 'Next visualization', 'Next must go back to walking the visualizers');
  assert(Math.abs(await seekFrac()) < 0.01, 'the seek thumb must go home');
  const vis1 = await visNow(), n0 = (await sent()).length;
  await page.click('#bnext');
  assert.notStrictEqual(await visNow(), vis1, 'Next must cycle presets again with no session');
  assert.strictEqual((await sent()).length, n0, 'no mediaCmd without a session');
  // screensaver: still chrome-free, with a track caption bottom-left and the larger lyric overlay
  await page.goto(PAGE + '?audio=ws&mode=screensaver');
  await page.waitForFunction(() => Alchemy && Alchemy.Shell.source && Alchemy.Shell.source.kind === 'wsaudio',
                             null, { timeout: 5000 });
  await hostSends(LYR);
  await hostSends(media({ position: 12 }));
  const ss = await page.evaluate(() => ({
    cap: document.getElementById('sscap').dataset.on === 'true' && document.getElementById('sscap').textContent,
    font: getComputedStyle(document.getElementById('lyrcur')).fontSize,
    chrome: getComputedStyle(document.getElementById('transport')).display
  }));
  assert.deepStrictEqual(ss, { cap: 'Aphex Twin – Windowlicker', font: '20px', chrome: 'none' },
                         'screensaver Now Playing: ' + JSON.stringify(ss));
  await page.waitForTimeout(900);
  await page.screenshot({ path: OUT + '-nowplaying-screensaver.png' });

  assert.strictEqual(errors.length, 0, 'page errors:\n' + errors.join('\n'));
  await browser.close();
  console.log('shell smoke: all checks passed, screenshots at ' + OUT + '-*.png');
})().catch(e => { console.error(e); process.exit(1); });
