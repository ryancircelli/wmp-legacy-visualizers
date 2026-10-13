import { describe, expect, it } from 'vitest';
import type { LibraryItem } from '../../../../model';
import { albumsBy, artistList, artistsOf, az, subline } from './logic';

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

it("words a tile's description as Spotify's library grid does", () => {
  expect(subline('spotify:playlist:p', 'ryan')).toBe('Playlist · ryan');
  expect(subline('spotify:playlist:p')).toBe('Playlist · Spotify');
  expect(subline('spotify:album:a', 'Queen, David Bowie')).toBe('Album · Queen, David Bowie');
  expect(subline('spotify:album:a')).toBe('Album');
  expect(subline('spotify:artist:x', 'Artist')).toBe('Artist');
  expect(subline('spotify:show:s', 'Some host')).toBe('Podcast');
  expect(subline('spotify:track:t', 'Song')).toBe('Song');
});
