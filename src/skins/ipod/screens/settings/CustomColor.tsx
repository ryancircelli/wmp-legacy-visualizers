// Settings > Color > Custom: the body's hue, lightness and saturation, by touch or by wheel (the owner,
// 2026-10-02: a y axis for tans and browns, and not the wheel alone). A field the finger drags in (hue
// across, lightness down, light at the top) with a ring at the colour, and under it the saturation's
// slider. The wheel turns the focused control; the centre button moves the focus hue, lightness,
// saturation and round (the ring, or the slider's thumb, and the readout's name in the selection
// blue); MENU leaves. Every change shows on the body at once and is kept.
import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { LIGHT } from '../../settings';
import { useIpodSettings, useWheel } from '../../ui';
import { DIM, TEXT, u } from './parts';
import { FOCI, fieldAt, fieldPoint, satAt, stepColor, type Focus } from './logic';

const BLUE = 'var(--ipod-value, #3e94e1)';
const pct = (f: number) => f * 100 + '%';
const hsl = (h: number, s: number, l: number) => `hsl(${h} ${s}% ${l}%)`;
/** HSL's lightness is a straight mix with white over 50 % and black under it, so the hue rainbow at 50 %
 *  under white fading out to 50 % and black fading in from it is the field's exact colour at every point */
const mid = (LIGHT[1] - 50) / (LIGHT[1] - LIGHT[0]);
const SHADE = `linear-gradient(rgb(255 255 255 / ${(LIGHT[1] - 50) / 50}), transparent ${pct(mid)}, transparent ${pct(mid)}, rgb(0 0 0 / ${(50 - LIGHT[0]) / 50}))`;

/** Pointer handlers reporting where the finger is in the element (0..1 across and down) from the press
 *  until it lifts. Captured, so a drag off the edge keeps tracking; its own, never the screen's swipe. */
function useDrag(to: (x: number, y: number) => void) {
  const id = useRef<number | null>(null);
  const at = (e: PointerEvent<HTMLDivElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    to((e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height);
  };
  return {
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      if (e.button) return;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      id.current = e.pointerId;
      at(e);
    },
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => { if (id.current === e.pointerId) at(e); },
    onPointerUp: (e: PointerEvent<HTMLDivElement>) => { e.stopPropagation(); id.current = null; },
    onPointerCancel: () => { id.current = null; },
  };
}

/** the ring in the field and the slider's thumb: white, or the selection blue while it has the wheel */
const knob = (on: boolean, x: number, y: number, size: number, bg: string): CSSProperties => ({
  position: 'absolute', left: pct(x), top: pct(y), width: u(size), height: u(size), transform: 'translate(-50%, -50%)', boxSizing: 'border-box',
  borderRadius: '50%', border: `${u(2.5)} solid ${on ? BLUE : '#fff'}`, background: bg, pointerEvents: 'none',
  boxShadow: '0 0 0 1px rgb(0 0 0 / .45), 0 1px 3px rgb(0 0 0 / .4)',
});
const track: CSSProperties = { position: 'relative', touchAction: 'none', cursor: 'pointer', boxShadow: 'inset 0 0 0 1px rgb(0 0 0 / .25)' };

export function CustomColor() {
  const [ip, patch] = useIpodSettings(), [focus, setFocus] = useState<Focus>('hue');
  useWheel({
    onTick: (d) => { const p = stepColor(ip, focus, d); if (!p) return false; patch(p); },
    onCenter: () => setFocus(FOCI[(FOCI.indexOf(focus) + 1) % FOCI.length]!),
  });
  const field = useDrag((x, y) => { patch(fieldAt(x, y)); if (focus === 'sat') setFocus('hue'); });
  const slider = useDrag((x) => { patch(satAt(x)); setFocus('sat'); });
  const { hue, sat, light } = ip, [fx, fy] = fieldPoint(ip), color = hsl(hue, sat, light);
  const rainbow = `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360].map((h) => hsl(h, sat, 50)).join()})`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box', padding: u(12), gap: u(12), color: TEXT }}>
      <div {...field} data-picker="field" role="group" aria-label="Hue and lightness"
           style={{ ...track, flex: 1, minHeight: 0, borderRadius: u(4), background: `${SHADE}, ${rainbow}` }}>
        <div style={knob(focus !== 'sat', fx, fy, 16, color)} />
      </div>
      <div {...slider} data-picker="sat" role="slider" aria-label="Saturation" aria-valuemin={0} aria-valuemax={100} aria-valuenow={sat}
           style={{ ...track, height: u(14), margin: `0 ${u(7)}`, borderRadius: u(7),
                    background: `linear-gradient(to right, ${hsl(hue, 0, light)}, ${hsl(hue, 100, light)})` }}>
        <div style={knob(focus === 'sat', sat / 100, 0.5, 20, color)} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', textAlign: 'center', fontSize: u(14) }}>
        {([['hue', 'Hue', hue + '°'], ['light', 'Lightness', light + '%'], ['sat', 'Saturation', sat + '%']] as const).map(([k, label, v]) => (
          <div key={k} data-focus={k === focus || undefined} style={{ color: k === focus ? BLUE : TEXT }}>
            <div style={{ fontSize: u(10), color: k === focus ? BLUE : DIM }}>{label}</div>{v}
          </div>
        ))}
      </div>
    </div>
  );
}
