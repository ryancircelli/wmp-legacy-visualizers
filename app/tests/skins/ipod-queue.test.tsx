// The iPod's Queue: its Library tile shows the next song's cover at 640 px, and its list is a
// playlist's song rows (two lines, each song's cover at the left, the ♪ tile when it has none).
import { act, cleanup } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { Track } from '../../src/model';
import { Root } from '../../src/skins/ipod/Root';
import { fakeData, mountSkinNow, settle } from './harness';

afterEach(() => { cleanup(); localStorage.clear(); });
const key = (k: string) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, cancelable: true })); });
const H = '0123456789abcdef01234567', THUMB = 'https://i.scdn.co/image/ab67616d00004851' + H, BIG = 'https://i.scdn.co/image/ab67616d0000b273' + H;
const track = (n: number, image?: string): Track => ({ uri: 'spotify:track:' + n, title: 'Song ' + n, artist: 'Queen', duration: 1, ...(image ? { image } : {}) });
const PL = 'spotify:playlist:p';

async function onLibrary() {
  const m = mountSkinNow('spotify', fakeData({
    list: [{ uri: PL, name: 'Road Trip', owner: 'ryan' }],
    collections: { [PL]: { meta: { kind: 'playlist', name: 'Road Trip', total: 2 }, tracks: [track(1, THUMB), track(2)] } },
  }), <div data-testid="ipod"><Root /></div>);
  act(() => { m.store.getState().actions.setQueue([track(1, THUMB), track(2)]); });
  const ipod = m.getByTestId('ipod'), shown = (q: string) => [...ipod.querySelectorAll<HTMLElement>(q)].filter((x) => !x.closest('[hidden]'));
  key('ArrowDown'); key('ArrowDown'); key('Enter');                 // the main menu's Library
  await settle();
  return { ...m, shown, songs: () => shown('[role=option]').filter((x) => x.textContent?.startsWith('Song')) };
}

/** a row's make-up: its parts' classes, and its picture (an img's address, else the ♪ tile) */
const shape = (row: HTMLElement) => [[...row.children].map((x) => x.className), row.querySelector('img')?.getAttribute('src') ?? 'tile'];

it('the Queue\'s tile shows the next song\'s cover at 640 px', async () => {
  const m = await onLibrary();
  const tile = m.shown('[role=option]').find((x) => x.textContent === 'QueueUp next')!;
  expect(tile.querySelector('img')!.getAttribute('src')).toBe(BIG);
});

it('the Queue lists its songs as a playlist does: two-line rows, each with its cover, the ♪ tile without one', async () => {
  const m = await onLibrary();
  key('ArrowRight'); key('ArrowRight'); key('Enter');                // past the Queue and Liked Songs: Road Trip
  await settle();
  const playlist = m.songs().map(shape);
  key('Escape');
  key('ArrowLeft'); key('ArrowLeft'); key('Enter');                  // the Queue
  await settle();
  const queue = m.songs();
  expect(queue.map((x) => x.textContent)).toEqual(['Song 1Queen', 'Song 2Queen']);
  expect(queue.map(shape)).toEqual(playlist);
  expect(queue[0]!.querySelector('img')!.getAttribute('src')).toBe(THUMB);   // a row keeps its small thumbnail
  expect(queue[0]!.closest('[data-tall]')).toBeTruthy();
});
