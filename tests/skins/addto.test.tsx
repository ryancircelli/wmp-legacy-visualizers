// Add to (Liked Songs, the user's playlists): the round button and its menu in the details pane,
// the Now Playing pane and the track tables; the Play menu's entries and Ctrl+D; the context
// mode's Save button. Through the WMP 9 skin over fake query functions (tests/skins/harness).
import { act, cleanup, fireEvent, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LIKED, type Track } from '../../src/model';
import { fakeData, mountSkin, type FakeData } from './harness';

let h: Awaited<ReturnType<typeof mountSkin>>, cmd: typeof h.cmd;
const S = () => h.S();
const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
const PL = 'spotify:playlist:a', MINE = 'spotify:playlist:m', OTHER = 'spotify:playlist:o', AL = 'spotify:album:x';
const track = (n: number, o: Partial<Track> = {}): Track =>
  ({ uri: 'spotify:track:' + n, title: 'Track ' + n, artist: 'Band', album: 'LP', duration: 125000, ctx: PL, ...o });
const press = (el: HTMLElement) => fireEvent.pointerDown(el, { button: 0, ctrlKey: false, pointerType: 'mouse' });
const menu = (depth: number) => document.querySelector<HTMLElement>(`[role=menu][data-depth="${depth}"]`);
const items = (depth: number) => [...menu(depth)!.querySelectorAll<HTMLElement>('[role^=menuitem]')];
const item = (depth: number, label: string) => items(depth).find((b) => b.children[1]!.textContent === label)!;
/** open a submenu from the keyboard (focus its item, ArrowRight), as a user walking the menu does */
const openSub = async (label: string) => {
  const t = item(0, label);
  t.focus();
  fireEvent.keyDown(t, { key: 'ArrowRight' });
  await act(() => new Promise((r) => setTimeout(r, 0)));
};
const labels = (depth: number) => items(depth).map((b) => b.children[0]!.textContent + b.children[1]!.textContent);

const data = (): FakeData => fakeData({
  list: [{ uri: PL, name: 'Mix A' }, { uri: AL, name: 'LP', artist: 'Band' }],
  collections: { [PL]: { tracks: [track(1), track(2)], meta: { kind: 'playlist', name: 'Mix A', total: 2 } },
                 [AL]: { tracks: [track(3)], meta: { kind: 'album', name: 'LP', total: 1 } } },
  saved: { 'spotify:track:2': true },
  editable: [{ uri: MINE, name: 'Mine', editable: true }, { uri: OTHER, name: 'Other', editable: true }],
  membership: { 'spotify:track:1': { [MINE]: true } },            // Other: not in the answer (unknown)
});

async function setup(d: FakeData = data()) {
  h = await mountSkin('spotify', d);
  cmd = h.cmd;
  act(() => { S().actions.setView('library'); S().actions.setUi({ libNode: PL }); });
  await h.settle();
  return h;
}
const row = (n: number) => [...$('#mlrows')!.querySelectorAll('tr')][n - 1]!;

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('the tables', () => {
  it('each track row has the button (+, ✓ when saved; one batched ask); a click toggles Liked Songs without selecting or playing', async () => {
    await setup();
    expect([row(1).querySelector('[data-addto] button')!.getAttribute('aria-label'), row(2).querySelector('[data-addto] button')!.getAttribute('aria-label')]).toEqual(['Like', 'Unlike']);
    expect([row(1).querySelector('[data-addto] path')!.getAttribute('fill'), row(2).querySelector('[data-addto] path')!.getAttribute('fill')]).toEqual(['none', 'currentColor']);
    expect(h.queries.fetchSaved.mock.calls.filter((c) => c[0][0]!.startsWith('spotify:track:'))).toEqual([[['spotify:track:1', 'spotify:track:2']]]);
    const b = row(1).querySelector<HTMLElement>('[data-addto] button')!;
    expect(b.title).toBe('Like');
    fireEvent.click(b);
    fireEvent.doubleClick(b);
    expect(cmd.addTo.mock.calls[0]).toEqual(['spotify:track:1', LIKED, true]);
    expect([S().ui.libSel, cmd.playContext.mock.calls.length]).toEqual([null, 0]);
    // the ▾ is the selected row's alone
    expect(row(1).querySelector('[aria-label="Add to"]')).toBeNull();
    fireEvent.click(row(1));
    expect(row(1).querySelector('[aria-label="Add to"]')).not.toBeNull();
  });

  it('optimistic: the store\'s mark flips the button at once; a refusal rolls it back', async () => {
    await setup();
    cmd.addTo.mockImplementation((...a: unknown[]) => {
      const [uri, , on] = a as [string, string, boolean];
      S().actions.setSaved(uri, on);                                  // what the adapter does first
      return new Promise<void>((_r, reject) => setTimeout(() => { S().actions.setSaved(uri, null); reject(new Error('403')); }, 10));
    });
    const b = () => row(1).querySelector<HTMLElement>('[data-addto] button')!;
    fireEvent.click(b());
    expect([b().getAttribute('aria-label'), b().dataset.on]).toEqual(['Unlike', 'true']);
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect([b().getAttribute('aria-label'), b().dataset.on]).toEqual(['Like', undefined]);
  });
});

describe('the menu', () => {
  it('Liked Songs checked when saved; Add to playlist lists the editable playlists, asks membership only when it opens, toggles each', async () => {
    await setup();
    act(() => S().actions.setUi({ libSel: 'spotify:track:1' }));
    await h.settle();
    const box = $('#mlinfo [data-addto]')!;
    expect(box.querySelector('#daddto')!.getAttribute('aria-label')).toBe('Like');
    press(within(box).getByLabelText('Add to'));
    expect(labels(0)).toEqual(['Like', 'Add to playlist']);
    expect([h.queries.fetchEditablePlaylists.mock.calls.length, h.queries.fetchMembership.mock.calls.length]).toEqual([0, 0]);
    let answer: () => void = () => {};
    const real = h.queries.fetchEditablePlaylists.getMockImplementation()!;
    h.queries.fetchEditablePlaylists.mockImplementationOnce(() => new Promise((r) => { answer = () => r(real()); }));
    await openSub('Add to playlist');
    expect(labels(1)).toEqual(['…']);                                  // the playlists on their way
    await act(async () => { answer(); await Promise.resolve(); });
    await h.settle();
    expect(h.queries.fetchMembership.mock.calls).toEqual([['spotify:track:1', [MINE, OTHER]]]);
    expect(labels(1)).toEqual(['✓Mine', 'Other']);                     // Other unknown: unchecked, choosable
    expect(item(1, 'Other').dataset.disabled).toBeUndefined();
    fireEvent.click(item(1, 'Mine'));
    expect(cmd.addTo.mock.calls.at(-1)).toEqual(['spotify:track:1', MINE, false]);
    press(within(box).getByLabelText('Add to'));
    await openSub('Add to playlist');
    fireEvent.click(item(1, 'Other'));
    expect(cmd.addTo.mock.calls.at(-1)).toEqual(['spotify:track:1', OTHER, true]);
    // the store's membership mark wins over the answer
    act(() => S().actions.setMembership(MINE, 'spotify:track:1', false));
    press(within(box).getByLabelText('Add to'));
    await openSub('Add to playlist');
    expect(labels(1)).toEqual(['Mine', 'Other']);
    fireEvent.click(item(0, 'Like'));
    expect(cmd.addTo.mock.calls.at(-1)).toEqual(['spotify:track:1', LIKED, true]);
  });

  it('while membership is on its way the playlists are shown but not choosable (a click would add a second copy)', async () => {
    await setup();
    act(() => S().actions.setUi({ libSel: 'spotify:track:1' }));
    await h.settle();
    const box = $('#mlinfo [data-addto]')!;
    let answer: () => void = () => {};
    const real = h.queries.fetchMembership.getMockImplementation()!;
    h.queries.fetchMembership.mockImplementationOnce((...a: unknown[]) =>
      new Promise((r) => { answer = () => r((real as (...x: unknown[]) => Promise<Record<string, boolean>>)(...a)); }));
    press(within(box).getByLabelText('Add to'));
    await openSub('Add to playlist');
    await h.settle();
    expect(labels(1)).toEqual(['…', 'Mine', 'Other']);
    expect([item(1, 'Mine').dataset.disabled, item(1, 'Other').dataset.disabled]).toEqual(['', '']);
    fireEvent.click(item(1, 'Other'));
    expect(cmd.addTo.mock.calls.length).toBe(0);
    await act(async () => { answer(); await Promise.resolve(); });
    await h.settle();
    expect(labels(1)).toEqual(['✓Mine', 'Other']);
    expect([item(1, 'Mine').dataset.disabled, item(1, 'Other').dataset.disabled]).toEqual([undefined, undefined]);
  });

  it('a right-click on the button opens the same menu', async () => {
    await setup();
    act(() => S().actions.setUi({ libSel: 'spotify:track:2' }));
    await h.settle();
    fireEvent.contextMenu($('#daddto')!);
    expect(labels(0)).toEqual(['✓Like', 'Add to playlist']);
  });
});

describe('the playing track', () => {
  it('the Now Playing pane\'s row, the Play menu\'s entries and Ctrl+D act on it', async () => {
    await setup();
    act(() => S().actions.setPlayback({ status: 'playing', track: track(2), position: 0, at: Date.now() }));
    await h.settle();
    expect($('#paddto')!.getAttribute('aria-label')).toBe('Unlike');
    press($('#mtops [data-menu=play]')!);
    expect(item(0, 'Unlike').children[2]!.textContent).toBe('Ctrl+D');
    expect(item(0, 'Add to Playlist')).toBeDefined();
    press($('#mtops [data-menu=play]')!);
    h.key('d', { ctrlKey: true });
    await h.settle();
    expect(cmd.addTo.mock.calls.at(-1)).toEqual(['spotify:track:2', LIKED, false]);
    // not known yet: Ctrl+D asks first, then saves
    act(() => S().actions.setPlayback({ track: track(9) }));
    h.key('d', { ctrlKey: true });
    await h.settle();
    expect([h.queries.fetchSaved.mock.calls.some((c) => c[0][0] === 'spotify:track:9'), cmd.addTo.mock.calls.at(-1)])
      .toEqual([true, ['spotify:track:9', LIKED, true]]);
    // Help > Keyboard Shortcuts lists it
    act(() => S().actions.setUi({ dialog: 'keys' }));
    expect([...$('#keystable')!.querySelectorAll('tr')].map((r) => r.children[0]!.textContent)).toContain('Ctrl+D');
  });
});

describe('context mode', () => {
  it('a playlist / album has Save / Saved ✓ (the same command); Liked Songs has none', async () => {
    const d = data();
    d.saved[AL] = true;
    await setup(d);
    expect($('#dsave')!.textContent).toBe('Save');
    fireEvent.click($('#dsave')!);
    expect(cmd.addTo.mock.calls.at(-1)).toEqual([PL, LIKED, true]);
    act(() => S().actions.setUi({ libNode: AL }));
    await h.settle();
    expect($('#dsave')!.textContent).toBe('Saved ✓');
    fireEvent.click($('#dsave')!);
    expect(cmd.addTo.mock.calls.at(-1)).toEqual([AL, LIKED, false]);
    act(() => S().actions.setUi({ libNode: LIKED }));
    await h.settle();
    expect($('#dsave')).toBeNull();
  });
});
