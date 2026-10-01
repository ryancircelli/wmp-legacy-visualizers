// Settings > General > Main Menu / Music Menu: what shows out of the box, and that only the user's own
// choices are stored (so a later change of the defaults reaches everyone who never touched a row).
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { resetMenu, setMenuItem, useMenuVisibility } from './prefs';

afterEach(() => localStorage.clear());

it('hides what Spotify has nothing behind until it is turned on', () => {
  const { result } = renderHook(() => useMenuVisibility());
  expect(result.current.main).toMatchObject({ music: true, videos: false, photos: true, podcasts: false, radio: true, voicememos: false, previewpanel: true });
  expect(result.current.music).toMatchObject({ coverflow: true, geniusmixes: true, genres: false, composers: false, audiobooks: false, search: true });
  act(() => setMenuItem('music', 'genres', true));
  expect(result.current.music.genres).toBe(true);
  expect(JSON.parse(localStorage.getItem('ipod.menus')!)).toEqual({ main: {}, music: { genres: true } });
  act(() => resetMenu('music'));
  expect(result.current.music.genres).toBe(false);
});
