// Brick, the click wheel's Breakout (docs/ipod-skin.md §4.2 Brick; the owner, 2026-10-02: "add the old
// click wheel brick breaker game"). The game is logic.ts's; this screen draws it on a canvas the
// area's size (in units, a 240th of its width, at the device's pixel ratio) every animation frame
// while it is on top and running, and feeds it the wheel: the ring's turn moves the paddle (clockwise
// right) as a drag on the screen does, centre serves (resumes; after Game Over starts again),
// hold-centre pauses and resumes. MENU is the chrome's back; leaving (or covering) the screen pauses
// the game, which is kept here, so coming back finds it where it was, paused. ⏮ ⏭ ⏯ keep their music.
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { DETENT } from '../../ClickWheel';
import { useWheel } from '../../ui';
import { useTurn } from '../../wheel';
import type { ScreenEntry } from '../contract';
import { useOnScreen } from '../nowplaying/NowPlaying';
import { readPref, writePref } from '../settings/prefs';
import { ball, BALL, BRICK_H, BRICK_W, brickX, brickY, COLS, movePaddle, newGame, PADDLE_H, PADDLE_W, paddleY, press, step, togglePause, TOP, W, WALL, type Game } from './logic';
import css from './brick.module.css';

export const brick = (): ScreenEntry => ({ key: 'brick', title: 'Brick', render: () => <Brick /> });

/** the game across leaving the screen and coming back (MENU unmounts it) */
let game = newGame(356);
/** 'ipod.brick': the high score */
const best = () => readPref('ipod.brick', 0);

/** the ring's travel for the paddle to cross the whole field, degrees: one full turn (the owner,
 *  2026-10-02: two turns was wrong, half a turn too quick: "make it 1 full turn") */
const CROSS_DEG = 360;
const PER_DEG = (W - 2 * WALL - PADDLE_W) / CROSS_DEG;
/** the nano's rows, top to bottom, flat */
const COLORS = ['#e8281e', '#f58c0a', '#f5d20a', '#3cb43c', '#2a78e0'];

function Brick() {
  const root = useRef<HTMLDivElement>(null), cv = useRef<HTMLCanvasElement>(null), seen = useOnScreen(root);
  const [phase, setPhase] = useState(game.phase), drag = useRef<{ id: number; x: number } | null>(null);
  const set = (g: Game) => { game = g; setPhase(g.phase); };
  const move = (dx: number) => { game = movePaddle(game, dx); };

  // the frames, while on top and running (serving too: the ball rides the paddle); a ball lost or Game
  // Over ends the loop through the phase. Leaving or covering the screen pauses a ball in play.
  const running = seen && (phase === 'serve' || phase === 'play');
  useEffect(() => {
    if (!running) return;
    let raf = 0, last = performance.now();
    const frame = (now: number) => {
      const was = game, g = step(fit(game, cv.current), Math.min(50, now - last));
      last = now;
      game = g;
      if (g.score !== was.score) window.alchemyHaptic?.('light');
      if (g.phase === 'over' && g.score > best()) writePref('ipod.brick', g.score);
      draw(cv.current, g);
      if (g.phase !== was.phase) setPhase(g.phase);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      if (game.phase === 'play') { game = togglePause(game); setPhase(game.phase); }
    };
  }, [running]);
  // still (paused, Game Over): one frame
  useEffect(() => {
    if (!seen) return;
    game = fit(game, cv.current);
    draw(cv.current, game);
  }, [seen, phase]);

  useTurn(seen ? (deg) => { move(deg * PER_DEG); return true; } : null);
  useWheel({
    onTick: (d) => { move(d * DETENT * PER_DEG); return false; },   // an arrow or mouse-wheel tick: a detent's worth, silent as the turn is
    onCenter: () => set(press(game)),
    onHoldCenter: phase === 'play' || phase === 'paused' ? () => set(togglePause(game)) : undefined,
  });
  // a drag anywhere on the screen moves the paddle as far (its own: not the chrome's swipe-right MENU)
  const touch = {
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      drag.current = { id: e.pointerId, x: e.clientX };
    },
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      move(((e.clientX - d.x) * W) / (e.currentTarget.getBoundingClientRect().width || W));
      d.x = e.clientX;
    },
    onPointerUp: () => { drag.current = null; },
    onPointerCancel: () => { drag.current = null; },
  };
  return <div ref={root} className={css.root} {...touch}><canvas ref={cv} /></div>;
}

/** the field's height in units from the canvas's box (the Now Playing bar shortens it) */
function fit(g: Game, c: HTMLCanvasElement | null): Game {
  const w = c?.clientWidth ?? 0, h = w ? ((c?.clientHeight ?? 0) * W) / w : g.h;
  return Math.abs(h - g.h) > 0.5 ? { ...g, h } : g;
}

function draw(c: HTMLCanvasElement | null, g: Game) {
  if (!c?.clientWidth) return;
  const dpr = window.devicePixelRatio || 1, pw = Math.round(c.clientWidth * dpr), ph = Math.round(c.clientHeight * dpr);
  if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
  const x = c.getContext('2d');
  if (!x) return;
  const k = pw / W, font = getComputedStyle(c).fontFamily;
  x.setTransform(k, 0, 0, k, 0, 0);
  x.fillStyle = '#000';
  x.fillRect(0, 0, W, ph / k);                  // the whole canvas: its rounded pixels can run past g.h
  x.fillStyle = '#fff';
  x.fillRect(0, TOP, W, WALL);
  x.fillRect(0, TOP, WALL, g.h - TOP);
  x.fillRect(W - WALL, TOP, WALL, g.h - TOP);
  g.bricks.forEach((on, i) => {
    if (!on) return;
    const r = Math.floor(i / COLS);
    x.fillStyle = COLORS[r]!;
    x.fillRect(brickX(i % COLS), brickY(r), BRICK_W, BRICK_H);
  });
  x.fillStyle = '#fff';
  x.fillRect(g.paddle - PADDLE_W / 2, paddleY(g.h), PADDLE_W, PADDLE_H);
  const [bx, by] = ball(g);
  if (g.phase !== 'over') x.fillRect(bx - BALL / 2, by - BALL / 2, BALL, BALL);
  const text = (s: string, px: number, tx: number, ty: number, align: CanvasTextAlign) => {
    x.font = `bold ${px}px ${font}`;
    x.textAlign = align;
    x.strokeText(s, tx, ty);                    // a black edge: the ball under "Paused" does not join its letters
    x.fillText(s, tx, ty);
  };
  x.textBaseline = 'middle';
  x.strokeStyle = '#000';
  x.lineWidth = 3;
  text(String(g.score), 12, 6, TOP / 2, 'left');
  text(`Balls ${g.lives}`, 12, W - 6, TOP / 2, 'right');
  const mid = (TOP + g.h) / 2 + 20;
  if (g.phase === 'paused') text('Paused', 20, W / 2, mid, 'center');
  if (g.phase === 'over') {
    text('Game Over', 22, W / 2, mid - 16, 'center');
    text(`Score ${g.score}`, 14, W / 2, mid + 10, 'center');
    text(`High Score ${Math.max(best(), g.score)}`, 14, W / 2, mid + 28, 'center');
  }
}
