// The iPod nano (5th generation), portrait: the screen in its glass on top, the click wheel below.
// No visualizer and no audio capture: the screens are menus over the store (menus.tsx, screens/*).
// Every screen in the stack stays mounted (hidden under the top one), so going back finds it as it
// was; the wheel reaches the top screen only (wheel.ts), and the real iPod's buttons that a screen
// does not take keep their usual meaning here: Play / Prev / Next and their holds work everywhere
// (hold ⏯ sleeps, hold ⏮ / ⏭ scan: ui.tsx scan). docs/ipod-skin.md §3.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react';
import { useStore } from 'zustand';
import { useApp, useShell, useWindowControls } from '../../ui';
import { Boot } from './Boot';
import { ClickWheel } from './ClickWheel';
import { useHostChrome, useHostGlobal, useDesktopViewport } from './host';
import { mainMenu } from './menus';
import { brick, fmRadio, nowPlaying } from './screens';
import { createNav, top, type NavStore, type Slot } from './nav';
import type { WheelInput } from './screens/contract';
import { bodyVars, ipodSettings, useIpodSettings } from './settings';
import { NowPlayingBar, scan, StatusRow, useBusy } from './ui';
import { FrameContext, handler, NavContext, type Hub } from './wheel';
import s from './ipod.module.css';

/** §3.4: mouse-wheel pixels per tick over the device, accumulated and dropped after 250 ms idle (a
 *  line, Firefox's unit, counts as one tick) */
const WHEEL_PX = 40, WHEEL_IDLE = 250;
/** §3.3: at most 30 clicks a second; past that the list still moves, silently */
const CLICK_GAP = 1000 / 30;
/** a swipe right on the screen at least this far (px), more across than down, is MENU */
const SWIPE_PX = 50;
type Plain = 'onPlay' | 'onPrev' | 'onNext' | 'onHoldPlay';

export function Root() {
  const sh = useShell(), [ipod] = useIpodSettings();
  const [nav] = useState(() => createNav(mainMenu(), () => nowPlaying())), [hub] = useState<Hub>(() => new Map());
  // the screens under the dark status bar (§2.2: Now Playing, Radio, the Extras apps)
  const [dark] = useState(() => new Set([nowPlaying, fmRadio, brick].map((f) => f().key))), [npKey] = useState(() => nowPlaying().key);
  const { stack, dir } = useStore(nav.store), topSlot = stack[stack.length - 1]!, busy = useBusy(topSlot.id);
  // the Now Playing bar: under every screen but Now Playing while a track is loaded
  const bar = useApp((x) => !!x.playback.track) && topSlot.entry.key !== npKey;
  const safe = useHostGlobal('__wmpSafeArea', 'wmp-safe-area');
  const win = useWindowControls(), caption = useApp((x) => x.auth.hostWindow && !x.auth.nativeTitle);
  const [asleep, setAsleep] = useState(false);
  useHostChrome();
  useDesktopViewport();

  const c = () => sh.store.getState().commands;
  const h = <K extends keyof WheelInput>(k: K) => handler(hub, top(nav.store.getState()).id, k);
  /** the top screen's handler, else the chrome's */
  const or = (k: Plain, dflt: () => void) => () => (h(k) ?? dflt)();
  const clicked = useRef(0);
  /** a detent that moved something: the haptic and the clicker (a screen's onTick returning false moved nothing) */
  const tick = (d: 1 | -1) => {
    const f = h('onTick');
    if (!f || (f(d) as unknown) === false) return;
    const now = performance.now();
    if (now - clicked.current < CLICK_GAP) return;
    clicked.current = now;
    window.alchemyHaptic?.('selection');
    if (ipodSettings().clicker) click();
  };
  const menu = () => { if (h('onMenu')?.() !== true) nav.pop(); };
  // the mouse wheel over the device ticks; it never scrolls a list (a native, non-passive listener)
  const wheel = useRef({ px: 0, at: 0 }), device = useRef<HTMLDivElement>(null);
  const onWheel = (e: WheelEvent) => {
    const w = wheel.current, now = performance.now();
    if (now - w.at > WHEEL_IDLE) w.px = 0;
    w.at = now;
    w.px += e.deltaY * (e.deltaMode ? WHEEL_PX : 1);
    while (Math.abs(w.px) >= WHEEL_PX) {
      const d = w.px > 0 ? 1 : -1;
      w.px -= d * WHEEL_PX;
      tick(d);
    }
  };
  const wheelNow = useRef(onWheel);
  useLayoutEffect(() => { wheelNow.current = onWheel; });
  useEffect(() => {
    const el = device.current, f = (e: WheelEvent) => { e.preventDefault(); wheelNow.current(e); };
    el?.addEventListener('wheel', f, { passive: false });
    return () => el?.removeEventListener('wheel', f);
  }, []);
  // the touch screen: a swipe right is MENU (and not also a tap on the row it ended on)
  const swipe = useRef<{ id: number; x: number; y: number } | null>(null), swiped = useRef(false);
  const screenTouch = {
    onPointerDown: (e: PointerEvent) => { swiped.current = false; swipe.current = { id: e.pointerId, x: e.clientX, y: e.clientY }; },
    onPointerUp: (e: PointerEvent) => {
      const g = swipe.current;
      swipe.current = null;
      if (!g || g.id !== e.pointerId) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (dx >= SWIPE_PX && Math.abs(dy) < dx / 2) { swiped.current = true; menu(); }
    },
    onPointerCancel: () => { swipe.current = null; },
    onClickCapture: (e: MouseEvent) => { if (swiped.current) { swiped.current = false; e.stopPropagation(); } },
  };
  // hold ⏮ / ⏭: the top screen's own hold, repeated (contract.ts), else the chrome's scan
  const held = useRef<{ repeat?: number; release?: () => void }>({});
  const hold = (k: 'onHoldPrev' | 'onHoldNext', d: 1 | -1) => {
    const f = h(k);
    if (f) { f(); held.current = { repeat: window.setInterval(f, 200) }; return; }
    const release = scan(sh.store, d);
    if (!release) { window.alchemyHaptic?.('warning'); return false; }   // cannot seek: the press stays a press
    held.current = { release };
  };
  const unhold = () => { clearInterval(held.current.repeat); held.current.release?.(); held.current = {}; };
  // hold ⏯: sleep, the nano's off (pause, LCD dark); the next press only wakes it
  useEffect(() => {
    if (!asleep) return;
    const wake = (e: Event) => { if (e.type === 'pointerdown') e.stopPropagation(); setAsleep(false); };
    window.addEventListener('pointerdown', wake, true);
    window.addEventListener('keydown', wake, true);
    return () => { window.removeEventListener('pointerdown', wake, true); window.removeEventListener('keydown', wake, true); };
  }, [asleep]);
  // §3.4: under a desktop host that draws no title, the aluminium (and the backdrop) is the caption
  const drag = (e: MouseEvent) => { if (!(e.target as Element).closest(`.${s.bezel}, .${s.wheel}`)) win.onCaptionMouseDown(e); };
  // The insets come in points; in the desktop-wide viewport the phone scales the page, so a point is
  // (viewport width / screen width) CSS pixels (host.ts: why the viewport is the desktop one).
  const k = Math.min(4, Math.max(1, window.innerWidth / (window.screen?.width || window.innerWidth)));
  const insets = safe && ({ '--safe-top': safe.top * k + 'px', '--safe-right': safe.right * k + 'px', '--safe-bottom': safe.bottom * k + 'px', '--safe-left': safe.left * k + 'px' } as CSSProperties);

  return (
    <NavContext.Provider value={nav}>
      <div className={s.backdrop} data-ui-root="" onMouseDown={caption ? drag : undefined}>
        {/* on the phone (the iOS app) the body always fills the screen, whatever shape its viewport */}
        <div className={s.body} data-wheel={ipod.wheel} data-phone={window.alchemyLayout ? '' : undefined} style={{ ...bodyVars(ipod), ...insets }}>
          <div className={s.device} ref={device}>
            <div className={s.bezel}>
              <div className={s.screen} data-asleep={asleep || undefined} data-bar={bar || undefined} {...screenTouch}>
                <StatusRow title={topSlot.entry.title} dark={dark.has(topSlot.entry.key)} busy={busy} />
                <div className={s.frames} style={{ '--dir': dir } as CSSProperties}>
                  {stack.map((slot, i) => <Frame key={slot.id} hub={hub} slot={slot} nav={nav} shown={i === stack.length - 1} />)}
                </div>
                {bar && <NowPlayingBar onOpen={() => nav.toNowPlaying()} />}
                <Boot />
              </div>
            </div>
            <ClickWheel
              onTick={tick}
              onCenter={() => h('onCenter')?.()}
              onMenu={menu}
              onPlay={or('onPlay', () => void c().playPause())}
              onPrev={or('onPrev', () => void c().prev())}
              onNext={or('onNext', () => void c().next())}
              // a hold on centre: the screen's (a row's own menu, Now Playing's), else Now Playing itself
              // while a track plays (the owner, 2026-10-02: "long press center button should open now playing")
              onHoldCenter={() => { const f = h('onHoldCenter'); if (f) { f(); return; } if (!bar) return false; nav.toNowPlaying(); }}
              onHoldMenu={() => nav.home()}
              onHoldPlay={or('onHoldPlay', () => { void c().pause(); setAsleep(true); })}
              onHoldPrev={() => hold('onHoldPrev', -1)}
              onHoldNext={() => hold('onHoldNext', 1)}
              onHoldEnd={unhold} />
          </div>
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

let audio: { ac: AudioContext; noise: AudioBuffer } | null = null;
/** The clicker (§3.3): the iOS keyboard tick where the app has it; elsewhere Web Audio, one shared
 *  context: a 4 ms burst of white noise under a 1.5 ms decay, through a 3 kHz high-pass at gain .12,
 *  silent while the page is hidden. */
function click() {
  if (window.alchemySound) { window.alchemySound(1104); return; }
  if (document.hidden || typeof AudioContext === 'undefined') return;
  if (!audio) {
    const ac = new AudioContext(), noise = ac.createBuffer(1, Math.ceil(ac.sampleRate * .004), ac.sampleRate), d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ac.sampleRate * .0015));
    audio = { ac, noise };
  }
  const { ac, noise } = audio, src = ac.createBufferSource(), hp = ac.createBiquadFilter(), g = ac.createGain();
  void ac.resume();
  src.buffer = noise;
  hp.type = 'highpass';
  hp.frequency.value = 3000;
  g.gain.value = .12;
  src.connect(hp).connect(g).connect(ac.destination);
  src.start();
}
