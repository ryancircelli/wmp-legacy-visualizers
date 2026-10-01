// The iPod nano 5G Now Playing screen: artist, title, album, the cover, the blue bar with elapsed and
// -remaining, "N of M" when the track's place is known. Ticks change the volume (the bar becomes a
// volume bar for 1.5 s); center cycles default -> scrub (ticks seek 2 % a detent, committed on center
// or after 1 s idle; MENU cancels) -> lyrics (when the track has them) -> default; hold center opens
// the nano's context menu; play / next / prev drive the player, hold next / prev skip 5 s.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { lineAt, lyricsShown, positionNow, type RadioSeed, type Track } from '../../../../model';
import {
  artOk, cx, isSpotify, playingTrack, useAddTo, useApp, useArtist, useCollection, useDevices, useLyricScroll, usePosition,
  useRadioSeeds, useShell, type MenuEntry,
} from '../../../../ui';
import type { MenuItem, ScreenEntry } from '../contract';
import { Bar, MenuScreen, Popup, useNav, useWheel } from '../../ui';
import { nextMode, ofText, scrubStep, times, volumeStep, type Mode } from './logic';
import css from './nowplaying.module.css';

export function nowPlaying(): ScreenEntry {
  return { key: 'nowplaying', title: 'Now Playing', render: () => <NowPlaying /> };
}

type Pop = 'main' | 'playlists' | 'radio' | 'devices';
/** the iPod's words for Spotify's repeat */
const REPEAT = { off: 'Off', context: 'All', track: 'One' } as const;

/** src/ui's menu entries (Add to playlist, Play on Device) as Popup rows; a choice closes the popup */
const toItems = (es: MenuEntry[], done: () => void): MenuItem[] => es.flatMap((e, i) => {
  if (!('label' in e)) return [];
  const act = e.act;
  return [{ id: String(i), label: e.label, right: e.check ? '✓' : undefined, disabled: e.disabled,
            onSelect: act && (() => { act(); done(); }) }];
});

function NowPlaying() {
  const sh = useShell(), nav = useNav(), get = () => sh.store.getState(), c = () => get().commands;
  const p = useApp((s) => ({
    media: s.playback.status !== 'none', track: s.playback.track, canSeek: s.playback.canSeek, shuffle: s.playback.shuffle,
    repeat: s.playback.repeat, spotify: isSpotify(s), lyrics: lyricsShown(s) !== null,
    vol: s.settings.muted ? 0 : s.settings.volume, max: isSpotify(s) ? 100 : 200,
  }));
  const t = p.track, uri = t?.uri ?? '', d = t?.duration ?? 0, canScrub = p.media && p.canSeek && d > 0;
  const [mode, setMode] = useState<Mode>('default');
  const [scrub, setScrub] = useState<{ uri: string; ms: number } | null>(null);
  const [volTick, setVolTick] = useState(0);
  const [popup, setPopup] = useState<Pop | null>(null);
  const m: Mode = (mode === 'scrub' && !canScrub) || (mode === 'lyrics' && !p.lyrics) ? 'default' : mode;
  const held = scrub?.uri === uri ? scrub.ms : null;

  // a scrub commits after 1 s without a tick; the volume bar goes 1.5 s after the last
  useEffect(() => {
    if (!scrub) return;
    const id = setTimeout(() => {
      if (sh.store.getState().playback.track?.uri === scrub.uri) void sh.store.getState().commands.seek(scrub.ms);
      setScrub(null);
    }, 1000);
    return () => clearTimeout(id);
  }, [scrub, sh]);
  useEffect(() => {
    if (!volTick) return;
    const id = setTimeout(() => setVolTick(0), 1500);
    return () => clearTimeout(id);
  }, [volTick]);

  // what it plays from: "N of M", and the row's album / artist (the playing state names neither)
  const col = useCollection(t?.ctx);
  const row = col.rows.find((r) => r.uri === uri);
  const seeds = useRadioSeeds();
  const artistUri = row?.artistUris?.[0] ?? seeds.find((x) => x.seed.startsWith('spotify:artist:'))?.seed;
  const albumUri = row?.albumUri ?? (t?.ctx?.startsWith('spotify:album:') ? t.ctx : undefined);
  const of = p.shuffle ? '' : ofText(col.rows, uri, col.total);

  const close = () => setPopup(null);
  const addTo = useAddTo(useApp(playingTrack)), plMenu = addTo.playlistMenu();
  const devices = useDevices(() => '');
  const startRadio = (seed: RadioSeed) => {
    close();
    // the seed's own station leads what fetchRadio tunes
    void sh.queries.fetchRadio([seed]).then((st) => {
      const hit = st.find((x) => x.name === seed.name);
      if (hit) c().playContext(hit.uri, null);
    }, () => {});
  };
  const items: Record<Pop, MenuItem[]> = {
    main: [
      { id: 'like', label: addTo.saved ? 'Unlike' : 'Like', disabled: !addTo.uri, onSelect: () => { addTo.toggle(); close(); } },
      { id: 'add', label: 'Add to Playlist', chevron: true, disabled: !addTo.uri, onSelect: () => { plMenu.onOpen?.(); setPopup('playlists'); } },
      { id: 'radio', label: 'Start Radio', chevron: true, disabled: !seeds.length, onSelect: () => setPopup('radio') },
      { id: 'artist', label: 'Go to Artist', disabled: !artistUri,
        onSelect: () => { close(); if (artistUri) nav.push(artistScreen(artistUri, t?.artist ?? '')); } },
      { id: 'album', label: 'Go to Album', disabled: !albumUri && !(artistUri && t?.album),
        onSelect: () => { close(); nav.push(albumScreen({ uri: albumUri, artist: artistUri, name: t?.album ?? '' })); } },
      { id: 'device', label: 'Play on Device', chevron: true, disabled: !p.spotify, onSelect: () => setPopup('devices') },
      { id: 'shuffle', label: 'Shuffle', right: p.shuffle ? 'On' : 'Off', disabled: !p.spotify, onSelect: () => c().toggleShuffle() },
      { id: 'repeat', label: 'Repeat', right: REPEAT[p.repeat], disabled: !p.spotify, onSelect: () => c().cycleRepeat() },
      { id: 'cancel', label: 'Cancel', onSelect: close },
    ],
    playlists: toItems(plMenu.sub ?? [], close),
    radio: seeds.map((x) => ({ id: x.seed, label: x.name, onSelect: () => startRadio(x) })),
    devices: toItems(devices.items(), close),
  };

  useWheel({
    // an open Popup registers after this screen, so it takes the ticks, center and MENU while open
    onTick: (dir) => {
      if (m === 'scrub') {
        setScrub((s) => ({ uri, ms: scrubStep(s?.uri === uri ? s.ms : positionNow(get()), dir, d) }));
        return;
      }
      const s = get();
      s.actions.setVolume(volumeStep(s.settings.muted ? 0 : s.settings.volume, dir, p.max));
      setVolTick((n) => n + 1);
    },
    onCenter: () => {
      if (!p.media) return;
      if (m === 'scrub' && held !== null) void c().seek(held);
      setScrub(null);
      setMode(nextMode(m, canScrub, p.lyrics));
    },
    onHoldCenter: () => setPopup('main'),
    onMenu: () => {
      if (m !== 'scrub') return false;
      setScrub(null);
      setMode('default');
      return true;
    },
    onPlay: () => void c().playPause(),
    onNext: () => void c().next(),
    onPrev: () => void c().prev(),
    onHoldNext: () => c().skip(5),
    onHoldPrev: () => c().skip(-5),
  });

  const pos = usePosition((ms) => Math.floor(ms / 250) * 250), shown = held ?? pos;
  const f = d > 0 ? Math.min(1, shown / d) : 0, [elapsed, remaining] = times(shown, d), art = artOk(t?.art);
  return (
    <div className={css.root}>
      {m === 'lyrics' ? <Lyrics /> : (
        <>
          <div className={cx(css.line, css.artist)}>{t?.artist}</div>
          <div className={cx(css.line, css.title)}>{t?.title}</div>
          <div className={cx(css.line, css.album)}>{t?.album}</div>
          {art ? <img className={css.art} src={art} alt="" /> : <div className={cx(css.art, css.noart)}>♪</div>}
          {of && <div className={css.of}>{of}</div>}
        </>
      )}
      {volTick ? (
        <div className={css.vol}>
          <Speaker />
          <Bar value={p.max ? p.vol / p.max : 0} className={css.fill} />
          <Speaker loud />
        </div>
      ) : p.media && (
        <>
          <div className={css.bar}>
            <Bar value={f} className={css.fill} />
            {m === 'scrub' && <span className={css.diamond} style={{ left: f * 100 + '%' }} />}
          </div>
          <div className={css.times}><span>{elapsed}</span><span>{remaining}</span></div>
        </>
      )}
      {popup && <Popup items={items[popup]} onClose={() => setPopup((x) => (x === popup ? null : x))} />}
    </div>
  );
}

function Speaker({ loud }: { loud?: boolean }) {
  return (
    <svg className={css.spk} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M1 4.2h2.4L6.6 1.5v9L3.4 7.8H1z" fill="currentColor" />
      {loud && <path d="M8.3 3.8a3 3 0 0 1 0 4.4M9.8 2.3a5 5 0 0 1 0 7.4" fill="none" stroke="currentColor" strokeWidth="1.1" />}
    </svg>
  );
}

/** Synced lyrics, the sung line lit and kept in the middle; plain ones scroll with the track. */
function Lyrics() {
  const { shown, lines, plain } = useApp((s) => ({ shown: lyricsShown(s), lines: s.lyrics.lines, plain: s.lyrics.plain }));
  const box = useRef<HTMLDivElement>(null), L = shown === 'synced' ? lines ?? [] : null;
  const i = usePosition((ms) => (L ? lineAt(L, ms) : -1));
  useLyricScroll(box, shown === 'plain');
  useLayoutEffect(() => {
    const b = box.current, el = b?.children[i] as HTMLElement | undefined;
    if (b && el) b.scrollTop = el.offsetTop - (b.clientHeight - el.offsetHeight) / 2;
  }, [i]);
  return (
    <div className={css.lyrics} ref={box}>
      {L ? L.map((l, k) => <div key={k} className={k === i ? css.cur : undefined}>{l.text || '♪'}</div>) : plain}
    </div>
  );
}

// Go to Artist / Go to Album: this group's own small lists (the lists group's screens are not ours to
// import, and commands.openArtist / openAlbum only select the WMP Media Library).

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
    onSelect: () => { sh.store.getState().commands.playContext(ctx, t.uri); nav.push(nowPlaying()); } }));
  return <MenuScreen items={items} loading={loading} empty="No Songs"
                     onSelectedChange={more && ((i) => { if (i >= rows.length - 5) more(); })} />;
}
