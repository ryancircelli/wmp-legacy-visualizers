// The transport's behaviour: the buttons (what they do, their titles, whether they are lit), the
// seek slider with the old shell's drag semantics, the volume, the clock and the karaoke line.
// Unstyled: a skin gives class names (functions of the lit state where it matters) and icons.
import { Fragment, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { hasMedia } from '../model';
import { useClockMode, useLyrics, usePlayback, usePosition } from './hooks';
import { duration, seekFraction } from './selectors';
import { isPlaying, prevNext, useApp, useShell } from './shell';
import { scrub, useScrub } from './scrub';
import type { Shell } from './types';

/** A class name or a function of the control's lit state. */
type Cls = string | ((on: boolean) => string);
const cls = (c: Cls | undefined, on: boolean) => (typeof c === 'function' ? c(on) : c);

export type TransportAction = 'play' | 'stop' | 'prev' | 'next' | 'mute' | 'shuffle' | 'repeat' | 'lyrics';

const REPEAT_NAME = { off: 'Off', context: 'Playlist', track: 'Track' } as const;
/** where lyrics came from, as the UI names it */
export const LYRICS_SOURCE = { spotify: 'Spotify', lrclib: 'LRCLIB' } as const;

/** What a transport control does and says. `on` = playing / muted / shuffling / lyrics on.
 *  `enabled` = false when the control has nothing to act on (WMP 9 draws those glyphs pale): Stop
 *  with nothing playing, Previous / Next when the session refuses the skip. Play always works (it
 *  resumes, or in a browser opens the share picker); with no session Previous / Next walk the
 *  visualizations. */
export function useTransportAction(action: TransportAction) {
  const sh = useShell(), p = usePlayback(), get = () => sh.store.getState(), source = useApp((s) => s.lyrics.source ?? null);
  switch (action) {
    case 'play': return { on: p.playing, enabled: true, title: p.playing ? 'Pause' : p.capture || p.media || p.spotify ? 'Play' : 'Play (share a tab or your screen)',
                          onClick: () => get().commands.playPause() };
    case 'stop': return { on: false, enabled: p.media || p.capture, title: 'Stop', onClick: () => get().commands.stop() };
    case 'prev': return { on: false, enabled: !p.media || p.canPrev !== false, title: p.media ? 'Previous track' : 'Previous visualization',
                          onClick: () => prevNext(sh, -1) };
    case 'next': return { on: false, enabled: !p.media || p.canNext !== false, title: p.media ? 'Next track' : 'Next visualization',
                          onClick: () => prevNext(sh, 1) };
    case 'mute': return { on: p.muted, enabled: true, title: p.muted ? 'Unmute' : 'Mute', onClick: () => get().actions.setVolume(null, !p.muted) };
    // a real toggle only under Spotify; elsewhere the skin's decoration
    case 'shuffle': return { on: p.spotify && p.shuffle, title: 'Shuffle', hidden: !p.spotify,
                             onClick: p.spotify ? () => get().commands.toggleShuffle() : undefined };
    // Off -> Playlist -> Track (lit for both; data-repeat says which); Spotify only, as shuffle
    case 'repeat': return { on: p.spotify && p.repeat !== 'off', title: 'Repeat: ' + REPEAT_NAME[p.spotify ? p.repeat : 'off'], hidden: !p.spotify,
                            onClick: p.spotify ? () => get().commands.cycleRepeat() : undefined };
    // the title names where the lyrics come from while they are on
    case 'lyrics': return { on: p.lyrics, title: 'Lyrics: ' + (p.lyrics ? 'On' + (source ? ' (' + LYRICS_SOURCE[source] + ')' : '') : 'Off'),
                            onClick: () => get().actions.setLyricsEnabled(!p.lyrics) };
  }
}

/** One transport control. Buttons are <button>s; the small discs (shuffle, repeat) are spans, as
 *  WMP's; the repeat disc carries data-repeat (off / context / track). */
export function TransportButton({ action, className, id, children }: {
  action: TransportAction; className?: Cls; id?: string; children: ReactNode | ((on: boolean) => ReactNode);
}) {
  const a = useTransportAction(action);
  const body = typeof children === 'function' ? children(a.on) : children;
  const repeat = usePlayback().repeat;
  if (action === 'shuffle' || action === 'repeat') {
    return (
      <span className={cls(className, a.on)} id={id} title={a.title} onClick={a.onClick} data-on={a.on || undefined}
            data-repeat={action === 'repeat' && a.on ? repeat : undefined}
            aria-hidden={'hidden' in a && a.hidden} role={'hidden' in a && a.hidden ? undefined : 'button'}>{body}</span>
    );
  }
  const enabled = !('enabled' in a) || a.enabled !== false;
  return <button className={cls(className, a.on)} id={id} title={a.title} onClick={a.onClick} data-on={a.on || undefined}
                 disabled={!enabled} data-disabled={!enabled || undefined}>{body}</button>;
}

/** A horizontal drag track: press (left button) starts (onStart) and previews, drag follows
 *  (onMove; the pointer is captured), release commits (onCommit), Escape or a lost pointer cancels
 *  (onCancel). `value` 0..1, or -1 for "no position" (the thumb's --seek is unset and it sits
 *  home). `inset` = half the thumb, so the thumb's centre follows the pointer. With `onStep` the
 *  track is focusable and ←/→ step it. The thumb is placed by CSS from --seek. */
export function Slider({ value, disabled, inset, onStart, onMove, onCommit, onCancel, onStep, label, className, thumbClassName, id, thumbId }: {
  value: number; disabled?: boolean; inset: number; onCommit: (f: number) => void;
  onStart?: () => void; onMove?: (f: number) => void; onCancel?: () => void; onStep?: (dir: -1 | 1) => void; label?: string;
  className?: string; thumbClassName?: string; id?: string; thumbId?: string;
}) {
  const [drag, setDrag] = useState(-1);
  const ref = useRef<HTMLSpanElement>(null);
  const frac = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left - inset) / Math.max(1, r.width - 2 * inset)));
  };
  const cancel = () => { if (drag < 0) return; setDrag(-1); onCancel?.(); };
  const f = drag >= 0 ? drag : value;
  return (
    <span className={className} id={id} ref={ref} data-disabled={disabled || undefined} data-dragging={drag >= 0 || undefined}
          {...(onStep ? { role: 'slider', tabIndex: disabled ? -1 : 0, 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100,
                          'aria-valuenow': f >= 0 ? Math.round(f * 100) : 0 } : { 'aria-hidden': true })}
          onPointerDown={(e) => {
            if (disabled || e.button !== 0) return;
            e.currentTarget.setPointerCapture?.(e.pointerId);
            const v = frac(e);
            setDrag(v);
            onStart?.();
            onMove?.(v);
          }}
          onPointerMove={(e) => { if (drag < 0) return; const v = frac(e); setDrag(v); onMove?.(v); }}
          onPointerUp={() => { if (drag < 0) return; onCommit(drag); setDrag(-1); }}
          onPointerCancel={cancel}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && drag >= 0) { e.stopPropagation(); cancel(); return; }
            if (!onStep || disabled || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
            e.preventDefault();
            onStep(e.key === 'ArrowLeft' ? -1 : 1);
          }}>
      <span className={thumbClassName} id={thumbId} style={f >= 0 ? ({ '--seek': Math.round(f * 10000) / 10000 } as CSSProperties) : undefined} />
    </span>
  );
}

/** Seeking by hand: holding the seek bar pauses (when playing), the thumb and the clock follow the
 *  pointer (the scrub position, no seek yet), and the release seeks and then resumes — in that
 *  order, as Spotify's commands are asynchronous — holding the shown position until the next
 *  playback state arrives. Escape cancels: no seek, resume. */
export function seekHold(sh: Shell) {
  const get = () => sh.store.getState();
  let resume = false, release: (() => void) | null = null;
  const done = () => { release?.(); release = null; };
  return {
    start: () => {
      done();
      const s = get();
      resume = hasMedia(s) && isPlaying(s);
      if (resume) void s.commands.pause();
    },
    move: (f: number) => { scrub.setState({ ms: f * duration(get()) }); },
    cancel: () => {
      scrub.setState({ ms: null });
      if (resume) void get().commands.play();
    },
    commit: (f: number) => {
      const s = get(), ms = f * duration(s), was = resume;
      if (!hasMedia(s)) { scrub.setState({ ms: null }); return; }
      scrub.setState({ ms });
      // keep the scrubbed position up until a state event (or 3 s) says where playback is
      const at = s.playback.at;
      const off = sh.store.subscribe((x) => x.playback.at, (a) => { if (a !== at) done(); });
      const t = setTimeout(done, 3000);
      release = () => { off(); clearTimeout(t); scrub.setState({ ms: null }); };
      // (an adapter's seek settles when the player answers; resume after it)
      void Promise.resolve(s.commands.seek(ms)).then(() => { if (was) void get().commands.play(); });
    },
  };
}

/** The seek bar: the extrapolated position (or the scrub) on a Slider, held-to-scrub as seekHold
 *  says, ←/→ ±5 s when focused; the ±10 s pills either side (Spotify's rewind / fast forward;
 *  decoration elsewhere). */
export function SeekBar({ className, id, pillClassName, track, rewind, forward }: {
  className?: string; id?: string; pillClassName?: string; rewind: ReactNode; forward: ReactNode;
  track: { className?: string; thumbClassName?: string; id?: string; thumbId?: string; inset: number };
}) {
  const sh = useShell(), get = () => sh.store.getState();
  const { media, canSeek, spotify } = usePlayback();
  const [hold] = useState(() => seekHold(sh));
  const held = useScrub();
  const f = usePosition((_, s) => seekFraction(s));
  const d = duration(get());
  const pill = (sec: number, title: string) => (spotify
    ? { 'aria-hidden': false, title, onClick: () => get().commands.skip(sec) } : { 'aria-hidden': true });
  return (
    <div className={className} id={id}>
      <span className={pillClassName} {...pill(-10, 'Rewind 10 seconds')}>{rewind}</span>
      <Slider {...track} label="Seek" value={held !== null && d > 0 ? held / d : f} disabled={!media || !canSeek || !(d > 0)}
              onStart={hold.start} onMove={hold.move} onCommit={hold.commit} onCancel={hold.cancel}
              onStep={(dir) => get().commands.skip(dir * 5)} />
      <span className={pillClassName} {...pill(10, 'Fast forward 10 seconds')}>{forward}</span>
    </div>
  );
}

/** Spotify: the player's volume 0..100; elsewhere the capture's sensitivity 0..200 (a native range).
 *  Muted, the thumb sits at 0 (settings.volume keeps the level, and unmuting puts it back); moving
 *  it while muted sets that level and unmutes. */
export function VolumeSlider({ className, id }: { className?: string; id?: string }) {
  const sh = useShell(), { spotify, volume, muted } = usePlayback();
  return (
    <input className={className} id={id} type="range" min="0" max={spotify ? 100 : 200} step="5" value={muted ? 0 : volume}
           title={spotify ? 'Volume' : 'Capture sensitivity'}
           onChange={(e) => sh.store.getState().actions.setVolume(+e.currentTarget.value)} />
  );
}

/** Elapsed / -remaining (a click flips it while a session exists); the length is its title. */
export function Clock({ className, id }: { className?: string; id?: string }) {
  const c = useClockMode();
  return <div className={className} id={id} title={c.title} onClick={c.toggle} data-clickable={c.clickable || undefined}>{c.text}</div>;
}

/** Synced lyrics: the current line word by word (data-k sung / now, the current word's fill in
 *  --f as a percentage) — or, with karaoke off, as one plain lit line — and the next line under
 *  it; each new line fades in. data-karaoke on the root says which. */
export function Karaoke({ className, id, classes, ids }: {
  className?: string; id?: string;
  classes: { cur?: string; next?: string; sung?: string; now?: string };
  ids?: { cur?: string; next?: string };
}) {
  const { synced } = useLyrics(), ref = useRef<HTMLDivElement>(null), i = synced?.index ?? -1;
  useLayoutEffect(() => { if (synced && i >= 0) ref.current?.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 150 }); }, [!!synced, i]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={className} id={id} hidden={!synced} ref={ref} data-karaoke={synced?.karaoke || undefined}>
      <div className={classes.cur} id={ids?.cur}>
        {synced && !synced.karaoke ? synced.text : synced?.words.map((w, j) => (
          <Fragment key={j}>
            {j ? ' ' : ''}
            <span className={w.state === 'sung' ? classes.sung : w.state === 'now' ? classes.now : undefined} data-k={w.state}
                  style={w.state === 'now' ? ({ '--f': synced.fill * 100 + '%' } as CSSProperties) : undefined}>{w.text}</span>
          </Fragment>
        ))}
      </div>
      <div className={classes.next} id={ids?.next}>{synced?.next ?? ''}</div>
    </div>
  );
}
