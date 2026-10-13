import { describe, expect, it } from 'vitest';
import { BALL, BRICK_H, BRICK_W, brickX, brickY, COLS, movePaddle, newGame, PADDLE_W, paddleY, press, step, W, WALL, type Game } from './logic';

const H = 356;
/** a game in play with the ball at (x, y) moving (vx, vy) units per ms */
const at = (x: number, y: number, vx: number, vy: number, o: Partial<Game> = {}): Game =>
  ({ ...newGame(H), x, y, vx, vy, phase: 'play', ...o });

describe('Brick', () => {
  it('holds the paddle inside the walls, and only while serving or playing', () => {
    expect(movePaddle(newGame(H), -1000).paddle).toBe(WALL + PADDLE_W / 2);
    expect(movePaddle(newGame(H), 1000).paddle).toBe(W - WALL - PADDLE_W / 2);
    expect(movePaddle({ ...newGame(H), phase: 'paused' }, 10).paddle).toBe(W / 2);
  });

  it('bounces off the left wall', () => {
    const g = step(at(WALL + BALL / 2 + 1, 200, -0.1, 0.05), 20);
    expect(g.vx).toBeGreaterThan(0);
    expect(g.x - BALL / 2).toBeGreaterThanOrEqual(WALL);
  });

  it('breaks the brick it hits, scoring by its row from the bottom (red the most), and turns back', () => {
    // under the red row's third brick, rising into it (the rows below gone)
    const bricks = newGame(H).bricks.map((_, k) => k < COLS), x = brickX(2) + BRICK_W / 2, y = brickY(0) + BRICK_H + BALL / 2 + 1;
    const g = step(at(x, y, 0, -0.1, { bricks }), 20);
    expect(g.bricks[2]).toBe(false);
    expect(g.bricks.filter(Boolean)).toHaveLength(COLS - 1);
    expect([g.score, g.hits]).toEqual([50, 1]);
    expect(g.vy).toBeGreaterThan(0);
  });

  it('off the paddle: its centre straight up, its edge steep; the last brick starts the next level faster', () => {
    const y = paddleY(H) - BALL / 2 - 1;
    expect(step(at(W / 2, y, 0, 0.1), 20).vx).toBeCloseTo(0);
    const edge = step(at(W / 2 + PADDLE_W / 2, y, 0, 0.1), 20);
    expect(edge.vx).toBeGreaterThan(-edge.vy);                // more across than up
    const last = newGame(H).bricks.map((_, k) => k === 0), x = brickX(0) + BRICK_W / 2;
    const g = step(at(x, brickY(0) + BRICK_H + BALL / 2 + 1, 0, -0.1, { bricks: last }), 20);
    expect(g).toMatchObject({ phase: 'serve', level: 2, score: 50, bricks: newGame(H).bricks });
    expect(g.speed).toBeGreaterThan(newGame(H).speed);
  });

  it('loses a ball past the foot: the next waits on the paddle, centre serves it', () => {
    const g = step(at(W / 2, H, 0, 0.1), 50);
    expect([g.phase, g.lives]).toEqual(['serve', 2]);
    const s = press(g);
    expect(s.phase).toBe('play');
    expect(s.vy).toBeLessThan(0);
  });

  it('is Game Over when the last ball goes; centre starts again', () => {
    const g = step(at(W / 2, H, 0, 0.1, { lives: 1, score: 120 }), 50);
    expect([g.phase, g.lives, g.score]).toEqual(['over', 0, 120]);
    expect(press(g)).toMatchObject({ phase: 'serve', lives: 3, score: 0, level: 1 });
    expect(step(g, 50)).toBe(g);                              // nothing moves meanwhile
  });
});
