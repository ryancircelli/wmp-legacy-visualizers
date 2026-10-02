// Settings > Menus > Main Menu / Library Filters: what shows out of the box, and that only the user's own
// choices are stored (so a later change of the defaults reaches everyone who never touched a row);
// Library View's and Appearance > Visualizer Fit's defaults.
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { resetMenu, setMenuItem, useLibraryView, useMenuVisibility, useVisFit } from './prefs';

afterEach(() => localStorage.clear());

it('shows every row and chip but Podcasts until it is turned on', () => {
  const { result } = renderHook(() => useMenuVisibility());
  expect(result.current.main).toEqual({ home: true, search: true, library: true, radio: true });
  expect(result.current.music).toEqual({ playlists: true, albums: true, artists: true, podcasts: false });
  act(() => setMenuItem('music', 'podcasts', true));
  expect(result.current.music.podcasts).toBe(true);
  expect(JSON.parse(localStorage.getItem('ipod.menus')!)).toEqual({ main: {}, music: { podcasts: true } });
  act(() => resetMenu('music'));
  expect(result.current.music.podcasts).toBe(false);
});

it('Library View is Grid until List is chosen', () => {
  const { result } = renderHook(() => useLibraryView());
  expect(result.current[0]).toBe('grid');
  act(() => result.current[1]('list'));
  expect(result.current[0]).toBe('list');
  expect(localStorage.getItem('ipod.view')).toBe('"list"');
});

it('Appearance > Visualizer Fit is Fit until Stretch is chosen', () => {
  const { result } = renderHook(() => useVisFit());
  expect(result.current[0]).toBe('fit');
  act(() => result.current[1]('stretch'));
  expect(result.current[0]).toBe('stretch');
  expect(localStorage.getItem('ipod.visFit')).toBe('"stretch"');
});
