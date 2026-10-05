// What iTunes put in a right-click menu, the phone asks in an action sheet, as the iPhone of 2010 did:
// the blue-grey translucent panel rising from the bottom, white glossy buttons, the destructive one red,
// Cancel dark at the foot. A long press on a song opens its sheet (no right-click on a phone, and iOS
// sends no contextmenu for a long press); the AirPlay button opens Play On's; Log Out confirms in one.
// One sheet at a time, kept in a small store so any page can open one over the whole layout.
import { useEffect, useRef, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { create } from 'zustand';
import type { Track } from '../../../model';
import { canSave, cx, Slider, TransportButton, useAddTo, useApp, useDevices, useLibraryList, usePlayback, useShell, type MenuEntry } from '../../../ui';
import { Icon, isUnplayed, itunesView, playRow, playUri, showPlaying, SHUFFLE_NAMES, startGenius, useShuffle, viewActions, type Content } from '../shared';
import { haptic } from './host';
import { nav, nowView, setNowView } from './nav';

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
export function SheetFrame({ title, items, head }: { title?: string; items: SheetItem[]; head?: ReactNode }) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={closeSheet} id="sheet">
      <div role="menu" aria-label={title || 'Options'} onClick={(e) => e.stopPropagation()}
           className="flex flex-col max-h-[88%] px-16 pt-12 pb-[calc(var(--sb,0px)+8px)] border-t border-[#2A2F38] bg-[linear-gradient(180deg,rgba(104,115,133,.95),rgba(50,57,69,.97))] shadow-[inset_0_1px_0_rgba(255,255,255,.35)]">
        {title && <div className="flex-none mb-10 px-6 text-center text-12 leading-[15px] text-[#E8ECF2] line-clamp-2 [text-shadow:0_-1px_0_rgba(0,0,0,.5)]">{title}</div>}
        {head}
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

/** A song's sheet: Play, Play Next, Up Next's moves (iTunes DJ), Like, Add to Playlist (an episode: Mark as
 *  Played / Unplayed), the album and the artist, Start Genius. `from` 'now' is Now Playing's (the playing
 *  song: its album and artist open in Music, Go to Current Song, Shuffle's three, Play On); a row's open
 *  inside the source it is in. */
export function TrackSheet({ t, i = 0, c, queue, from = 'row' }: { t: Track; i?: number; c?: Content; queue?: QueueEdit; from?: 'row' | 'now' }) {
  const sh = useShell(), addTo = useAddTo(canSave(t.uri) ? t.uri : null), queues = useApp((s) => !!s.commands.addToQueue);
  const album = t.albumUri, artist = t.artistUris?.[0], now = from === 'now', shuffle = useShuffle();
  const mark = useApp((s) => t.uri.startsWith('spotify:episode:') && !!s.commands.markPlayed), marks = useApp((s) => s.played), unplayed = isUnplayed(t, marks);
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
    mark && { label: unplayed ? 'Mark as Played' : 'Mark as Unplayed', act: () => void sh.store.getState().commands.markPlayed?.(t.uri, unplayed) },
    { label: 'Show Album', disabled: !album, act: () => { if (album) show(album); } },
    { label: 'Show Artist', disabled: !artist, act: () => { if (artist) show(artist); } },
    now && { label: 'Go to Current Song', act: () => showPlaying(sh) },
    { label: 'Start Genius', disabled: !t.uri.startsWith('spotify:track:'), act: () => startGenius(sh, t.uri) },
    now && shuffle.three && { label: 'Shuffle: ' + SHUFFLE_NAMES[shuffle.mode] + '…', act: () => openSheet(<ShuffleSheet />) },
    now && { label: 'Play On…', act: () => openSheet(<DeviceSheet />) },
    now && { label: nowView.getState().vis ? 'Hide Visualizer' : 'Show Visualizer', act: () => setNowView('vis', !nowView.getState().vis) },
    now && { label: 'Visualizer Style…', act: () => openSheet(<VisSheet />) },
  ];
  return <SheetFrame title={t.title + (t.artist ? ' — ' + t.artist : '')} items={items.filter((x): x is SheetItem => !!x)} />;
}

/** Shuffle's three, the one on checked: Smart Shuffle where the player offers it (not on the phone's own
 *  speaker; a playlist or Liked Songs playing). The bottom bar's button cycles them; this names them. */
function ShuffleSheet() {
  const u = useShuffle();
  return <SheetFrame title="Shuffle" items={(['off', 'shuffle', 'smart'] as const).map((m) => ({ label: SHUFFLE_NAMES[m], check: u.mode === m,
    disabled: m === 'smart' && !u.smart && u.mode !== 'smart', act: () => u.set(m) }))} />;
}

/** Add to Playlist: the playlists the user can add to, a check on those holding the song (asked as it opens). */
function PlaylistSheet({ uri, title }: { uri: string; title: string }) {
  const m = useAddTo(uri).playlistMenu('Add to Playlist');
  const ask = useRef(m.onOpen);
  useEffect(() => { ask.current?.(); }, []);
  return <SheetFrame title={'Add “' + title + '” to'} items={fromMenu(m.sub ?? [])} />;
}

/** Play On (iTunes' AirPlay menu): the volume of what plays (iTunes' AirPlay window had its Master
 *  Volume over the speakers: a Connect speaker's volume has no other place on the phone, whose own
 *  buttons turn only the phone), the Spotify Connect devices, the playing one checked, then the phone's
 *  own AirPlay picker where the app has it. */
export function DeviceSheet() {
  const d = useDevices(() => '');
  return <SheetFrame title="Play On" head={<SheetVolume />} items={[...fromMenu(d.items()),
    ...(window.alchemyRoutePicker ? [{ label: 'AirPlay…', act: () => window.alchemyRoutePicker?.() }] : [])]} />;
}

/** ms between the volumes a drag sends (the iPod's: the host turns the phone's own volume for it) */
const VOLUME_SEND_MS = 50;

/** The volume between its speakers on the sheet: a drag anywhere on the groove sets it, a tap on the
 *  quiet speaker mutes, as iTunes' did. */
function SheetVolume() {
  const sh = useShell(), { spotify, volume, muted } = usePlayback(), max = spotify ? 100 : 200;
  const sent = useRef({ at: 0, timer: 0, v: -1 });
  useEffect(() => () => clearTimeout(sent.current.timer), []);
  const set = (f: number, now = false) => {
    const S = sent.current, go = () => { S.at = Date.now(); S.timer = 0; sh.store.getState().actions.setVolume(S.v); };
    S.v = Math.round(Math.max(0, Math.min(1, f)) * max);
    clearTimeout(S.timer);
    if (now || Date.now() - S.at >= VOLUME_SEND_MS) go(); else S.timer = window.setTimeout(go, VOLUME_SEND_MS);
  };
  const v = muted ? 0 : Math.min(1, volume / max);
  return (
    <div className="flex-none flex items-center gap-8 h-36 mb-8 px-4 text-[#E8ECF2]" id="sheetvol">
      <TransportButton action="mute" className="relative flex-none grid place-items-center w-26 h-26 p-0 border-0 bg-transparent text-inherit data-on:text-[#9FD0FF] after:absolute after:-inset-5 after:content-['']">
        <Icon name="vol-low" size={14} />
      </TransportButton>
      <span className="relative flex-auto min-w-0">
        <span className="absolute inset-x-0 top-1/2 h-9 -mt-[4.5px] rounded-full border border-[#2A2F38] bg-[linear-gradient(180deg,#C9CED6,#F4F6F9)] overflow-hidden pointer-events-none">
          <span className="block h-full bg-[linear-gradient(180deg,#6AA0E2,#3871C6)]" style={{ width: v > 0 ? 'calc(10px + (100% - 20px) * ' + v + ')' : 0 }} />
        </span>
        <Slider id="vol" label="Volume" inset={10} value={v} onMove={(f) => set(f)} onCommit={(f) => set(f, true)}
                onStep={(dir) => set(v + dir * 0.05, true)} className="relative block w-full h-34 touch-none outline-none"
                thumbClassName="absolute top-1/2 w-20 h-20 -mt-10 left-[calc((100%-20px)*var(--seek,0))] rounded-full border border-[#5A5B5C] shadow-[0_1px_2px_rgba(0,0,0,.45)] bg-[radial-gradient(circle,rgba(90,91,92,.55)_0_1.5px,transparent_2px),linear-gradient(180deg,#FBFBFB,#E2E4E5_48%,#C9CBCC_52%,#B1B4B7)]" />
      </span>
      <Icon name="vol-high" size={16} className="flex-none" />
    </div>
  );
}

/** View > Visualizer: the engines (Alchemy, Bars and Waves, Battery), the one holding the choice checked,
 *  each opening its presets (an engine of one preset picked at its own row); a pick shows the visualizer. */
function VisSheet() {
  const sh = useShell(), cur = useApp((s) => s.vis.kind + ':' + s.vis.preset);
  const pick = (p: (typeof sh.presets)[number]) => () => { sh.store.getState().actions.setVis(p.vis, p.preset); setNowView('vis', true); };
  const groups = [...new Set(sh.presets.map((p) => p.group))].map((g) => sh.presets.filter((p) => p.group === g));
  return <SheetFrame title="Visualizer" items={groups.map((ps) => ps.length === 1
    ? { label: ps[0]!.group, check: cur === ps[0]!.vis + ':' + ps[0]!.preset, act: pick(ps[0]!) }
    : { label: ps[0]!.group, check: ps.some((p) => cur === p.vis + ':' + p.preset),
        act: () => openSheet(<SheetFrame title={ps[0]!.group} items={ps.map((p) => ({ label: p.name, check: cur === p.vis + ':' + p.preset, act: pick(p) }))} />) })} />;
}

/** Radio from a playlist, album or artist (the iPod's Start Radio; iTunes made a Genius playlist from
 *  what was chosen): the station Spotify seeds from it, played; the LCD says when there is none. */
export function collectionRadio(sh: ReturnType<typeof useShell>, uri: string, title: string): void {
  const name = title + ' Radio';
  void sh.queries.fetchRadio([{ seed: uri, name, sub: '' }]).catch(() => []).then((st) => {
    const s = sh.store.getState(), hit = st.find((x) => x.name === name) ?? (uri.startsWith('spotify:artist:') ? st[0] : undefined);
    if (hit) s.commands.playContext(hit.uri, null); else s.actions.setStatus('No Genius radio for ' + title);
  });
}

/** Deleted (Spotify's Delete: off the library), Music selected if it was the source showing. */
async function deletePlaylist(sh: ReturnType<typeof useShell>, uri: string): Promise<void> {
  if (await sh.store.getState().commands.deletePlaylist?.(uri) && itunesView.getState().source === uri) viewActions.select('music');
}

/** Play a collection whole, shuffled (Spotify's shuffle turned on first: the player starts it shuffled). */
export function shufflePlay(sh: ReturnType<typeof useShell>, uri: string): void {
  const s = sh.store.getState();
  if (!s.playback.shuffle) s.commands.toggleShuffle();
  playUri(sh, uri);
}

/** A cover's sheet (a long press on an album, playlist, artist or show; on a playlist in the source list,
 *  `open` its own): Open, Play, Shuffle, Save to the library (Follow an artist), Genius (its radio), and
 *  Delete Playlist for the user's own (asked again, red). A song tile gets the song's own. */
export function TileSheet({ uri, name, open }: { uri: string; name: string; open?: () => void }) {
  const sh = useShell(), save = useAddTo(canSave(uri) ? uri : null), artist = uri.startsWith('spotify:artist:');
  const lib = useLibraryList(), del = useApp((s) => !!s.commands.deletePlaylist) && !!lib.items.find((x) => x.uri === uri)?.editable;
  const items: (SheetItem | false)[] = [
    { label: 'Open', act: open ?? (() => { viewActions.open(uri); nav.source(); }) },
    { label: 'Play', act: () => playUri(sh, uri) },
    !uri.startsWith('spotify:show:') && { label: 'Shuffle', act: () => shufflePlay(sh, uri) },
    !!save.uri && { label: artist ? (save.saved ? 'Unfollow' : 'Follow') : save.saved ? 'Remove from Library' : 'Save to Library', act: save.toggle },
    /^spotify:(playlist|album|artist):/.test(uri) && { label: 'Start Genius', act: () => collectionRadio(sh, uri, name) },
    del && { label: 'Delete Playlist', danger: true, act: () => openSheet(<SheetFrame title={'Delete “' + name + '” from your Spotify library?'}
      items={[{ label: 'Delete Playlist', danger: true, act: () => void deletePlaylist(sh, uri) }]} />) },
  ];
  return <SheetFrame title={name} items={items.filter((x): x is SheetItem => !!x)} />;
}
