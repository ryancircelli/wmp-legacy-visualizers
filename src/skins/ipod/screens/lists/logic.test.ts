import { describe, expect, it } from 'vitest';
import { artistsOf, SLOTS, strip, type Strip } from './logic';

const at = (slot: number, q = '', row = -1): Strip => ({ q, slot, row });
const DEL = SLOTS.length - 1;

describe('search strip', () => {
  it('scrolls the strip, clamped at A', () => {
    expect(strip(at(0), { t: 'tick', dir: -1, rows: 0 })).toEqual(at(0));
    expect(strip(at(0), { t: 'tick', dir: 1, rows: 0 })).toEqual(at(1));
  });
  it('appends the slot, deletes with ⌫, Prev and MENU', () => {
    expect(strip(at(16, 'QUEE'), { t: 'enter' }).q).toBe('QUEEQ');
    expect(strip(at(DEL, 'AB'), { t: 'enter' }).q).toBe('A');
    expect(strip(at(0, 'AB'), { t: 'delete' }).q).toBe('A');
    expect(strip(at(0, 'AB'), { t: 'menu' }).q).toBe('A');
    expect(strip(at(0, ''), { t: 'menu' }).q).toBe('');
    expect(strip(at(0, 'A'), { t: 'space' }).q).toBe('A ');
  });
  it('goes past ⌫ into the results and back', () => {
    expect(strip(at(DEL, 'A'), { t: 'tick', dir: 1, rows: 0 })).toEqual(at(DEL, 'A'));
    const r0 = strip(at(DEL, 'A'), { t: 'tick', dir: 1, rows: 3 });
    expect(r0).toEqual(at(DEL, 'A', 0));
    expect(strip(at(DEL, 'A', 2), { t: 'tick', dir: 1, rows: 3 }).row).toBe(2);
    expect(strip(r0, { t: 'tick', dir: -1, rows: 3 })).toEqual(at(DEL, 'A'));
    // MENU in the results leaves them without deleting
    expect(strip(at(5, 'AB', 1), { t: 'menu' })).toEqual(at(5, 'AB'));
  });
});

describe('artistsOf', () => {
  const t = (artist: string, artistUris?: string[]) => ({ uri: 'u', title: 't', duration: 0, artist, artistUris });
  it('pairs names with uris, first appearance first', () => {
    const m = artistsOf([t('B', ['b']), t('A, B', ['a', 'b']), t('Tyler, The Creator, C', ['ty', 'c']), t('X')]);
    expect([...m]).toEqual([['b', 'B'], ['a', 'A']]);
  });
});
