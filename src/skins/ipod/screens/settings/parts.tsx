// What the Settings pages share: nano-pixel metrics and colours, the screen-entry helpers, the red
// confirm list, a text page the wheel scrolls and a bar page the wheel sets.
import { useRef, useState, type FC, type ReactNode } from 'react';
import { Bar, MenuScreen, useNav, useWheel } from '../../ui';
import type { MenuItem, Nav, ScreenEntry } from '../contract';

/** n nano pixels */
export const u = (n: number) => `calc(var(--unit) * ${n})`;
// the chrome's colours (ipod.module.css), the spec's values behind them (docs/ipod-skin.md §2.2)
export const TEXT = 'var(--ipod-text, #000)', DIM = 'var(--ipod-dim, #8e8e93)';
const SEL_BG = 'var(--ipod-sel-bg, linear-gradient(180deg, #4ea0dc 0%, #4690d4 40%, #3f7fcd 70%, #336ac7 100%))';
const ROW = `var(--ipod-row-h, ${u(29.67)})`;
export const check = (on: boolean) => (on ? '✓' : undefined);
export const onOff = (on: boolean) => (on ? 'On' : 'Off');

/** A screen whose body is a component (it may use hooks). */
export const page = (key: string, title: string, C: FC): ScreenEntry => ({ key, title, render: () => <C /> });
/** A plain list. */
export const menu = (key: string, title: string, items: (nav: Nav) => MenuItem[]): ScreenEntry =>
  ({ key, title, render: (nav) => <MenuScreen items={items(nav)} /> });

/** Reset Settings / Log Out (§2.4 Settings pages): the act, then Cancel, the act's selection bar red
 *  (reconstructed). It opens on Cancel, so a double press never acts. */
function Confirm({ label, act }: { label: string; act: (nav: Nav) => void }) {
  const nav = useNav(), [i, setI] = useState(1);
  const choose = (k: number) => (k ? nav.pop() : act(nav));
  useWheel({ onTick: (d) => { const k = d > 0 ? 1 : 0; if (k === i) return false; setI(k); }, onCenter: () => choose(i) });
  return (
    <div style={{ color: TEXT, fontSize: u(18), fontWeight: 'bold' }}>
      {[label, 'Cancel'].map((l, k) => (
        <div key={l} onClick={() => { setI(k); choose(k); }}
             style={{ display: 'flex', alignItems: 'center', height: ROW, padding: `0 ${u(9)} 0 ${u(10)}`,
                      ...(k === i ? { background: k ? SEL_BG : 'linear-gradient(#e35d5b, #b8211f)', color: '#fff' } : {}) }}>{l}</div>
      ))}
    </div>
  );
}
export const confirm = (key: string, title: string, label: string, act: (nav: Nav) => void): ScreenEntry =>
  ({ key, title, render: () => <Confirm label={label} act={act} /> });

/** A page of text; the wheel scrolls it. */
export function TextPage({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useWheel({ onTick: (d) => { const el = ref.current; if (el) el.scrollTop += (d * el.clientHeight) / 6; } });
  return <div ref={ref} style={{ height: '100%', overflow: 'hidden', padding: u(10), color: TEXT, fontSize: u(14), lineHeight: 1.35 }}>{children}</div>;
}

/** A label at the left, its value dim at the right. */
export const Row = ({ label, value }: { label: string; value: ReactNode }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: u(8), padding: `${u(2)} 0` }}>
    <span>{label}</span><span style={{ color: DIM, textAlign: 'right', minWidth: 0, overflowWrap: 'anywhere' }}>{value}</span>
  </div>
);

/** A setting the wheel turns (Volume Limit, Brightness): the volume's bar between two glyphs; centre
 *  keeps it and goes back. `onTick` returns false when the value stays (no click at the ends). */
export function BarPage({ value, onTick, caption, lo, hi }: {
  value: number; onTick: (d: 1 | -1) => boolean | void; caption: ReactNode; lo?: ReactNode; hi?: ReactNode;
}) {
  const nav = useNav();
  useWheel({ onTick, onCenter: () => nav.pop() });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%', padding: `0 ${u(12)}`, gap: u(12),
                  color: TEXT, fontSize: u(14), textAlign: 'center' }}>
      <div>{caption}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: u(6) }}>{lo}<div style={{ flex: 1 }}><Bar value={value} /></div>{hi}</div>
    </div>
  );
}
