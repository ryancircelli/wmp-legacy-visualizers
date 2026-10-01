// The click wheel: a ring (MENU, ⏮, ⏭, ⏯) round a centre button, driven by pointer events, touch and
// mouse alike (docs/ipod-skin.md §3.2). A press on the ring that turns more than half a detent is a
// scroll, not a press: it ticks once per whole detent and fires no button. A press held HOLD_MS
// (SLEEP_MS for ⏯) is the button's hold, and its release is onHoldEnd; a hold nothing takes stays a
// press. A right-click is a hold of that zone at once (§3.4). Feedback (§3.3): 'prepare' on touch, a
// 'light' haptic per press, 'medium' when a hold fires. On a desktop the keyboard stands in: arrows
// tick, Enter is the centre, Escape / Backspace MENU. Space is not here: the page's own keyboard (App
// onKey) already plays / pauses with it.
import { useEffect, useLayoutEffect, useRef, type PointerEvent as RPointerEvent } from 'react';
import { cx } from '../../ui';
import s from './ipod.module.css';

/** degrees per tick: 24 a turn as on the real wheel (Rockbox: 96 positions, 4 per item). A tuning
 *  knob, 12 to 18; try 12 on a phone, where the wheel is about 1.5 times the real 27 mm */
export const DETENT = 360 / 24;
export const HOLD_MS = 600, SLEEP_MS = 1500;
/** the centre button's diameter as a fraction of the wheel's (measured: 13.3 of 27 mm) */
export const HUB = 0.49;

export type Zone = 'center' | 'menu' | 'next' | 'play' | 'prev';

/** a turn in degrees, folded into [-180, 180) */
const wrap = (d: number) => ((((d % 360) + 540) % 360) - 180);
/** Whole detents from `from` to `to` (degrees, clockwise positive), the shorter way round. */
export const ticksFor = (from: number, to: number, detent: number): number => Math.trunc(wrap(to - from) / detent) || 0;

/** Which part of a wheel of radius r a point is on (x, y from the centre, y down). */
export function zoneAt(x: number, y: number, r: number): Zone {
  if (Math.hypot(x, y) < r * HUB) return 'center';
  const a = (Math.atan2(y, x) * 180) / Math.PI;       // 0 right, 90 down
  return a > -45 && a <= 45 ? 'next' : a > 45 && a <= 135 ? 'play' : a > -135 && a <= -45 ? 'menu' : 'prev';
}

export interface WheelProps {
  onTick(dir: 1 | -1): void;
  onCenter(): void; onMenu(): void; onPrev(): void; onNext(): void; onPlay(): void;
  /** holds: returning false says nothing took it, and the press stays a press */
  onHoldCenter?(): boolean | void; onHoldMenu?(): boolean | void; onHoldPrev?(): boolean | void;
  onHoldNext?(): boolean | void; onHoldPlay?(): boolean | void;
  /** a taken hold let go (the scan's release) */
  onHoldEnd?(zone: Zone): void;
  detent?: number;
  className?: string;
}

const TAP = { center: 'onCenter', menu: 'onMenu', prev: 'onPrev', next: 'onNext', play: 'onPlay' } as const;
const HOLD = { center: 'onHoldCenter', menu: 'onHoldMenu', prev: 'onHoldPrev', next: 'onHoldNext', play: 'onHoldPlay' } as const;
const KEYS: Record<string, (w: WheelProps) => void> = {
  ArrowUp: (w) => w.onTick(-1), ArrowLeft: (w) => w.onTick(-1), ArrowDown: (w) => w.onTick(1), ArrowRight: (w) => w.onTick(1),
  Enter: (w) => w.onCenter(), Escape: (w) => w.onMenu(), Backspace: (w) => w.onMenu(),
};

/** One press: its pointer, zone, the wheel's centre and radius, where it started, the angle of the
 *  last tick, whether it turned (a scroll) or was held, and the hold timer. */
interface Press { id: number; zone: Zone; cx: number; cy: number; r: number; start: number; anchor: number; turned: boolean; held: boolean; timer: number }

export function ClickWheel(props: WheelProps) {
  const p = useRef(props), press = useRef<Press | null>(null);
  useLayoutEffect(() => { p.current = props; });

  const hold = (g: Press) => {
    g.held = p.current[HOLD[g.zone]]?.() !== false;
    if (g.held) window.alchemyHaptic?.('medium');
  };

  const down = (e: RPointerEvent<HTMLDivElement>) => {
    const right = e.pointerType === 'mouse' && e.button === 2;
    if (press.current || (e.pointerType === 'mouse' && e.button !== 0 && !right)) return;
    const b = e.currentTarget.getBoundingClientRect(), r = b.width / 2, cx = b.left + r, cy = b.top + b.height / 2;
    const x = e.clientX - cx, y = e.clientY - cy, a = (Math.atan2(y, x) * 180) / Math.PI, zone = zoneAt(x, y, r);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const g: Press = { id: e.pointerId, zone, cx, cy, r, start: a, anchor: a, turned: false, held: false, timer: 0 };
    press.current = g;
    window.alchemyHaptic?.('prepare');
    // a right-click is the hold, now; taken or not it is never a tap
    if (right) { g.turned = true; hold(g); return; }
    if (p.current[HOLD[zone]]) g.timer = window.setTimeout(() => hold(g), zone === 'play' ? SLEEP_MS : HOLD_MS);
  };

  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const g = press.current;
    if (!g || e.pointerId !== g.id || g.zone === 'center' || g.held) return;
    const x = e.clientX - g.cx, y = e.clientY - g.cy;
    if (Math.hypot(x, y) < g.r * 0.15) return;          // atan2 is noise near the middle
    const a = (Math.atan2(y, x) * 180) / Math.PI, detent = p.current.detent ?? DETENT;
    if (!g.turned && Math.abs(wrap(a - g.start)) > detent / 2) { g.turned = true; clearTimeout(g.timer); }
    const n = ticksFor(g.anchor, a, detent);
    if (!n) return;
    g.anchor = (g.anchor + n * detent) % 360;
    for (let i = 0; i < Math.abs(n); i++) p.current.onTick(n > 0 ? 1 : -1);
  };

  /** pointerup taps (unless it turned or was held); cancel and a lost capture just end the press */
  const up = (e: RPointerEvent<HTMLDivElement>) => {
    const g = press.current;
    if (!g || e.pointerId !== g.id) return;
    press.current = null;
    clearTimeout(g.timer);
    if (g.held) p.current.onHoldEnd?.(g.zone);
    else if (e.type === 'pointerup' && !g.turned) { window.alchemyHaptic?.('light'); p.current[TAP[g.zone]](); }
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = (e.composedPath?.()[0] ?? e.target) as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || !KEYS[e.key] || /^(INPUT|SELECT|TEXTAREA)$/.test(t?.tagName ?? '') || t?.isContentEditable) return;
      e.preventDefault();
      KEYS[e.key]!(p.current);
    };
    // capture on window: under Spotify the page stops keys before they bubble back up (App wirePage)
    window.addEventListener('keydown', key, true);
    const held = press, cur = p;
    return () => {
      window.removeEventListener('keydown', key, true);
      const g = held.current;
      clearTimeout(g?.timer);
      if (g?.held) cur.current.onHoldEnd?.(g.zone);
    };
  }, []);

  return (
    <div className={cx(s.wheel, props.className)} role="group" aria-label="Click wheel"
         onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}
         onContextMenu={(e) => e.preventDefault()}>
      <span className={s.menu}>MENU</span>
      <svg className={s.prev} viewBox="0 0 23 10" preserveAspectRatio="none" aria-hidden="true"><path d="M0 0h2v10H0zM12.5 0v10L2 5zM23 0v10L12.5 5z" /></svg>
      <svg className={s.next} viewBox="0 0 23 10" preserveAspectRatio="none" aria-hidden="true"><path d="M21 0h2v10h-2zM10.5 0v10L21 5zM0 0v10l10.5-5z" /></svg>
      <svg className={s.play} viewBox="0 0 21 10" preserveAspectRatio="none" aria-hidden="true"><path d="M0 0v10l8-5zM12 0h3v10h-3zM17 0h3v10h-3z" /></svg>
      <div className={s.hub} />
    </div>
  );
}
