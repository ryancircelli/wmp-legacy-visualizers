import { describe, expect, it } from 'vitest';
import type { LibraryItem } from '../../../../model';
import { albumsBy, artistList, artistsOf, az, SLOTS, strip, STRIP0, type Strip } from './logic';

const at = (slot: number, q = '', row = -1, typed = false): Strip => ({ q, slot, row, typed });
const LAST = SLOTS.length - 1;

describe('search picker', () => {
  it('walks A–Z then 0–9, clamped at both ends', () => {
    expect(SLOTS.join('')).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
    expect(strip(at(0), { t: 'tick', dir: -1, rows: 0 })).toEqual(at(0));
    expect(strip(at(0), { t: 'tick', dir: 1, rows: 0 })).toEqual(at(1));
    expect(strip(at(LAST), { t: 'tick', dir: 1, rows: 5 })).toEqual(at(LAST));
  });
  it('types the letter, ⏭ a space, ⏮ deletes', () => {
    expect(strip(at(16, 'QUEE'), { t: 'enter' })).toEqual(at(16, 'QUEEQ', -1, true));
    expect(strip(at(0, 'A'), { t: 'space' })!.q).toBe('A ');
    expect(strip(at(0, ''), { t: 'space' })).toEqual(at(0));
    expect(strip(at(0, 'AB'), { t: 'delete' })!.q).toBe('A');
    expect(strip(at(0, ''), { t: 'delete' })).toEqual(at(0));
  });
  it('MENU: to the results once typed, back to the picker, then out', () => {
    const typed = strip(STRIP0, { t: 'enter' })!;
    const results = strip(typed, { t: 'menu', rows: 3 })!;
    expect(results).toEqual(at(0, 'A', 0));
    expect(strip(results, { t: 'tick', dir: 1, rows: 3 })!.row).toBe(1);
    expect(strip(at(0, 'A', 2), { t: 'tick', dir: 1, rows: 3 })!.row).toBe(2);
    expect(strip(at(0, 'A', 0), { t: 'tick', dir: -1, rows: 3 })!.row).toBe(0);
    const back = strip(results, { t: 'menu', rows: 3 })!;
    expect(back).toEqual(at(0, 'A'));
    expect(strip(back, { t: 'menu', rows: 3 })).toBeNull();
    // nothing found: MENU leaves at once
    expect(strip(typed, { t: 'menu', rows: 0 })).toBeNull();
    expect(strip(STRIP0, { t: 'menu', rows: 0 })).toBeNull();
  });
});

describe('A–Z', () => {
  it("ignores The / A / An and case, and puts what isn't a letter after Z", () => {
    const names = ['the Zombies', '2Pac', 'ABBA', 'A Tribe Called Quest', 'beck', 'Ánimo', '!!!', 'The Beatles', 'Anathema'];
    expect(names.sort(az)).toEqual(['ABBA', 'Anathema', 'Ánimo', 'The Beatles', 'beck', 'A Tribe Called Quest', 'the Zombies', '!!!', '2Pac']);
  });
});

describe('artists', () => {
  const t = (artist: string, artistUris?: string[]) => ({ uri: 'u', title: 't', duration: 0, artist, artistUris });
  const album = (name: string, artist?: string): LibraryItem => ({ uri: 'spotify:album:' + name, name, artist });
  it('pairs names with uris, first appearance first', () => {
    const m = artistsOf([t('B', ['b']), t('A, B', ['a', 'b']), t('Tyler, The Creator, C', ['ty', 'c']), t('X')]);
    expect([...m]).toEqual([['b', 'B'], ['a', 'A']]);
  });
  it('merges liked songs and saved albums by name, A–Z', () => {
    const liked = new Map([['spotify:artist:q', 'Queen'], ['spotify:artist:b', 'Beck']]);
    const list = artistList(liked, [album('Hot Space', 'Queen, David Bowie'), album('Low', 'david bowie'), album('X')]);
    expect(list).toEqual([
      { key: 'spotify:artist:b', name: 'Beck', uri: 'spotify:artist:b' },
      { key: 'name:David Bowie', name: 'David Bowie' },
      { key: 'spotify:artist:q', name: 'Queen', uri: 'spotify:artist:q' },
    ]);
    expect(albumsBy('David Bowie', [album('Hot Space', 'Queen, David Bowie'), album('Low', 'David Bowie'), album('X')]).map((a) => a.name))
      .toEqual(['Hot Space', 'Low']);
  });
});
