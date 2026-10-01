// Settings > General > Main Menu / Library Menu: what shows out of the box, and that only the user's own
// choices are stored (so a later change of the defaults reaches everyone who never touched a row).
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { resetMenu, setMenuItem, useMenuVisibility } from './prefs';

afterEach(() => localStorage.clear());

it('shows every row but Extras, Podcasts & Shows and Cover Flow until they are turned on', () => {
  const { result } = renderHook(() => useMenuVisibility());
  expect(result.current.main).toEqual({ home: true, search: true, library: true, radio: true, extras: false, previewpanel: true });
  expect(result.current.music).toEqual({ playlists: true, likedsongs: true, albums: true, artists: true, 'podcasts&shows': false, queue: true, coverflow: false });
  act(() => setMenuItem('music', 'coverflow', true));
  expect(result.current.music.coverflow).toBe(true);
  expect(JSON.parse(localStorage.getItem('ipod.menus')!)).toEqual({ main: {}, music: { coverflow: true } });
  act(() => resetMenu('music'));
  expect(result.current.music.coverflow).toBe(false);
});
