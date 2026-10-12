// The iPod's screen stack: push / pop / replace / home, unique keys, the slide direction.
import { describe, expect, it } from 'vitest';
import { createNav, top } from '../../src/skins/ipod/nav';
import type { ScreenEntry } from '../../src/skins/ipod/screens/contract';

const e = (key: string): ScreenEntry => ({ key, title: key, render: () => null });
const keys = (n: ReturnType<typeof createNav>) => n.store.getState().stack.map((s) => s.entry.key);

describe('nav', () => {
  it('pushes and pops, never below the root', () => {
    const n = createNav(e('main'), () => e('now'));
    expect([n.depth, n.store.getState().dir]).toEqual([1, 0]);
    n.pop();
    expect(keys(n)).toEqual(['main']);
    n.push(e('music'));
    n.push(e('albums'));
    expect([n.depth, n.store.getState().dir, top(n.store.getState()).entry.key]).toEqual([3, 1, 'albums']);
    n.pop();
    expect([keys(n), n.store.getState().dir]).toEqual([['main', 'music'], -1]);
  });

  it('a key pushed again moves to the top as a fresh slot; replace swaps the top', () => {
    const n = createNav(e('main'), () => e('now'));
    n.push(e('now'));
    const first = top(n.store.getState()).id;
    n.push(e('album'));
    n.push(e('now'));
    expect(keys(n)).toEqual(['main', 'album', 'now']);
    expect(top(n.store.getState()).id).not.toBe(first);
    n.replace(e('artist'));
    expect(keys(n)).toEqual(['main', 'album', 'artist']);
    n.replace(e('album'));                           // still unique: the lower 'album' goes
    expect(keys(n)).toEqual(['main', 'album']);
  });

  it('toNowPlaying pushes Now Playing, or brings the one in the stack to the top as it was', () => {
    const n = createNav(e('main'), () => e('now'));
    n.toNowPlaying();
    const np = top(n.store.getState()).id;
    n.push(e('album'));
    n.toNowPlaying();
    expect(keys(n)).toEqual(['main', 'album', 'now']);
    expect(top(n.store.getState()).id).toBe(np);
    n.toNowPlaying();
    expect(n.depth).toBe(3);
  });

  it('home goes back to the root', () => {
    const n = createNav(e('main'), () => e('now'));
    n.push(e('a'));
    n.push(e('b'));
    n.home();
    expect([keys(n), n.store.getState().dir]).toEqual([['main'], -1]);
  });
});
