// The iPod nano (5th generation), portrait: the screen in its glass on top, the click wheel below.
// No visualizer and no audio capture: the screens are menus over the store (menus.tsx, screens/*).
// Every screen in the stack stays mounted (hidden under the top one), so going back finds it as it
// was; the wheel reaches the top screen only (wheel.ts), and the real iPod's buttons that a screen
// does not take keep their usual meaning here: Play / Prev / Next and their holds work everywhere.
import { useMemo, useRef, useState, type CSSProperties, type WheelEvent } from 'react';
import { useStore } from 'zustand';
import { useShell } from '../../ui';
import { ClickWheel } from './ClickWheel';
import { useHostChrome, useHostGlobal, useMobileViewport } from './host';
import { mainMenu } from './menus';
import { nowPlaying, useVolumeLimit } from './screens';
import { createNav, top, type NavStore, type Slot } from './nav';
import type { WheelInput } from './screens/contract';
import { bodyVars, ipodSettings, useIpodSettings } from './settings';
import { StatusRow } from './ui';
import { FrameContext, handler, NavContext, type Hub } from './wheel';
import s from './ipod.module.css';

/** mouse-wheel pixels per tick over the screen (a desktop's stand-in for the wheel).
 *  ponytail: one notch is ~100 px in Chrome and 3 lines in Firefox; tune if a trackpad feels slow */
const WHEEL_PX = 100, LINE_PX = 33;
type Plain = 'onPlay' | 'onPrev' | 'onNext' | 'onHoldPlay' | 'onHoldPrev' | 'onHoldNext';

export function Root() {
  const sh = useShell(), [ipod] = useIpodSettings();
  const [nav] = useState(() => createNav(mainMenu(), () => nowPlaying())), [hub] = useState<Hub>(() => new Map());
  const { stack, dir } = useStore(nav.store);
  const safe = useHostGlobal('__wmpSafeArea', 'wmp-safe-area');
  useHostChrome();
  useMobileViewport();
  useVolumeLimit();                 // Settings > Volume Limit holds everywhere, not only on its page

  const c = () => sh.store.getState().commands;
  const h = <K extends keyof WheelInput>(k: K) => handler(hub, top(nav.store.getState()).id, k);
  /** the top screen's handler, else the chrome's */
  const or = (k: Plain, dflt: () => void) => () => (h(k) ?? dflt)();
  const tick = (d: 1 | -1) => {
    window.alchemyHaptic?.('selection');
    if (ipodSettings().clicker) window.alchemySound?.(1104);
    h('onTick')?.(d);
  };
  const scrolled = useRef(0);
  const onWheel = (e: WheelEvent) => {
    scrolled.current += e.deltaY * (e.deltaMode === 1 ? LINE_PX : 1);
    while (Math.abs(scrolled.current) >= WHEEL_PX) {
      const d = scrolled.current > 0 ? 1 : -1;
      scrolled.current -= d * WHEEL_PX;
      tick(d);
    }
  };

  return (
    <NavContext.Provider value={nav}>
      <div className={s.body} data-ui-root="" data-wheel={ipod.wheel}
           style={{ ...bodyVars(ipod), padding: safe ? `${safe.top}px ${safe.right}px ${safe.bottom}px ${safe.left}px` : undefined }}>
        <div className={s.device}>
          <div className={s.bezel}>
            <div className={s.screen} onWheel={onWheel}>
              <StatusRow title={stack[stack.length - 1]!.entry.title} />
              <div className={s.frames} style={{ '--dir': dir } as CSSProperties}>
                {stack.map((slot, i) => <Frame key={slot.id} hub={hub} slot={slot} nav={nav} shown={i === stack.length - 1} />)}
              </div>
            </div>
          </div>
          <ClickWheel
            onTick={tick}
            onCenter={() => h('onCenter')?.()}
            onMenu={() => { if (h('onMenu')?.() !== true) nav.pop(); }}
            onPlay={or('onPlay', () => void c().playPause())}
            onPrev={or('onPrev', () => void c().prev())}
            onNext={or('onNext', () => void c().next())}
            onHoldCenter={() => { const f = h('onHoldCenter'); if (!f) return false; f(); }}
            onHoldMenu={() => nav.home()}
            // the nano's hold-Play is sleep; here it pauses. Prev / Next scan, repeated while held.
            // ponytail: a seek per repeat (5/s) under Spotify; one seek on release if that ever 429s
            onHoldPlay={or('onHoldPlay', () => void c().pause())}
            onHoldPrev={or('onHoldPrev', () => c().skip(-2))}
            onHoldNext={or('onHoldNext', () => c().skip(2))} />
        </div>
      </div>
    </NavContext.Provider>
  );
}

/** One stacked screen: its own wheel registrations (FrameContext), hidden unless on top. */
function Frame({ hub, slot, nav, shown }: { hub: Hub; slot: Slot; nav: NavStore; shown: boolean }) {
  const frame = useMemo(() => ({ hub, id: slot.id }), [hub, slot.id]);
  return (
    <FrameContext.Provider value={frame}>
      <div className={s.frame} hidden={!shown}>{slot.entry.render(nav)}</div>
    </FrameContext.Provider>
  );
}
