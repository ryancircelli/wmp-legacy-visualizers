// The Media Library's details pane (context and track modes, collapse) and tiles view, through
// the WMP 9 skin against a real store, spy commands and fake query functions (tests/skins/harness).
import { act, cleanup, fireEvent, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIKED, type Track } from '../../src/model';
import { useIdlePrefetch } from '../../src/ui';
import { fakeData, mountSkin, mountSkinNow, settle, type FakeData } from './harness';

let h: Awaited<ReturnType<typeof mountSkin>>, cmd: typeof h.cmd;
const S = () => h.S();
const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
const PL = 'spotify:playlist:a', AL = 'spotify:album:x';
const track = (n: number, o: Partial<Track> = {}): Track =>
  ({ uri: 'spotify:track:' + n, title: 'Track ' + n, artist: 'Band', album: 'LP', duration: 125000, ctx: PL, ...o });

const data = (): FakeData => fakeData({
  list: [{ uri: PL, name: 'Mix A', owner: 'ryan', image: 'https://i/a.jpg' }, { uri: AL, name: 'LP', artist: 'Band', total: 10 }],
  collections: { [PL]: { tracks: [
    track(1, { explicit: true, playcount: 1476105414, albumUri: AL, artistUris: ['spotify:artist:b', 'spotify:artist:c'],
               artist: 'Band, Guest', releaseDate: '2015-07-15', trackNumber: 3, discNumber: 2, image: 'https://i/t1.jpg' }),
    track(2, { duration: 3600000 })],
    meta: { kind: 'playlist', name: 'Mix A', total: 2, image: 'https://i/a.jpg', followers: 12345,
            owner: { name: 'ryan', uri: 'spotify:user:ryan', avatar: 'https://i/u.jpg' },
            description: 'x'.repeat(300), shareUrl: 'https://open.spotify.com/playlist/a' } } },
});

async function setup(d: FakeData = data()) {
  h = await mountSkin('spotify', d);
  cmd = h.cmd;
  act(() => S().actions.setView('library'));
  await h.settle();
  return h;
}
const pane = () => $('#mlinfo')!;
const lines = () => [...pane().querySelectorAll('[data-mode] > div, [data-mode] > div > div')].map((d) => d.textContent);

beforeEach(() => localStorage.clear());
afterEach(cleanup);


describe('details pane', () => {
  it('context mode: cover, name, owner, followers, clamped description, stats, Play all / Shuffle play / Copy link', async () => {
    await setup();
    expect(pane().dataset.mode).toBe('context');
    expect(pane().querySelector('img')!.getAttribute('src')).toBe('https://i/a.jpg');
    expect(lines()).toEqual(expect.arrayContaining(['Mix A', 'by ryan', '♥ 12,345 followers', '2 tracks · 1 hr 2 min', 'Playlist']));
    const desc = pane().querySelector('[data-clamped]')!;
    fireEvent.click(within(pane()).getByText('more'));
    expect(desc.hasAttribute('data-clamped')).toBe(false);
    fireEvent.click($('#dplayall')!);
    expect(cmd.playAll).toHaveBeenCalledWith(PL);
    fireEvent.click($('#dshuffle')!);
    expect([cmd.toggleShuffle.mock.calls.length, cmd.playAll.mock.calls.length]).toEqual([1, 2]);
    const write = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    fireEvent.click($('#dcopy')!);
    await act(() => Promise.resolve());
    expect(write).toHaveBeenCalledWith('https://open.spotify.com/playlist/a');
    expect(S().ui.status).toBe('Link copied: https://open.spotify.com/playlist/a');
  });

  it('an album: artists, saved, release, label, copyright, its kind; while it loads the list row still names it', async () => {
    const d = data();
    let answer: () => void = () => {};
    await setup(d);
    d.collections[AL] = { tracks: [track(5)], meta: { kind: 'album', name: 'LP', total: 1,
      artists: [{ name: 'Band', uri: 'spotify:artist:b' }], saved: true, releaseDate: '2015-07-15', label: 'Warp',
      copyright: '© 2015 Warp', format: 'SINGLE' } };
    d.saved[AL] = true;
    const real = h.queries.fetchCollectionPage.getMockImplementation()!;
    h.queries.fetchCollectionPage.mockImplementationOnce((u: string, o?: number) => new Promise((r) => { answer = () => r(real(u, o)); }));
    act(() => S().actions.setUi({ libNode: AL }));
    await h.settle();
    expect(lines()).toEqual(expect.arrayContaining(['LP', 'Band', '10 tracks', 'Album']));    // the list row only, meanwhile
    await act(async () => { answer(); await Promise.resolve(); });
    await h.settle();
    expect(lines()).toEqual(expect.arrayContaining(['Band', '1 track · 2 min', 'Released 2015-07-15', 'Warp', '© 2015 Warp', 'Album · Single']));
    expect($('#mlinfo #daddto')!.getAttribute('aria-pressed')).toBe('true');   // saved: the heart is filled
    act(() => S().actions.setUi({ libNode: LIKED }));
    await h.settle();
    expect(lines()).toEqual(expect.arrayContaining(['Liked Songs', '0 tracks']));
  });

  it('track mode: a selected row; artists and album link, plays, EXPLICIT, the album\'s label; back and Esc return to the playlist', async () => {
    const d = data();
    d.albums[AL] = { kind: 'album', name: 'LP', total: 9, label: 'Warp', releaseDate: '1999' };
    await setup(d);
    const rows = () => $('#mlrows')!.querySelectorAll('tr');
    fireEvent.click(rows()[0]!);
    await h.settle();
    expect(pane().dataset.mode).toBe('track');
    expect(lines()).toEqual(expect.arrayContaining(['Track 1EXPLICIT', 'Band, Guest', 'LP', 'Length 2:05', '1,476,105,414 plays',
                                                   'Released 2015-07-15', 'Warp', 'Track 3, disc 2']));
    expect(h.queries.fetchAlbumMeta).toHaveBeenCalledWith(AL);
    expect(pane().querySelector('img')!.getAttribute('src')).toBe('https://i/t1.jpg');
    fireEvent.click(within(pane()).getByText('Guest'));
    expect(cmd.openArtist).toHaveBeenCalledWith('spotify:artist:c');
    fireEvent.click(within(pane()).getByText('LP'));
    expect(cmd.openInLibrary).toHaveBeenCalledWith(AL, 'LP');
    fireEvent.click($('#dplay')!);
    expect(cmd.playContext).toHaveBeenCalledWith(PL, 'spotify:track:1');
    fireEvent.click(within(pane()).getByText('‹ back to Mix A'));
    expect(pane().dataset.mode).toBe('context');
    fireEvent.click(rows()[1]!);
    expect(lines()).toContain('Length 60:00');               // a row with no extras: what is there
    fireEvent.keyDown($('#mlscroll')!, { key: 'Escape' });
    expect([pane().dataset.mode, S().ui.libSel]).toEqual(['context', null]);
  });

  it('collapses from its grip and from View > Details Pane (persisted in settings.detailsPane)', async () => {
    await setup();
    const grip = pane().querySelector('button')!;
    expect([grip.textContent, grip.getAttribute('aria-expanded')]).toEqual(['›', 'true']);
    fireEvent.click(grip);
    expect([(S().settings as { detailsPane?: boolean }).detailsPane, pane().dataset.open, pane().querySelector('[data-mode]')])
      .toEqual([false, undefined, null]);
    expect(pane().querySelector('button')!.textContent).toBe('‹');
    fireEvent.pointerDown($('#mtops [data-menu=view]')!, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    const item = [...document.querySelectorAll('[role=menu] [role^=menuitem]')].find((b) => b.children[1]?.textContent === 'Details Pane')!;
    expect(item.children[0]!.textContent).toBe('');
    fireEvent.click(item);
    expect(pane().dataset.open).toBe('true');
  });
});

describe('tiles view', () => {
  it('Tiles mode browses covers (no tree, no track tiles): a cover opens its tracks as the table under a breadcrumb; the level persists', async () => {
    const d = data();
    d.collections[PL]!.total = 5;                             // more to page
    d.collections[LIKED] = { tracks: [track(8), track(9), track(10)] };
    const { key } = await setup(d);
    fireEvent.click($('#mlviewtiles')!);
    await h.settle();
    // the covers: Liked Songs (its count) first, then the playlists and the albums; the tree hidden
    expect([S().settings.libraryView, $('#mlviewtiles')!.dataset.on, $('#mltree'), $('#mltable'), $('#mlcrumb')])
      .toEqual(['tiles', 'true', null, null, null]);
    const covers = () => [...$('#mltiles')!.querySelectorAll<HTMLElement>('button[data-uri]')];
    expect(covers().map((t) => t.textContent)).toEqual(['Liked Songs3 tracks', 'Mix Aby ryan', 'LPBand']);
    expect([...$('#mltiles')!.querySelectorAll('div > div:first-child')].map((x) => x.textContent)).toContain('Playlists');
    expect([$('#mltitle')!.textContent, $('#mlcount')!.textContent]).toEqual(['Media Library', '1 playlist · 1 album']);
    // a double-click (two clicks within the window) plays it whole and stays on the covers
    const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));
    fireEvent.click(covers()[1]!, { detail: 1 });
    fireEvent.click(covers()[1]!, { detail: 2 });
    fireEvent.doubleClick(covers()[1]!);
    await wait(300);
    expect([h.cmd.playAll.mock.calls, S().ui.libNode, !!$('#mltiles')]).toEqual([[[PL]], null, true]);
    // one click opens after the double-click window: the table, "‹ Playlists ›" before the name, Play all, Load more
    fireEvent.click(covers()[1]!, { detail: 1 });
    await wait(100);
    expect(S().ui.libNode).toBeNull();                                      // not yet
    await wait(200);
    await h.settle();
    expect([S().ui.libNode, $('#mlcrumb')!.textContent, $('#mltitle')!.textContent, $('#mlcount')!.textContent, $('#mltiles'), $('#mltree')])
      .toEqual([PL, '‹ Playlists', 'Mix A', '5 tracks', null, null]);
    expect([...$('#mlrows')!.querySelectorAll('tr')].map((r) => r.textContent)).toEqual(['Track 1Band, GuestLP2:05', 'Track 2BandLP60:00', 'Load more']);   // (the like button is a heart: no text)
    fireEvent.click(within($('#mlrows')!).getByText('Load more'));
    await h.settle();
    expect(h.queries.fetchCollectionPage).toHaveBeenLastCalledWith(PL, 2);
    fireEvent.click($('#mlrows tr')!);
    expect(pane().dataset.mode).toBe('track');                               // the pane follows the selection
    // the level survives a view switch; the mode buttons switch from either level
    act(() => { S().actions.setView('now'); S().actions.setView('library'); });
    await h.settle();
    expect([$('#mltitle')!.textContent, !!$('#mlcrumb')]).toEqual(['Mix A', true]);
    key('T', { ctrlKey: true, shiftKey: true });
    expect([S().settings.libraryView, !!$('#mltree'), !!$('#mltable'), $('#mlcrumb')]).toEqual(['details', true, true, null]);
    key('T', { ctrlKey: true, shiftKey: true });
    fireEvent.click($('#mlcrumb')!);
    await h.settle();
    fireEvent.click(covers().find((t) => t.dataset.uri === AL)!, { detail: 0 });   // Enter (a keyboard click) opens at once
    expect(S().ui.libNode).toBe(AL);
    await h.settle();
    expect($('#mlcrumb')!.textContent).toBe('‹ Albums');
    fireEvent.click($('#mlcrumb')!);
    await h.settle();
    fireEvent.click(covers()[0]!, { detail: 0 });                           // Liked Songs opens the same way
    await h.settle();
    expect([$('#mltitle')!.textContent, $('#mlrows')!.querySelectorAll('tr').length]).toEqual(['Liked Songs', 3]);
  });

  it('the Playlists and Albums headings show their collections as tiles; a click opens, ▶ and double-click play', async () => {
    await setup();
    fireEvent.click(within($('#mlnodes')!).getByText('Playlists'));
    expect([$('#mltitle')!.textContent, $('#mlcount')!.textContent]).toEqual(['Playlists', '1 playlist']);
    const tile = $('#mltiles button[data-uri]')!;
    expect(tile.textContent).toBe('Mix Aby ryan▶');
    fireEvent.click(within($('#mlnodes')!).getByText('Albums'));
    const al = $('#mltiles button[data-uri]')!;
    expect(al.textContent).toBe('LPBand▶');
    fireEvent.click(within(al).getByText('▶'));                     // the corner plays it where it stands
    expect([cmd.playAll.mock.calls, S().ui.libNode]).toEqual([[[AL]], 'albums']);
    fireEvent.doubleClick(al);
    expect(cmd.playAll).toHaveBeenCalledTimes(2);                  // a collection plays whole
    fireEvent.click(al, { detail: 0 });                            // Enter opens at once
    await h.settle();
    expect([S().ui.libNode, $('#mltitle')!.textContent]).toEqual([AL, 'LP']);
  });
});

describe('loading ahead', () => {
  it('a playlist kept from the last session shows before the login is known, and nothing is fetched', async () => {
    h = mountSkinNow('spotify', data());
    act(() => S().actions.setAuth({ loggedIn: null }));
    const page = await h.queries.fetchCollectionPage(PL, 0);
    h.queries.fetchCollectionPage.mockClear();
    act(() => { h.client.setQueryData(h.sh.queries.keys.collection(PL), { pages: [page], pageParams: [0] }); });
    act(() => { S().actions.setView('library'); S().actions.setUi({ libNode: PL }); });
    await settle();
    expect($('#mlrows')!.textContent).toContain('Track 2');
    expect(h.queries.fetchCollectionPage).not.toHaveBeenCalled();       // nothing is asked before the login
  });

  it('after Media Guide\'s feed, its first screen of covers: four rows, eight covers each', async () => {
    vi.useFakeTimers();
    const real = globalThis.Image, srcs: string[] = [];
    globalThis.Image = class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      fetchPriority = '';
      set src(v: string) { srcs.push(v); }
    } as unknown as typeof Image;
    try {
      const home = { greeting: '', sections: Array.from({ length: 6 }, (_, s) => ({ title: 'Row ' + s, items: Array.from({ length: 10 }, (_, i) =>
        ({ uri: 'spotify:playlist:' + s + '-' + i, name: 'P', sub: '', img: `https://i/${s}-${i}.jpg` })) })) };
      const Ahead = () => { useIdlePrefetch(); return null; };
      h = mountSkinNow('spotify', { ...data(), home }, <Ahead />);
      await act(() => vi.advanceTimersByTimeAsync(20_000));
      expect(srcs).toEqual(home.sections.slice(0, 4).flatMap((s) => s.items.slice(0, 8).map((i) => i.img)));
    } finally {
      globalThis.Image = real;
      vi.useRealTimers();
    }
  });

  it('after login, while idle: the library, Media Guide and the first collections, one at a time', async () => {
    vi.useFakeTimers();
    try {
      const Ahead = () => { useIdlePrefetch(); return null; };
      h = mountSkinNow('spotify', data(), <Ahead />);
      act(() => S().actions.setAuth({ loggedIn: null }));
      await act(() => vi.advanceTimersByTimeAsync(10_000));
      expect(h.queries.fetchHome).not.toHaveBeenCalled();               // not before the login
      act(() => S().actions.setAuth({ loggedIn: true }));
      await act(() => vi.advanceTimersByTimeAsync(10_000));
      expect([h.queries.fetchLibraryList.mock.calls.length > 0, h.queries.fetchHome.mock.calls.length]).toEqual([true, 1]);
      expect(h.queries.fetchCollectionPage.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining([LIKED, PL, AL]));
    } finally {
      vi.useRealTimers();
    }
  });
});
