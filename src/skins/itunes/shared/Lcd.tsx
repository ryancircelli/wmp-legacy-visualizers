// The LCD: iTunes' status display in the middle of the toolbar (REFERENCE §LCD). Idle, the glass with
// one centred glyph (a pair of quavers: no logo). Playing, three centred lines: the song; the artist
// and the album taking turns every few seconds (a click on the line turns it at once); the elapsed
// time, the progress bar with its diamond (drag or click to seek: src/ui's Slider and seekHold) and
// the time left, or the length (a click on it flips them, kept in the view state). A status note
// (ui.status: a refusal, a fallback) takes the glass for a few seconds. `compact` is the phone's: two
// lines and the bar, sized by its className.
import { useEffect, useRef, useState } from 'react';
import { mss } from '../../../model';
import { cx, seekFraction, seekHold, Slider, useApp, usePlayback, usePosition, useShell, useScrub, duration } from '../../../ui';
import { Icon } from './icons';
import { useItunesView, viewActions } from './state';

/** how long the artist and the album each hold the second line (ms) */
export const LCD_TURN = 4000;
/** how long a status note holds the glass (ms) */
const NOTE_MS = 4000;

/** The second line's text: the artist, or (turn 1) the album; a song with no album keeps its artist. */
export function lcdSub(t: { artist: string; album?: string } | null, turn: number): string {
  if (!t) return '';
  return turn % 2 && t.album ? t.album : t.artist;
}
/** The bar's two times: elapsed at the left; the time left ("-3:12") at the right, or the length. */
export function lcdTimes(ms: number, length: number, total: boolean): [string, string] {
  const p = Math.max(0, Math.min(ms, length || ms));
  return [mss(p), length > 0 ? (total ? mss(length) : '-' + mss(length - p)) : ''];
}

/** What the LCD shows now: 'idle' (nothing loaded), 'note' (a status note), 'song'. */
export function useLcd() {
  const sh = useShell(), p = usePlayback(), total = useItunesView((s) => s.total);
  const t = p.media && p.track?.title ? p.track : null;
  const [turn, setTurn] = useState(0), key = t ? t.uri + '\n' + t.artist + '\n' + (t.album ?? '') : '';
  // a new song starts on its artist; the turns run while one is loaded
  useEffect(() => {
    setTurn(0); // eslint-disable-line react-hooks/set-state-in-effect -- a new song restarts the turns
    if (!key) return;
    const id = setInterval(() => setTurn((n) => n + 1), LCD_TURN);
    return () => clearInterval(id);
  }, [key]);
  // a status note shows for a while after it is set
  const [note, setNote] = useState('');
  useEffect(() => {
    setNote(p.status); // eslint-disable-line react-hooks/set-state-in-effect -- the note is a timed response to a status change
    if (!p.status) return;
    const id = setTimeout(() => setNote(''), NOTE_MS);
    return () => clearTimeout(id);
  }, [p.status]);
  const held = useScrub();
  const ms = usePosition((pos) => Math.floor((held ?? pos) / 1000) * 1000);
  const len = duration(sh.store.getState());
  const [left, right] = lcdTimes(ms, len, total);
  return {
    state: note ? 'note' as const : t ? 'song' as const : 'idle' as const,
    note,
    title: t?.title ?? '',
    sub: lcdSub(t, turn),
    /** the artist / album line clicked: the other one at once */
    turn: () => setTurn((n) => n + 1),
    left, right, total,
    flipTime: viewActions.toggleTotal,
    canSeek: p.media && p.canSeek && len > 0,
  };
}

/** The progress bar with its diamond scrubber (seekHold: hold pauses, release seeks). */
function LcdBar({ className }: { className?: string }) {
  const sh = useShell(), [hold] = useState(() => seekHold(sh)), held = useScrub(), box = useRef<HTMLSpanElement>(null);
  const { media, canSeek } = usePlayback();
  const f = usePosition((_, s) => { const x = seekFraction(s), w = box.current?.clientWidth || 500; return x < 0 ? x : Math.round(x * w) / w; });
  const d = duration(sh.store.getState()), v = held !== null && d > 0 ? held / d : f;
  return (
    <span ref={box} className={cx('relative flex-auto min-w-0 h-11 flex items-center', className)}>
      {/* the groove, and its fill up to the diamond (under the slider, which takes the pointer) */}
      <span className="absolute inset-x-0 top-1/2 h-9 -mt-[4.5px] rounded-full border border-itunes-lcd-ink/75 bg-[#FBFCF2]/50 overflow-hidden pointer-events-none">
        <span className="block h-full bg-[linear-gradient(180deg,#6E7062,#3E4036)]" style={{ width: v > 0 ? 'calc(4px + (100% - 8px) * ' + v + ')' : 0 }} />
      </span>
      <Slider id="seektrack" label="Seek" inset={4} value={v} disabled={!media || !canSeek || !(d > 0)}
              onStart={hold.start} onMove={hold.move} onCommit={hold.commit} onCancel={hold.cancel}
              onStep={(dir) => sh.store.getState().commands.skip(dir * 5)}
              className="relative block w-full h-11 cursor-default outline-offset-2 data-disabled:opacity-60"
              thumbClassName="absolute top-1/2 left-[calc(4px+(100%-8px)*var(--seek,0))] w-9 h-9 -mt-[4.5px] -ml-[4.5px] rotate-45 bg-itunes-lcd-ink shadow-[0_0_0_1px_rgba(251,252,242,.8)]" />
    </span>
  );
}

/** The display. `onGoto`: the round ➜ at its right ("show the current song"), shown while a song plays. */
export function Lcd({ className, compact, onGoto }: { className?: string; compact?: boolean; onGoto?: () => void }) {
  const l = useLcd(), fill = useApp((s) => seekFraction(s) >= 0);
  return (
    <div id="lcd" className={cx('relative min-w-0 overflow-hidden rounded-md border border-itunes-lcd-rim bg-itunes-lcd text-itunes-lcd-ink shadow-[0_1px_0_rgba(255,255,255,.55),inset_0_1px_1px_rgba(0,0,0,.12)] select-none',
                                compact ? 'px-10 py-4' : 'h-42 px-36', className)}
         data-state={l.state} aria-live="polite">
      {l.state === 'idle' && <Icon name="note" size={compact ? 18 : 22} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-itunes-lcd-dim" />}
      {l.state === 'note' && (
        <div className="h-full flex items-center justify-center text-center text-12 leading-[15px] px-8"><span className="line-clamp-2">{l.note}</span></div>
      )}
      {l.state === 'song' && (
        <div className={cx('h-full flex flex-col justify-center items-stretch text-center', compact ? 'gap-1' : 'gap-0')}>
          <div className="truncate text-12 leading-[13px] font-semibold" id="lcdtitle" title={l.title}>{l.title}</div>
          <div className="truncate text-12 leading-[13px] cursor-default" id="lcdsub" title={l.sub} onClick={l.turn}>{l.sub}</div>
          <div className="flex items-center gap-6 text-11 leading-[12px] [font-variant-numeric:tabular-nums]" hidden={!fill}>
            <span className="flex-none min-w-28 text-right" id="time">{l.left}</span>
            <LcdBar />
            <span className="flex-none min-w-32 text-left cursor-default" id="timeleft" title={l.total ? 'Show the time left' : 'Show the length'}
                  onClick={l.flipTime}>{l.right}</span>
          </div>
        </div>
      )}
      {onGoto && l.state === 'song' && !compact && (
        <button type="button" className="absolute right-8 top-1/2 -translate-y-1/2 p-0 border-0 bg-transparent text-itunes-lcd-dim hover:text-itunes-lcd-ink"
                title="Show the current song" aria-label="Show the current song" onClick={onGoto}><Icon name="goto" size={14} /></button>
      )}
    </div>
  );
}
