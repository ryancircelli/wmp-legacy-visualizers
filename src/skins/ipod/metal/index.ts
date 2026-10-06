// Settings > Metal > Rendered (docs/ipod-skin.md §1.7): the body and the click wheel's ring and centre
// button drawn by the GPU (gl.ts) on a canvas under the device, the CSS cylinder's and the wheel's
// backgrounds' place (the wheel's MENU, glyphs and touches stay the page's, where the layout puts them),
// and the glass's reflection on a canvas over the screen, its static glare's place. Drawn when
// something changes, never on a loop: the colours, the size and the wheel's and the glass's place, the
// room's light (the screen's brightness, settled) and the hand (the phone's roll and pitch, past a
// tremor, at most FPS a second while it turns). In Low Power Mode it holds still (the owner, 2026-10-06:
// "keep pbr in low power but disable motion and light responses"): upright and at the middle
// brightness, drawn again only for the colours, the size and the layout. Without WebGL, or with its
// context lost, the canvases go and the classic look shows again.
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { pointPx } from '../host';
import s from '../ipod.module.css';
import { createRenderer, type Frame, type Layout } from './gl';

/** a roll or a tip under this (degrees) from the one aimed at is not followed: with the room turning by
 *  15% of the roll (TURN), a degree moves the reflections under a pixel, so this is about a pixel and a
 *  half. The host sends the roll ten times a second in steps of about a degree (App.swift Tilt); a hand
 *  held still on a step's edge flickers between two of them, which at .3 (and the glide chasing each
 *  reading) drew 30 times a second while the phone lay still */
const STILL = 2;
/** each draw goes this share of the way to the roll aimed at, so the host's steps glide in over a few
 *  frames (at most FPS a second) instead of jumping */
const EASE = .45;
/** while a tip settles back with no new reading, the room's pitch is drawn again only once it has moved
 *  this far (degrees of the room, about half a pixel), and goes home under it: drawn every frame, one
 *  tip of 25° was 500 draws over 17 s of a still phone */
const STEP = .1;
/** at most this many draws a second while the phone turns or a colour is dragged */
const FPS = 30;
/** the brightness stands this long (ms) before the room follows it */
const SETTLE = 500;
/** the room turns with the hand by this share of the phone's own roll (and its pitch, PITCH): 4° at a full
 *  roll could not be seen ("i also don't see tilt applying"), the whole roll was "too aggressive" (the
 *  owner, 2026-10-06) */
const TURN = .15, PITCH = .12;
/** and never past this (degrees) either way: tipped further, the reflections left the room's windows for
 *  its dark floor and the body went nearly black ("gets way too dark and moves too much", build 88) */
const REACH = 6;
/** the pitch is taken from how the phone is being held, a reference that follows it over this long (ms):
 *  tipping it moves the light, which settles back as the new angle becomes the way it is held */
const HOLD = 4000;
/** the room's light from the screen's brightness 0..1 (the classic --lux's range, in linear light);
 *  the middle, 1, where the host reports none and in Low Power Mode */
const exposure = (b: number) => 1 + (Math.max(0, Math.min(1, b)) - .5) * .28;

type Rgb = readonly [number, number, number];
const log = (line: string) => window.alchemyLog?.('ipod: metal ' + line);
const tilt = () => Math.max(-1, Math.min(1, window.__wmpTilt ?? 0));
const pitchNow = () => window.__wmpPitch ?? 0;
const deg = (t: number) => Math.asin(t) * 180 / Math.PI;
const linear = (c: number) => (c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
/** hsl (degrees, %, %) as linear RGB */
export function dye([h, sat, l]: Rgb): Rgb {
  const a = sat / 100 * Math.min(l / 100, 1 - l / 100);
  const k = (n: number) => (n + h / 30) % 12, c = (n: number) => l / 100 - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [linear(c(0)), linear(c(8)), linear(c(4))];
}

/** The body `body` drawn by the GPU while `on`, in `color` (hsl as it reads, settings.ts bodyLook), its
 *  click wheel's ring in `ring`. */
export function useMetal(body: RefObject<HTMLElement | null>, on: boolean, color: Rgb, ring: Frame['ring']): void {
  const paint = useRef<((f0: Rgb, ring: Frame['ring']) => void) | null>(null);
  const [h, sat, l] = color;
  useLayoutEffect(() => {
    const el = body.current;
    if (!on || !el) return;
    const m = start(el);
    paint.current = m?.color ?? null;
    return () => { paint.current = null; m?.stop(); };
  }, [on, body]);
  useLayoutEffect(() => { paint.current?.(dye([h, sat, l]), ring); }, [on, h, sat, l, ring]);
}

function start(body: HTMLElement) {
  const canvas = document.createElement('canvas');
  canvas.className = s.metal!;
  body.prepend(canvas);
  // the glass's reflection, over the screen (the bezel's glass, gl.ts)
  const bezel = body.querySelector<HTMLElement>('.' + s.bezel!), over = bezel ? document.createElement('canvas') : null;
  if (over) { over.className = s.glass!; bezel!.append(over); }
  const r = createRenderer(canvas, over);
  if (typeof r === 'string') { canvas.remove(); over?.remove(); log('classic (' + r + ')'); return null; }
  if (!r.glass) over?.remove();                                 // no second context: Classic's glare stays
  log('rendered (' + r.name + ')');
  let f0: Rgb | null = null, ring: Frame['ring'] = 'white', low = !!window.__wmpLowPower, lux = window.__wmpBrightness ?? .5, w = -1, h = -1;
  /** the wheel and the glass on the canvas (gl.ts Layout), as a key; the wheel's ring and centre button on the page */
  let layout = '';
  const [wheelEl, hubEl] = [s.wheel, s.hub].map((c) => body.querySelector<HTMLElement>('.' + c!));
  /** the last draw's inputs (as a key), when, how many this minute; a draw the hidden page owes; the
   *  next draw's timer and when it is due; the brightness's timer */
  let drawn = '', at = -Infinity, count = 0, dirty = false, due = 0, dueAt = 0, settle = 0;
  /** the roll and the pitch aimed at (the last readings past STILL), the roll drawn; the pitch's reference
   *  (how it is held) and when it last followed; the tip drawn */
  let aim = deg(tilt()), pAim = pitchNow(), shown = 0, held = pAim, heldAt = performance.now(), tipped = 0;
  /** a new pitch reading is gliding in (after it, the tip follows the reference as it settles) */
  let fresh = false;
  if (low) log('still (low power)');
  const draw = () => {
    due = 0;
    if (!f0) return;
    if (document.hidden) { dirty = true; return; }
    dirty = false;
    const target = low ? 0 : aim;
    shown = low || Math.abs(target - shown) < .1 ? target : shown + (target - shown) * EASE;
    // the tip from how it is held: the reference follows the pitch over HOLD; home once under a STEP
    const now = follow();
    const tip = low || Math.abs(pAim - held) * PITCH < STEP ? 0 : pAim - held;
    fresh &&= !low && Math.abs(tip - tipped) >= .1;
    tipped = fresh ? tipped + (tip - tipped) * EASE : tip;
    const cap = (x: number) => Math.max(-REACH, Math.min(REACH, x)) * Math.PI / 180;
    const frame = { f0, ring, exposure: exposure(low ? .5 : lux), turn: cap(shown * TURN), pitch: cap(tipped * PITCH) };
    const key = JSON.stringify([frame, w, h, layout]);
    if (key !== drawn) { r.draw(frame); drawn = key; at = now; count++; }
    if (shown !== target || fresh) request();                 // gliding to what is aimed at
    // settling back: again once the room's pitch has moved a STEP (it goes as tip / HOLD)
    else if (tip) schedule(Math.min(1000, Math.max(1000 / FPS, STEP * HOLD / (Math.abs(tip) * PITCH))));
  };
  /** the reference brought up to now, toward the pitch aimed at */
  const follow = () => {
    const now = performance.now();
    held += (pAim - held) * Math.min(1, (now - heldAt) / HOLD); heldAt = now;
    return now;
  };
  /** a draw `wait` ms from now, unless one is due sooner */
  const schedule = (wait: number) => {
    const when = performance.now() + Math.max(0, wait);
    if (due && when >= dueAt) return;
    clearTimeout(due);
    dueAt = when;
    if (wait <= 0) { due = 0; draw(); } else due = window.setTimeout(draw, wait);
  };
  const request = () => schedule(at + 1000 / FPS - performance.now());
  /** the canvas at the body's size in points, a CSS pixel in a browser (its light is smooth; the
   *  browser scales it up; on the phone the page's CSS pixels are the desktop viewport's, 2.5 a point),
   *  and the wheel and the glass where the page lays them out, in the canvas's pixels */
  const fit = () => {
    const c = canvas.getBoundingClientRect(), k = pointPx(), W = Math.round(c.width / k), H = Math.round(c.height / k);
    const sx = c.width ? W / c.width : 0, sy = c.height ? H / c.height : 0;
    const [ring, hub, pane] = [wheelEl, hubEl, bezel].map((el) => el?.getBoundingClientRect());
    const at: Layout = {
      wheel: ring?.width && hub ? { x: (ring.left + ring.width / 2 - c.left) * sx, y: H - (ring.top + ring.height / 2 - c.top) * sy,
                                    r: ring.width / 2 * sx, hub: hub.width / 2 * sx } : null,
      glass: pane?.width ? { x: (pane.left - c.left) * sx, y: (pane.top - c.top) * sy, w: pane.width * sx, h: pane.height * sy } : null,
    };
    const key = JSON.stringify(at);
    if (W === w && H === h && key === layout) return;
    w = W; h = H; layout = key;
    r.size(W, H, at);
    // the grain (.body::before) is the brushed metal's, not the wheel's plastic: kept off it (ipod.module.css)
    if (ring?.width) {
      body.style.setProperty('--wheel-at', `${ring.left + ring.width / 2 - c.left}px ${ring.top + ring.height / 2 - c.top}px`);
      body.style.setProperty('--wheel-r', ring.width / 2 + 'px');
    }
    request();
  };
  const onTilt = () => { const t = deg(tilt()); if (!low && Math.abs(t - aim) > STILL) { aim = t; request(); } };
  // a new pitch: the reference first caught up with the old (it follows in time, drawn or not: after a still
  // spell the first draw would otherwise take the whole tip as how it is held, and show none of it)
  const onPitch = () => { const p = pitchNow(); if (!low && Math.abs(p - pAim) > STILL) { follow(); pAim = p; fresh = true; request(); } };
  const onLux = () => {
    clearTimeout(settle);
    settle = window.setTimeout(() => { lux = window.__wmpBrightness ?? .5; if (!low) request(); }, SETTLE);
  };
  const onLow = () => {
    if (!!window.__wmpLowPower === low) return;
    low = !low;
    log(low ? 'still (low power)' : 'live');
    // back from it: the roll as it is now, and the pitch as it is now taken as how it is held
    if (!low) { aim = deg(tilt()); pAim = held = pitchNow(); heldAt = performance.now(); }
    request();
  };
  const onSeen = () => { if (!document.hidden && dirty) request(); };
  const onLost = () => { log('classic (context lost)'); stop(); };
  const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
  const minute = window.setInterval(() => { log(count + ' redraws/min'); count = 0; }, 60_000);
  const heard: [EventTarget, string, () => void][] = [[window, 'wmp-tilt', onTilt], [window, 'wmp-pitch', onPitch], [window, 'wmp-brightness', onLux], [window, 'wmp-lowpower', onLow],
                                                     [document, 'visibilitychange', onSeen], [canvas, 'webglcontextlost', onLost]];
  if (over && r.glass) heard.push([over, 'webglcontextlost', onLost]);
  for (const [t, e, f] of heard) t.addEventListener(e, f);
  for (const el of [canvas, wheelEl, hubEl, bezel]) if (el) ro?.observe(el);
  fit();
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const [t, e, f] of heard) t.removeEventListener(e, f);   // first: the context's own loss below is no fall
    ro?.disconnect();
    clearTimeout(due); clearTimeout(settle); clearInterval(minute);
    r.dispose();
    canvas.remove();
    over?.remove();
    body.style.removeProperty('--wheel-at'); body.style.removeProperty('--wheel-r');
  };
  return { color: (c: Rgb, rg: Frame['ring']) => { if (!stopped) { f0 = c; ring = rg; request(); } }, stop };
}
