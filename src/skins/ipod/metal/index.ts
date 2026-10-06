// Settings > Metal > Rendered (docs/ipod-skin.md §1.7): the body drawn by the GPU (gl.ts) on a canvas
// under the device, the CSS cylinder's place. Drawn when something changes, never on a loop: the
// colour, the size, the room's light (the screen's brightness, settled) and the hand (the phone's roll,
// past a tremor, at most FPS a second while it turns). In Low Power Mode it holds still (the owner,
// 2026-10-06: "keep pbr in low power but disable motion and light responses"): upright and at the
// middle brightness, drawn again only for the colour and the size. Without WebGL, or with its context
// lost, the canvas goes and the classic body shows again.
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { pointPx } from '../host';
import s from '../ipod.module.css';
import { createRenderer } from './gl';

/** a roll under this (degrees) from the one drawn draws nothing: with the room turning by the phone's
 *  whole roll (TURN), a degree moves the reflections about 5 px, so this is about a pixel and a half. The
 *  host sends the roll ten times a second in steps of about a degree (App.swift Tilt), which already
 *  leaves the hand's tremor out */
const STILL = .3;
/** each draw goes this share of the way to the newest roll, so the host's steps glide in over a few
 *  frames (at most FPS a second) instead of jumping */
const EASE = .45;
/** at most this many draws a second while the phone turns or a colour is dragged */
const FPS = 30;
/** the brightness stands this long (ms) before the room follows it */
const SETTLE = 500;
/** the room turns with the hand by this share of the phone's own roll: 1, as real metal's reflections
 *  do (a turn of 4° at a full roll, matched to the classic sheen's 12 px, could not be seen: the owner,
 *  2026-10-06, "i also don't see tilt applying") */
const TURN = 1;
/** the room's light from the screen's brightness 0..1 (the classic --lux's range, in linear light);
 *  the middle, 1, where the host reports none and in Low Power Mode */
const exposure = (b: number) => 1 + (Math.max(0, Math.min(1, b)) - .5) * .28;

type Rgb = readonly [number, number, number];
const log = (line: string) => window.alchemyLog?.('ipod: metal ' + line);
const tilt = () => Math.max(-1, Math.min(1, window.__wmpTilt ?? 0));
const deg = (t: number) => Math.asin(t) * 180 / Math.PI;
const linear = (c: number) => (c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
/** hsl (degrees, %, %) as linear RGB */
export function dye([h, sat, l]: Rgb): Rgb {
  const a = sat / 100 * Math.min(l / 100, 1 - l / 100);
  const k = (n: number) => (n + h / 30) % 12, c = (n: number) => l / 100 - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [linear(c(0)), linear(c(8)), linear(c(4))];
}

/** The body `body` drawn by the GPU while `on`, in `color` (hsl as it reads, settings.ts bodyLook). */
export function useMetal(body: RefObject<HTMLElement | null>, on: boolean, color: Rgb): void {
  const paint = useRef<((f0: Rgb) => void) | null>(null);
  const [h, sat, l] = color;
  useLayoutEffect(() => {
    const el = body.current;
    if (!on || !el) return;
    const m = start(el);
    paint.current = m?.color ?? null;
    return () => { paint.current = null; m?.stop(); };
  }, [on, body]);
  useLayoutEffect(() => { paint.current?.(dye([h, sat, l])); }, [on, h, sat, l]);
}

function start(body: HTMLElement) {
  const canvas = document.createElement('canvas');
  canvas.className = s.metal!;
  body.prepend(canvas);
  const r = createRenderer(canvas);
  if (typeof r === 'string') { canvas.remove(); log('classic (' + r + ')'); return null; }
  log('rendered (' + r.name + ')');
  let f0: Rgb | null = null, low = !!window.__wmpLowPower, lux = window.__wmpBrightness ?? .5, w = -1, h = -1;
  /** the last draw's roll (degrees) and inputs (as a key), when, how many this minute; a draw the
   *  hidden page owes; the throttled draw's and the brightness's timers */
  let roll = 0, drawn = '', at = -Infinity, count = 0, dirty = false, due = 0, settle = 0, shown = 0;
  if (low) log('still (low power)');
  const draw = () => {
    due = 0;
    if (!f0) return;
    if (document.hidden) { dirty = true; return; }
    dirty = false;
    const target = low ? 0 : deg(tilt());
    shown = low || Math.abs(target - shown) < .1 ? target : shown + (target - shown) * EASE;
    const frame = { f0, exposure: exposure(low ? .5 : lux), turn: shown * TURN * Math.PI / 180 };
    const key = JSON.stringify([frame, w, h]);
    if (key === drawn) return;
    r.draw(frame);
    roll = shown; drawn = key; at = performance.now(); count++;
    if (shown !== target) request();             // still gliding to the newest roll
  };
  const request = () => {
    if (due) return;
    const wait = at + 1000 / FPS - performance.now();
    if (wait <= 0) draw(); else due = window.setTimeout(draw, wait);
  };
  /** the canvas at the body's size in points, a CSS pixel in a browser (its light is smooth; the
   *  browser scales it up; on the phone the page's CSS pixels are the desktop viewport's, 2.5 a point) */
  const fit = () => {
    const k = pointPx(), W = Math.round(canvas.clientWidth / k), H = Math.round(canvas.clientHeight / k);
    if (W === w && H === h) return;
    w = W; h = H;
    r.size(W, H);
    request();
  };
  const onTilt = () => { if (!low && Math.abs(deg(tilt()) - roll) > STILL) request(); };
  const onLux = () => {
    clearTimeout(settle);
    settle = window.setTimeout(() => { lux = window.__wmpBrightness ?? .5; if (!low) request(); }, SETTLE);
  };
  const onLow = () => {
    if (!!window.__wmpLowPower === low) return;
    low = !low;
    log(low ? 'still (low power)' : 'live');
    request();
  };
  const onSeen = () => { if (!document.hidden && dirty) request(); };
  const onLost = () => { log('classic (context lost)'); stop(); };
  const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
  const minute = window.setInterval(() => { log(count + ' redraws/min'); count = 0; }, 60_000);
  const heard: [EventTarget, string, () => void][] = [[window, 'wmp-tilt', onTilt], [window, 'wmp-brightness', onLux], [window, 'wmp-lowpower', onLow],
                                                     [document, 'visibilitychange', onSeen], [canvas, 'webglcontextlost', onLost]];
  for (const [t, e, f] of heard) t.addEventListener(e, f);
  ro?.observe(canvas);
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
  };
  return { color: (c: Rgb) => { if (!stopped) { f0 = c; request(); } }, stop };
}
