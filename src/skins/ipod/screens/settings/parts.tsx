// What the Settings and Extras pages share: nano-pixel metrics and colours, the screen-entry
// helpers, a text page the wheel scrolls, a bar page the wheel sets, and the clock tick.
import { useEffect, useRef, useState, type FC, type ReactNode } from 'react';
import { Bar, MenuScreen, useNav, useWheel } from '../../ui';
import type { MenuItem, Nav, ScreenEntry } from '../contract';

/** n nano pixels */
export const u = (n: number) => `calc(var(--unit) * ${n})`;
export const TEXT = 'var(--ipod-text, #000)', DIM = 'var(--ipod-dim, #6e6e73)', BLUE = 'var(--ipod-blue, #2a7ae2)';
export const check = (on: boolean) => (on ? '✓' : undefined);
export const onOff = (on: boolean) => (on ? 'On' : 'Off');

/** A screen whose body is a component (it may use hooks). */
export const page = (key: string, title: string, C: FC): ScreenEntry => ({ key, title, render: () => <C /> });
/** A plain list. */
export const menu = (key: string, title: string, items: (nav: Nav) => MenuItem[]): ScreenEntry =>
  ({ key, title, render: (nav) => <MenuScreen items={items(nav)} /> });
/** The iPod's "No Contacts" page. */
export const nothing = (key: string, title: string, text: string): ScreenEntry =>
  ({ key, title, render: () => <MenuScreen items={[]} empty={text} /> });
/** Cancel first (selected), then the act. */
export const confirm = (key: string, title: string, label: string, act: (nav: Nav) => void): ScreenEntry =>
  menu(key, title, (nav) => [{ id: 'cancel', label: 'Cancel', onSelect: () => nav.pop() }, { id: 'ok', label, onSelect: () => act(nav) }]);

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

/** A setting the wheel turns (Volume Limit, Brightness): centre keeps it and goes back. */
export function BarPage({ value, onTick, caption }: { value: number; onTick: (d: 1 | -1) => void; caption: ReactNode }) {
  const nav = useNav();
  useWheel({ onTick, onCenter: () => nav.pop() });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%', padding: `0 ${u(18)}`, gap: u(12),
                  color: TEXT, fontSize: u(14), textAlign: 'center' }}>
      <div>{caption}</div>
      <Bar value={value} />
    </div>
  );
}

/** Date.now(), re-read every `ms` while `on`. */
export function useNow(ms: number, on = true): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms, on]);
  return now;
}
