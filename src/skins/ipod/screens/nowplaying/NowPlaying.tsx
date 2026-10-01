// The iPod nano 5G Now Playing (docs/ipod-skin.md §2.4, §3.1, §4.3), under the chrome's 20-unit status
// row: artist / title / album on the dark band, the 240×240 cover, then the controls band with the
// cover's reflection, the mode row and "N of M". Ticks change the volume (the row becomes a volume bar
// for 2 s); the center cycles the mode row: scrubber (ticks seek 1 % a detent, accelerated, sent 400 ms
// after the last or on center; MENU cancels) -> Radio slider (the nano's Genius) -> lyrics over the
// cover -> back; each but lyrics falls back after 5 s idle (shuffle and Like: the status row's
// toggles). Hold center: the nano's popup, Spotify's way (§4.3). Play / next / prev and their holds
// (fast-forward, rewind: useScan) are the chrome's. A track with a Spotify Canvas shows it behind the
// whole screen instead of the cover, the two bands made translucent over it; a tap on the cover's area
// cycles Canvas -> cover -> the app's visualizer (on silence, as the phone has no capture) -> Canvas,
// remembered (only while the Canvas is chosen is one fetched).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { persist } from 'zustand/middleware';
import { createStore } from 'zustand/vanilla';
import { Visualizer } from '../../../../app/Visualizer';
import { lyricsShown, positionNow, type Track } from '../../../../model';
import {
  artOk, cx, isSpotify, Karaoke, playingTrack, useAddTo, useApp, useArtist, useCanvas, useCollection, useDevices, useLyricScroll,
  usePlainLyrics, usePosition, useRadioSeeds, useShell, type MenuEntry,
} from '../../../../ui';
import type { MenuItem, ScreenEntry } from '../contract';
import { Bar, MenuScreen, Popup, useNav, useScan, useWheel } from '../../ui';
import { IDLE_MS, nextMode, ofText, SCRUB_COMMIT_MS, scrubAccel, scrubStep, times, volumeStep, VOLUME_MS, type Mode } from './logic';
import css from './nowplaying.module.css';

export function nowPlaying(): ScreenEntry {
  return { key: 'nowplaying', title: 'Now Playing', render: () => <NowPlaying /> };
}

/** what the cover's area shows: the Canvas (the cover for a track without one), the cover, or the
 *  visualizer; across tracks and launches, localStorage 'ipod.canvas' (version 0 was { on: boolean }) */
type Show = 'video' | 'cover' | 'vis';
const canvasPref = createStore<{ show: Show }>()(persist((): { show: Show } => ({ show: 'video' }), {
  name: 'ipod.canvas', version: 1, migrate: (old) => ({ show: (old as { on?: boolean } | null)?.on === false ? 'cover' : 'video' }),
}));

type Pop = 'main' | 'playlists' | 'devices';
/** a wheel scrub: the position shown, then (sent) held until the player reports the seek */
type Scrub = { uri: string; ms: number; sent?: boolean };

/** src/ui's menu entries (Add to playlist, Play on) as Popup rows; the Popup closes on a choice */
const toItems = (es: MenuEntry[]): MenuItem[] => es.flatMap((e, i) =>
  'label' in e ? [{ id: String(i), label: e.label, right: e.check ? '✓' : undefined, disabled: e.disabled, onSelect: e.act }] : []);

function NowPlaying() {
  const sh = useShell(), nav = useNav(), get = () => sh.store.getState(), c = () => get().commands;
  const p = useApp((s) => ({
    media: s.playback.status !== 'none', track: s.playback.track, canSeek: s.playback.canSeek, shuffle: s.playback.shuffle,
    spotify: isSpotify(s), lyrics: lyricsShown(s) !== null, max: isSpotify(s) ? 100 : 200, kind: s.vis.kind,
  }));
  const t = p.track, uri = t?.uri ?? '', d = t?.duration ?? 0;
  const [mode, setMode] = useState<Mode>('default');
  const [scrub, setScrub] = useState<Scrub | null>(null);
  const [vol, setVol] = useState<{ v: number } | null>(null);
  const [poke, setPoke] = useState(0);
  const [popup, setPopup] = useState<Pop | null>(null);
  const lastTick = useRef(0);
  const seeds = useRadioSeeds(), addTo = useAddTo(useApp(playingTrack)), plMenu = addTo.playlistMenu();
  const has: Record<Mode, boolean> = {
    default: true, scrub: p.media && p.canSeek && d > 0, radio: seeds.length > 0, lyrics: p.lyrics,
  };
  const m: Mode = has[mode] ? mode : 'default';
  const held = scrub?.uri === uri ? scrub.ms : null;

  /** the one seek a scrub makes */
  const send = (x: Scrub) => {
    if (get().playback.track?.uri !== x.uri) return setScrub(null);
    void c().seek(x.ms);
    setScrub({ ...x, sent: true });
  };
  useEffect(() => {
    if (!scrub) return;
    if (!scrub.sent) {
      const id = setTimeout(() => send(scrub), SCRUB_COMMIT_MS);
      return () => clearTimeout(id);
    }
    // hold the seeked position until a playback state says where the player is (or 3 s), as seekHold does
    const id = setTimeout(() => setScrub(null), 3000), off = sh.store.subscribe((x) => x.playback.at, () => setScrub(null));
    return () => { clearTimeout(id); off(); };
  }, [scrub, sh]); // eslint-disable-line react-hooks/exhaustive-deps
  // a mode drops back to the progress bar after IDLE_MS without input; lyrics stay until center
  useEffect(() => {
    if (m === 'default' || m === 'lyrics') return;
    const id = setTimeout(() => setMode('default'), IDLE_MS);
    return () => clearTimeout(id);
  }, [m, poke]);
  useEffect(() => {
    if (!vol) return;
    const id = setTimeout(() => setVol(null), VOLUME_MS);
    return () => clearTimeout(id);
  }, [vol]);
  // the phone's volume buttons (the iOS app's wmp-volume, 0..100) flash the volume bar too
  useEffect(() => {
    const on = () => { const v = window.__wmpVolume ?? -1; if (v >= 0) setVol({ v: v / 100 }); };
    window.addEventListener('wmp-volume', on);
    return () => window.removeEventListener('wmp-volume', on);
  }, []);

  // what it plays from: "N of M" (its first loaded page only), and the row's album / artist
  const col = useCollection(t?.ctx);
  const row = col.rows.find((r) => r.uri === uri);
  const artistUri = t?.artistUris?.[0] ?? row?.artistUris?.[0] ?? seeds.find((x) => x.seed.startsWith('spotify:artist:'))?.seed;
  const albumUri = t?.albumUri ?? row?.albumUri ?? (t?.ctx?.startsWith('spotify:album:') ? t.ctx : undefined);
  const of = p.shuffle ? '' : ofText(col.rows, uri, col.total);

  const devices = useDevices(() => '');
  const show = useStore(canvasPref, (x) => x.show);
  // the visualizers in WMP's order (Alchemy, Bars and Waves, Battery), one entry each
  const kinds = sh.presets.filter((x) => x.preset === 0), ki = kinds.findIndex((x) => x.vis === p.kind);
  /** song radio: the first seed's own station (§4.3) */
  const startRadio = () => {
    const seed = seeds[0];
    if (seed) void sh.queries.fetchRadio([seed]).then((st) => {
      const hit = st.find((x) => x.name === seed.name);
      if (hit) c().playItem({ uri: hit.uri });
    }, () => {});
  };
  const items: Record<Pop, MenuItem[]> = {
    main: [
      { id: 'radio', label: 'Start Radio', disabled: !seeds.length, onSelect: startRadio },
      { id: 'add', label: 'Add to Playlist…', disabled: !addTo.uri, onSelect: () => { plMenu.onOpen?.(); setPopup('playlists'); } },
      { id: 'like', label: addTo.saved ? 'Unlike' : 'Like', disabled: !addTo.uri, onSelect: addTo.toggle },
      { id: 'album', label: 'Browse Album', disabled: !albumUri && !(artistUri && t?.album),
        onSelect: () => nav.push(albumScreen({ uri: albumUri, artist: artistUri, name: t?.album ?? '' })) },
      { id: 'artist', label: 'Browse Artist', disabled: !artistUri,
        onSelect: () => { if (artistUri) nav.push(artistScreen(artistUri, t?.artist ?? '')); } },
      { id: 'device', label: 'Play On…', disabled: !p.spotify, onSelect: () => setPopup('devices') },
      ...(show === 'vis' && kinds.length ? [{ id: 'vis', label: 'Visualizer', right: kinds[ki]?.group,
        onSelect: () => get().actions.setVis(kinds[(ki + 1) % kinds.length]!.vis, 0) }] : []),
      { id: 'cancel', label: 'Cancel' },
    ],
    playlists: toItems(plMenu.sub ?? []),
    devices: toItems(devices.items()),
  };

  useWheel({
    // an open Popup registers after this screen, so it takes the ticks, center and MENU while open
    onTick: (dir) => {
      setPoke((n) => n + 1);
      const s = get();
      if (m === 'scrub') {
        const now = Date.now(), a = scrubAccel(now - lastTick.current);
        lastTick.current = now;
        setScrub((x) => ({ uri, ms: scrubStep(x?.uri === uri ? x.ms : positionNow(s), dir, d, a) }));
      } else if (m === 'radio') {
        if (dir > 0) { startRadio(); setMode('default'); }
      } else {
        // The phone's own level when it reports one (its buttons move it too), else the setting.
        const hv = window.__wmpVolume, base = typeof hv === 'number' && hv >= 0 && hv <= 100 ? hv : s.settings.muted ? 0 : s.settings.volume;
        const v = volumeStep(base, dir, p.max);
        s.actions.setVolume(v);
        setVol({ v: v / p.max });
      }
    },
    onCenter: () => {
      if (!p.media) return;
      if (scrub && !scrub.sent) send(scrub);
      setVol(null);
      setPoke((n) => n + 1);
      setMode(nextMode(m, has));
    },
    onHoldCenter: () => setPopup('main'),
    onMenu: () => {
      if (m !== 'scrub') return false;
      if (!scrub?.sent) setScrub(null);
      setMode('default');
      return true;
    },
  });

  // fast-forward / rewind (hold ⏭ / ⏮): the chrome's scan, sought once on release; shown here meanwhile
  const scan = useScan();
  const pos = usePosition((ms) => Math.floor(ms / 250) * 250);
  const shown = held ?? (scan.scanning ? Math.min(d, Math.max(0, pos + scan.offsetMs)) : pos);
  const f = d > 0 ? Math.min(1, shown / d) : 0, [elapsed, remaining] = times(shown, d), art = artOk(t?.art);
  // the Canvas, unless the cover is chosen or its file failed to load (then the cover, as without one)
  const [failed, setFailed] = useState('');
  const fetched = useCanvas(show === 'video' ? uri : null), canvas = fetched && fetched.url !== failed ? fetched : null;
  const fail = () => setFailed(canvas?.url ?? '');
  const vis = show === 'vis', bg = !!canvas || vis;
  /** a tap on the cover's area: Canvas -> cover -> visualizer -> Canvas; a track without a Canvas shows
   *  the cover for it, so from there the tap goes straight on to the visualizer */
  const swap = () => {
    window.alchemyHaptic?.('light');
    canvasPref.setState({ show: show === 'cover' || (show === 'video' && !canvas) ? 'vis' : vis ? 'video' : 'cover' });
  };
  return (
    <div className={css.root} data-canvas={bg ? '' : undefined}>
      {vis ? <Vis /> : canvas?.type === 'video' ? <CanvasVideo src={canvas.url} poster={art || undefined} onError={fail} />
        : canvas ? <img className={css.bg} src={canvas.url} alt="" onError={fail} /> : null}
      <div className={css.info}>
        <Line className={css.artist} text={t?.artist} />
        <Line className={css.title} text={t?.title} />
        <Line className={css.album} text={t?.album} />
      </div>
      {bg ? null : art ? <img className={css.art} src={art} alt="" /> : <div className={cx(css.art, css.noart)}>♪</div>}
      {/* a swipe from here is still MENU (Root suppresses the click that ends one); a tap is the swap's alone */}
      <div className={css.tap} onClick={(e) => { e.stopPropagation(); swap(); }} />
      {m === 'lyrics' && <Lyrics />}
      <div className={css.controls}>
        {art && !bg && <img className={css.reflection} src={art} alt="" />}
        {vol ? (
          <div className={css.row}>
            <Speaker />
            <div className={css.track}><Bar value={vol.v} className={css.fill} /></div>
            <Speaker loud />
          </div>
        ) : !p.media ? null : m === 'radio' ? (
          <div className={css.row}>
            <span className={css.left}>Radio</span>
            <div className={cx(css.track, css.slider)}><span className={css.knob}>⇨</span></div>
            <span className={css.right}>Start</span>
          </div>
        ) : (
          <div className={css.row}>
            <span className={css.left}>{elapsed}</span>
            <div className={css.track}>
              {/* the scrubber is the same track all white / grey, the diamond on it */}
              {/* a tap or a drag on the bar seeks there (the chrome's Bar); the wheel's scrubber is the mode */}
              <Bar value={m === 'scrub' ? 0 : f} className={css.fill}
                   onSeek={d && p.canSeek ? (fr) => { void c().seek(Math.round(fr * d)); } : undefined} />
              {m === 'scrub' && <span className={css.diamond} style={{ left: f * 100 + '%' }} />}
            </div>
            <span className={css.right}>{remaining}</span>
          </div>
        )}
        {of && <div className={css.of}>{of}</div>}
      </div>
      {popup && <Popup items={items[popup]} onClose={() => setPopup((x) => (x === popup ? null : x))} />}
    </div>
  );
}

/** The Canvas clip filling the screen, muted and looping as Spotify's apps play it; only while this
 *  screen is the top one (the stack hides the others: no intersection) and the page is visible. */
function CanvasVideo({ src, poster, onError }: { src: string; poster?: string; onError: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    let seen = true;
    const sync = () => { if (seen && !document.hidden) v.play().catch(() => {}); else v.pause(); };
    const io = new IntersectionObserver(([e]) => { seen = !!e?.isIntersecting; sync(); });
    io.observe(v);
    document.addEventListener('visibilitychange', sync);
    return () => { io.disconnect(); document.removeEventListener('visibilitychange', sync); };
  }, [src]);
  return <video ref={ref} className={css.bg} src={src} poster={poster} muted autoPlay loop playsInline onError={onError} />;
}

/** The app's visualizer behind the whole screen as the Canvas is, drawing whatever settings.vis / preset
 *  say on silence (Alchemy and Battery animate on it, Bars and Waves waits for sound; settings.animate
 *  off stills them). Its canvas is mounted only while this screen is the top one and the page is
 *  visible: the ticker's loop runs only with a canvas attached, so it costs nothing elsewhere. */
function Vis() {
  const sh = useShell(), ref = useRef<HTMLDivElement>(null), [on, setOn] = useState(() => !document.hidden);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let seen = true;
    const sync = () => setOn(seen && !document.hidden);
    const io = new IntersectionObserver(([e]) => { seen = !!e?.isIntersecting; sync(); });
    io.observe(el);
    document.addEventListener('visibilitychange', sync);
    return () => { io.disconnect(); document.removeEventListener('visibilitychange', sync); };
  }, []);
  // The ticker holds the engine while WMP's view is off Now Playing (vis.hold: a WMP view left on
  // Library sets it again at every Spotify start); here it is the screen, so no hold while shown,
  // then the hold WMP's view implies.
  useEffect(() => {
    if (!on) return;
    const st = sh.store, hold = (v: boolean) => st.setState((s) => ({ vis: { ...s.vis, hold: v } }));
    const lift = () => { if (st.getState().vis.hold) hold(false); };
    lift();
    const off = st.subscribe(lift);
    return () => { off(); hold(st.getState().ui.view !== 'now'); };
  }, [on, sh]);
  return <div ref={ref} className={css.bg}>{on && <Visualizer className={css.vis} />}</div>;
}

/** One info line; a long one marquees as the nano's do (§2.2): after 1 s, at 30 units/s, pausing 1 s at each end. */
function Line({ className, text }: { className?: string; text?: string }) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const b = box.current, s = b?.firstElementChild as HTMLElement | null;
    if (!b || !s?.animate) return;
    let a: Animation | undefined;
    // re-measured on resize, so a line set while the screen was hidden starts once it shows
    const ro = new ResizeObserver(() => {
      a?.cancel();
      const over = s.offsetWidth - b.clientWidth, unit = b.clientWidth / 224;   // the line is 224 units wide
      if (over <= 0 || !unit) return;
      const move = (over / unit / 30) * 1000, T = 2 * move + 2000, x = `translateX(${-over}px)`;
      a = s.animate([{ transform: 'none' }, { transform: 'none', offset: 1000 / T }, { transform: x, offset: (1000 + move) / T },
                     { transform: x, offset: (2000 + move) / T }, { transform: 'none' }], { duration: T, iterations: Infinity });
    });
    ro.observe(b);
    return () => { ro.disconnect(); a?.cancel(); };
  }, [text]);
  return <div ref={box} className={cx(css.line, className)}><span>{text}</span></div>;
}

function Speaker({ loud }: { loud?: boolean }) {
  return (
    <svg className={loud ? css.loud : css.spk} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M1 4.2h2.4L6.6 1.5v9L3.4 7.8H1z" fill="currentColor" />
      {loud && <path d="M8.3 3.8a3 3 0 0 1 0 4.4M9.8 2.3a5 5 0 0 1 0 7.4" fill="none" stroke="currentColor" strokeWidth="1.1" />}
    </svg>
  );
}

/** Lyrics over the cover: synced as the current line and the next one dimmed (karaoke per its
 *  setting), plain ones scrolled with the track. */
function Lyrics() {
  const plain = usePlainLyrics(), box = useRef<HTMLDivElement>(null);
  useLyricScroll(box, plain !== null);
  return (
    <div className={css.lyrics}>
      {plain !== null ? <div ref={box} className={css.plain}>{plain}</div>
        : <Karaoke className={css.synced} classes={{ cur: css.cur, next: css.next, sung: css.sung, now: css.now }} />}
    </div>
  );
}

// Browse Artist / Browse Album: this group's own small lists (the lists group's screens are not ours
// to import, and commands.openArtist / openAlbum only select the WMP Media Library).

function artistScreen(uri: string, name: string): ScreenEntry {
  return { key: 'np-artist', title: name || 'Artist', render: () => <ArtistAlbums uri={uri} /> };
}

function ArtistAlbums({ uri }: { uri: string }) {
  const nav = useNav(), { page, loading } = useArtist(uri);
  const items: MenuItem[] = [
    ...(page?.tracks.length ? [{ id: 'top', label: 'Top Songs', chevron: true,
      onSelect: () => nav.push({ key: 'np-top', title: 'Top Songs', render: () => <Songs rows={page.tracks} ctx={uri} /> }) }] : []),
    ...(page?.albums ?? []).map((a) => ({ id: a.uri, label: a.name, chevron: true, onSelect: () => nav.push(albumScreen({ uri: a.uri, name: a.name })) })),
  ];
  return <MenuScreen items={items} loading={loading} empty="No Albums" />;
}

function albumScreen(a: { uri?: string; artist?: string; name: string }): ScreenEntry {
  return { key: 'np-album', title: a.name || 'Album', render: () => <AlbumSongs {...a} /> };
}

function AlbumSongs({ uri, artist, name }: { uri?: string; artist?: string; name: string }) {
  // no album uri (the track is past the loaded rows of a playlist): its artist's discography names it
  const disc = useArtist(uri ? null : artist);
  const u = uri ?? disc.page?.albums.find((x) => x.name === name)?.uri;
  const col = useCollection(u);
  return <Songs rows={col.rows} ctx={u ?? ''} loading={disc.loading || col.loading} more={col.loadMore} />;
}

/** A song list: center plays it in its context and goes to Now Playing; nearing the end loads more. */
function Songs({ rows, ctx, loading, more }: { rows: Track[]; ctx: string; loading?: boolean; more?: () => void }) {
  const sh = useShell(), nav = useNav();
  const items: MenuItem[] = rows.map((t, i) => ({ id: i + ':' + t.uri, label: t.title,
    onSelect: () => { sh.store.getState().commands.playContext(ctx, t.uri); nav.toNowPlaying(); } }));
  return <MenuScreen items={items} loading={loading} empty="No Songs"
                     onSelectedChange={more && ((i) => { if (i >= rows.length - 5) more(); })} />;
}
