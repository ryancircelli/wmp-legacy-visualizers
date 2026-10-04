// The Library's Podcasts (on at first): the followed shows, a show's episodes newest first (date · length,
// the blue dot where Spotify says unplayed), the centre plays an episode in its show; and Recently Played,
// the Playlists tile made of the home feed's recently-played shelves.
import { act, cleanup, fireEvent, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { HomeSection, LibraryItem, Track } from '../../src/model';
import { Root } from '../../src/skins/ipod/Root';
import { fakeData, mountSkinNow, settle, type FakeData } from './harness';

// Now Playing watches whether it is on screen (jsdom has no IntersectionObserver: this one never calls back, so it is)
beforeEach(() => { vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });
const key = (k: string) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, cancelable: true })); });

const SHOW = 'spotify:show:hf', PL = 'spotify:playlist:p', AR = 'spotify:artist:a';
const ep = (n: number, date: string, o: Partial<Track> = {}): Track =>
  ({ uri: 'spotify:episode:e' + n, title: 'Episode ' + n, artist: 'Hard Fork', album: 'Hard Fork', duration: 3_900_000, ctx: SHOW, releaseDate: date, ...o });

/** the iPod on its Library, the catalogue serving `data` and the followed shows */
async function onLibrary(data: Partial<FakeData> = {}, shows: LibraryItem[] = [{ uri: SHOW, name: 'Hard Fork', owner: 'The New York Times' }]) {
  const m = mountSkinNow('spotify', fakeData(data), <div data-testid="ipod"><Root /></div>);
  // the harness's catalogue predates the shows query: added here
  Object.assign(m.queries, { fetchShows: vi.fn(() => Promise.resolve(shows)) });
  m.queries.keys.shows = () => ['fake', 'library', 'shows'];
  key('ArrowDown'); key('ArrowDown'); key('Enter');                 // the main menu's Library
  await settle();
  const ipod = m.getByTestId('ipod'), shown = (q: string) => [...ipod.querySelectorAll<HTMLElement>(q)].filter((x) => !x.closest('[hidden]'));
  const rows = () => shown('[role=option]').map((x) => x.textContent);
  const wheel = within(ipod).getByRole('group', { name: 'Click wheel' });
  wheel.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}) });
  return {
    ...m, shown, rows,
    /** what the lists on top say (an empty one's note is no row) */
    text: () => shown('[role=listbox]').map((x) => x.textContent).join('|'),
    sel: () => shown('[aria-selected=true]').map((x) => x.textContent),
    click: async (text: string) => { act(() => { fireEvent.click(shown('[role=option]').find((x) => x.textContent?.startsWith(text))!); }); await settle(); },
    /** ⏯ on the wheel (its bottom) */
    playButton: () => act(() => {
      fireEvent.pointerDown(wheel, { pointerId: 3, pointerType: 'mouse', button: 0, clientX: 100, clientY: 186 });
      fireEvent.pointerUp(wheel, { pointerId: 3, pointerType: 'mouse', button: 0, clientX: 100, clientY: 186 });
    }),
  };
}

it('Podcasts is a chip out of the box: the followed shows; a show\'s episodes newest first, date · length, the dot only where Spotify says unplayed', async () => {
  const m = await onLibrary({ collections: { [SHOW]: { tracks: [ep(1, '2026-09-01', { unplayed: false }), ep(3, '2026-09-29', { unplayed: true, duration: 1_500_000 }), ep(2, '2026-09-15')] } } });
  expect(m.rows().slice(0, 4)).toEqual(['Playlists', 'Albums', 'Artists', 'Podcasts']);
  await m.click('Podcasts');
  expect(m.rows().slice(4)).toEqual(['Hard ForkPodcast']);
  expect(m.sel()).toEqual(['Hard ForkPodcast']);
  key('Enter');
  await settle();
  const day = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  expect(m.rows()).toEqual(['Episode 3' + day('2026-09-29') + ' · 25 min', 'Episode 2' + day('2026-09-15') + ' · 1 hr 5 min', 'Episode 1' + day('2026-09-01') + ' · 1 hr 5 min']);
  expect(m.shown('[role=option] [aria-label=Unplayed]').map((x) => x.closest('[role=option]')!.textContent?.slice(0, 9))).toEqual(['Episode 3']);
  expect(m.shown('[role=option]')[0]!.closest('[data-tall]')).toBeTruthy();                 // two-line rows
});

it('the centre plays an episode in its show and goes to Now Playing; ⏯ on a show plays the show', async () => {
  const m = await onLibrary({ collections: { [SHOW]: { tracks: [ep(1, '2026-09-01'), ep(2, '2026-09-15')] } } });
  await m.click('Podcasts');
  m.playButton();
  expect(m.cmd.playContext).toHaveBeenCalledWith(SHOW, null);
  key('Escape');                                                     // back from Now Playing
  key('Enter');                                                      // the show
  await settle();
  key('ArrowDown'); key('Enter');                                    // its second-newest
  expect(m.cmd.playItem).toHaveBeenCalledWith(expect.objectContaining({ uri: 'spotify:episode:e1', ctx: SHOW }));
  expect(m.shown('[role=option]').length).toBe(0);                   // Now Playing on top: no list
  key('Escape');
  expect(m.sel()[0]).toMatch(/^Episode 1/);
});

it('no followed shows: "No Podcasts"', async () => {
  const m = await onLibrary({}, []);
  await m.click('Podcasts');
  expect([m.rows().slice(4), m.text()]).toEqual([[], expect.stringContaining('No Podcasts')]);
});

const recents: HomeSection[] = [
  { title: 'Jump back in', items: [{ uri: PL, name: 'Road Trip', sub: 'ryan', img: 'https://i.scdn.co/p' }, { uri: 'spotify:track:t', name: 'A Song', sub: 'Queen', img: null },
                                   { uri: AR, name: 'Queen', sub: 'Artist', img: null }, { uri: SHOW, name: 'Hard Fork', sub: 'Podcast', img: null }] },
  { title: 'Made for you', items: [{ uri: 'spotify:album:x', name: 'Not Recent', sub: 'Band', img: null }] },
  { title: 'Recently played', items: [{ uri: PL, name: 'Road Trip', sub: 'ryan', img: null }] },
];

it('Recently Played: a Playlists tile after the Queue while Home has a recently-played shelf; its playlists, artists and shows open as the Library\'s do, ⏯ plays one', async () => {
  const m = await onLibrary({ home: { greeting: '', sections: recents },
                              collections: { [PL]: { meta: { kind: 'playlist', name: 'Road Trip', total: 1 }, tracks: [{ uri: 'spotify:track:t', title: 'A Song', artist: 'Queen', duration: 1 }] } } });
  expect(m.rows().slice(4, 7)).toEqual(['QueueUp next', 'Recently PlayedJump back in', 'Liked SongsPlaylist · 0 songs']);
  expect(m.shown('[role=option]')[5]!.querySelector('img')!.getAttribute('src')).toBe('https://i.scdn.co/p');   // the latest's cover
  await m.click('Recently Played');
  expect(m.rows()).toEqual(['Road TripPlaylist · ryan', 'QueenArtist', 'Hard ForkPodcast']);   // songs left out, each once
  m.playButton();
  expect(m.cmd.playAll).toHaveBeenCalledWith(PL);
  key('Escape');
  key('Enter');                                                      // Road Trip: the playlist's page under its header
  await settle();
  expect(m.shown('[data-head]')[0]!.textContent).toContain('Road Trip');
  key('Escape');
  key('ArrowDown'); key('ArrowDown'); key('Enter');                  // Hard Fork: its episodes
  await settle();
  expect([m.rows(), m.text()]).toEqual([[], 'No Episodes']);
});

it('no recently-played shelf on Home: no tile, and the host\'s log says which shelves there were', async () => {
  const log = vi.fn();
  window.alchemyLog = log;
  const m = await onLibrary({ home: { greeting: '', sections: [recents[1]!] } });
  expect(m.rows().slice(4)).toEqual(['QueueUp next', 'Liked SongsPlaylist · 0 songs']);
  expect(log).toHaveBeenCalledWith('spotify: home has no recently played shelf (titles: Made for you)');
  delete window.alchemyLog;
});
