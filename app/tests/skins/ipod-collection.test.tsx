// The iPod's playlist / album header: Play is Pause on the playing context (and pauses / resumes it),
// Shuffle is Spotify's shuffle toggle, the heart is filled for what the library holds (the user's own
// playlists always, and never removed).
import { act, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LIKED, type LibraryItem, type Track } from '../../src/model';
import { Root } from '../../src/skins/ipod/Root';
import { fakeData, mountSkinNow, settle } from './harness';

// Now Playing watches whether it is on screen (jsdom has no IntersectionObserver: this one never calls back, so it is)
beforeEach(() => { vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });
const MINE = 'spotify:playlist:mine', FOLLOWED = 'spotify:playlist:followed', OTHER = 'spotify:playlist:other';
const track = (n: number): Track => ({ uri: 'spotify:track:' + n, title: 'Song ' + n, artist: 'Queen', duration: 1 });
const pl = (uri: string, name: string, o: Partial<LibraryItem> = {}): LibraryItem => ({ uri, name, owner: 'someone', ...o });

/** the iPod on a collection's page, opened from the Library; the library then lists `listed` */
async function onPage(uri: string, listed: LibraryItem[]) {
  const tracks = [track(1), track(2)], there = listed.some((x) => x.uri === uri);
  const data = fakeData({ list: there ? listed : [...listed, pl(uri, 'lawnmower classics')],
                          collections: { [uri]: { meta: { kind: 'playlist', name: 'lawnmower classics', total: 2 }, tracks } } });
  const m = mountSkinNow('spotify', data, <div data-testid="ipod"><Root /></div>);
  const ipod = m.getByTestId('ipod'), shown = (q: string) => [...ipod.querySelectorAll<HTMLElement>(q)].filter((x) => !x.closest('[hidden]'));
  const tile = (text: string) => shown('[role=option]').find((x) => x.textContent?.startsWith(text))!;
  act(() => { fireEvent.click(tile('Library')); });
  await settle();
  act(() => { fireEvent.click(tile('lawnmower classics')); });
  await settle();
  if (!there) { data.list = listed; await m.refresh(); }
  const btn = (kind: string) => shown(`[data-kind=${kind}]`)[0]!;
  return { ...m, btn, shown, play: (o: Partial<ReturnType<typeof m.S>['playback']>) => act(() => { m.store.setState((s) => ({ playback: { ...s.playback, ...o } })); }) };
}

it('Play is Pause while this collection plays, and pauses / resumes it; another context: plays this one from the top', async () => {
  const m = await onPage(MINE, [pl(MINE, 'lawnmower classics', { editable: true })]);
  m.play({ track: track(1), context: { uri: MINE, kind: 'playlist', label: 'Playlist: lawnmower classics' }, paused: false });
  expect(m.btn('play').getAttribute('aria-label')).toBe('Pause');
  act(() => { fireEvent.click(m.btn('play')); });
  expect(m.cmd.playPause).toHaveBeenCalledTimes(1);
  expect(m.cmd.playAll).not.toHaveBeenCalled();
  m.play({ paused: true });
  expect(m.btn('play').getAttribute('aria-label')).toBe('Play');
  act(() => { fireEvent.click(m.btn('play')); });
  expect(m.cmd.playPause).toHaveBeenCalledTimes(2);
  expect(m.cmd.playAll).not.toHaveBeenCalled();
  m.play({ context: { uri: LIKED, kind: 'liked', label: 'Liked Songs' }, paused: false });
  expect(m.btn('play').getAttribute('aria-label')).toBe('Play');
  act(() => { fireEvent.click(m.btn('play')); });
  expect(m.cmd.playAll).toHaveBeenCalledWith(MINE);
  expect(m.cmd.playPause).toHaveBeenCalledTimes(2);
});

it('Shuffle toggles Spotify\'s shuffle (lit when on, dimmed when off) and plays nothing', async () => {
  const m = await onPage(MINE, [pl(MINE, 'lawnmower classics', { editable: true })]);
  expect(m.btn('shuffle').getAttribute('aria-checked')).toBe('false');
  expect(m.btn('shuffle').hasAttribute('data-off')).toBe(true);
  act(() => { fireEvent.click(m.btn('shuffle')); });
  expect(m.cmd.toggleShuffle).toHaveBeenCalledTimes(1);
  expect([m.cmd.playAll, m.cmd.playItem, m.cmd.playContext].map((f) => f.mock.calls.length)).toEqual([0, 0, 0]);
  m.play({ shuffle: true });
  expect(m.btn('shuffle').getAttribute('aria-checked')).toBe('true');
  expect(m.btn('shuffle').hasAttribute('data-off')).toBe(false);
});

it('the user\'s own playlist is saved: the heart filled, a press removes nothing, the … menu offers no removal', async () => {
  const m = await onPage(MINE, [pl(MINE, 'lawnmower classics', { editable: true })]);
  expect(m.btn('like').getAttribute('aria-checked')).toBe('true');
  expect(m.btn('like').getAttribute('aria-label')).toBe('Saved');
  act(() => { fireEvent.click(m.btn('like')); });
  expect(m.cmd.addTo).not.toHaveBeenCalled();
  act(() => { fireEvent.click(m.shown('[aria-label=More]')[0]!); });
  expect(m.shown('[role=option]').map((x) => x.textContent)).not.toContain('Remove from Library');
  expect(m.shown('[role=option]').map((x) => x.textContent)).toContain('Start Radio');
});

it('a followed playlist is saved (in the library list): filled, a press removes it; one not in the library is not', async () => {
  const m = await onPage(FOLLOWED, [pl(FOLLOWED, 'lawnmower classics')]);
  expect(m.btn('like').getAttribute('aria-label')).toBe('Unlike');
  expect(m.btn('like').getAttribute('aria-checked')).toBe('true');
  act(() => { fireEvent.click(m.btn('like')); });
  expect(m.cmd.addTo).toHaveBeenCalledWith(FOLLOWED, LIKED, false);
  cleanup();
  const o = await onPage(OTHER, []);
  expect(o.btn('like').getAttribute('aria-label')).toBe('Like');
  expect(o.btn('like').getAttribute('aria-checked')).toBe('false');
  act(() => { fireEvent.click(o.btn('like')); });
  expect(o.cmd.addTo).toHaveBeenCalledWith(OTHER, LIKED, true);
});
