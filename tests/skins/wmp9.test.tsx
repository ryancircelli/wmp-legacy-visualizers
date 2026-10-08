// The WMP 9 skin against a real store and spy commands (no adapter, no engine loop).
// The fetched data (library, home, radio) are fake query functions: tests/skins/harness.
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIKED, type Track } from '../../src/model';
import { announceHostUpdate } from '../../src/adapters/host';
import { LINKS } from '../../src/ui';
import { PRESETS } from '../../src/engine';
import { fakeData, mountSkinNow, settle, type FakeData } from './harness';

let h: ReturnType<typeof mountSkinNow>, cmd: typeof h.cmd;

/** menus and dialogs portal to the body, so `$` looks everything up in the document */
function setup(engine: 'local' | 'spotify' = 'local', data: FakeData = fakeData()) {
  h = mountSkinNow(engine, data);
  cmd = h.cmd;
  cmd.openLink.mockReturnValue(true);
  return h;
}
const S = () => h.S();
// Radix opens a menu on pointerdown (left button, no Ctrl), as a real click starts
const press = (el: HTMLElement) => fireEvent.pointerDown(el, { button: 0, ctrlKey: false, pointerType: 'mouse' });
const menu = (depth: number) => document.querySelector<HTMLElement>(`[role=menu][data-depth="${depth}"]`);
const item = (depth: number, label: string) =>
  [...menu(depth)!.querySelectorAll<HTMLElement>('[role^=menuitem]')].find((b) => b.children[1]!.textContent === label)!;
const track = (n: number, o: Partial<Track> = {}): Track =>
  ({ uri: 'spotify:track:' + n, title: 'Track ' + n, artist: 'Band', album: 'LP', duration: 125000, ctx: 'spotify:playlist:a', ...o });
const session = (o: object = {}) => act(() => S().actions.setPlayback({
  status: 'paused', source: 'host', track: track(1, { title: 'Song', duration: 130000 }), position: 65000, at: Date.now(),
  canSeek: true, canNext: true, canPrev: true, ...o }));

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('menus', () => {
  it('View > Visualizations > Bars and Waves > Fire Storm switches, closes and checks', () => {
    const { $ } = setup();
    press($('[data-menu=view]')!);
    expect([...menu(0)!.querySelectorAll<HTMLElement>('[role^=menuitem]')].map((b) => b.children[1]!.textContent))
      .toEqual(['Visualizations', 'Refresh Rate', 'Karaoke Highlight', 'Skin', 'Full Screen']);
    fireEvent.click(item(0, 'Visualizations'));
    fireEvent.click(item(1, 'Bars and Waves'));
    fireEvent.click(item(2, 'Fire Storm'));
    expect([S().vis.kind, S().vis.preset]).toEqual(['bars', 2]);
    expect(menu(0)).toBeNull();
    expect($('#vizlabel')!.textContent).toBe('Bars and Waves : Fire Storm');
    press($('[data-menu=view]')!);
    fireEvent.click(item(0, 'Visualizations'));
    fireEvent.click(item(1, 'Bars and Waves'));
    expect(item(2, 'Fire Storm').children[0]!.textContent).toBe('✓');
  });

  it('View > Skin lists the skins, this one checked, and switches', () => {
    const { $ } = setup();
    press($('[data-menu=view]')!);
    fireEvent.click(item(0, 'Skin'));
    expect(item(1, 'Windows Media Player 9 (Corporate)').children[0]!.textContent).toBe('✓');
    fireEvent.click(item(1, 'iPod nano'));
    expect(S().settings.skin).toBe('ipod');
  });

  it('keyboard: ArrowDown opens focused, arrows walk, Right opens a submenu, Left closes it, Escape closes all', async () => {
    const { $, key } = setup();
    fireEvent.keyDown($('[data-menu=view]')!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(item(0, 'Visualizations'));
    // keys go to the focused item, as a browser sends them; Radix moves focus on the next tick
    const keyOn = async (k: string) => {
      fireEvent.keyDown(document.activeElement!, { key: k });
      await act(() => new Promise((r) => setTimeout(r, 0)));
    };
    await keyOn('ArrowDown');
    expect(document.activeElement).toBe(item(0, 'Refresh Rate'));
    await keyOn('ArrowRight');
    expect(document.activeElement).toBe(item(1, 'As WMP (up to 30 fps)'));
    await keyOn('ArrowLeft');
    expect(menu(1)).toBeNull();
    key('Escape');
    expect(menu(0)).toBeNull();
    expect(S().ui.menu).toBeNull();
  });

  it('a click outside closes; the picker ▾ opens the visualizations', async () => {
    const { $ } = setup();
    press($('#vpick')!);
    expect([...menu(0)!.querySelectorAll<HTMLElement>('[role^=menuitem]')].map((b) => b.children[1]!.textContent)).toEqual(['Alchemy', 'Ambience', 'Bars and Waves', 'Battery', 'Particle', 'Plenoptic', 'Spikes']);   // by registry key: Particle is "Dotplane"
    await act(() => new Promise((r) => setTimeout(r, 0)));     // Radix listens for outside presses from the next tick
    press(document.body);
    expect(menu(0)).toBeNull();
  });

  it('the website\'s Help menu and About link the Windows downloads and GitHub; the apps\' do not', () => {
    const { $ } = setup();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const labels = () => {
      press($('#mtops [data-menu=help]')!);
      const r = [...menu(0)!.querySelectorAll('[role^=menuitem]')].map((b) => b.children[1]!.textContent);
      press($('#mtops [data-menu=help]')!);
      return r;
    };
    expect(labels()).toEqual(['Download WMP Spotify for Windows', 'Download the Alchemy Screensaver', 'Source Code on GitHub',
      'Check for Player Updates...', 'About Windows Media Player']);
    press($('#mtops [data-menu=help]')!);
    fireEvent.click(item(0, 'Download WMP Spotify for Windows'));
    expect(open).toHaveBeenCalledWith(LINKS.spotify, '_blank', 'noopener');
    act(() => S().actions.setUi({ dialog: 'about' }));
    expect([...document.querySelectorAll<HTMLAnchorElement>('#aboutlinks a')].map((x) => x.href))
      .toEqual([LINKS.spotify, LINKS.screensaver, LINKS.repo]);
    act(() => S().actions.setUi({ dialog: null }));
    act(() => S().actions.setAuth({ mode: 'screensaver' }));
    expect(labels()).toEqual(['Check for Player Updates...', 'About Windows Media Player']);
    open.mockRestore();
  });

  it('a newer exe: Help offers the download through the host, and the dialog asks at most once a day', () => {
    const { $ } = setup('spotify');
    const opened: string[] = [];
    window.alchemyOpenUrl = (u: string) => void opened.push(u);
    const labels = () => {
      press($('#mtops [data-menu=help]')!);
      const r = [...menu(0)!.querySelectorAll('[role^=menuitem]')].map((b) => b.children[1]!.textContent);
      press($('#mtops [data-menu=help]')!);
      return r;
    };
    act(() => S().actions.setAuth({ mode: 'app' }));
    expect(labels()).toEqual(['Keyboard Shortcuts', 'Check for Player Updates...', 'About Windows Media Player']);
    localStorage.removeItem('wmp.updateAsked');
    window.alchemyHostUpdate = true;
    act(() => announceHostUpdate(h.store));
    expect([S().auth.hostUpdate, S().ui.dialog]).toEqual([true, 'update']);
    expect($('#dlgUpdate')!.textContent).toContain('A newer version of WMP Spotify is available.');
    fireEvent.click(within($('#dlgUpdate')!).getByText('Download'));
    expect([opened, S().ui.dialog]).toEqual([[LINKS.spotify], null]);
    act(() => announceHostUpdate(h.store));
    expect(S().ui.dialog).toBeNull();                                  // asked today already
    expect(labels()[0]).toBe('Download the New Version...');
    press($('#mtops [data-menu=help]')!);
    fireEvent.click(item(0, 'Download the New Version...'));
    expect(opened).toEqual([LINKS.spotify, LINKS.spotify]);
    delete window.alchemyHostUpdate;
    delete window.alchemyOpenUrl;
  });

  it('Help > Check for Player Updates: latest, ready (Restart Now), a new exe (the download), or no answer', async () => {
    const { $ } = setup('spotify');
    act(() => S().actions.setAuth({ mode: 'app' }));
    const restarts: number[] = [];
    window.alchemyRestart = () => void restarts.push(1);
    const open = async (answer: object) => {
      cmd.checkForUpdates.mockResolvedValueOnce(answer);
      act(() => S().actions.setUi({ dialog: 'checkUpdates' }));
      await settle();
    };
    await open({ state: 'latest' });
    expect($('#checkmsg')!.textContent).toBe('You have the latest version of WMP Spotify.');
    fireEvent.click(within($('#dlgCheck')!).getByText('OK'));
    await open({ state: 'ready' });
    expect($('#checkmsg')!.textContent).toBe('A player update has been downloaded. Restart WMP Spotify to use it.');
    fireEvent.click(within($('#dlgCheck')!).getByText('Restart Now'));
    expect(restarts).toEqual([1]);
    act(() => S().actions.setUi({ dialog: null }));
    await open({ state: 'error', message: 'The update site could not be reached.' });
    expect($('#checkmsg')!.textContent).toBe('Could not check for updates. The update site could not be reached.');
    act(() => S().actions.setUi({ dialog: null }));
    await open({ state: 'app' });
    expect([S().ui.dialog, S().auth.hostUpdate]).toEqual(['update', true]);    // the download dialog takes over
    delete window.alchemyRestart;
  });

  it('Spotify: File, View, Play and Help carry the engine\'s entries and accelerators', () => {
    const { $ } = setup('spotify');
    const labels = (name: string) => {
      press($(`#mtops [data-menu=${name}]`)!);
      const r = [...menu(0)!.querySelectorAll('[role^=menuitem]')].map((b) => b.children[1]!.textContent + '|' + b.children[2]!.textContent);
      press($(`#mtops [data-menu=${name}]`)!);
      return r;
    };
    expect(labels('file')).toEqual(['Open Spotify Link...|', 'Exit|Alt+F4']);
    expect(labels('view')).toEqual(['Now Playing|Ctrl+1', 'Media Guide|Ctrl+2', 'Media Library|Ctrl+3', 'Search|Ctrl+4',
      'Radio Tuner|Ctrl+5', 'Visualizations|▶', 'Refresh Rate|▶', 'Karaoke Highlight|Ctrl+K', 'Task Pane|', 'Playlist Pane|', 'Details Pane|', 'Library View|▶',
      'Skin|▶', 'Full Screen|Alt+Enter']);
    expect(labels('play')).toEqual(['Play|Ctrl+P', 'Stop|Ctrl+S', 'Previous|Ctrl+B', 'Next|Ctrl+F', 'Shuffle|Ctrl+H', 'Repeat|▶',
      'Like|Ctrl+D', 'Add to Playlist|▶', 'Rewind|Ctrl+Shift+B', 'Fast Forward|Ctrl+Shift+F', 'Volume Up|F9', 'Volume Down|F8', 'Mute|F7']);
    expect(labels('help')).toEqual(['Keyboard Shortcuts|', 'Check for Player Updates...|', 'About Windows Media Player|']);
    // checks are real ARIA: toggles menuitemcheckbox, one-of-a-set menuitemradio, aria-checked; the ✓ stays
    const roles = (name: string) => {
      press($(`#mtops [data-menu=${name}]`)!);
      const r = [...menu(0)!.querySelectorAll<HTMLElement>('[role^=menuitem]')].map((b) =>
        b.children[1]!.textContent + ':' + b.getAttribute('role')!.replace('menuitem', '') + ':' + (b.getAttribute('aria-checked') ?? '-') + ':' + b.children[0]!.textContent);
      press($(`#mtops [data-menu=${name}]`)!);
      return r;
    };
    expect(roles('view').filter((x) => /^(Now Playing|Media Guide|Karaoke|Task|Details|Full|Visual)/.test(x))).toEqual([
      'Now Playing:radio:true:✓', 'Media Guide:radio:false:', 'Visualizations::-:', 'Karaoke Highlight:checkbox:true:✓',
      'Task Pane:checkbox:true:✓', 'Details Pane:checkbox:true:✓', 'Full Screen:checkbox:false:']);
    expect(roles('play').filter((x) => /^(Shuffle|Mute|Pause|Play)/.test(x))).toEqual(['Play::-:', 'Shuffle:checkbox:false:', 'Mute:checkbox:false:']);
    press($('#mtops [data-menu=play]')!);
    fireEvent.click(item(0, 'Repeat'));
    expect([...menu(1)!.querySelectorAll('[role=menuitemradio]')].map((b) => b.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    press($('#mtops [data-menu=play]')!);
    act(() => S().actions.setAuth({ canLogout: true }));
    expect(labels('file')).toEqual(['Open Spotify Link...|', 'Log Out of Spotify|', 'Exit|Alt+F4']);
  });
});

describe('transport', () => {
  it('the strip\'s buttons: Now Playing options menu, fit (both panes), full screen, playlist pane; the seam tab hides the task pane', async () => {
    const { $ } = setup();
    expect([S().settings.taskPane, S().settings.playlistPane]).not.toContain(false);
    fireEvent.click($('#vfit')!);
    expect([S().settings.taskPane, S().settings.playlistPane]).toEqual([false, false]);
    expect($('#vfit')!.dataset.on).toBe('true');
    fireEvent.click($('#vfit')!);
    expect([S().settings.taskPane, S().settings.playlistPane]).toEqual([true, true]);
    fireEvent.click($('#vpane')!);
    expect(S().settings.playlistPane).toBe(false);
    fireEvent.click($('#vpane')!);
    expect(S().settings.playlistPane).toBe(true);
    fireEvent.click($('#taskgrip')!);
    expect(S().settings.taskPane).toBe(false);
    act(() => S().actions.setSettings({ taskPane: true }));
    fireEvent.pointerDown($('#vopts')!, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    await act(() => new Promise((r) => setTimeout(r, 0)));
    const labels = [...document.querySelectorAll('[role=menu][data-depth="0"] [role^=menuitem]')].map((e) => e.textContent);
    expect(labels.some((l) => l.includes('Visualizations'))).toBe(true);
    expect(labels.some((l) => l.includes('Playlist Pane'))).toBe(true);
    expect(labels.some((l) => l.includes('Full Screen'))).toBe(true);
    expect($('#plfoot svg')).toBeNull();                               // the footer's decorative icon is gone
  });

  it('play, stop, mute, volume and the lyrics disc', () => {
    const { $ } = setup();
    expect($('#bplay')!.title).toBe('Play (share a tab or your screen)');
    fireEvent.click($('#bplay')!);
    expect(cmd.playPause).toHaveBeenCalledOnce();
    // nothing playing: Stop has nothing to act on (disabled, its glyph pale, as WMP 9's); Play and
    // Previous / Next (the visualizations) work
    expect([$('#bplay')!.dataset.disabled, $('#bstop')!.dataset.disabled, $('#bprev')!.dataset.disabled, $('#bnext')!.dataset.disabled])
      .toEqual([undefined, 'true', undefined, undefined]);
    fireEvent.click($('#bstop')!);
    expect(cmd.stop).not.toHaveBeenCalled();
    act(() => S().actions.setPlayback({ status: 'paused', track: { uri: 'x', title: 'T', artist: 'A', album: '', duration: 200000 }, canPrev: false }));
    expect([$('#bstop')!.dataset.disabled, $('#bprev')!.dataset.disabled]).toEqual([undefined, 'true']);   // a session refusing the skip back
    fireEvent.click($('#bstop')!);
    expect(cmd.stop).toHaveBeenCalledOnce();
    act(() => S().actions.setPlayback({ status: 'none', track: null, canPrev: true }));
    fireEvent.click($('#bmute')!);
    expect(S().settings.muted).toBe(true);
    expect($('#bmute')!.title).toBe('Unmute');
    expect($('#icslash')).not.toBeNull();
    const vol = () => ($('#vol') as HTMLInputElement).value;
    expect([vol(), S().settings.volume]).toEqual(['0', 100]);          // muted: the thumb at 0, the level kept
    fireEvent.click($('#bmute')!);
    expect([vol(), $('#icwave') !== null]).toEqual(['100', true]);     // unmuted: back to the level
    fireEvent.click($('#bmute')!);
    fireEvent.change($('#vol')!, { target: { value: '50' } });         // a drag while muted: that level, unmuted
    expect([S().settings.volume, S().settings.muted, vol(), $('#icslash')]).toEqual([50, false, '50', null]);
    // lyrics: a button on the strip under the screen, only while Now Playing shows and only where
    // lyrics exist (the desktop host fetches them; the website never has any)
    expect($('#blyrics')).toBeNull();
    act(() => S().actions.setAuth({ mode: 'app' }));
    expect($('#blyrics')!.title).toBe('Lyrics: On');
    fireEvent.click($('#blyrics')!);
    expect(S().settings.lyrics).toBe(false);
    expect([$('#blyrics')!.title, $('#blyrics')!.dataset.on]).toEqual(['Lyrics: Off', undefined]);
    // the repeat disc is decoration outside Spotify
    expect([$('#brepeat')!.title, $('#brepeat')!.getAttribute('aria-hidden')]).toEqual(['Repeat: Off', 'true']);
    fireEvent.click($('#brepeat')!);
    expect(cmd.cycleRepeat).not.toHaveBeenCalled();
  });

  it('Spotify: the repeat disc cycles and shows the mode; the lyrics button leaves with Now Playing', () => {
    const { $ } = setup('spotify');
    fireEvent.click($('#brepeat')!);
    expect(cmd.cycleRepeat).toHaveBeenCalledOnce();
    act(() => S().actions.setPlayback({ repeat: 'context' }));
    expect([$('#brepeat')!.title, $('#brepeat')!.dataset.on, $('#brepeat')!.dataset.repeat]).toEqual(['Repeat: Playlist', 'true', 'context']);
    act(() => S().actions.setPlayback({ repeat: 'track' }));
    expect([$('#brepeat')!.title, $('#brepeat')!.dataset.repeat]).toEqual(['Repeat: Track', 'track']);
    act(() => S().actions.setView('library'));
    expect($('#blyrics')).toBeNull();
    act(() => S().actions.setView('now'));
    expect($('#blyrics')).not.toBeNull();
    act(() => S().actions.setAuth({ mode: 'web' }));
  });

  it('Previous/Next walk the presets with no session, skip tracks with one', () => {
    const { $ } = setup();
    fireEvent.click($('#bnext')!);
    expect([S().vis.kind, S().vis.preset]).toEqual(['ambience', 0]);   // WMP's order: Ambience's key sorts after Alchemy's
    fireEvent.click($('#bprev')!);
    expect(S().vis.kind).toBe('alchemy');
    session();
    expect($('#bnext')!.title).toBe('Next track');
    fireEvent.click($('#bnext')!);
    fireEvent.click($('#bprev')!);
    expect([cmd.next.mock.calls.length, cmd.prev.mock.calls.length]).toEqual([1, 1]);
    expect(S().vis.kind).toBe('alchemy');
    fireEvent.click($('#vnext')!);             // the arrows under the screen still walk the presets
    expect(S().vis.kind).toBe('ambience');
  });

  it("the arrows walk WMP's flat list, wrapping, into a family's last preset going back; Shift steps the families", () => {
    const { $ } = setup();
    const at = () => S().vis.kind + ':' + S().vis.preset, last = PRESETS[PRESETS.length - 1]!;
    const lastOf = (vis: string) => vis + ':' + (PRESETS.filter((p) => p.vis === vis).length - 1);
    fireEvent.click($('#vprev')!);                                     // Alchemy, the first: wraps to the end
    expect(at()).toBe(last.vis + ':' + last.preset);
    fireEvent.click($('#vnext')!);
    expect(at()).toBe('alchemy:0');
    act(() => S().actions.setVis('particle', 0));
    fireEvent.click($('#vprev')!);                                     // out of Particle: Battery's last preset
    expect(at()).toBe(lastOf('battery'));
    fireEvent.click($('#vnext')!);
    expect(at()).toBe('particle:0');
    act(() => S().actions.setVis('battery', 3));
    fireEvent.click($('#vnext')!, { shiftKey: true });                 // next family, its first preset
    expect(at()).toBe('particle:0');
    fireEvent.click($('#vprev')!, { shiftKey: true });                 // previous family, its last preset
    expect(at()).toBe(lastOf('battery'));
    act(() => S().actions.setVis('alchemy', 0));
    fireEvent.click($('#vprev')!, { shiftKey: true });                 // wraps: the last family, its last preset
    expect(at()).toBe(last.vis + ':' + last.preset);
  });

  it('the clock: elapsed, a click for remaining, the length as its title; the seek thumb', () => {
    const { $ } = setup();
    expect($('#time')!.textContent).toBe('00:00');
    session();
    expect($('#time')!.textContent).toBe('01:05');
    expect($('#time')!.title).toBe('02:10');
    expect($('#seekthumb')!.style.getPropertyValue('--seek')).toBe('0.5');
    fireEvent.click($('#time')!);
    expect($('#time')!.textContent).toBe('-01:05');
    fireEvent.click($('#time')!);
    expect($('#time')!.textContent).toBe('01:05');
    act(() => S().actions.setPlayback({ status: 'none' }));
    expect($('#seekthumb')!.style.getPropertyValue('--seek')).toBe('');
  });

  it('keys: Space plays, Ctrl+L lyrics, D only with advanced settings, Spotify accelerators', () => {
    const { key } = setup('spotify');
    key(' ', { code: 'Space' });
    expect(cmd.playPause).toHaveBeenCalledOnce();
    key('l', { ctrlKey: true });
    expect(S().settings.lyrics).toBe(false);
    key('d');
    expect(S().settings.debug).toBe(false);
    act(() => S().actions.setSettings({ advanced: true }));
    key('d');
    expect(S().settings.debug).toBe(true);
    key('3', { ctrlKey: true });
    expect(S().ui.view).toBe('library');
    key('F7');
    expect(S().settings.muted).toBe(true);
    key('F8');
    expect([S().settings.volume, S().settings.muted]).toEqual([90, false]);
    key('b', { ctrlKey: true, shiftKey: true });
    expect(cmd.skip).toHaveBeenCalledWith(-10);
    key('t', { ctrlKey: true });
    expect(cmd.cycleRepeat).toHaveBeenCalledOnce();
  });
});

describe('views', () => {
  it('the task pane switches views; the screen hides and the engine is held off Now Playing', () => {
    const { $ } = setup('spotify');
    expect($('#tcd')).toBeNull();
    // the task pane's order (Play on Device is the transport's device button now)
    expect([...$('#tasklist')!.querySelectorAll('button')].map((b) => b.textContent))
      .toEqual(['Now Playing', 'Media Guide', 'Media Library', 'Search', 'Radio Tuner']);
    for (const [task, view] of [['#tguide', '#mguide'], ['#tradio', '#mradio'], ['#tsearch', '#msearch'], ['#tlib', '#mlib']] as const) {
      fireEvent.click($(task)!);
      expect($(view)).not.toBeNull();
      expect($('#screen')!.hidden).toBe(true);
      expect(S().vis.hold).toBe(true);
      expect($(task)!.dataset.on).toBe('true');
    }
    expect($('#npill')!.textContent).toBe('Media Library');
    fireEvent.click($('#tnow')!);
    expect($('#screen')!.hidden).toBe(false);
    expect(S().vis.hold).toBe(false);
  });

  it('local mode: the other tasks are disabled decorations, Copy from CD shown', () => {
    const { $ } = setup();
    expect(($('#tcd') as HTMLButtonElement).disabled).toBe(true);
    expect(($('#tlib') as HTMLButtonElement).disabled).toBe(true);
    expect([...$('#tasklist')!.querySelectorAll('button')].map((b) => b.textContent))
      .toEqual(['Now Playing', 'Media Guide', 'Copy from CD', 'Media Library', 'Radio Tuner', 'Copy to CD or Device']);
    expect($('#bdevice')).toBeNull();                         // no devices without Spotify
  });

  it('Media Library: the tree, Title|Artist|Album|Length, m:ss, double-click plays, Load more, Play all', async () => {
    const { $, queries } = setup('spotify', fakeData({
      list: [{ uri: 'spotify:playlist:a', name: 'Mix A' }, { uri: 'spotify:album:x', name: 'LP' }],
      collections: { 'spotify:playlist:a': { meta: { kind: 'playlist', name: 'Mix A', total: 5 }, tracks: [track(1), track(2)], total: 5 } } }));
    act(() => S().actions.setView('library'));
    await settle();
    expect([...$('#mlnodes')!.children].map((b) => b.textContent)).toEqual(['Playlists', 'Mix A', 'Albums', 'LP', 'Liked Songs']);
    expect($('#mlq')).toBeNull();                             // the search box is the Search view's
    expect([...$('#mltable')!.querySelectorAll('th')].map((t) => t.textContent).join('|')).toBe('|Title|Artist|Album|Length');
    expect($('#mltitle')!.textContent).toBe('Mix A');
    expect($('#mlcount')!.textContent).toBe('5 tracks');
    const rows = $('#mlrows')!.querySelectorAll('tr');
    expect(rows[0]!.querySelector('td:last-child')!.textContent).toBe('2:05');
    fireEvent.doubleClick(rows[1]!);
    expect(cmd.playContext).toHaveBeenCalledWith('spotify:playlist:a', 'spotify:track:2');
    fireEvent.click(rows[1]!);
    expect(S().ui.libSel).toBe('spotify:track:2');
    fireEvent.click(rows[2]!);                                  // the "Load more" row
    await settle();
    expect(queries.fetchCollectionPage).toHaveBeenLastCalledWith('spotify:playlist:a', 2);
    fireEvent.click($('#mlplay')!);
    expect(cmd.playAll).toHaveBeenCalledWith('spotify:playlist:a');
    fireEvent.click(within($('#mlnodes')!).getByText('Liked Songs'));
    expect(S().ui.libNode).toBe(LIKED);
  });

  it('Media Guide: a tile opens its playlist in the library, the corner ▶ plays it. Radio, devices', async () => {
    const { $ } = setup('spotify', fakeData({
      home: { greeting: '', sections: [{ title: 'Made for you', items: [{ uri: 'spotify:playlist:p', name: 'Daily', sub: 'x', img: null }] }] },
      stations: [{ uri: 'spotify:playlist:r', name: 'Band Radio' }] }));
    act(() => {
      const a = S().actions;
      a.setDevices([{ id: 'd1', name: 'Kitchen', type: 'Speaker' }, { id: 'me', name: 'Web Player', type: 'Computer', active: true }], 'me');
      a.setView('guide');
    });
    await settle();
    const tile = $('#mguide button')!;
    fireEvent.click(tile);
    expect([cmd.openInLibrary.mock.calls, cmd.playItem.mock.calls.length]).toEqual([[['spotify:playlist:p', 'Daily']], 0]);
    fireEvent.click(within(tile).getByText('▶'));
    expect([cmd.playItem.mock.calls.length, cmd.openInLibrary.mock.calls.length]).toEqual([1, 1]);
    act(() => S().actions.setView('radio'));
    await settle();
    fireEvent.click(within($('#mradio')!).getByTitle('Play Band Radio'));
    expect(cmd.playContext).toHaveBeenCalledWith('spotify:playlist:r', null);
    // Play on Device: the transport's device disc and its menu
    expect($('#bdevice')!.title).toBe('Play on Device: WMP Spotify (This Device)');
    fireEvent.pointerDown($('#bdevice')!, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    const devs = [...document.querySelectorAll<HTMLElement>('[role=menu] [role^=menuitem]')];
    expect(devs.map((d) => d.textContent)).toEqual(['Kitchen', '✓WMP Spotify (This Device)']);
    fireEvent.click(devs[1]!);
    expect(cmd.transfer).not.toHaveBeenCalled();
    fireEvent.pointerDown($('#bdevice')!, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.click([...document.querySelectorAll<HTMLElement>('[role=menu] [role^=menuitem]')][0]!);
    expect(cmd.transfer).toHaveBeenCalledWith('d1');
    act(() => S().actions.setDevices([{ id: 'd1', name: 'Kitchen', type: 'Speaker', active: true }, { id: 'me', name: 'Web Player', type: 'Computer' }], 'me'));
    expect([$('#bdevice')!.dataset.on, $('#bdevice')!.title]).toEqual(['true', 'Play on Device: Kitchen']);
  });
});

describe('lyrics', () => {
  const LINES = [{ t: 4000, text: 'First line' }, { t: 10000, text: 'Second line' }, { t: 16000, text: 'Third line' }];
  const words = ($: (s: string) => HTMLElement | null) => [...$('#lyrcur')!.querySelectorAll('span')].map((s) => s.dataset.k);

  it('karaoke: sung words gold, the current one filling through --f, the next line under it', () => {
    const { $ } = setup();
    act(() => S().actions.setLyrics({ status: 'synced', lines: LINES, plain: null, track: { title: 'Song', artist: 'Band' } }));
    session({ position: 5000 });
    expect($('#lyr')!.hidden).toBe(false);
    expect($('#lyrcur')!.textContent).toBe('First line');
    expect($('#lyrnext')!.textContent).toBe('Second line');
    // 'First line' spread over 1.92 s from 4 s: 'First' fills until 5.05 s, then 'line'
    expect(words($)).toEqual(['now', '']);
    expect($('#lyrcur span')!.style.getPropertyValue('--f')).toBe('96%');
    session({ position: 5500 });
    expect(words($)).toEqual(['sung', 'now']);
    session({ position: 12000 });
    expect($('#lyrcur')!.textContent).toBe('Second line');
    act(() => S().actions.setLyricsEnabled(false));
    expect($('#lyr')!.hidden).toBe(true);
  });

  it('karaoke off: the current line plain and lit (no word spans), the next line as before; Ctrl+K, Options and View flip it', () => {
    const { $, key } = setup();
    act(() => S().actions.setLyrics({ status: 'synced', lines: LINES, plain: null, track: { title: 'Song', artist: 'Band' } }));
    session({ position: 5000 });
    expect([words($).length, $('#lyr')!.dataset.karaoke]).toEqual([2, 'true']);
    key('k', { ctrlKey: true });
    expect([S().settings.karaoke, $('#lyrcur')!.textContent, $('#lyrcur')!.querySelectorAll('span').length, $('#lyr')!.dataset.karaoke])
      .toEqual([false, 'First line', 0, undefined]);
    expect($('#lyrnext')!.textContent).toBe('Second line');
    session({ position: 12000 });
    expect($('#lyrcur')!.textContent).toBe('Second line');
    act(() => S().actions.setUi({ dialog: 'options' }));
    const box = $('#karaoke') as HTMLInputElement;
    expect([box.checked, box.disabled]).toEqual([false, false]);
    fireEvent.click(box);
    expect([S().settings.karaoke, words($).length]).toEqual([true, 2]);
    act(() => S().actions.setLyricsEnabled(false));
    expect(($('#karaoke') as HTMLInputElement).disabled).toBe(true);     // nothing to highlight without lyrics
    act(() => S().actions.setUi({ dialog: null }));
    fireEvent.pointerDown($('#mtops [data-menu=view]')!, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.click(item(0, 'Karaoke Highlight'));
    expect(S().settings.karaoke).toBe(false);
  });

  it('enhanced LRC word stamps win over the estimate', () => {
    const { $ } = setup();
    act(() => S().actions.setLyrics({ status: 'synced', track: null, plain: null,
      lines: [{ t: 0, text: 'a b', words: [{ t: 0, text: 'a' }, { t: 3000, text: 'b' }] }] }));
    session({ position: 2000 });
    expect(words($)).toEqual(['now', '']);
    session({ position: 3100 });
    expect(words($)).toEqual(['sung', 'now']);
  });

  it('plain lyrics are a block in the pane; lyrics for another track never show', () => {
    const { $ } = setup();
    act(() => S().actions.setLyrics({ status: 'plain', lines: null, plain: 'la la\nla la la', track: { title: 'Song', artist: 'Band' } }));
    session();
    expect($('#pllyr')!.hidden).toBe(false);
    expect($('#pllyr')!.textContent).toBe('la la\nla la la');
    act(() => S().actions.setLyrics({ status: 'plain', lines: null, plain: 'x', track: { title: 'Other', artist: 'Band' } }));
    expect($('#pllyr')!.hidden).toBe(true);
  });
});

describe('dialogs', () => {
  it('Help > Keyboard Shortcuts lists README\'s keys; Escape closes it', () => {
    const { $, key } = setup('spotify');
    press($('#mtops [data-menu=help]')!);
    fireEvent.click(item(0, 'Keyboard Shortcuts'));
    const rows = [...$('#keystable')!.querySelectorAll('tr')].map((r) => r.children[0]!.textContent);
    expect(rows).toContain('Ctrl+Shift+B');
    expect(rows).toHaveLength(20);
    expect($('#modal')!.hidden).toBe(false);
    key('Escape');
    expect($('#modal')!.hidden).toBe(true);
  });

  it('Options: the advanced tab, live settings, Cancel restores', () => {
    const { $ } = setup();
    press($('#mtops [data-menu=tools]')!);
    fireEvent.click(item(0, 'Options...'));
    expect($('#tabAdv')).toBeNull();
    fireEvent.click($('#advanced')!);
    fireEvent.click($('#tabAdv')!);
    fireEvent.change($('#fps')!, { target: { value: '30' } });
    fireEvent.change($('#scale')!, { target: { value: '0.25' } });
    expect([S().settings.fps, S().settings.scale]).toEqual([30, 0.25]);
    expect($('#scale option[value=original]')!.textContent).toBe('Original 640x480');
    fireEvent.click($('#optCancel')!);
    expect([S().settings.fps, S().settings.scale, S().settings.advanced]).toEqual(['wmp', 'original', false]);
    expect($('#modal')!.hidden).toBe(true);
  });

  it('Open Spotify Link: a bad link says so, a good one closes', () => {
    const { $ } = setup('spotify');
    cmd.openLink.mockReturnValueOnce(false);
    act(() => S().actions.setUi({ dialog: 'link' }));
    fireEvent.change($('#linkq')!, { target: { value: 'nope' } });
    fireEvent.keyDown($('#linkq')!, { key: 'Enter' });
    expect($('#linkerr')!.textContent).toMatch(/not a Spotify/);
    fireEvent.change($('#linkq')!, { target: { value: 'spotify:album:x' } });
    fireEvent.click(screen.getByText('OK'));
    expect(cmd.openLink).toHaveBeenLastCalledWith('spotify:album:x');
    expect(S().ui.dialog).toBeNull();
  });
});

describe('chrome', () => {
  it('the host ids, bare, and the panes', () => {
    const { $ } = setup('spotify');
    expect($('#chrome')).not.toBeNull();
    expect($('#titlebar')).not.toBeNull();
    act(() => S().actions.setUi({ bare: true }));
    expect($('#chrome')!.dataset.bare).toBe('true');
    // the host draws the title bar itself (window.alchemyNativeTitle): the skin's hides
    expect($('#chrome')!.dataset.nativetitle).toBeUndefined();
    act(() => S().actions.setAuth({ nativeTitle: true }));
    expect($('#chrome')!.dataset.nativetitle).toBe('true');
    act(() => S().actions.setSettings({ playlistPane: false }));
    expect($('#chrome')!.dataset.nopl).toBe('true');
    fireEvent.click($('#tpcollapse')!);
    expect(S().settings.taskPane).toBe(false);
    expect($('#chrome')!.dataset.notask).toBe('true');
  });

  it('the Spotify pane: now playing, up next, playlists open and play; where it plays from is the line under the song info', async () => {
    const { $, queries } = setup('spotify', fakeData({
      list: [{ uri: 'spotify:playlist:a', name: 'Mix A' }], collections: { 'spotify:playlist:a': { tracks: [track(7)] } } }));
    act(() => {
      const a = S().actions;
      a.setQueue([track(2)]);
      a.setPlayback({ status: 'playing', track: track(1), from: 'Playlist: Mix A', position: 0, at: Date.now(),
                      context: { uri: 'spotify:playlist:a', kind: 'playlist', label: 'Playlist: Mix A' } });
    });
    await settle();
    const lib = $('#spLib')!;
    expect([...lib.children].map((e) => e.textContent)).toEqual(['Now Playing', 'Track 1 – Band▾',
      'Up Next', 'Track 2 – Band', 'Playlists', '▸ Mix A', 'Liked Songs']);
    expect($('#spq')).toBeNull();                              // search is the Search view's alone
    // where it plays from: the italic line under the song info (no group of its own), a link
    expect($('#plfrom')!.textContent).toBe('Playlist: Mix A');
    expect(within(lib).queryByText('Playlist: Mix A')).toBeNull();
    fireEvent.click($('#plfrom')!);
    expect(cmd.openFrom).toHaveBeenCalledOnce();
    fireEvent.click(within(lib).getByText('▸ Mix A'));
    await settle();
    expect(queries.fetchCollectionPage).toHaveBeenCalledWith('spotify:playlist:a', 0);
    expect(within(lib).getAllByText('Track 7 – Band')).toHaveLength(1);
    fireEvent.click(within(lib).getAllByText('Track 7 – Band')[0]!);
    expect(cmd.playContext).toHaveBeenCalledWith('spotify:playlist:a', 'spotify:track:7');
    fireEvent.click($('#plalbum')!);
    expect(cmd.openAlbum).toHaveBeenCalledOnce();
    expect($('#plart')!.title).toBe('Show in Media Library');
  });
});
