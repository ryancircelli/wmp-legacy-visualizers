// The iTunes 10 skin: Spotify mapped onto the source list, the view switcher (per source, kept), the
// LCD's lines and times, and iTunes DJ's edits as Up Next orders. Mounted over the harness's fake catalogue.
import { act, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../../src/model';
// the harness first: it loads the app, and so the skin registry, before the skin (the registry and the
// skins' View > Skin import each other; the app's own load order is registry first)
import { fakeData, mountSkinNow, settle } from './harness';
import { itunes } from '../../src/skins/itunes';
import { Root } from '../../src/skins/itunes/Root';
import { runShortcut } from '../../src/ui';
import { buildSources, DEFAULT_VIEW, itunesView, LCD_TURN, lcdSub, lcdTimes, queueOrder } from '../../src/skins/itunes/shared';

const PL = 'spotify:playlist:a';
const track = (n: number, o: Partial<Track> = {}): Track =>
  ({ uri: 'spotify:track:' + n, title: 'Song ' + n, artist: 'Band', album: 'LP ' + (n % 2), albumUri: 'spotify:album:' + (n % 2), duration: 125000, ctx: PL, ...o });

beforeEach(() => { localStorage.clear(); itunesView.setState(DEFAULT_VIEW); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

/** the skin over the catalogue, a playlist in the library; queries inside its own box (WMP 9 mounts beside it) */
async function mount() {
  const m = mountSkinNow('spotify', fakeData({
    list: [{ uri: PL, name: 'Road Trip' }, { uri: 'spotify:album:9', name: 'Saved LP', artist: 'Band' }],
    collections: { [PL]: { tracks: [1, 2, 3].map((n) => track(n)), meta: { kind: 'playlist', name: 'Road Trip', total: 3 } } },
  }), <div data-testid="itunes"><Root /></div>);
  await settle();
  // ids by attribute: WMP 9 beside it has the same ids, and jsdom's '#id' looks in the document's id map
  const box = m.getByTestId('itunes'), q = (s: string) => box.querySelector<HTMLElement>(s.replace(/#([\w-]+)/g, '[id="$1"]'));
  const source = async (id: string) => { act(() => { fireEvent.mouseDown(q(`[data-source="${id}"]`)!); }); await settle(); };
  return { ...m, box, q, source };
}

describe('the source list', () => {
  it('lays Spotify on iTunes\' sections: the playlists (not the saved albums), no DEVICES (the AirPlay menu has them), Search Results while a search is typed', () => {
    const sections = buildSources({ spotify: true, searchQ: 'queen', queue: 2,
      library: [{ uri: PL, name: 'Road Trip' }, { uri: 'spotify:album:x', name: 'An Album' }] });
    expect(sections.map((s) => [s.title, s.items.map((x) => x.label)])).toEqual([
      ['LIBRARY', ['Music', 'Podcasts', 'Radio']],
      ['STORE', ['Spotify', 'Search Results']],
      ['GENIUS', ['Genius', 'Genius Mixes']],
      ['PLAYLISTS', ['iTunes DJ', 'Recently Played', 'Road Trip']],
    ]);
    expect(sections[3]!.items[0]!.badge).toBe('2');                       // Up Next's length on iTunes DJ
    expect(sections[0]!.items[0]!.uri).toBe('spotify:collection:tracks');  // Music is Liked Songs
    const none = buildSources({ spotify: true, searchQ: '', queue: 0, library: [] });
    expect(none.map((s) => s.title)).toEqual(['LIBRARY', 'STORE', 'GENIUS', 'PLAYLISTS']);
    expect(none[1]!.items.map((x) => x.id)).toEqual(['store']);
    expect(buildSources({ spotify: false, searchQ: '', queue: 0, library: [] })).toEqual([]);
  });

  it('a playlist selected lists its songs; a double-click plays the row in the playlist', async () => {
    const m = await mount();
    await m.source(PL);
    const rows = [...m.box.querySelectorAll('[id="tracks"] tbody tr')];
    expect(rows.map((r) => r.children[1]!.textContent)).toEqual(['Song 1', 'Song 2', 'Song 3']);
    fireEvent.doubleClick(rows[1]!);
    expect(m.cmd.playContext).toHaveBeenCalledWith(PL, 'spotify:track:2');
    expect(m.q('#status')!.textContent).toBe('3 songs, 6 minutes');
  });
});

describe('the view switcher', () => {
  it('switches List / Album List / Grid / Cover Flow, kept per source; Ctrl+Alt+3..6 too', async () => {
    const m = await mount();
    await m.source(PL);
    expect(m.q('#tracks')).toBeTruthy();
    act(() => { fireEvent.click(m.q('#valbum')!); });
    expect(m.q('#albumlist')!.textContent).toContain('LP 1');
    act(() => { fireEvent.click(m.q('#vgrid')!); });
    expect([...m.box.querySelectorAll('[id="grid"] [data-uri]')].map((t) => t.getAttribute('data-uri'))).toEqual(['spotify:album:1', 'spotify:album:0']);
    act(() => { fireEvent.click(m.q('#vflow')!); });
    expect(m.q('#coverflow')).toBeTruthy();
    expect(m.q('#vflow')!.getAttribute('aria-checked')).toBe('true');
    // another source keeps its own (List), and coming back finds Cover Flow
    await m.source('music');
    expect(m.q('#vlist')!.getAttribute('aria-checked')).toBe('true');
    await m.source(PL);
    expect(m.q('#coverflow')).toBeTruthy();
    // the skin's table (the harness's shell has WMP 9's)
    act(() => { runShortcut(m.sh, new KeyboardEvent('keydown', { key: '3', ctrlKey: true, altKey: true, cancelable: true }), itunes.shortcuts); });
    expect(itunesView.getState().views[PL]).toBe('list');
    expect((JSON.parse(localStorage.getItem('itunes.view')!) as { state: { views: Record<string, string> } }).state.views[PL]).toBe('list');
  });

  it('is greyed where a source has one view (the store\'s covers)', async () => {
    const m = await mount();
    await m.source('store');
    expect((m.q('#vgrid') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('the LCD', () => {
  it('idle shows the glyph; playing, the song, then the artist and the album taking turns, and the times', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const m = await mount();
    expect(m.q('#lcd')!.getAttribute('data-state')).toBe('idle');
    act(() => m.S().actions.setPlayback({ status: 'paused', track: track(7, { title: 'Under Pressure', artist: 'Queen', album: 'Hot Space', duration: 248000 }),
                                          position: 65000, at: Date.now(), canSeek: true }));
    expect(m.q('#lcdtitle')!.textContent).toBe('Under Pressure');
    expect(m.q('#lcdsub')!.textContent).toBe('Queen');
    act(() => { vi.advanceTimersByTime(LCD_TURN); });
    expect(m.q('#lcdsub')!.textContent).toBe('Hot Space');
    expect([m.q('#time')!.textContent, m.q('#timeleft')!.textContent]).toEqual(['1:05', '-3:03']);
    act(() => { fireEvent.click(m.q('#timeleft')!); });                 // the length instead of the time left
    expect(m.q('#timeleft')!.textContent).toBe('4:08');
  });

  it('words its lines and times as iTunes did', () => {
    expect([lcdSub({ artist: 'Queen', album: 'Jazz' }, 0), lcdSub({ artist: 'Queen', album: 'Jazz' }, 1), lcdSub({ artist: 'Queen' }, 1)]).toEqual(['Queen', 'Jazz', 'Queen']);
    expect(lcdTimes(61000, 200000, false)).toEqual(['1:01', '-2:19']);
    expect(lcdTimes(61000, 200000, true)).toEqual(['1:01', '3:20']);
  });
});

it('iTunes DJ: a drag and a removal become Up Next orders', () => {
  expect(queueOrder(4, { move: [3, 0] })).toEqual([3, 0, 1, 2]);
  expect(queueOrder(4, { move: [0, 2] })).toEqual([1, 2, 0, 3]);
  expect(queueOrder(4, { remove: 1 })).toEqual([0, 2, 3]);
});
