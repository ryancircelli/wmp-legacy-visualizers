// Now Playing on the phone. iTunes 10 had no such page (its artwork pane and Cover Flow showed the
// cover), so it is Cover Flow's front cover alone: the black stage with its grey wash, the cover square
// as large as the page lets it be with its mirror image fading below, and one slim row (Like, Lyrics,
// Up Next). The toolbar's LCD over it already names the song and runs its progress, and the phone's
// buttons are the volume, so the page repeats neither. Lyrics show over the cover while they are on,
// as over iTunes' visualizer; the song's other acts (Genius among them) are •••'s sheet. A tap on the cover
// swaps it for the song's Spotify Canvas and back (off at first: iTunes had none, and a looping video
// costs the phone more than a picture); only while the Canvas is chosen is one fetched or played.
import { useEffect, useRef, useState } from 'react';
import { lyricsShown } from '../../../model';
import { artOk, cx, Karaoke, playingTrack, TransportButton, useAddTo, useApp, useCanvas, useLyricScroll, usePlainLyrics } from '../../../ui';
import { Icon, styles, viewActions } from '../shared';
import { nav } from './nav';
import { Strip } from './Pages';
import { openSheet, TrackSheet } from './Sheet';

const CANVAS = 'itunes.phone.canvas';
const readCanvas = () => { try { return localStorage.getItem(CANVAS) === '1'; } catch { return false; } };

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

/** The black stage: the cover (or the Canvas) and its reflection, the caption, the lyrics over them. */
function Stage() {
  const t = useApp((s) => (s.playback.status !== 'none' ? s.playback.track : null)), art = artOk(t?.art);
  const box = useRef<HTMLDivElement>(null), [wh, setWh] = useState<[number, number]>([320, 360]);
  // sized once per resize (a turn of the phone, the keyboard), never per frame
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWh([el.clientWidth, el.clientHeight]));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // the cover as large as the stage lets it be, a little of its reflection under it
  const [w, h] = wh, size = Math.max(80, Math.min(w - 28, h - 44, 420)), top = Math.max(14, Math.round((h - size) * 0.12));
  const [want, setWant] = useState(readCanvas), fetched = useCanvas(want && t ? t.uri : null), [failed, setFailed] = useState('');
  const canvas = fetched && fetched.url !== failed ? fetched : null;
  const swap = () => {
    const v = !want;
    setWant(v);
    try { localStorage.setItem(CANVAS, v ? '1' : '0'); } catch { /* blocked storage: the session's */ }
  };
  return (
    <div ref={box} className="relative flex-auto min-h-0 overflow-hidden bg-itunes-flow" id="npstage">
      {canvas && (canvas.type === 'video'
        ? <CanvasVideo src={canvas.url} poster={art || undefined} onError={() => setFailed(canvas.url)} />
        : <img className="absolute inset-0 w-full h-full object-cover" src={canvas.url} alt="" onError={() => setFailed(canvas.url)} />)}
      <button type="button" className="absolute left-1/2 p-0 border-0 bg-transparent" style={{ top, width: size, height: size, marginLeft: -size / 2 }}
              aria-label={want ? 'Show the artwork' : 'Show the Canvas'} id="npart" onClick={swap}>
        {!canvas && <Art src={art} className="block w-full h-full shadow-[0_2px_10px_rgba(0,0,0,.6)]" />}
      </button>
      {!canvas && (
        <div className="absolute left-1/2 pointer-events-none" style={{ top: top + size + 1, width: size, height: size, marginLeft: -size / 2 }} aria-hidden="true">
          <Art src={art} className={cx(styles.reflect, 'block w-full h-full -scale-y-100')} />
        </div>
      )}
      <Lyrics top={top} size={size} />
    </div>
  );
}

const Art = ({ src, className }: { src: string; className: string }) => (src
  ? <img src={src} alt="" draggable={false} className={cx(className, 'object-cover bg-[#222]')} />
  : <span className={cx(className, 'grid place-items-center bg-[linear-gradient(180deg,#3C3C3C,#1C1C1C)] text-[#6A6A6A]')}><Icon name="music" size={64} /></span>);

/** The Canvas clip behind the stage, muted and looping as Spotify's apps play it; paused while the app
 *  is in the background. */
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
  return <video ref={ref} className="absolute inset-0 w-full h-full object-cover" src={src} poster={poster} muted autoPlay loop playsInline onError={onError} />;
}

/** The lyrics while they are on: synced as the current line and the next (karaoke per its setting) at
 *  the cover's foot; plain ones scrolled with the song over the cover, by its position, never by touch. */
function Lyrics({ top, size }: { top: number; size: number }) {
  const shown = useApp(lyricsShown), plain = usePlainLyrics(), box = useRef<HTMLDivElement>(null);
  useLyricScroll(box, plain !== null);
  if (!shown) return null;
  if (plain !== null) {
    return (
      <div ref={box} className="absolute left-1/2 overflow-hidden px-12 py-10 bg-black/60 text-white text-12 leading-[17px] whitespace-pre-line text-center pointer-events-none"
           style={{ top, width: size, height: size, marginLeft: -size / 2 }} id="nplyrics">{plain}</div>
    );
  }
  return (
    // the lines sit over the cover's foot, above the caption
    <div className="absolute left-[4%] right-[4%] pointer-events-none" style={{ bottom: `calc(100% - ${top + size - 8}px)` }}>
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

const ROUND = 'relative grid place-items-center w-44 h-34 p-0 border-0 rounded-md bg-transparent text-[#CFCFCF] active:bg-white/10 data-on:text-[#5AA6FF] disabled:opacity-40';

/** One slim row under the stage: Like, Lyrics, Up Next (the song's other acts are •••'s sheet). */
function Controls() {
  return (
    <div className="flex-none flex items-center justify-center gap-32 h-36 bg-[linear-gradient(180deg,#262626,#0B0B0B)] border-t border-[#3A3A3A]" id="npcontrols">
      <Like />
      <TransportButton action="lyrics" id="blyrics" className={ROUND}><LyricsGlyph /></TransportButton>
      <button type="button" className={ROUND} aria-label="Up Next" title="Up Next (iTunes DJ)" id="bupnext" onClick={() => { viewActions.select('dj'); nav.source(); }}>
        <Icon name="dj" size={18} />
      </button>
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
