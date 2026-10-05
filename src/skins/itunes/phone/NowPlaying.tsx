// Now Playing on the phone. iTunes 10 had no such page (its artwork pane and Cover Flow showed the
// cover), so the stage is Cover Flow of the play order: the playing song's cover in front, the songs
// played this session to its left and Up Next to its right, the caption under the front one; then the
// iPhone Music app's controls of 2010 in iTunes' dress: Like, Lyrics and Up Next, the scrubber (iTunes'
// volume knob on Cover Flow's dark groove) and a big Previous / Play / Next row under the thumb. The
// toolbar's LCD stays over it (the owner, 2026-10-04: the controls are wanted here too). A flick or a tap
// on a side cover browses (its title and artist in the caption) and springs back to the playing song a
// few seconds after the last touch; a tap on the browsed cover, now in front, plays it (Up Next: skipped
// to; played: again, in its context). Lyrics show over the playing cover while they are on, as over
// iTunes' visualizer; a tap on the playing cover swaps it for the song's Spotify Canvas and back. The
// visualizer (iTunes' View > Show Visualizer, the ••• sheet) takes the stage's place while it is on.
// The Canvas and the visualizer are off at first: each costs the phone more than a picture.
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { Visualizer } from '../../../app/Visualizer';
import { lyricsShown, type Track } from '../../../model';
import {
  artOk, cx, duration, Karaoke, playingTrack, seekHold, Slider, TransportButton, useAddTo, useApp, useCanvas, useLyricScroll, usePlainLyrics,
  usePlayback, usePosition, useScrub, useShell,
} from '../../../ui';
import { CoverFlow, Icon, lcdTimes, playRow, viewActions, type Content, type FlowCover } from '../shared';
import { nav, nowView, setNowView } from './nav';
import { Strip } from './Pages';
import { openSheet, TrackSheet } from './Sheet';

// ---- the play order ------------------------------------------------------------------------------------

/** songs kept to the left (this session's, most recent last), and Up Next's shown to the right */
const PLAYED = 10, AHEAD = 15;
/** ms after the last touch that a browsed cover springs back to the playing song */
export const BROWSE_MS = 4000;

/** This session's played songs, each with the context it played in (to play it there again). */
const played = create<{ list: Track[] }>(() => ({ list: [] }));

/** Keeps the played songs as the track changes (Root, so it runs on every page): the song left goes
 *  on the list, unless the new one is the last on it (Previous), which comes off. The latest metadata
 *  of a song is kept (its cover arrives after its title). */
export function useKeepPlayed(): void {
  const sh = useShell();
  useEffect(() => {
    const s0 = sh.store.getState();
    let last = s0.playback.track, ctx = s0.playback.context?.uri ?? null;
    return sh.store.subscribe((s) => {
      const t = s.playback.track;
      if (!t || t.uri === last?.uri) { if (t) { last = t; ctx = s.playback.context?.uri ?? ctx; } return; }
      const was = last && { ...last, ctx: last.ctx ?? ctx };
      last = t;
      ctx = s.playback.context?.uri ?? null;
      if (!was) return;
      played.setState(({ list }) => (list[list.length - 1]?.uri === t.uri ? { list: list.slice(0, -1) } : { list: [...list, was].slice(-PLAYED) }));
    });
  }, [sh]);
}

type Item = { t: Track; from: 'played' | 'now' | 'queue'; k: number };
export type PlayOrder = ReturnType<typeof usePlayOrder>;

/** The play order as Cover Flow covers: played, playing, Up Next; which one is in front, and the moves. */
export function usePlayOrder() {
  const sh = useShell(), track = useApp((s) => (s.playback.status !== 'none' ? s.playback.track : null));
  const queue = useApp((s) => s.queue.next), list = played((s) => s.list);
  const items: Item[] = [...list.map((t, k) => ({ t, from: 'played' as const, k })), ...(track ? [{ t: track, from: 'now' as const, k: 0 }] : []),
                         ...queue.slice(0, AHEAD).map((t, k) => ({ t, from: 'queue' as const, k }))];
  const now = track ? list.length : 0;
  // browsing: a side cover in front, until the song changes or BROWSE_MS pass without a touch
  const [b, setB] = useState<{ i: number; uri: string } | null>(null);
  const browsing = b && b.uri === (track?.uri ?? '') && b.i !== now && items[b.i] ? b.i : null;
  useEffect(() => {
    if (!b) return;
    const id = setTimeout(() => setB(null), BROWSE_MS);
    return () => clearTimeout(id);
  }, [b]);
  // each song keeps its key as the order moves past it (its nth time in the list), so a track change slides
  const seen = new Map<string, number>();
  const covers: FlowCover[] = items.map((x, i) => {
    const n = seen.get(x.t.uri) ?? 0;
    seen.set(x.t.uri, n + 1);
    return { key: x.t.uri + '#' + n, img: artOk(x.t.art) || artOk(x.t.image) || null, name: x.t.title,
             sub: x.t.artist + (i === browsing ? ' — tap to play' : '') };
  });
  /** play the browsed song: Up Next skipped to (the songs before it leave the queue, as Spotify's own
   *  tap on a queued song does), a played one again in its context */
  const jump = (i: number) => {
    const x = items[i], c = sh.store.getState().commands;
    setB(null);
    if (!x || x.from === 'now') return;
    if (x.from === 'played') { playRow(sh, { kind: 'tracks', ctx: x.t.ctx ?? null } as Content, x.t); return; }
    if (!x.k || c.reorderQueue) {
      if (x.k) c.reorderQueue?.(Array.from({ length: queue.length - x.k }, (_, j) => x.k + j));
      void c.next();
    } else playRow(sh, { kind: 'tracks', ctx: x.t.ctx ?? null } as Content, x.t);
  };
  return {
    covers, now, browsing, index: browsing ?? now,
    browse: (i: number) => setB(i === now ? null : { i, uri: track?.uri ?? '' }),
    jump,
  };
}

/** The play order's Cover Flow. A tap on the front cover: the browsed one plays (`o.jump`), the playing
 *  one is `onFront`'s (the Canvas); a flick that ends on it is a flick, a double tap one tap. */
function PlayOrderFlow({ o, className, size, top, bar, onFront }: {
  o: PlayOrder; className?: string; size?: number; top?: number; bar?: boolean; onFront?: () => void;
}) {
  const down = useRef({ x: 0, y: 0 }), tapped = useRef(0);
  return (
    // positioned by the caller (Tailwind's relative would beat an absolute given beside it)
    <div className={className} onPointerDownCapture={(e) => { down.current = { x: e.clientX, y: e.clientY }; }}
         onClick={(e) => {
           if (Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y) > 10 || !(e.target as Element).closest('[data-front]')) return;
           const t = Date.now();
           if (t - tapped.current < 400) return;
           tapped.current = t;
           if (o.browsing !== null) o.jump(o.browsing); else onFront?.();
         }}>
      <CoverFlow id="npflow" className="w-full h-full" covers={o.covers} index={o.index} onIndex={o.browse} onActivate={() => {}}
                 size={size} top={top} bar={bar} />
    </div>
  );
}

// ---- the page --------------------------------------------------------------------------------------------

export function NowPlayingPage({ back, backLabel }: { back: () => void; backLabel: string }) {
  const t = useApp((s) => (s.playback.status !== 'none' ? s.playback.track : null));
  return (
    <>
      <Strip dark title="Now Playing" back={back} backLabel={backLabel}
             right={t && (
               <button type="button" aria-label="Song options" id="npmore" onClick={() => openSheet(<TrackSheet t={t} from="now" />)}
                       className="relative grid place-items-center w-36 h-26 p-0 rounded-sm border border-[#111] bg-[linear-gradient(180deg,#5A5A5A,#333)] text-white text-14 leading-none tracking-[1px] active:bg-[linear-gradient(180deg,#333,#555)] after:absolute after:-inset-5 after:content-['']">•••</button>
             )} />
      <Stage />
      <Controls />
    </>
  );
}

/** The phone on its side on Now Playing: the play order's Cover Flow alone, full size, its scrollbar under it. */
export function NowPlayingSide({ left, right }: { left: number; right: number }) {
  const o = usePlayOrder();
  return (
    <div className="flex-auto min-h-0 flex flex-col bg-black" style={{ paddingLeft: left, paddingRight: right }} id="landscape">
      {o.covers.length ? <PlayOrderFlow o={o} className="relative flex-auto" />
        : <div className="flex-auto grid place-items-center text-12 text-itunes-flow-ink">Nothing Playing</div>}
    </div>
  );
}

/** The black stage: the play order (or the visualizer), the Canvas in the playing cover's place, the
 *  lyrics over it. */
function Stage() {
  const t = useApp((s) => (s.playback.status !== 'none' ? s.playback.track : null)), art = artOk(t?.art);
  const box = useRef<HTMLDivElement>(null), [wh, setWh] = useState<[number, number]>([320, 340]);
  // sized once per resize (a turn of the phone, the keyboard), never per frame
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWh([el.clientWidth, el.clientHeight]));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // the front cover narrower than the page, so the ones beside it show; the cover and its caption centred
  const [w, h] = wh, size = Math.max(80, Math.min(Math.round(w * 0.6), h - 64, 300)), top = Math.max(8, Math.round((h - size - 40) / 2));
  const o = usePlayOrder(), { canvas: want, vis } = nowView();
  const fetched = useCanvas(want && t && !vis ? t.uri : null), [failed, setFailed] = useState('');
  const canvas = fetched && fetched.url !== failed && o.browsing === null ? fetched : null;
  const square = { top, width: size, height: size, marginLeft: -size / 2 };
  return (
    <div ref={box} className="relative isolate flex-auto min-h-0 overflow-hidden bg-itunes-flow" id="npstage">
      {vis ? <Vis /> : o.covers.length ? <PlayOrderFlow o={o} className="absolute inset-0" size={size} top={top} bar={false} onFront={() => setNowView('canvas', !want)} />
        : <div className="absolute left-1/2 grid place-items-center bg-[linear-gradient(180deg,#3C3C3C,#1C1C1C)] text-[#6A6A6A]" style={square}><Icon name="music" size={64} /></div>}
      {canvas && (
        <div className="absolute left-1/2 z-300 overflow-hidden pointer-events-none" style={square} id="npcanvas">
          {canvas.type === 'video'
            ? <CanvasVideo src={canvas.url} poster={art || undefined} onError={() => setFailed(canvas.url)} />
            : <img className="w-full h-full object-cover" src={canvas.url} alt="" onError={() => setFailed(canvas.url)} />}
        </div>
      )}
      {o.browsing === null && <Lyrics top={vis ? 12 : top} size={vis ? Math.min(w - 24, h - 24) : size} />}
    </div>
  );
}

/** The Canvas clip, muted and looping as Spotify's apps play it; paused while the app is in the background. */
function CanvasVideo({ src, poster, onError }: { src: string; poster?: string; onError: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const sync = () => { if (document.hidden) v.pause(); else v.play().catch(() => {}); };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, [src]);
  return <video ref={ref} className="w-full h-full object-cover" src={src} poster={poster} muted autoPlay loop playsInline onError={onError} />;
}

/** The visualizer in the stage's place (iTunes' View > Show Visualizer), opaque in its own colours: the
 *  engine is let run while it shows (the ticker holds it off Now Playing's view: the hold a WMP view
 *  implies comes back after), drawn at the stage's own shape (settings.scale 'auto', then the scale
 *  there was). The ticker's loop runs only while its canvas is mounted: nothing when this is off. */
function Vis() {
  const sh = useShell();
  useEffect(() => {
    const st = sh.store, a = st.getState().actions, scale = st.getState().settings.scale;
    const hold = (v: boolean) => st.setState((s) => ({ vis: { ...s.vis, hold: v } }));
    const lift = () => { if (st.getState().vis.hold) hold(false); };
    lift();
    const off = st.subscribe(lift);
    a.setSettings({ scale: 'auto' });
    return () => { off(); hold(st.getState().ui.view !== 'now'); a.setSettings({ scale }); };
  }, [sh]);
  return <Visualizer className="absolute inset-0 block w-full h-full bg-black" id="npvis" />;
}

/** The lyrics while they are on: synced as the current line and the next (karaoke per its setting) at
 *  the cover's foot; plain ones scrolled with the song over the cover, by its position, never by touch. */
function Lyrics({ top, size }: { top: number; size: number }) {
  const shown = useApp(lyricsShown), plain = usePlainLyrics(), box = useRef<HTMLDivElement>(null);
  useLyricScroll(box, plain !== null);
  if (!shown) return null;
  if (plain !== null) {
    return (
      <div ref={box} className="absolute left-1/2 z-300 overflow-hidden px-12 py-10 bg-black/60 text-white text-12 leading-[17px] whitespace-pre-line text-center pointer-events-none"
           style={{ top, width: size, height: size, marginLeft: -size / 2 }} id="nplyrics">{plain}</div>
    );
  }
  return (
    // the lines sit over the cover's foot
    <div className="absolute z-300 left-[4%] right-[4%] pointer-events-none" style={{ bottom: `calc(100% - ${top + size - 8}px)` }}>
      <Karaoke id="nplyrics" className="flex flex-col items-center gap-2 text-center [text-shadow:0_1px_3px_rgba(0,0,0,.9),0_0_8px_rgba(0,0,0,.7)]"
               ids={{ cur: 'lyrcur', next: 'lyrnext' }}
               classes={{
                 cur: 'inline-block max-w-full min-h-[1.3em] py-2 px-10 rounded-md bg-black/45 text-white font-semibold text-14 leading-[1.3] empty:invisible',
                 next: 'inline-block max-w-full min-h-[1.3em] py-1 px-10 rounded-md bg-black/45 text-white/60 text-12 leading-[1.3] empty:invisible',
                 sung: 'text-[#9FD0FF]',
                 now: 'text-transparent [text-shadow:none] [filter:drop-shadow(0_1px_3px_rgba(0,0,0,.9))] bg-[linear-gradient(90deg,#9FD0FF_var(--f,0%),#FFFFFF_var(--f,0%))] bg-clip-text',
               }} />
    </div>
  );
}

// ---- the controls ----------------------------------------------------------------------------------

const ROUND = 'relative grid place-items-center w-44 h-32 p-0 border-0 rounded-md bg-transparent text-[#CFCFCF] active:bg-white/10 data-on:text-[#5AA6FF] disabled:opacity-40';
/** the transport under the thumb: the iPhone Music app's big glyphs, each a wide fingertip */
const BIG = 'relative grid place-items-center w-72 h-50 p-0 border-0 rounded-lg bg-transparent text-[#EDEDED] [filter:drop-shadow(0_-1px_0_rgba(0,0,0,.7))] active:bg-white/10 disabled:opacity-35';

function Controls() {
  return (
    <div className="flex-none pb-2 bg-[linear-gradient(180deg,#262626,#0B0B0B)] border-t border-[#3A3A3A]" id="npcontrols">
      <div className="flex items-center justify-center gap-32 h-34">
        <Like />
        <TransportButton action="lyrics" id="blyrics" className={ROUND}><LyricsGlyph /></TransportButton>
        <button type="button" className={ROUND} aria-label="Up Next" title="Up Next (iTunes DJ)" id="bupnext" onClick={() => { viewActions.select('dj'); nav.source(); }}>
          <Icon name="dj" size={18} />
        </button>
      </div>
      <Scrubber />
      <div className="flex items-center justify-center gap-10 h-54" id="nptransport">
        <TransportButton action="prev" id="npprev" className={BIG}><Icon name="prev" size={26} /></TransportButton>
        <TransportButton action="play" id="npplay" className={BIG}>{(on) => <Icon name={on ? 'pause' : 'play'} size={30} className={on ? '' : 'ml-3'} />}</TransportButton>
        <TransportButton action="next" id="npnext" className={BIG}><Icon name="next" size={26} /></TransportButton>
      </div>
    </div>
  );
}

const KNOB = 'absolute top-1/2 w-18 h-18 -mt-9 rounded-full border border-[#5A5B5C] shadow-[0_1px_2px_rgba(0,0,0,.45)] bg-[radial-gradient(circle,rgba(90,91,92,.55)_0_1.5px,transparent_2px),linear-gradient(180deg,#FBFBFB,#E2E4E5_48%,#C9CBCC_52%,#B1B4B7)]';

/** The scrubber: elapsed, the groove with the knob (drag or tap: src/ui's seekHold, which pauses while
 *  held and seeks on release, as the LCD's), the time left. Re-rendered once a second while it plays. */
function Scrubber() {
  const sh = useShell(), [hold] = useState(() => seekHold(sh)), held = useScrub(), { media, canSeek } = usePlayback();
  const sec = usePosition((ms) => Math.floor(ms / 1000)), d = useApp(duration);
  const ms = held ?? sec * 1000, v = d > 0 ? Math.min(1, ms / d) : -1, [left, right] = lcdTimes(ms, d, false), off = !media || !canSeek || !(d > 0);
  return (
    <div className="flex items-center gap-8 h-28 px-12 text-11 [font-variant-numeric:tabular-nums] text-[#BDBDBD]">
      <span className="flex-none w-34 text-right" id="nptime">{media && d > 0 ? left : ''}</span>
      <span className="relative flex-auto min-w-0">
        {/* Cover Flow's dark groove, filled lighter up to the knob, under the slider that takes the finger */}
        <span className="absolute inset-x-0 top-1/2 h-10 -mt-5 rounded-full border border-[#B3B3B3]/70 bg-[linear-gradient(180deg,#2E2E2D,#5C5C5B_50%,#4A4A49)] overflow-hidden pointer-events-none">
          <span className="block h-full bg-[linear-gradient(180deg,#B9B9B9,#7E7E7E)]" style={{ width: v > 0 ? 'calc(9px + (100% - 18px) * ' + v + ')' : 0 }} />
        </span>
        <Slider id="npseek" label="Seek" inset={9} value={v} disabled={off} onStart={hold.start} onMove={hold.move} onCommit={hold.commit} onCancel={hold.cancel}
                onStep={(dir) => sh.store.getState().commands.skip(dir * 5)}
                className="relative block w-full h-28 touch-none outline-none data-disabled:opacity-50"
                thumbClassName={cx(KNOB, 'left-[calc((100%-18px)*var(--seek,0))]', off && 'hidden')} />
      </span>
      <span className="flex-none w-34" id="npleft">{media && d > 0 ? right : ''}</span>
    </div>
  );
}

/** Like / Unlike the playing song (Spotify's Liked Songs: iTunes had stars, the iPhone a heart later). */
function Like() {
  const like = useAddTo(useApp(playingTrack)), on = !!like.saved;
  return (
    <button type="button" className={ROUND} aria-label={on ? 'Unlike' : 'Like'} aria-pressed={on} data-on={on || undefined} disabled={!like.uri}
            onClick={like.toggle} id="blike">
      <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 14.2 2.3 8.6A3.4 3.4 0 0 1 8 3.9a3.4 3.4 0 0 1 5.7 4.7Z" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

/** a speech balloon of lines: the song's words */
const LyricsGlyph = () => (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" d="M2 2h12a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1H7.2L4 14.3v-2.8H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm.3 1.3v6.9h3v1.4l1.6-1.4h6.8V3.3ZM4 5h8v1.2H4Zm0 2.4h5.5v1.2H4Z" />
  </svg>
);
