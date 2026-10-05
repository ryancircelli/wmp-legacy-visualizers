// What iTunes put in a right-click menu, the phone asks in an action sheet, as the iPhone of 2010 did:
// the blue-grey translucent panel rising from the bottom, white glossy buttons, the destructive one red,
// Cancel dark at the foot. A long press on a song opens its sheet (no right-click on a phone, and iOS
// sends no contextmenu for a long press); the AirPlay button opens Play On's; Log Out confirms in one.
// One sheet at a time, kept in a small store so any page can open one over the whole layout.
import { useEffect, useRef, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { create } from 'zustand';
import type { Track } from '../../../model';
import { canSave, cx, useAddTo, useApp, useDevices, useShell, type MenuEntry } from '../../../ui';
import { playRow, showPlaying, startGenius, viewActions, type Content } from '../shared';
import { haptic } from './host';
import { nav } from './nav';

const sheets = create<{ node: ReactNode }>(() => ({ node: null }));
export const openSheet = (node: ReactNode) => sheets.setState({ node });
export const closeSheet = () => sheets.setState({ node: null });

/** Where the open sheet shows (over the whole layout: Root renders it last). */
export function SheetHost() {
  return <>{sheets((s) => s.node)}</>;
}

export interface SheetItem { label: string; act?: () => void; check?: boolean; disabled?: boolean; danger?: boolean }

const BTN = 'block w-full h-40 mb-8 px-12 rounded-[9px] border text-[15px] leading-[38px] font-bold truncate shadow-[0_1px_0_rgba(255,255,255,.22)]';
const WHITE = 'border-[#3B3F46] bg-[linear-gradient(180deg,#FFFFFF,#EDEDED_50%,#E1E1E1_51%,#F2F2F2)] text-black active:bg-[linear-gradient(180deg,#6AA0E2,#3871C6)] active:text-white aria-disabled:text-[#A0A0A0] aria-disabled:active:bg-[linear-gradient(180deg,#FFFFFF,#E1E1E1)]';
const RED = 'border-[#6E1414] bg-[linear-gradient(180deg,#F49A9A,#E0393A_50%,#CE1A1C_51%,#D52E2F)] text-white [text-shadow:0_-1px_0_rgba(0,0,0,.35)]';
const DARK = 'mt-4 border-[#23272E] bg-[linear-gradient(180deg,#8A919C,#5E6570_50%,#4A515C_51%,#565E69)] text-white [text-shadow:0_-1px_0_rgba(0,0,0,.45)]';

/** The sheet: its title, the choices (a choice closes it, then acts), Cancel. */
export function SheetFrame({ title, items }: { title?: string; items: SheetItem[] }) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={closeSheet} id="sheet">
      <div role="menu" aria-label={title || 'Options'} onClick={(e) => e.stopPropagation()}
           className="flex flex-col max-h-[88%] px-16 pt-12 pb-[calc(var(--sb,0px)+8px)] border-t border-[#2A2F38] bg-[linear-gradient(180deg,rgba(104,115,133,.95),rgba(50,57,69,.97))] shadow-[inset_0_1px_0_rgba(255,255,255,.35)]">
        {title && <div className="flex-none mb-10 px-6 text-center text-12 leading-[15px] text-[#E8ECF2] line-clamp-2 [text-shadow:0_-1px_0_rgba(0,0,0,.5)]">{title}</div>}
        <div className="flex-auto min-h-0 overflow-y-auto overscroll-contain">
          {items.map((x, i) => (
            <button key={i} type="button" role="menuitem" aria-disabled={x.disabled || undefined} className={cx(BTN, x.danger ? RED : WHITE)}
                    onClick={() => { if (x.disabled) return; closeSheet(); x.act?.(); }}>
              {x.check && <span aria-hidden="true">✓ </span>}{x.label}
            </button>
          ))}
        </div>
        <button type="button" className={cx(BTN, 'flex-none', DARK)} onClick={closeSheet}>Cancel</button>
      </div>
    </div>
  );
}

/** src/ui's menu entries (a playlist list, the Connect devices) as sheet choices. */
const fromMenu = (es: readonly MenuEntry[]): SheetItem[] =>
  es.flatMap((e) => ('label' in e ? [{ label: e.label, check: e.check, disabled: e.disabled, act: e.act }] : []));

/** ms a finger rests on a row before its sheet opens; px it may wander meanwhile */
export const LONG_MS = 500;
const SLOP = 10;

/** A long press on an element matching `sel` inside the handlers' element: `onLong(el)` with a medium
 *  haptic, and the tap that ends it swallowed (a song row would play). A right-click does the same. */
export function useLongPress(onLong: (el: Element) => void, sel: string) {
  const press = useRef<{ x: number; y: number; t: number } | null>(null), fired = useRef(0);
  const clear = () => { if (press.current) clearTimeout(press.current.t); press.current = null; };
  useEffect(() => clear, []);
  const fire = (el: Element) => { fired.current = Date.now(); haptic('medium'); onLong(el); };
  const swallow = (e: MouseEvent) => { if (Date.now() - fired.current < 900) { e.stopPropagation(); e.preventDefault(); } };
  return {
    onPointerDown: (e: PointerEvent) => {
      const el = e.button === 0 ? (e.target as Element).closest(sel) : null;
      clear();
      if (el) press.current = { x: e.clientX, y: e.clientY, t: window.setTimeout(() => { press.current = null; fire(el); }, LONG_MS) };
    },
    onPointerMove: (e: PointerEvent) => { const p = press.current; if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP) clear(); },
    onPointerUp: clear,
    onPointerCancel: clear,
    onMouseDownCapture: swallow,
    onClickCapture: swallow,
    onDoubleClickCapture: swallow,
    onContextMenuCapture: (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      clear();
      const el = (e.target as Element).closest(sel);
      if (el && Date.now() - fired.current > 900) fire(el);
    },
  };
}

/** Up Next's edits on a row (iTunes DJ): a move from one place to another, a removal. */
export interface QueueEdit { move: (from: number, to: number) => void; remove: (i: number) => void; n: number }

/** A song's sheet: Play, Play Next, Up Next's moves (iTunes DJ), Like, Add to Playlist, the album and the
 *  artist, Start Genius. `from` 'now' is Now Playing's (the playing song: its album and artist open in
 *  Music, Go to Current Song, Play On); a row's open inside the source it is in. */
export function TrackSheet({ t, i = 0, c, queue, from = 'row' }: { t: Track; i?: number; c?: Content; queue?: QueueEdit; from?: 'row' | 'now' }) {
  const sh = useShell(), addTo = useAddTo(canSave(t.uri) ? t.uri : null), queues = useApp((s) => !!s.commands.addToQueue);
  const album = t.albumUri, artist = t.artistUris?.[0], now = from === 'now';
  const show = (uri: string) => { if (now) viewActions.reveal('music', uri); else { viewActions.open(uri); nav.source(); } };
  const items: (SheetItem | false)[] = [
    !now && { label: 'Play', act: () => playRow(sh, c ?? ({ kind: 'tracks', ctx: t.ctx ?? null } as Content), t) },
    !now && !queue && queues && { label: 'Play Next', act: () => void sh.store.getState().commands.addToQueue?.(t.uri) },
    ...(queue ? [
      { label: 'Move to Top', disabled: i === 0, act: () => queue.move(i, 0) },
      { label: 'Move Up', disabled: i === 0, act: () => queue.move(i, i - 1) },
      { label: 'Move Down', disabled: i >= queue.n - 1, act: () => queue.move(i, i + 1) },
      { label: 'Remove from Up Next', danger: true, act: () => queue.remove(i) },
    ] : []),
    !!addTo.uri && { label: addTo.saved ? 'Unlike' : 'Like', act: addTo.toggle },
    !!addTo.uri && t.uri.startsWith('spotify:track:') && { label: 'Add to Playlist…', act: () => openSheet(<PlaylistSheet uri={t.uri} title={t.title} />) },
    { label: 'Show Album', disabled: !album, act: () => { if (album) show(album); } },
    { label: 'Show Artist', disabled: !artist, act: () => { if (artist) show(artist); } },
    now && { label: 'Go to Current Song', act: () => showPlaying(sh) },
    { label: 'Start Genius', disabled: !t.uri.startsWith('spotify:track:'), act: () => startGenius(sh, t.uri) },
    now && { label: 'Play On…', act: () => openSheet(<DeviceSheet />) },
  ];
  return <SheetFrame title={t.title + (t.artist ? ' — ' + t.artist : '')} items={items.filter((x): x is SheetItem => !!x)} />;
}

/** Add to Playlist: the playlists the user can add to, a check on those holding the song (asked as it opens). */
function PlaylistSheet({ uri, title }: { uri: string; title: string }) {
  const m = useAddTo(uri).playlistMenu('Add to Playlist');
  const ask = useRef(m.onOpen);
  useEffect(() => { ask.current?.(); }, []);
  return <SheetFrame title={'Add “' + title + '” to'} items={fromMenu(m.sub ?? [])} />;
}

/** Play On (iTunes' AirPlay menu): the Spotify Connect devices, the playing one checked, then the
 *  phone's own AirPlay picker where the app has it. */
export function DeviceSheet() {
  const d = useDevices(() => '');
  return <SheetFrame title="Play On" items={[...fromMenu(d.items()),
    ...(window.alchemyRoutePicker ? [{ label: 'AirPlay…', act: () => window.alchemyRoutePicker?.() }] : [])]} />;
}
