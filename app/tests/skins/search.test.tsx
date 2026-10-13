// Search: the Search view's box (Enter, ×, Ctrl+E), the results page (top result, sections, Show
// all, paging, both view modes) and an artist's page, over fake query functions (tests/skins/harness).
import { act, cleanup, fireEvent, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryItem, SearchResults, SearchType, Track } from '../../src/model';
import { fakeData, mountSkin, type FakeData } from './harness';

let h: Awaited<ReturnType<typeof mountSkin>>;
const S = () => h.S();
const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
const AR = 'spotify:artist:q';
const track = (n: number): Track => ({ uri: 'spotify:track:' + n, title: 'Song ' + n, artist: 'Queen', album: 'Opera', duration: 60000 });
const item = (uri: string, name: string, o: Partial<LibraryItem> = {}): LibraryItem => ({ uri, name, ...o });
const page = <T,>(items: T[], total: number, o: { exact?: boolean; hasMore?: boolean } = {}) =>
  ({ items, total, offset: 0, exact: o.exact ?? true, hasMore: o.hasMore ?? false });

const queen = (): SearchResults => ({
  top: { kind: 'artist', item: item(AR, 'Queen', { kind: 'artist' }) },
  tracks: page([track(1), track(2)], 30, { hasMore: true }),
  artists: page([item(AR, 'Queen', { kind: 'artist' })], 1),
  albums: page([item('spotify:album:o', 'A Night at the Opera', { owner: 'Queen' })], 1),
  playlists: page([item('spotify:playlist:q', 'This Is Queen', { owner: 'Spotify' })], 1),
});
const data = (): FakeData => fakeData({
  search: { queen: queen() },
  typed: { 'queen|tracks': { items: Array.from({ length: 30 }, (_, i) => track(i + 1)), total: 30 } },
});

async function setup(view: 'now' | 'search' = 'search', d: FakeData = data(), q = '') {
  h = await mountSkin('spotify', d);
  act(() => { S().actions.setView(view); S().actions.setUi({ searchQ: q }); });
  await h.settle();
  return h;
}
const sections = () => [...document.querySelectorAll<HTMLElement>('#mlresults section')].map((x) => x.dataset.section + ':' + x.firstElementChild!.textContent);

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('search box', () => {
  it('typing waits 400 ms, Enter searches at once; × clears; Ctrl+E from any view focuses it', async () => {
    const { key, cmd } = await setup('now');
    vi.useFakeTimers();
    key('e', { ctrlKey: true });
    expect([S().ui.view, $('#tsearch')!.dataset.on]).toEqual(['search', 'true']);
    act(() => { vi.advanceTimersByTime(1); });
    expect(document.activeElement).toBe($('#mlq'));
    fireEvent.change($('#mlq')!, { target: { value: 'que' } });
    expect(cmd.search).not.toHaveBeenCalled();
    fireEvent.change($('#mlq')!, { target: { value: 'queen' } });
    fireEvent.keyDown($('#mlq')!, { key: 'Enter' });
    expect(cmd.search.mock.calls).toEqual([['queen']]);
    act(() => { vi.advanceTimersByTime(500); });
    expect(cmd.search).toHaveBeenCalledOnce();                // Enter dropped the pending one
    fireEvent.click($('#mlqclear')!);
    expect([($('#mlq') as HTMLInputElement).value, $('#mlqclear')]).toEqual(['', null]);
    vi.useRealTimers();
  });
});

describe('results page', () => {
  it('Results for “q”, the top result, Songs / Artists / Albums / Playlists with counts; Show all pages one type', async () => {
    await setup('search', data(), 'queen');
    expect(h.queries.fetchSearch).toHaveBeenCalledWith('queen', 'all');
    expect($('#mltitle')!.textContent).toBe('Results for “queen”');
    expect($('#mltop')!.textContent).toBe('Top resultQueenArtist');
    expect(sections()).toEqual(['tracks:Songs30Show all 30', 'artists:Artists1', 'albums:Albums1', 'playlists:Playlists1']);
    expect([...$('#mlresults section table')!.querySelectorAll('th')].map((t) => t.textContent)).toEqual(['', 'Title', 'Artist', 'Album', 'Length']);
    fireEvent.click(within($('#mlresults')!).getByText('Show all 30'));
    await h.settle();
    // the typed query starts at once (its first page of 20); its total is a lower bound until the last page
    expect(h.queries.fetchSearch).toHaveBeenLastCalledWith('queen', 'tracks', 0);
    expect([$('#mlresults')!.dataset.type, sections(), $('#mlresults tbody')!.querySelectorAll('tr').length]).toEqual(['tracks', ['tracks:Songs30+'], 21]);
    fireEvent.click(within($('#mlresults')!).getByText('Load more'));
    await h.settle();
    expect(h.queries.fetchSearch).toHaveBeenLastCalledWith('queen', 'tracks', 20);
    expect([$('#mlresults tbody')!.querySelectorAll('tr').length, sections()]).toEqual([30, ['tracks:Songs30']]);   // all in: exact, no Load more
    fireEvent.click($('#mlall')!);
    expect(sections()).toEqual(['tracks:Songs30Show all 30', 'artists:Artists1', 'albums:Albums1', 'playlists:Playlists1']);
    expect($('#mlresults section tbody')!.querySelectorAll('tr').length).toBe(2);   // the preview slice again
  });

  it('a lower-bound total reads "18+" (the full search under-reports); hasMore drives Show all; a fallback note goes to the status line', async () => {
    const d = data();
    d.search.queen = { ...queen(), tracks: page([track(1), track(2)], 18, { exact: false, hasMore: true }),
                       artists: page([item(AR, 'Queen', { kind: 'artist' })], 1, { hasMore: true }) };
    d.typed['queen|artists'] = { items: [item(AR, 'Queen', { kind: 'artist' }), item('spotify:artist:f', 'Freddie')], total: 2, pageSize: 1,
                                 note: 'searchArtists unavailable: via searchDesktop' };
    await setup('search', d, 'queen');
    expect(sections().slice(0, 2)).toEqual(['tracks:Songs18+Show all 18+', 'artists:Artists1Show all 1']);
    fireEvent.click(within($('#mlresults')!).getByText('Show all 1'));
    await h.settle();
    expect(S().ui.status).toBe('searchArtists unavailable: via searchDesktop');
    fireEvent.click(within($('#mlresults')!).getByText('Load more'));
    await h.settle();
    expect(h.queries.fetchSearch).toHaveBeenLastCalledWith('queen', 'artists', 1);
  });

  it('a track selects (the pane) and plays on double-click; an artist or album opens here, ‹ All results back, or in the library', async () => {
    const d = data();
    d.artists[AR] = { meta: { kind: 'artist', name: 'Queen', total: 1 }, tracks: [track(9)], albums: [item('spotify:album:o', 'A Night at the Opera')] };
    d.collections['spotify:album:o'] = { tracks: [track(7)], meta: { kind: 'album', name: 'A Night at the Opera', total: 1 } };
    const { cmd } = await setup('search', d, 'queen');
    fireEvent.click($('#mlresults tbody tr')!);
    expect([S().ui.libSel, $('#mlinfo')!.dataset.mode]).toEqual(['spotify:track:1', 'track']);
    fireEvent.doubleClick($('#mlresults tbody tr')!);
    expect(cmd.playContext).toHaveBeenCalledWith('spotify:track:1', 'spotify:track:1');
    fireEvent.doubleClick($('#mlresults [data-uri="spotify:playlist:q"]')!);
    expect(cmd.playContext).toHaveBeenCalledWith('spotify:playlist:q', null);
    // an artist: its page (fetchArtist) in the Search view
    fireEvent.click($(`#mlresults [data-uri="${AR}"]`)!);
    await h.settle();
    expect([h.queries.fetchArtist.mock.calls[0], S().ui.view, $('#mltitle')!.textContent, $('#mlresults')]).toEqual([[AR], 'search', 'Queen', null]);
    expect([$('#mlrows')!.textContent, !!$('#mlalbums')]).toEqual(['Song 9QueenOpera1:00', true]);
    fireEvent.click($('#mltolib')!);
    expect(cmd.openArtist).toHaveBeenCalledWith(AR);
    fireEvent.click($('#mlall')!);
    expect(sections()).toHaveLength(4);
    // an album: its tracks here too; Open in Media Library sends it there
    fireEvent.click($('#mlresults [data-uri="spotify:album:o"]')!);
    await h.settle();
    expect([h.queries.fetchCollectionPage.mock.calls.at(-1), S().ui.libNode, $('#mltitle')!.textContent, $('#mlrows')!.textContent])
      .toEqual([['spotify:album:o', 0], null, 'A Night at the Opera', 'Song 7QueenOpera1:00']);
    fireEvent.click($('#mltolib')!);
    expect(cmd.openInLibrary).toHaveBeenCalledWith('spotify:album:o');
  });

  it('tiles mode: collections as tiles, songs as rows; the empty and loading states say so; results stay cached across views', async () => {
    const d = data();
    let answer: () => void = () => {};
    await setup('search', d);
    act(() => S().actions.setSettings({ libraryView: 'tiles' }));
    expect($('#mlnote')!.textContent).toMatch(/Type in the search box/);
    const real = h.queries.fetchSearch.getMockImplementation()!;
    h.queries.fetchSearch.mockImplementationOnce(((q: string, t?: SearchType) => new Promise((r) => { answer = () => r(real(q, t)); })));
    act(() => S().actions.setUi({ searchQ: 'queen' }));
    await h.settle();
    expect($('#mlnote')!.textContent).toBe('Searching…');
    await act(async () => { answer(); await Promise.resolve(); });
    await h.settle();
    // artists, albums and playlists as tiles; songs stay list rows (tracks are never tiles)
    expect([...document.querySelectorAll('#mlresults button[data-uri]')].map((b) => b.getAttribute('data-uri')))
      .toEqual([AR, 'spotify:album:o', 'spotify:playlist:q']);
    expect([...$('#mlresults section[data-section=tracks] tbody')!.querySelectorAll('tr')].map((r) => r.children[1]!.textContent))
      .toEqual(['Song 1', 'Song 2']);
    const n = h.queries.fetchSearch.mock.calls.length;
    act(() => S().actions.setView('now'));
    act(() => S().actions.setView('search'));
    await h.settle();
    expect([h.queries.fetchSearch.mock.calls.length, !!$('#mlresults button[data-uri]')]).toEqual([n, true]);   // no refetch
  });
});

describe('artist page', () => {
  it('the table is the top tracks, the discography a tile strip; the pane shows the artist', async () => {
    const d = data();
    d.artists[AR] = { tracks: [track(1), track(2)], albums: [item('spotify:album:o', 'A Night at the Opera'), item('spotify:album:j', 'Jazz')],
                      meta: { kind: 'artist', name: 'Queen', total: 2, followers: 50000000, description: 'British rock band.' } };
    const { cmd } = await setup('now', d);
    act(() => { S().actions.setView('library'); S().actions.setUi({ libNode: AR }); });
    await h.settle();
    expect([$('#mltitle')!.textContent, $('#mlrows')!.querySelectorAll('tr').length]).toEqual(['Queen', 2]);
    expect([...$('#mlalbums')!.querySelectorAll('button[data-uri]')].map((b) => b.textContent)).toEqual(['A Night at the Opera▶', 'Jazz▶']);
    const pane = $('#mlinfo')!.textContent;
    expect(pane).toMatch(/♥ 50,000,000 followers/);
    expect(pane).toMatch(/Artist/);
    expect(within($('#mlnodes')!).getByText('Artist: Queen').dataset.on).toBe('true');
    fireEvent.click($('#mlplay')!);
    expect(cmd.playContext).toHaveBeenCalledWith(AR, null);
    fireEvent.click(within($('#mlalbums')!).getByText('Jazz'), { detail: 0 });   // a tile opens (Enter: at once)
    expect(S().ui.libNode).toBe('spotify:album:j');
  });
});
