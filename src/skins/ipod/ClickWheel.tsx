// The click wheel: a ring (MENU, ⏮, ⏭, ⏯) round a centre button, driven by pointer events, touch and
// mouse alike. A press on the ring that turns more than half a detent is a scroll, not a press: it
// ticks once per whole detent and fires no button. A press held HOLD_MS is the button's hold (Prev /
// Next repeat every REPEAT_MS while held); a hold nothing takes stays a press. On a desktop the
// keyboard stands in: arrows tick, Enter is the centre, Escape / Backspace MENU. Space is not here:
// the page's own keyboard (App onKey) already plays / pauses with it.
import { useEffect, useLayoutEffect, useRef, type PointerEvent as RPointerEvent } from 'react';
import { cx } from '../../ui';
import s from './ipod.module.css';

/** degrees per tick (the spec will refine) */
export const DETENT = 360 / 24;
export const HOLD_MS = 600, REPEAT_MS = 200;
/** the centre button's radius as a fraction of the wheel's */
export const HUB = 0.36;

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

  const down = (e: RPointerEvent<HTMLDivElement>) => {
    if (press.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const b = e.currentTarget.getBoundingClientRect(), r = b.width / 2, cx = b.left + r, cy = b.top + b.height / 2;
    const x = e.clientX - cx, y = e.clientY - cy, a = (Math.atan2(y, x) * 180) / Math.PI, zone = zoneAt(x, y, r);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const g: Press = { id: e.pointerId, zone, cx, cy, r, start: a, anchor: a, turned: false, held: false, timer: 0 };
    press.current = g;
    window.alchemyHaptic?.('prepare');
    if (p.current[HOLD[zone]]) {
      g.timer = window.setTimeout(() => {
        g.held = p.current[HOLD[zone]]?.() !== false;
        // clearTimeout clears an interval too (one timer list)
        if (g.held && (zone === 'prev' || zone === 'next')) g.timer = window.setInterval(() => p.current[HOLD[zone]]?.(), REPEAT_MS);
      }, HOLD_MS);
    }
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
    if (e.type === 'pointerup' && !g.turned && !g.held) p.current[TAP[g.zone]]();
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
    const held = press;
    return () => { window.removeEventListener('keydown', key, true); clearTimeout(held.current?.timer); };
  }, []);

  return (
    <div className={cx(s.wheel, props.className)} role="group" aria-label="Click wheel"
         onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}
         onContextMenu={(e) => e.preventDefault()}>
      <span className={s.menu}>MENU</span>
      <svg className={s.prev} viewBox="0 0 20 10" aria-hidden="true"><path d="M1 0h2v10H1zM11 0v10L3 5zM19 0v10l-8-5z" /></svg>
      <svg className={s.next} viewBox="0 0 20 10" aria-hidden="true"><path d="M17 0h2v10h-2zM9 0v10l8-5zM1 0v10l8-5z" /></svg>
      <svg className={s.play} viewBox="0 0 20 10" aria-hidden="true"><path d="M0 0v10l8-5zM11 0h3v10h-3zM16 0h3v10h-3z" /></svg>
      <div className={s.hub} />
    </div>
  );
}
