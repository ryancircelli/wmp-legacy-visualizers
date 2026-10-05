// Cover Flow (REFERENCE §Cover Flow): the front cover square and flat, the others standing at an angle
// on each side and overlapping, receding into the black, every one over its mirror image; the front
// one's title and artist under it, a dark scrollbar under that. ← / → and the wheel walk, a drag flicks
// through, a click on a side cover brings it to the front, a double-click (or Enter) on the front one
// plays it. Only the covers near the front are drawn.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import { cx, Slider } from '../../../ui';
import { Icon } from './icons';
import s from './itunes.module.css';

export interface FlowCover { key: string; img: string | null; name: string; sub: string }

/** covers drawn either side of the front one */
const SPAN = 7;
/** wheel pixels, and drag widths of a cover, per step */
const WHEEL_STEP = 40, DRAG_STEP = 0.32;

/** Where a cover stands, `d` places from the front, for covers `size` px wide: [x px, angle°, depth px].
 *  Fitted to the 2010 capture: the nearest side cover turned 45° toward the middle, its inner edge at the
 *  front cover's edge and about as tall (set back), about 0.56 of a cover wide; each further one 0.15 of a
 *  cover further out and a little further back, so only a strip of it shows. */
export function flowPlace(d: number, size: number): [number, number, number] {
  if (d === 0) return [0, 0, 0];
  const k = Math.sign(d), n = Math.abs(d);
  return [k * (size * 0.85 + (n - 1) * size * 0.15), k * 45, -size * (0.42 + (n - 1) * 0.04)];
}

export function CoverFlow({ covers, index, onIndex, onActivate, className, id }: {
  covers: FlowCover[]; index: number; onIndex: (i: number) => void; onActivate: (i: number) => void; className?: string; id?: string;
}) {
  const stage = useRef<HTMLDivElement>(null), [h, setH] = useState(300), wheel = useRef({ acc: 0, at: 0 });
  const drag = useRef<{ x: number; at: number; moved: boolean } | null>(null);
  useEffect(() => {
    const el = stage.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const n = covers.length, at = Math.max(0, Math.min(n - 1, index));
  const go = (i: number) => { const j = Math.max(0, Math.min(n - 1, i)); if (j !== at) onIndex(j); };
  const size = Math.max(60, Math.min(Math.round(h * 0.72), 360)), top = Math.round(h * 0.045);
  const onKey = (e: KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, Home: -n, End: n, PageUp: -SPAN, PageDown: SPAN }[e.key];
    if (step) { e.preventDefault(); go(at + step); } else if (e.key === 'Enter' && n) { e.preventDefault(); onActivate(at); }
  };
  const onWheel = (e: WheelEvent) => {
    const w = wheel.current, now = performance.now(), d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (now - w.at > 250) w.acc = 0;
    w.at = now;
    w.acc += d * (e.deltaMode ? WHEEL_STEP : 1);
    const steps = Math.trunc(w.acc / WHEEL_STEP);
    if (steps) { w.acc -= steps * WHEEL_STEP; go(at + steps); }
  };
  const down = (e: PointerEvent) => { if (e.button === 0) drag.current = { x: e.clientX, at, moved: false }; };
  const move = (e: PointerEvent) => {
    const g = drag.current;
    if (!g) return;
    const steps = Math.round((g.x - e.clientX) / (size * DRAG_STEP));
    if (steps) { g.moved = true; e.currentTarget.setPointerCapture?.(e.pointerId); go(g.at + steps); }
  };
  const front = covers[at];
  return (
    <div ref={stage} id={id} tabIndex={0} onKeyDown={onKey} onWheel={onWheel} onPointerDown={down} onPointerMove={move}
         onPointerUp={() => { setTimeout(() => { drag.current = null; }, 0); }} onPointerCancel={() => { drag.current = null; }}
         className={cx('relative overflow-hidden bg-itunes-flow outline-none select-none touch-none', className)}
         style={{ perspective: size * 4 + 'px', perspectiveOrigin: '50% ' + (top + size / 2) + 'px' }}>
      {covers.map((c, i) => {
        const d = i - at;
        if (Math.abs(d) > SPAN) return null;
        const [x, rot, z] = flowPlace(d, size);
        return (
          <div key={c.key} data-front={d === 0 || undefined} title={c.name}
               className="absolute left-1/2 [transition:transform_.32s_cubic-bezier(.2,.7,.3,1)] cursor-default"
               style={{ top, width: size, height: size, marginLeft: -size / 2, zIndex: 100 - Math.abs(d),
                        transform: `translateX(${x}px) translateZ(${z}px) rotateY(${rot}deg)`,
                        // the side covers in shade, as the capture's are
                        filter: d ? `brightness(${Math.max(0.35, 0.64 - (Math.abs(d) - 1) * 0.06)})` : undefined }}
               onClick={() => { if (!drag.current?.moved && d !== 0) go(i); }}
               onDoubleClick={() => { if (d === 0) onActivate(i); }}>
            <Art c={c} className="block w-full h-full" />
            <Art c={c} className={cx(s.reflect, 'block w-full h-full mt-1 -scale-y-100 pointer-events-none')} />
          </div>
        );
      })}
      {front && (
        <div className="absolute inset-x-0 text-center pointer-events-none px-20 z-200" style={{ top: top + size + 5 }}>
          <div className="truncate text-12 leading-[15px] font-bold text-white">{front.name}</div>
          <div className="truncate text-12 leading-[15px] text-itunes-flow-ink">{front.sub}</div>
        </div>
      )}
      {n > 1 && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-10 z-200 w-[min(74%,640px)] flex items-center h-15 rounded-full border border-[#B3B3B3]/80 bg-[linear-gradient(180deg,#3A3A39,#5C5C5B_45%,#5C5C5B)]"
             onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" className="flex-none w-16 h-full p-0 border-0 bg-transparent text-[#D8D8D8] text-[8px]" aria-label="Previous cover" onClick={() => go(at - 1)}>◀</button>
          <Slider label="Covers" inset={14} value={at / (n - 1)} onMove={(f) => go(Math.round(f * (n - 1)))} onCommit={(f) => go(Math.round(f * (n - 1)))}
                  className="relative flex-auto h-full"
                  thumbClassName="absolute top-1 bottom-1 w-28 left-[calc((100%-28px)*var(--seek,0))] rounded-full border border-[#8A8A8A] bg-[linear-gradient(180deg,#5A5A5A,#1A1A1A_55%,#000000)]" />
          <button type="button" className="flex-none w-16 h-full p-0 border-0 bg-transparent text-[#D8D8D8] text-[8px]" aria-label="Next cover" onClick={() => go(at + 1)}>▶</button>
        </div>
      )}
    </div>
  );
}

function Art({ c, className }: { c: FlowCover; className: string }) {
  return c.img
    ? <img src={c.img} alt="" draggable={false} className={cx(className, 'object-cover bg-[#222]')} />
    : <span className={cx(className, 'grid place-items-center bg-[linear-gradient(180deg,#3C3C3C,#1C1C1C)] text-[#6A6A6A]')}><Icon name="music" size={48} /></span>;
}
