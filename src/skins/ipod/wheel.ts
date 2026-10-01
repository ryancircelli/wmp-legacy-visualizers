// How the wheel reaches the screens: every screen frame has a slot id; a screen (or a MenuScreen or
// Popup inside it) registers its handlers with useWheel, and the chrome sends each wheel event to
// the top frame only. Inside one frame the latest registrant that has the handler wins, so a Popup
// opened over a list takes the wheel and gives it back when it closes.
import { createContext, useContext, useLayoutEffect, useRef } from 'react';
import { useStore } from 'zustand';
import type { NavStore } from './nav';
import type { Nav, WheelInput } from './screens/contract';

type Reg = { current: WheelInput };
export type Hub = Map<number, Reg[]>;

export const NavContext = createContext<NavStore | null>(null);
/** the frame's slot id and the hub it registers in */
export const FrameContext = createContext<{ hub: Hub; id: number } | null>(null);

/** The handler of the top frame's latest registrant that has `k`. */
export function handler<K extends keyof WheelInput>(hub: Hub, frame: number, k: K): WheelInput[K] {
  const regs = hub.get(frame) ?? [];
  for (let i = regs.length - 1; i >= 0; i--) { const f = regs[i]!.current[k]; if (f) return f; }
  return undefined;
}

export function useWheel(handlers: WheelInput): void {
  const frame = useContext(FrameContext), ref = useRef(handlers);
  useLayoutEffect(() => { ref.current = handlers; });
  useLayoutEffect(() => {
    if (!frame) return;
    const { hub, id } = frame, regs = hub.get(id) ?? [];
    hub.set(id, [...regs, ref]);
    return () => {
      const left = (hub.get(id) ?? []).filter((r) => r !== ref);
      if (left.length) hub.set(id, left); else hub.delete(id);
    };
  }, [frame]);
}

/** The stack, re-rendering the caller when its depth changes. */
export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('iPod screen rendered outside the iPod skin');
  useStore(nav.store, (s) => s.stack.length);
  return nav;
}
