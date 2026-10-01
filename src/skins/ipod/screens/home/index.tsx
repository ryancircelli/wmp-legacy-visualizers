// The home group: the nano's Videos / Photos / FM Radio / Voice Memos slots, given Spotify Home
// (the home feed's shelves as nested menus), the saved albums' art as the photo grid, the radio
// stations on the FM dial, and the empty Voice Memos page. Hold-center on a thing that can be
// saved opens Like / Add to Playlist / Start Radio.
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { HomeItem, HomeSection, LibraryItem } from '../../../../model';
import {
  canSave, isCollectionUri, toggleSaved, useAddTo, useArtist, useCollection, useHome, useLibraryList, useRadio, useRadioSeeds, useShell,
  type Shell,
} from '../../../../ui';
import { MenuScreen, Popup, useNav, useWheel } from '../../ui';
import type { MenuItem, Nav, ScreenEntry } from '../contract';
import { step } from './step';

/** nano pixels */
const u = (n: number) => `calc(var(--unit) * ${n})`;
/** the chrome's screen colours (ipod.module.css); the selection is a gradient, so a cell shows it as a background */
const INK = 'var(--ipod-ink, #000)', DIM = 'var(--ipod-dim, #7a7a7a)', SEL = 'var(--ipod-sel-bg, #2c76d4)';

/** A selection held by the screen entry, not its component: the chrome may unmount a covered
 *  screen, and the full-screen photo moves the grid's. */
function kept() {
  let i = 0;
  const subs = new Set<() => void>();
  return {
    get: () => i,
    set: (n: number) => { i = n; subs.forEach((f) => f()); },
    sub: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
  };
}
type Kept = ReturnType<typeof kept>;
const useKept = (k: Kept) => [useSyncExternalStore(k.sub, k.get), k.set] as const;

/** Start Radio: the station Spotify makes from this uri (its "inspired by" mix), played, then Now Playing. */
async function startRadio(sh: Shell, nav: Nav, uri: string, name: string): Promise<void> {
  const want = name + ' Radio';
  const st = (await sh.queries.fetchRadio([{ seed: uri, name: want, sub: '' }]).catch(() => [])).find((s) => s.name === want);
  if (st) { sh.store.getState().commands.playContext(st.uri, null); nav.toNowPlaying(); }
}

/** What hold-center was pressed on; `lists`: Add to Playlist's list is showing. */
type Held = { uri: string; name: string; radio?: boolean; lists?: boolean };

/** Hold-center on a track, album, playlist or artist: Like (save), Add to Playlist (tracks), Start
 *  Radio. Returns the popup (null while closed) and its opener. The chrome's Popup closes before
 *  it runs a choice, so Add to Playlist reopens it as the playlists in the same batch. */
function useHold() {
  const [held, set] = useState<Held | null>(null);
  return [held && <Hold {...held} set={set} />, (h: Held) => set(h)] as const;
}

function Hold({ set, ...h }: Held & { set: (h: Held | null) => void }) {
  const sh = useShell(), nav = useNav(), a = useAddTo(h.uri), pl = a.playlistMenu(), track = h.uri.startsWith('spotify:track:');
  const items: MenuItem[] = h.lists
    ? (pl.sub ?? []).flatMap((e, k): MenuItem[] => e.sep ? [] : [{
        id: String(k), label: e.label, right: e.check ? '✓' : undefined, disabled: e.disabled || !e.act, onSelect: e.act }])
    : [
        { id: 'like', label: track ? (a.saved ? 'Unlike' : 'Like') : a.saved ? 'Remove from Library' : 'Save to Library',
          onSelect: () => void toggleSaved(sh, h.uri) },
        ...(track ? [{ id: 'pl', label: 'Add to Playlist', chevron: true, onSelect: () => { pl.onOpen?.(); set({ ...h, lists: true }); } }] : []),
        ...(h.radio !== false ? [{ id: 'radio', label: 'Start Radio', onSelect: () => void startRadio(sh, nav, h.uri, h.name) }] : []),
      ];
  // a fresh Popup for the playlists (its list starts at the top); Hold itself stays, with the playlists it asked for
  return <Popup key={String(!!h.lists)} items={items} onClose={() => set(null)} />;
}

// ---- Videos: Spotify Home -------------------------------------------------------------------

export function videos(): ScreenEntry {
  const at = kept();
  return { key: 'videos', title: 'Spotify Home', render: () => <Shelves at={at} /> };
}

function Shelves({ at }: { at: Kept }) {
  const { sections } = useHome(), nav = useNav(), [i, setI] = useKept(at);
  const items = (sections ?? []).map((sec, k): MenuItem => ({ id: String(k), label: sec.title, chevron: true, onSelect: () => nav.push(shelf(sec, k)) }));
  return <MenuScreen items={items} selected={i} onSelectedChange={setI} loading={!sections} empty="Nothing on Home" />;
}

function shelf(sec: HomeSection, k: number): ScreenEntry {
  const at = kept();
  return { key: 'videos/' + k, title: sec.title, render: () => <Shelf items={sec.items} at={at} /> };
}

/** a playlist, album, Liked Songs or artist opens to its songs; anything else plays */
const opens = (uri: string) => uri.startsWith('spotify:artist:') || isCollectionUri(uri);

function Shelf({ items, at }: { items: HomeItem[]; at: Kept }) {
  const sh = useShell(), nav = useNav(), [i, setI] = useKept(at), [hold, openHold] = useHold();
  const menu = items.map((it, k): MenuItem => ({
    id: String(k), label: it.name, chevron: opens(it.uri),
    onSelect: () => { if (opens(it.uri)) nav.push(songs(it.uri, it.name)); else { sh.store.getState().commands.playItem(it); nav.toNowPlaying(); } },
    onHold: canSave(it.uri) ? () => openHold({ uri: it.uri, name: it.name }) : undefined,
  }));
  return (
    <>
      <MenuScreen items={menu} selected={i} onSelectedChange={setI} empty="Nothing here" />
      {hold}
    </>
  );
}

function songs(uri: string, name: string): ScreenEntry {
  const at = kept();
  return { key: 'videos:' + uri, title: name, render: () => <Songs uri={uri} at={at} /> };
}

/** a collection's songs (paged as the selection nears the end), or an artist's top songs */
function Songs({ uri, at }: { uri: string; at: Kept }) {
  const sh = useShell(), nav = useNav(), coll = useCollection(uri), artist = useArtist(uri), [i, setI] = useKept(at), [hold, openHold] = useHold();
  const rows = isCollectionUri(uri) ? coll.rows : artist.page?.tracks ?? [];
  const items = rows.map((t, k): MenuItem => ({
    id: String(k), label: t.title, chevron: false,
    onSelect: () => { sh.store.getState().commands.playContext(t.ctx ?? uri, t.uri); nav.toNowPlaying(); },
    onHold: canSave(t.uri) ? () => openHold({ uri: t.uri, name: t.title }) : undefined,
  }));
  const move = (n: number) => { setI(n); if (n >= rows.length - 10) coll.loadMore(); };
  return (
    <>
      <MenuScreen items={items} selected={i} onSelectedChange={move} loading={coll.loading || artist.loading} empty="No Songs" />
      {hold}
    </>
  );
}

// ---- Photos: the saved albums' art -----------------------------------------------------------

export function photos(): ScreenEntry {
  const at = kept();
  return { key: 'photos', title: 'Photos', render: () => <Photos at={at} /> };
}

const isAlbum = (x: LibraryItem) => x.uri.startsWith('spotify:album:');

/** the nano's thumbnail grid, 4 across: the wheel walks the cells, center shows one full-screen */
function Photos({ at }: { at: Kept }) {
  const { items, loading } = useLibraryList(), albums = items.filter(isAlbum);
  const nav = useNav(), [sel, setI] = useKept(at), [hold, openHold] = useHold(), grid = useRef<HTMLDivElement>(null);
  // an album removed from the library (hold-center: Remove) shortens the grid under the selection
  const i = Math.min(sel, Math.max(0, albums.length - 1)), a = albums[i];
  // keep the selected cell in view, scrolling the grid only (never the page around it)
  useLayoutEffect(() => {
    const g = grid.current, c = g?.children[i] as HTMLElement | undefined;
    if (!g || !c) return;
    if (c.offsetTop < g.scrollTop) g.scrollTop = c.offsetTop;
    else if (c.offsetTop + c.offsetHeight > g.scrollTop + g.clientHeight) g.scrollTop = c.offsetTop + c.offsetHeight - g.clientHeight;
  }, [i, albums.length]);
  useWheel({
    onTick: (d) => setI(step(i, d, albums.length)),
    onCenter: () => { if (a) nav.push(photo(albums, at)); },
    onHoldCenter: () => { if (a) openHold({ uri: a.uri, name: a.name }); },
  });
  if (!albums.length) return <MenuScreen items={[]} loading={loading} empty="No Albums" />;
  return (
    <>
      <div ref={grid} className="relative grid grid-cols-4 content-start h-full overflow-hidden" style={{ padding: u(2) }}>
        {albums.map((x, k) => (
          <div key={x.uri} className="aspect-square" style={{ padding: u(3), background: k === i ? SEL : undefined }}>
            {x.image ? <img src={x.image} alt="" loading="lazy" className="block w-full h-full object-cover" />
                     : <div className="w-full h-full" style={{ background: DIM }} />}
          </div>
        ))}
      </div>
      {hold}
    </>
  );
}

function photo(albums: LibraryItem[], at: Kept): ScreenEntry {
  return { key: 'photos/full', title: 'Photos', render: () => <Photo albums={albums} at={at} /> };
}

/** one album's art full-screen with its title and artist: the wheel moves through them (and the
 *  grid's selection with it), center plays the album */
function Photo({ albums, at }: { albums: LibraryItem[]; at: Kept }) {
  const sh = useShell(), nav = useNav(), [i, setI] = useKept(at), [hold, openHold] = useHold(), a = albums[i];
  useWheel({
    onTick: (d) => setI(step(i, d, albums.length)),
    onCenter: () => { if (a) { sh.store.getState().commands.playAll(a.uri); nav.toNowPlaying(); } },
    onHoldCenter: () => { if (a) openHold({ uri: a.uri, name: a.name }); },
  });
  if (!a) return null;
  return (
    <div className="relative h-full" style={{ background: '#000' }}>
      {a.image && <img src={a.image} alt="" className="block w-full h-full object-contain" />}
      <div className="absolute inset-x-0 bottom-0 text-center" style={{ padding: u(6), background: 'rgba(0,0,0,.6)', color: '#fff' }}>
        <div className="truncate font-bold" style={{ fontSize: u(14) }}>{a.name}</div>
        <div className="truncate" style={{ fontSize: u(12), opacity: 0.8 }}>{a.artist}</div>
      </div>
      {hold}
    </div>
  );
}

// ---- FM Radio: the stations on the dial ------------------------------------------------------

export function fmRadio(): ScreenEntry {
  const at = kept();
  return { key: 'fmRadio', title: 'Radio', render: () => <Dial at={at} /> };
}

/** nano pixels between two stations on the dial; a minor tick every 6, half the screen of scale past each end */
const GAP = 30, PAD = 120;

/** The nano's FM dial: the station's name where the frequency would be, a scale that slides under
 *  the needle as the wheel tunes (round, like the real one), center plays the station. */
function Dial({ at }: { at: Kept }) {
  const sh = useShell(), nav = useNav(), { stations } = useRadio(useRadioSeeds()), [sel, setI] = useKept(at), [hold, openHold] = useHold();
  const list = stations ?? [], n = list.length, i = Math.min(sel, Math.max(0, n - 1)), st = list[i];
  useWheel({
    onTick: (d) => setI(step(i, d, n, true)),
    onCenter: () => { if (st) { sh.store.getState().commands.playContext(st.uri, null); nav.toNowPlaying(); } },
    // a station is a playlist: Like saves it; radio of a radio is not offered
    onHoldCenter: () => { if (st) openHold({ uri: st.uri, name: st.name, radio: false }); },
  });
  if (!st) return <MenuScreen items={[]} loading={!stations} empty="No Stations" />;
  return (
    <div className="relative h-full overflow-hidden" style={{ color: INK }}>
      <div className="text-center" style={{ padding: `${u(40)} ${u(10)} 0` }}>
        <div className="truncate font-bold" style={{ fontSize: u(26) }}>{st.name}</div>
        <div className="truncate" style={{ fontSize: u(13), color: DIM }}>{st.sub}</div>
      </div>
      <div className="absolute inset-x-0" style={{ bottom: u(40), height: u(48) }}>
        <div className="absolute inset-y-0" style={{
          left: `calc(50% - ${u(PAD)})`, width: u((n - 1) * GAP + 2 * PAD), transform: `translateX(${u(-i * GAP)})`, transition: 'transform .2s',
          background: `repeating-linear-gradient(90deg, ${DIM} 0 ${u(1)}, transparent 0 ${u(6)}) bottom / 100% 50% no-repeat`,
        }}>
          {list.map((s, k) => (
            <div key={s.uri} className="absolute inset-y-0" style={{ left: u(PAD + k * GAP), width: u(2), background: INK }} />
          ))}
        </div>
        <div className="absolute" style={{ left: '50%', top: u(-6), bottom: u(-6), width: u(2), background: '#e0302a' }} />
      </div>
      {hold}
    </div>
  );
}

// ---- Voice Memos -----------------------------------------------------------------------------

export function voiceMemos(): ScreenEntry {
  return { key: 'voiceMemos', title: 'Voice Memos', render: () => <MenuScreen items={[]} empty="No Voice Memos" /> };
}
