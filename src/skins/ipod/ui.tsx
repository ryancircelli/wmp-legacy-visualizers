// What the chrome gives the screens (screens/contract.ts ChromeModule): the wheel-driven list and its
// grid of tiles, the status row, the progress bar, the hold-centre popup, the spinner, the hooks, and the scan (hold
// ⏮ / ⏭) Now Playing shows. Looks and metrics: docs/ipod-skin.md §2.1-2.2.
import { useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type MouseEvent, type PointerEvent } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { hasMedia, positionNow } from '../../model';
import { artOk, cx, duration, isPlaying, isSpotify, playingTrack, useAddTo, useApp, useShell, type Shell } from '../../ui';
import { useHostGlobal } from './host';
import type { Chrome, GridItem, MenuItem } from './screens/contract';
import { useClockPrefs } from './screens';
import s from './ipod.module.css';
import { FrameContext, useWheel } from './wheel';
export { useNav, useWheel } from './wheel';
export { useIpodSettings } from './settings';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v || 0));

/** §3.2: the wheel's speed in ticks/s, filtered as Rockbox does (v = (15v + new) / 16), from 0 again
 *  after 250 ms without a tick. `dt` is ms since the last tick; ticks in one pointer event count as
 *  one frame (16 ms) apart. */
export const wheelSpeed = (v: number, dt: number): number => (dt > 250 ? 0 : (15 * v + 1000 / Math.max(dt, 16)) / 16);
/** rows a tick moves at that speed: only lists over 100 rows accelerate (ipod-classic-js's table) */
export const stride = (v: number, rows: number): number => (rows <= 100 ? 1 : v >= 14 ? 8 : v >= 10 ? 5 : v >= 6 ? 3 : 1);
/** a tick now: the speed kept in `sp` updated, the rows it moves returned */
function strideNow(sp: { v: number; at: number }, rows: number): number {
  const now = performance.now();
  sp.v = wheelSpeed(sp.v, now - sp.at);
  sp.at = now;
  return stride(sp.v, rows);
}

/** the scroll indicator over list `l` (hidden when it does not overflow) */
function placeThumb(l: HTMLElement | null, t: HTMLElement | null) {
  if (!l || !t) return;
  const H = l.scrollHeight;
  t.hidden = !(H > l.clientHeight + 1);
  t.style.top = (l.scrollTop / H) * 100 + '%';
  t.style.height = (l.clientHeight / H) * 100 + '%';
}

/** frames whose list is loading: the status bar shows the spinner in place of the play glyph (§2.2) */
const busy = createStore<{ ids: number[] }>(() => ({ ids: [] }));
export const useBusy = (frame: number): boolean => useStore(busy, (b) => b.ids.includes(frame));

/** What MenuScreen and GridScreen share (§2.2). Selection is the caller's when `selected` is given,
 *  else its own. It moves first and the list scrolls only when it would leave the view; lists over
 *  100 rows accelerate. A tap selects and does what the centre would. While it loads, the status bar
 *  shows the spinner and `note` says why it waits; with nothing to list, `note` is `empty`. */
function useList({ items, selected, onSelectedChange, loading, empty }: {
  items: MenuItem[]; selected?: number; onSelectedChange?: (i: number) => void; loading?: boolean; empty?: string;
}) {
  const [own, setOwn] = useState(0), list = useRef<HTMLDivElement>(null), thumb = useRef<HTMLDivElement>(null);
  const frame = useContext(FrameContext), speed = useRef({ v: 0, at: 0 });
  // a list waiting on Spotify says why: still signing in, signed out, or really loading
  const signedIn = useApp((x) => x.auth.loggedIn);
  const wait = signedIn === null ? 'Signing in…' : signedIn === false ? 'Not signed in' : 'Loading…';
  const sel = Math.max(0, Math.min(selected ?? own, items.length - 1));
  // several ticks can land in one pointer event, before a re-render: they count from here
  const at = useRef(sel);
  useLayoutEffect(() => { at.current = sel; });
  const item = items[sel];
  const live = !loading && item && !item.disabled ? item : undefined;
  const pick = (i: number) => { at.current = i; setOwn(i); onSelectedChange?.(i); };
  useWheel({
    onTick: (d) => {
      const from = at.current, i = Math.max(0, Math.min(items.length - 1, from + d * strideNow(speed.current, items.length)));
      if (loading || i === from) return false;          // nothing moved: no click (§3.3)
      pick(i);
    },
    onCenter: () => live?.onSelect?.(),
    // only while the row has a hold, so a plain row's long press stays a press
    onHoldCenter: live?.onHold ? () => live.onHold?.() : undefined,
  });
  const tap = (i: number) => {
    const it = items[i];
    if (loading || !it) return;
    if (i !== sel) pick(i);
    if (it.disabled) return;
    window.alchemyHaptic?.('light');
    it.onSelect?.();
  };
  // the status bar's spinner: only while data is really on its way
  useEffect(() => {
    if (!loading || signedIn !== true || !frame) return;
    const id = frame.id;
    busy.setState((b) => ({ ids: [...b.ids, id] }));
    return () => busy.setState((b) => { const ids = [...b.ids]; ids.splice(ids.indexOf(id), 1); return { ids }; });
  }, [loading, signedIn, frame]);
  // the selected row or tile in view (scrolling the list only, never the page), the scroll indicator
  useLayoutEffect(() => {
    const l = list.current, el = l?.children[sel] as HTMLElement | undefined;
    if (!l || !el) return;
    if (el.offsetTop < l.scrollTop) l.scrollTop = el.offsetTop;
    else if (el.offsetTop + el.offsetHeight > l.scrollTop + l.clientHeight) l.scrollTop = el.offsetTop + el.offsetHeight - l.clientHeight;
    placeThumb(l, thumb.current);
  }, [sel, items.length]);
  const note = loading ? <div className={s.row} data-loading=""><span className={s.label}>{wait}</span></div>
    : !items.length && empty ? <div className={s.row}><span className={s.label}>{empty}</span></div> : null;
  return { sel, pick, tap, note, list, thumb, onScroll: () => placeThumb(list.current, thumb.current) };
}

/** The list the wheel scrolls (§2.2): useList's rows. A row with `chevron: true` shows it on the
 *  selected row only (the 5G's rule). The screen is a touch screen too: a drag scrolls the list
 *  (natively, with momentum; the selection stays). The selected row's label marquees when it does not fit. */
export const MenuScreen: Chrome['MenuScreen'] = ({ items, selected, onSelectedChange, preview, loading, empty }) => {
  const { sel, tap, note, list, thumb, onScroll } = useList({ items, selected, onSelectedChange, loading, empty });
  const label = items[sel]?.label;
  // after 1 s, 30 units/s to the end, 1 s there, back to the start, again
  useLayoutEffect(() => {
    const row = list.current?.children[sel] as HTMLElement | undefined;
    const box = row?.firstElementChild as HTMLElement | null | undefined, text = box?.firstElementChild as HTMLElement | null | undefined;
    const over = row && box && text ? text.offsetWidth - box.clientWidth : 0;
    if (!row || over <= 0 || !text?.animate) return;
    const run = (over / ((30 * row.clientWidth) / 240)) * 1000, total = run + 2000, end = `translateX(${-over}px)`;
    const a = text.animate([{ transform: 'none' }, { transform: 'none', offset: 1000 / total },
                            { transform: end, offset: (1000 + run) / total }, { transform: end }], { duration: total, iterations: Infinity });
    return () => a.cancel();
  }, [sel, items.length, label, list]);
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className={cx(preview != null ? s.split : 'flex-auto min-h-0', s.list)}>
        <div ref={list} className={s.scroll} role="listbox" aria-busy={loading || undefined} onScroll={onScroll}>
          {note ?? items.map((it, i) => (
            <div key={it.id} className={s.row} role="option" aria-selected={i === sel} aria-disabled={it.disabled || undefined}
                 data-sel={i === sel || undefined} data-disabled={it.disabled || undefined} onClick={() => tap(i)}>
              <span className={s.label}><span>{it.label}</span></span>
              {it.right != null && <span className={s.value}>{it.right}</span>}
              {it.chevron && i === sel && <svg className={s.chevron} viewBox="0 0 7 11" aria-hidden="true"><path d="M1.5 1.5l4 4-4 4" /></svg>}
            </div>
          ))}
        </div>
        <div ref={thumb} className={s.thumb} hidden />
      </div>
      {preview != null && <div className={s.preview}>{preview}</div>}
    </div>
  );
};

/** A press this long on a tile is hold-centre (ms) */
const LONG_PRESS = 500;

/** MenuScreen's list as 2 columns of tiles, Spotify's library look (Tile). The wheel moves the
 *  selection a tile at a time, row by row; a drag scrolls; a tap opens; a long press (a finger held
 *  still: a drag cancels it) is hold-centre. */
export const GridScreen: Chrome['GridScreen'] = ({ items, selected, onSelectedChange, loading, empty }) => {
  const { sel, pick, tap, note, list, thumb, onScroll } = useList({ items, selected, onSelectedChange, loading, empty });
  const press = useRef({ timer: 0, held: false });
  useEffect(() => () => clearTimeout(press.current.timer), []);
  const release = () => clearTimeout(press.current.timer);
  const down = (i: number) => {
    const it = items[i], p = press.current;
    release();
    p.held = false;
    if (loading || !it?.onHold || it.disabled) return;
    p.timer = window.setTimeout(() => { p.held = true; pick(i); window.alchemyHaptic?.('medium'); it.onHold?.(); }, LONG_PRESS);
  };
  return (
    <div className={cx('h-full', s.list)}>
      <div ref={list} className={cx(s.scroll, !note && s.grid)} role="listbox" aria-busy={loading || undefined}
           onScroll={() => { release(); onScroll(); }}>
        {note ?? items.map((it, i) => (
          <Tile key={it.id} item={it} selected={i === sel} onPointerDown={() => down(i)} onPointerUp={release} onPointerCancel={release}
                onPointerLeave={release} onContextMenu={(e) => e.preventDefault()}
                // the click that ends a long press is not also a tap
                onClick={() => { if (press.current.held) press.current.held = false; else tap(i); }} />
        ))}
      </div>
      <div ref={thumb} className={s.thumb} hidden />
    </div>
  );
};

/** One tile: the square art (a grey ♪ tile when none), the name under it in bold, one line, its
 *  description under that, dim; the selected one ringed in the selection's blue. */
export function Tile({ item, selected, ...on }: { item: GridItem; selected: boolean } & Omit<HTMLAttributes<HTMLDivElement>, 'children'>) {
  const art = artOk(item.art);
  return (
    <div className={s.cell} role="option" aria-selected={selected} aria-disabled={item.disabled || undefined}
         data-sel={selected || undefined} data-disabled={item.disabled || undefined} {...on}>
      <div className={s.art}>
        {art ? <img src={art} alt="" loading="lazy" draggable={false} />
          : <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.2 11 .5v7.8a1.9 1.6 0 1 1-1.3-1.5V3.1L5.8 4.2v5.6a1.9 1.6 0 1 1-1.3-1.5z" /></svg>}
      </div>
      <div className={s.name}>{item.label}</div>
      {item.sub && <div className={s.sub}>{item.sub}</div>}
    </div>
  );
}

/** The time now, as the iPod writes it, re-rendered on the minute. */
export function useTime(h24: boolean): string {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setTimeout(() => setNow(Date.now()), 60_000 - (now % 60_000));
    return () => clearTimeout(t);
  }, [now]);
  return new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !h24 });
}

/** The status bar (§2.2, §2.4). Over menus (light): the title at the left, or the time with Settings >
 *  Date & Time > Time in Title. Over Now Playing and the media pages (`dark`): shuffle and repeat at
 *  the left (Spotify only), the time centred. At the right always: ▶ playing / ❚❚ paused (the spinner
 *  while the screen loads), then the battery (the phone's, when the iOS app reports it). Shuffle,
 *  repeat and Like are toggles: a tap flips shuffle (dimmed when off), steps repeat Off -> All -> One
 *  (dimmed when off), or likes / unlikes the track (♡ / ♥, dimmed with none). */
export const StatusRow = ({ title, dark, busy: loading }: { title: string; dark?: boolean; busy?: boolean }) => {
  const sh = useShell();
  const st = useApp((x) => ({ media: hasMedia(x), playing: isPlaying(x), paused: x.playback.status === 'paused',
                               shuffle: x.playback.shuffle, repeat: x.playback.repeat, spotify: isSpotify(x) }));
  const tap = (e: MouseEvent, act: () => void) => { e.stopPropagation(); window.alchemyHaptic?.('light'); act(); };
  const prefs = useClockPrefs(), time = useTime(prefs.twentyFourHour);
  const bat = useHostGlobal('__wmpBattery', 'wmp-battery');
  const level = bat && bat.level >= 0 ? bat.level / 100 : 1;
  const text = dark || prefs.timeInTitle ? time : title;
  return (
    <div className={s.status} data-dark={dark || undefined}>
      {dark && <span className={s.modes}>{st.spotify && <>
        <span className={s.mode} role="button" aria-label="Shuffle" aria-pressed={st.shuffle} data-off={!st.shuffle || undefined}
              onClick={(e) => tap(e, () => sh.store.getState().commands.toggleShuffle())}>
          <svg className={s.glyph} viewBox="0 0 12 9" aria-hidden="true">
            <path d="M0 2h3l5 5h2M0 7h3l5-5h2" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M10 0v4l2-2zM10 5v4l2-2z" /></svg>
        </span>
        <span className={s.mode} role="button" aria-label={st.repeat === 'track' ? 'Repeat one' : 'Repeat'} aria-pressed={st.repeat !== 'off'}
              data-off={st.repeat === 'off' || undefined}
              onClick={(e) => tap(e, () => sh.store.getState().commands.cycleRepeat())}>
          <svg className={s.glyph} viewBox="0 0 12 9" aria-hidden="true">
            <path d="M1 5V3h8M11 4v2H3" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M8.5 1l2.5 2-2.5 2zM3.5 4L1 6l2.5 2z" />
            {st.repeat === 'track' && <text x="6" y="7.5" fontSize="5" textAnchor="middle">1</text>}</svg>
        </span>
        <Like tap={tap} />
      </>}</span>}
      <span key={text} className={cx(s.title, 'min-w-0 truncate', dark && 'text-center')}>{text}</span>
      <span className={s.icons}>
        {loading ? <Spinner />
          : st.media && (st.playing || st.paused) && <span className={st.playing ? s.playing : s.paused} role="img" aria-label={st.playing ? 'Playing' : 'Paused'} />}
        <span className={s.battery} style={{ '--v': clamp01(level) } as CSSProperties} data-charging={bat?.charging || undefined}
              aria-label={bat && bat.level >= 0 ? 'Battery ' + bat.level + '%' : 'Battery'} />
      </span>
    </div>
  );
};

/** The status row's Like: the playing track's, by Now Playing's own useAddTo (one saved query for both) */
function Like({ tap }: { tap: (e: MouseEvent, act: () => void) => void }) {
  const like = useAddTo(useApp(playingTrack)), on = !!like.saved;
  return (
    <span className={s.mode} role="button" aria-label={on ? 'Unlike' : 'Like'} aria-pressed={on} aria-disabled={!like.uri || undefined}
          data-off={!like.uri || undefined} onClick={(e) => { if (like.uri) tap(e, like.toggle); else e.stopPropagation(); }}>
      <svg className={s.glyph} viewBox="0 1 12 11" aria-hidden="true">
        <path d="M6 10.4C3.3 8.4 1.3 6.8 1.3 4.5 1.3 3 2.5 1.9 3.8 1.9c1 0 1.7.5 2.2 1.3.5-.8 1.2-1.3 2.2-1.3 1.3 0 2.5 1.1 2.5 2.6 0 2.3-2 3.9-4.7 5.9Z"
              fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
    </span>
  );
}

/** The iPod's glossy blue progress bar. With `onSeek` it is touch-seekable: a tap seeks there, a
 *  drag scrubs (the bar follows the finger) and the release seeks, once, with the fraction 0..1. */
export function Bar({ value, className, onSeek }: { value: number; className?: string; onSeek?: (fraction: number) => void }) {
  const [drag, setDrag] = useState<number | null>(null);
  const at = (e: PointerEvent<HTMLDivElement>) => { const b = e.currentTarget.getBoundingClientRect(); return clamp01((e.clientX - b.left) / b.width); };
  const v = clamp01(drag ?? value);
  return (
    <div className={cx(s.bar, className)} style={{ '--v': v } as CSSProperties} data-seek={onSeek ? '' : undefined}
         role={onSeek ? 'slider' : 'progressbar'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}
         // the bar's own: not a swipe of the screen under it
         onPointerDown={onSeek && ((e) => { e.stopPropagation(); e.currentTarget.setPointerCapture?.(e.pointerId); setDrag(at(e)); })}
         onPointerMove={onSeek && ((e) => { if (drag !== null) setDrag(at(e)); })}
         onPointerUp={onSeek && ((e) => { if (drag === null) return; setDrag(null); onSeek(at(e)); })}
         onPointerCancel={onSeek && (() => setDrag(null))} />
  );
}

/** A modal list over the screen: it takes the wheel while open; MENU, a choice or a tap outside closes it. */
export const Popup: Chrome['Popup'] = ({ items, onClose }) => {
  useWheel({ onMenu: () => { onClose(); return true; }, onHoldCenter: () => {} });
  const closing = items.map((it) => ({ ...it, onSelect: () => { onClose(); it.onSelect?.(); } }));
  return (
    <div className={s.popup} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={s.sheet}><MenuScreen items={closing} /></div>
    </div>
  );
};

/** The iPod's 12-spoke activity wheel. */
export const Spinner: Chrome['Spinner'] = () => (
  <svg className={s.spinner} viewBox="0 0 16 16" role="progressbar" aria-label="Loading">
    {Array.from({ length: 12 }, (_, i) => (
      <rect key={i} x="7.25" y="0.5" width="1.5" height="4.5" rx=".75" opacity={(i + 1) / 12} transform={`rotate(${i * 30} 8 8)`} />
    ))}
  </svg>
);

// ---- Scan: hold ⏮ / ⏭ (§3.1) ---------------------------------------------------------------------
// Fast-forward and rewind never repeat a network call. While ⏮ / ⏭ is held (and the top screen has
// no hold of its own) the chrome scans locally: 4× real time, 8× after 2 s, 16× after 5 s, clamped
// to the track. On release it calls commands.seek once with where the scan got to.
//   useScan(): { scanning: -1 | 0 | 1, offsetMs }
//   - scanning: the direction (-1 rewind, 1 fast-forward), 0 when no scan shows. It stays set after
//     the release until the seek lands (the next playback state, or 3 s), so nothing jumps back.
//   - offsetMs: add it to the extrapolated position (usePosition / positionNow) to show the scan's
//     position; 0 while scanning is 0. Now Playing: shown = clamp(position + offsetMs).
export interface Scan { scanning: -1 | 0 | 1; offsetMs: number }
const IDLE: Scan = { scanning: 0, offsetMs: 0 };
const scanStore = createStore<Scan>(() => IDLE);
export const useScan = (): Scan => useStore(scanStore);

/** track ms a hold of `t` ms covers: 4× real time, 8× after 2 s, 16× after 5 s */
export const scanned = (t: number): number =>
  4 * Math.min(t, 2000) + 8 * Math.max(0, Math.min(t, 5000) - 2000) + 16 * Math.max(0, t - 5000);

let settle: (() => void) | null = null;
/** Start a scan; the function returned releases it (one seek). False when the track cannot seek. */
export function scan(store: Shell['store'], dir: -1 | 1): (() => void) | false {
  const s0 = store.getState();
  if (!hasMedia(s0) || !s0.playback.canSeek) return false;
  settle?.();
  const t0 = Date.now(), base = positionNow(s0);
  const target = () => Math.max(0, Math.min(duration(store.getState()), base + dir * scanned(Date.now() - t0)));
  const show = () => scanStore.setState({ scanning: dir, offsetMs: target() - positionNow(store.getState()) });
  show();
  const tick = setInterval(show, 50);
  return () => {
    clearInterval(tick);
    show();
    const s = store.getState(), ms = target(), was = s.playback.at;
    const off = store.subscribe((x) => x.playback.at, (a) => { if (a !== was) settle?.(); });
    const t = setTimeout(() => settle?.(), 3000);
    settle = () => { off(); clearTimeout(t); settle = null; scanStore.setState(IDLE); };
    void s.commands.seek(ms);
  };
}
