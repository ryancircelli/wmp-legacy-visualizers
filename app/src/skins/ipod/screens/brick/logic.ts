// Brick, the iPod's Breakout (Extras > Games on the nanos of 2005-2009), as pure functions: a game in,
// the next game out, time in ms. Units are the screen's (240 across); the field's height `h` is the
// frame's (356, or 312 over the Now Playing bar), so Brick.tsx hands it in. The score and the balls
// left sit in the top band, the white outline (top, left, right; the foot is open) under it.

export const W = 240, ROWS = 5, COLS = 10, LIVES = 3;
/** the band over the field (score, balls left), and the outline's width */
export const TOP = 20, WALL = 1;
/** the bricks: 1-unit gaps between them and to the walls, the first row this far under the outline */
export const GAP = 1, BRICK_H = 8, BRICKS_Y = TOP + WALL + 14;
export const BRICK_W = (W - 2 * WALL - (COLS + 1) * GAP) / COLS;
export const PADDLE_W = 36, PADDLE_H = 4, BALL = 4;
/** the paddle's top, this far over the field's foot */
const PADDLE_LIFT = 14;
/** units per ms at the start; × SPEEDUP every 10 bricks, × LEVEL_UP each level */
const SPEED = 0.16, SPEEDUP = 1.04, LEVEL_UP = 1.1;
/** the bounce off the paddle's very edge, from straight up (its centre); the serve's */
const EDGE = (60 * Math.PI) / 180, SERVE = (30 * Math.PI) / 180;

/** serve: the ball waits on the paddle; over: Game Over, centre starts again */
export type Phase = 'serve' | 'play' | 'paused' | 'over';
export interface Game {
  h: number;
  /** the paddle's centre */
  paddle: number;
  /** the ball's centre and velocity (units per ms); while serving it rides the paddle (ball()) */
  x: number; y: number; vx: number; vy: number;
  speed: number;
  /** ROWS × COLS, row 0 (red) on top; false once broken */
  bricks: boolean[];
  /** bricks broken this level (every 10th speeds the ball up) */
  hits: number;
  score: number; lives: number; level: number;
  phase: Phase;
}

const full = () => Array<boolean>(ROWS * COLS).fill(true);
export const newGame = (h: number): Game =>
  ({ h, paddle: W / 2, x: W / 2, y: 0, vx: 0, vy: 0, speed: SPEED, bricks: full(), hits: 0, score: 0, lives: LIVES, level: 1, phase: 'serve' });

export const paddleY = (h: number) => h - PADDLE_LIFT;
export const brickX = (c: number) => WALL + GAP + c * (BRICK_W + GAP);
export const brickY = (r: number) => BRICKS_Y + r * (BRICK_H + GAP);
/** where the ball is: on the paddle while serving */
export const ball = (g: Game): [number, number] => (g.phase === 'serve' ? [g.paddle, paddleY(g.h) - BALL / 2] : [g.x, g.y]);

/** the paddle moved dx units, held inside the walls; it moves only while serving or playing */
export function movePaddle(g: Game, dx: number): Game {
  if (g.phase !== 'serve' && g.phase !== 'play') return g;
  const lo = WALL + PADDLE_W / 2, hi = W - WALL - PADDLE_W / 2;
  return { ...g, paddle: Math.max(lo, Math.min(hi, g.paddle + dx)) };
}

/** Centre: serve (30° off straight up, toward the wider side), resume, or after Game Over a new game. */
export function press(g: Game): Game {
  if (g.phase === 'over') return newGame(g.h);
  if (g.phase === 'paused') return { ...g, phase: 'play' };
  if (g.phase !== 'serve') return g;
  const [x, y] = ball(g), side = g.paddle > W / 2 ? -1 : 1;
  return { ...g, x, y, vx: side * g.speed * Math.sin(SERVE), vy: -g.speed * Math.cos(SERVE), phase: 'play' };
}

/** Hold-centre: pause, or resume. */
export const togglePause = (g: Game): Game =>
  g.phase === 'play' ? { ...g, phase: 'paused' } : g.phase === 'paused' ? { ...g, phase: 'play' } : g;

/** dt ms of play: the ball moves in steps of at most 2 units (it never passes through a brick or the
 *  paddle), off the walls, breaking the first brick it touches and bouncing off the paddle at an angle
 *  set by where it lands (the centre straight up, the edges steep). Past the foot it is lost. */
export function step(g: Game, dt: number): Game {
  if (g.phase !== 'play' || dt <= 0) return g;
  const n = Math.ceil((g.speed * dt) / 2), t = dt / n;
  let s = g;
  for (let i = 0; i < n && s.phase === 'play'; i++) s = move(s, t);
  return s;
}

function move(g: Game, t: number): Game {
  let { x, y, vx, vy } = g;
  x += vx * t;
  y += vy * t;
  const r = BALL / 2, top = TOP + WALL;
  if (x - r < WALL) { x = WALL + r; vx = Math.abs(vx); }
  if (x + r > W - WALL) { x = W - WALL - r; vx = -Math.abs(vx); }
  if (y - r < top) { y = top + r; vy = Math.abs(vy); }
  if (y - r > g.h) return lose(g);
  // a brick: gone, scored by its row from the bottom; the ball goes back the way it came on the side it hit
  const k = g.bricks.findIndex((on, k) => {
    if (!on) return false;
    const bx = brickX(k % COLS), by = brickY(Math.floor(k / COLS));
    return x + r > bx && x - r < bx + BRICK_W && y + r > by && y - r < by + BRICK_H;
  });
  if (k >= 0) {
    const bx = brickX(k % COLS), by = brickY(Math.floor(k / COLS));
    const ox = Math.min(x + r, bx + BRICK_W) - Math.max(x - r, bx), oy = Math.min(y + r, by + BRICK_H) - Math.max(y - r, by);
    if (ox < oy) vx = x < bx + BRICK_W / 2 ? -Math.abs(vx) : Math.abs(vx);
    else vy = y < by + BRICK_H / 2 ? -Math.abs(vy) : Math.abs(vy);
    const bricks = g.bricks.map((on, j) => on && j !== k), hits = g.hits + 1;
    const score = g.score + 10 * (ROWS - Math.floor(k / COLS));
    if (!bricks.includes(true)) {
      const speed = SPEED * LEVEL_UP ** g.level;
      return { ...g, score, speed, bricks: full(), hits: 0, level: g.level + 1, phase: 'serve' };
    }
    const f = hits % 10 ? 1 : SPEEDUP;
    return { ...g, x, y, vx: vx * f, vy: vy * f, speed: g.speed * f, bricks, hits, score };
  }
  // the paddle
  const py = paddleY(g.h), off = (x - g.paddle) / (PADDLE_W / 2 + r);
  if (vy > 0 && y + r >= py && y + r <= py + PADDLE_H && Math.abs(off) <= 1) {
    const a = off * EDGE;
    return { ...g, x, y: py - r, vx: g.speed * Math.sin(a), vy: -g.speed * Math.cos(a) };
  }
  return { ...g, x, y, vx, vy };
}

/** a ball past the foot: the next one waits on the paddle, or with none left, Game Over */
const lose = (g: Game): Game => ({ ...g, lives: g.lives - 1, phase: g.lives > 1 ? 'serve' : 'over' });
