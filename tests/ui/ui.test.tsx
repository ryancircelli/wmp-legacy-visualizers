// src/ui's headless pieces on their own: a bare harness (no skin, no classes) over a real store
// with spy commands, so what is tested is the shared behaviour a second skin would inherit.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeShell } from '../../src/app/App';
import { createQueryClient } from '../../src/app/query';
import type { Ticker } from '../../src/app/ticker';
import { createAppStore, noCommands, type AppStore, type Commands, type Track } from '../../src/model';
import {
  clockText, Clock, deviceName, Dialog, DialogHost, Dropdown, useDevices, Karaoke, ListTable, MenuBar, runShortcut,
  seekFraction, SeekBar, ShellContext, Slider, StationList, TaskList, Tiles, TransportButton, Tree, useMenus, ViewHost,
  scrub, type MenuClasses, type Shell, type Shortcut,
} from '../../src/ui';

const ticker = { nativeSize: () => [640, 480], debugText: () => '' } as unknown as Ticker;
const CLS: MenuClasses = { content: '', item: '', check: '', label: '', accel: '', sep: '' };
let store: AppStore, sh: Shell, cmd: { [K in keyof Commands]: ReturnType<typeof vi.fn> };

function mount(ui: ReactNode, o: { engine?: 'local' | 'spotify'; portal?: HTMLElement | ShadowRoot; shortcuts?: Shortcut[] } = {}) {
  store = createAppStore({ persist: false });
  // commands answer as the adapters' do: a promise (transport) or nothing
  cmd = Object.fromEntries(Object.keys(noCommands).map((k) => [k, vi.fn(() => Promise.resolve())])) as never;
  store.getState().actions.setCommands(cmd as unknown as Commands);
  store.getState().actions.setAuth({ engine: o.engine ?? 'local', mode: 'web', loggedIn: true });
  sh = makeShell(store, ticker, o.portal, o.shortcuts);
  return render(<ShellContext.Provider value={sh}>{ui}</ShellContext.Provider>);
}
const S = () => store.getState();
const $ = (sel: string, root: ParentNode = document) => root.querySelector<HTMLElement>(sel);
const press = (el: Element) => fireEvent.pointerDown(el, { button: 0, ctrlKey: false, pointerType: 'mouse' });
const tick = () => act(() => new Promise((r) => setTimeout(r, 0)));
const track = (n: number, o: Partial<Track> = {}): Track =>
  ({ uri: 'spotify:track:' + n, title: 'T' + n, artist: 'A', album: 'L', duration: 100000, ...o });
const session = (o: object = {}) => act(() => S().actions.setPlayback({
  status: 'paused', source: 'host', track: track(1), position: 25000, at: Date.now(), canSeek: true, ...o }));

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); scrub.setState({ ms: null }); });

describe('selectors', () => {
  it('seekFraction, clockText, deviceName', () => {
    const st = createAppStore({ persist: false }), a = st.getState().actions;
    expect(seekFraction(st.getState())).toBe(-1);
    a.setPlayback({ status: 'paused', track: track(1), position: 25000, at: 0 });
    expect(seekFraction(st.getState())).toBe(0.25);
    expect(clockText(st.getState())).toBe('00:25');
    a.setSettings({ remaining: true });
    expect(clockText(st.getState())).toBe('-01:15');
    expect(deviceName({ id: 'abcdef123', name: 'abcdef123', type: 'speaker' })).toBe('Speaker abcdef');
    expect(deviceName({ id: 'x', name: 'Kitchen' })).toBe('Kitchen');
  });
});

describe('Slider', () => {
  const box = (el: HTMLElement) => { el.getBoundingClientRect = () => ({ left: 0, width: 121, top: 0, height: 10 }) as DOMRect; };
  it('a press previews, a drag follows, the release commits (the thumb centre follows the pointer)', () => {
    const commit = vi.fn();
    mount(<Slider value={0.1} inset={10.5} onCommit={commit} id="t" thumbId="th" />);
    const t = $('#t')!;
    box(t);
    expect($('#th')!.style.getPropertyValue('--seek')).toBe('0.1');
    fireEvent.pointerDown(t, { button: 0, clientX: 60.5, pointerId: 1 });
    expect($('#th')!.style.getPropertyValue('--seek')).toBe('0.5');
    fireEvent.pointerMove(t, { clientX: 500 });
    expect($('#th')!.style.getPropertyValue('--seek')).toBe('1');
    fireEvent.pointerUp(t);
    expect(commit).toHaveBeenCalledWith(1);
    expect($('#th')!.style.getPropertyValue('--seek')).toBe('0.1');
  });
  it('disabled, right button, cancel, and -1 (no position)', () => {
    const commit = vi.fn();
    const r = mount(<Slider value={-1} inset={0} disabled onCommit={commit} id="t" thumbId="th" />);
    box($('#t')!);
    fireEvent.pointerDown($('#t')!, { button: 0, clientX: 10 });
    fireEvent.pointerUp($('#t')!);
    expect(commit).not.toHaveBeenCalled();
    expect($('#th')!.style.getPropertyValue('--seek')).toBe('');
    r.rerender(<ShellContext.Provider value={sh}><Slider value={0} inset={0} onCommit={commit} id="t" thumbId="th" /></ShellContext.Provider>);
    box($('#t')!);
    fireEvent.pointerDown($('#t')!, { button: 2, clientX: 10 });
    fireEvent.pointerDown($('#t')!, { button: 0, clientX: 10 });
    fireEvent.pointerCancel($('#t')!);
    fireEvent.pointerUp($('#t')!);
    expect(commit).not.toHaveBeenCalled();
  });
});

describe('transport', () => {
  it('the clock asks for frames only while playing; paused, a store change still shows', () => {
    let queue: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => queue.push(f));
    vi.stubGlobal('cancelAnimationFrame', () => { queue = []; });
    try {
      mount(<Clock id="c" />, { engine: 'spotify' });
      session();                                              // paused at 00:25
      expect(queue).toHaveLength(0);
      session({ position: 61000 });                           // a seek while paused
      expect($('#c')!.textContent).toBe('01:01');
      session({ status: 'playing' });
      expect(queue.length).toBeGreaterThan(0);
      session();
      expect(queue).toHaveLength(0);
    } finally { vi.unstubAllGlobals(); }
  });
  it('SeekBar: holding pauses, the thumb and the clock follow, the release seeks then resumes; Escape cancels', async () => {
    const order: string[] = [];
    let seekDone: () => void = () => {};
    mount(<><SeekBar rewind="<" forward=">" pillClassName="pill" track={{ id: 't', thumbId: 'th', inset: 0 }} /><Clock id="c" /></>, { engine: 'spotify' });
    for (const k of ['pause', 'play'] as const) cmd[k].mockImplementation(() => { order.push(k); });
    cmd.seek.mockImplementation(((ms: number) => { order.push('seek ' + ms); return new Promise<void>((r) => { seekDone = r; }); }) as never);
    session({ status: 'playing' });
    expect($('#th')!.style.getPropertyValue('--seek')).toBe('0.25');
    $('#t')!.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 10 }) as DOMRect;
    fireEvent.pointerDown($('#t')!, { button: 0, clientX: 50 });
    expect(order).toEqual(['pause']);                         // at once, and no seek while held
    fireEvent.pointerMove($('#t')!, { clientX: 60 });
    expect([$('#th')!.style.getPropertyValue('--seek'), $('#c')!.textContent]).toEqual(['0.6', '01:00']);
    fireEvent.pointerUp($('#t')!);
    expect(order).toEqual(['pause', 'seek 60000']);           // resume waits for the seek
    await act(async () => { seekDone(); await Promise.resolve(); });
    expect(order).toEqual(['pause', 'seek 60000', 'play']);
    expect([$('#th')!.style.getPropertyValue('--seek'), $('#c')!.textContent]).toEqual(['0.6', '01:00']);   // held until the state says
    session({ status: 'playing', position: 61000 });
    expect($('#c')!.textContent).toBe('01:01');
    order.length = 0;
    fireEvent.pointerDown($('#t')!, { button: 0, clientX: 10 });
    fireEvent.keyDown($('#t')!, { key: 'Escape' });
    fireEvent.pointerUp($('#t')!);
    expect(order).toEqual(['pause', 'play']);                 // cancelled: no seek
    fireEvent.keyDown($('#t')!, { key: 'ArrowRight' });
    expect([cmd.skip.mock.calls.at(-1), order]).toEqual([[5], ['pause', 'play']]);   // ±5 s, no pause
    fireEvent.click(screen.getByTitle('Rewind 10 seconds'));
    expect(cmd.skip).toHaveBeenCalledWith(-10);
  });
  it('SeekBar paused: no pause and no resume around the seek', () => {
    mount(<SeekBar rewind="<" forward=">" track={{ id: 't', thumbId: 'th', inset: 0 }} />);
    session();
    $('#t')!.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 10 }) as DOMRect;
    fireEvent.pointerDown($('#t')!, { button: 0, clientX: 50 });
    fireEvent.pointerUp($('#t')!);
    expect([cmd.pause.mock.calls.length, cmd.seek.mock.calls, cmd.play.mock.calls.length]).toEqual([0, [[50000]], 0]);
  });
  it('TransportButton: titles and lit state follow the store; the discs are spans', () => {
    mount(<>
      <TransportButton action="play" id="p">{(on) => (on ? 'pause' : 'play')}</TransportButton>
      <TransportButton action="mute" id="m" className={(on) => (on ? 'lit' : 'dim')}>m</TransportButton>
      <TransportButton action="shuffle" id="s">s</TransportButton>
      <TransportButton action="next" id="n">n</TransportButton>
    </>);
    expect([$('#p')!.title, $('#p')!.textContent]).toEqual(['Play (share a tab or your screen)', 'play']);
    session({ status: 'playing' });
    expect([$('#p')!.title, $('#p')!.textContent, $('#p')!.dataset.on]).toEqual(['Pause', 'pause', 'true']);
    fireEvent.click($('#m')!);
    expect([S().settings.muted, $('#m')!.className, $('#m')!.title]).toEqual([true, 'lit', 'Unmute']);
    expect([$('#s')!.tagName, $('#s')!.getAttribute('aria-hidden')]).toEqual(['SPAN', 'true']);
    fireEvent.click($('#s')!);
    expect(cmd.toggleShuffle).not.toHaveBeenCalled();         // decoration outside Spotify
    expect($('#n')!.title).toBe('Next track');
  });
  it('Clock: elapsed, a click for remaining, the length as its title', () => {
    mount(<Clock id="c" />);
    session();
    expect([$('#c')!.textContent, $('#c')!.title]).toEqual(['00:25', '01:40']);
    fireEvent.click($('#c')!);
    expect($('#c')!.textContent).toBe('-01:15');
  });
  it('Karaoke: word states, the fill, the next line', () => {
    mount(<Karaoke id="k" ids={{ cur: 'cur', next: 'next' }} classes={{ sung: 'sung', now: 'now' }} />);
    act(() => S().actions.setLyrics({ status: 'synced', plain: null, track: null,
      lines: [{ t: 0, text: 'a b', words: [{ t: 0, text: 'a' }, { t: 2000, text: 'b' }] }, { t: 10000, text: 'next one' }] }));
    session({ position: 1000 });
    const spans = () => [...$('#cur')!.querySelectorAll('span')].map((x) => x.className + ':' + x.dataset.k);
    expect(spans()).toEqual(['now:now', ':']);
    expect($('#cur span')!.style.getPropertyValue('--f')).toBe('50%');
    expect($('#next')!.textContent).toBe('next one');
    session({ position: 2500 });
    expect(spans()).toEqual(['sung:sung', 'now:now']);
  });
});

describe('menus', () => {
  const Bar = () => (
    <MenuBar classes={CLS} id="bar" listId="list" burger={{ id: 'burger' }}
             menus={[['a', 'A', () => [{ label: 'One', accel: 'Ctrl+1', act: () => S().actions.setUi({ status: 'one' }) }, { sep: true },
                                          { label: 'Sub', sub: [{ label: 'Deep', check: true }] }]],
                     ['b', 'B', () => [{ label: 'Two' }]]]} />
  );
  it('data-driven items: check, label, accelerator; a choice acts and closes', () => {
    mount(<Bar />);
    press($('[data-menu=a]')!);
    expect(S().ui.menu).toBe('top:a');
    const items = [...document.querySelectorAll('[role=menu][data-depth="0"] [role^=menuitem]')];
    expect(items.map((i) => [...i.children].map((c) => c.textContent).join('|'))).toEqual(['|One|Ctrl+1', '|Sub|▶']);
    fireEvent.click(items[1]!);
    expect($('[role=menu][data-depth="1"] [role^=menuitem]')!.textContent).toBe('✓Deep');
    fireEvent.click(items[0]!);
    expect([S().ui.status, S().ui.menu, $('[role=menu]')]).toEqual(['one', null, null]);
  });
  it('a press on the open menu\'s button closes it; the burger shows the list and cascades menus to the side', async () => {
    mount(<Bar />);
    press($('[data-menu=a]')!);
    press($('[data-menu=a]')!);
    expect(S().ui.menu).toBeNull();
    fireEvent.click($('#burger')!);
    expect([S().ui.menu, $('#bar')!.dataset.open]).toEqual(['burger', 'true']);
    press($('[data-menu=b]')!);
    expect(S().ui.menu).toBe('side:b');
    await tick();
    // the burger is an opener: a press on it is not "outside", its click closes everything
    press($('#burger')!);
    expect(S().ui.menu).toBe('side:b');
    fireEvent.click($('#burger')!);
    expect(S().ui.menu).toBeNull();
  });
  it('the burger list closes on a click elsewhere; Dropdown owns one owner and ignores a late close', () => {
    function Late() { const m = useMenus(); return <button id="late" onClick={() => m.close('pick')}>late</button>; }
    mount(<><Bar /><Dropdown owner="pick" items={() => [{ label: 'X' }]} classes={CLS}><button id="pick">v</button></Dropdown><Late /></>);
    fireEvent.click($('#burger')!);
    fireEvent.click(document.body);
    expect(S().ui.menu).toBeNull();
    press($('#pick')!);
    expect([S().ui.menu, $('[role=menu] [role^=menuitem]')!.textContent]).toEqual(['pick', 'X']);
    act(() => S().actions.setUi({ menu: 'top:a' }));       // another opener took over
    fireEvent.click($('#late')!);
    expect(S().ui.menu).toBe('top:a');
  });
  it('content portals into the shell\'s container (a shadow root under Spotify)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    mount(<Bar />, { portal: shadow });
    press($('[data-menu=a]')!);
    expect([$('[role=menu]'), !!shadow.querySelector('[role=menu][data-ui-root]')]).toEqual([null, true]);
    host.remove();
  });
});

describe('dialogs', () => {
  function Body() {
    return <Dialog id="d" title="Title" label="Lbl" classes={{ title: '', titleText: '', close: 'x', buttons: '', button: '' }}
                   buttons={[['OK', () => S().actions.setUi({ dialog: null }), 'ok']]}><input id="field" /></Dialog>;
  }
  it('DialogHost shows ui.dialog\'s body over a backdrop; ✕, OK, the backdrop and Escape close', async () => {
    mount(<DialogHost id="modal" dialogs={{ one: Body }} />);
    expect($('#modal')!.hidden).toBe(true);
    for (const close of [() => fireEvent.click($('.x')!), () => fireEvent.click($('#ok')!), () => fireEvent.click($('#modal')!),
                         () => fireEvent.keyDown(document.activeElement!, { key: 'Escape' })]) {
      act(() => S().actions.setUi({ dialog: 'one' }));
      await tick();
      expect([$('#modal')!.hidden, $('#d')!.getAttribute('role'), $('#d')!.getAttribute('aria-label')]).toEqual([false, 'dialog', 'Lbl']);
      expect(document.activeElement).toBe($('.x'));            // the first control takes focus
      close();
      expect(S().ui.dialog).toBeNull();
    }
    act(() => S().actions.setUi({ dialog: 'none-such' }));
    expect($('#modal')!.hidden).toBe(true);
  });
});

describe('lists', () => {
  it('ListTable: columns, m:ss, select, double-click, Load more, scroll reset', () => {
    const on = { select: vi.fn(), activate: vi.fn(), more: vi.fn() };
    const rows = [track(1, { duration: 65000 }), track(2)];
    const r = mount(<ListTable rows={rows} selected="spotify:track:2" now="spotify:track:1" onSelect={on.select} onActivate={on.activate}
                               more={{ label: 'Load more', load: on.more }} id="scroll" bodyId="body" resetKey="a" />);
    expect([...document.querySelectorAll('th')].map((t) => t.textContent)).toEqual(['Title', 'Artist', 'Album', 'Length']);
    const tr = $('#body')!.querySelectorAll('tr');
    expect([tr[0]!.lastChild!.textContent, tr[0]!.dataset.now, tr[1]!.dataset.sel, tr[0]!.firstElementChild!.getAttribute('title')])
      .toEqual(['1:05', 'true', 'true', 'T1']);
    fireEvent.click(tr[0]!);
    fireEvent.doubleClick(tr[1]!);
    fireEvent.click(tr[2]!);
    expect([on.select.mock.calls[0]![0], on.activate.mock.calls[0]![0], on.more.mock.calls.length]).toEqual([rows[0], rows[1], 1]);
    $('#scroll')!.scrollTop = 50;
    r.rerender(<ShellContext.Provider value={sh}><ListTable rows={rows} selected={null} now={null} onSelect={on.select}
               onActivate={on.activate} more={null} id="scroll" resetKey="b" /></ShellContext.Provider>);
    expect($('#scroll')!.scrollTop).toBe(0);
  });
  it('Tree, TaskList, ViewHost', () => {
    const pick = vi.fn();
    mount(<>
      <Tree nodes={[{ key: 'h', label: 'Head', target: null, top: true }, { key: 'n', label: 'Node', target: 'u', top: false }]}
            selected="u" onSelect={pick} id="tree" />
      <TaskList tasks={[{ view: 'now', id: 'tn', label: 'Now' }, { view: 'radio', id: 'tr', label: 'Radio' }]} />
      <ViewHost views={{ radio: () => <div id="radioview" /> }} />
    </>, { engine: 'spotify' });
    const [h, n] = [...$('#tree')!.children] as HTMLElement[];
    expect([h!.dataset.top, h!.dataset.on, n!.dataset.on]).toEqual(['true', undefined, 'true']);
    fireEvent.click(h!);
    fireEvent.click(n!);
    expect(pick.mock.calls).toEqual([['u']]);
    expect($('#tn')!.dataset.on).toBe('true');
    fireEvent.click($('#tr')!);
    expect([S().ui.view, S().vis.hold, $('#tr')!.dataset.on, !!$('#radioview')]).toEqual(['radio', true, 'true', true]);
    act(() => S().actions.setUi({ bare: true }));          // full screen is always the visualizer
    expect($('#radioview')).toBeNull();
  });
  it('Tiles, StationList, the device menu', () => {
    const sections = [{ title: 'S', items: [{ uri: 'spotify:album:x', name: 'Al', sub: '', img: null },
                                            { uri: 'spotify:track:y', name: 'Tr', sub: '', img: null },
                                            { uri: 'spotify:artist:z', name: 'Ar', sub: '', img: null }] }];
    const r = mount(<StationList stations={null} classes={{ empty: 'empty' }} />, { engine: 'spotify' });
    expect($('.empty')).toBeNull();                         // stations null = still tuning
    r.rerender(<ShellContext.Provider value={sh}>
      <Tiles sections={sections} classes={{ tile: 'tile', play: 'play' }} />
      <StationList stations={[]} classes={{ empty: 'empty' }} />
      <Devices />
    </ShellContext.Provider>);
    act(() => {
      const a = S().actions;
      a.setDevices([{ id: 'd1', name: 'TV', type: 'TV' }, { id: 'd2', name: 'Here', type: 'Computer', active: true }], 'd2');
    });
    const tiles = document.querySelectorAll('.tile');
    expect([tiles[0]!.querySelector('.play')!.textContent, tiles[1]!.querySelector('.play')]).toEqual(['▶', null]);
    fireEvent.click(tiles[0]!);                             // a click opens (album → the library, artist → its page)
    expect(cmd.openInLibrary).toHaveBeenCalledWith('spotify:album:x', 'Al');
    fireEvent.click(tiles[2]!);
    expect(cmd.openArtist).toHaveBeenCalledWith('spotify:artist:z');
    fireEvent.click(tiles[0]!.querySelector('.play')!);     // the corner plays where it stands
    fireEvent.keyDown(tiles[2]!, { key: 'Enter', ctrlKey: true });
    expect(cmd.playItem.mock.calls.map((c) => (c[0] as { uri: string }).uri)).toEqual(['spotify:album:x', 'spotify:artist:z']);
    expect(cmd.openInLibrary).toHaveBeenCalledOnce();
    act(() => S().actions.setPlayback({ context: { uri: 'spotify:album:x', kind: 'album', label: 'Album: Al' }, status: 'playing' }));
    const corner = tiles[0]!.querySelector<HTMLElement>('.play')!;
    expect([corner.textContent, corner.dataset.current, tiles[0]!.getAttribute('data-current')]).toEqual(['❚❚', 'true', 'true']);
    fireEvent.click(corner);                                // ❚❚ pauses the playing context
    expect(cmd.playPause).toHaveBeenCalledOnce();
    expect(cmd.playItem).toHaveBeenCalledTimes(2);
    fireEvent.click(tiles[1]!);                             // a track tile plays
    expect(cmd.playItem).toHaveBeenCalledTimes(3);
    expect($('.empty')!.textContent).toMatch(/No stations/);
    expect($('#dev')!.title).toBe('Play on Device: WMP Spotify (This Device)');
    press($('#dev')!);
    const items = [...document.querySelectorAll<HTMLElement>('[role=menu] [role^=menuitem]')];
    expect(items.map((i) => [...i.children].map((c) => c.textContent).join('|'))).toEqual(['|TV|', '✓|WMP Spotify (This Device)|']);
    expect(items[0]!.querySelector('.icon-tv')).not.toBeNull();
    fireEvent.click(items[0]!);
    expect(cmd.transfer.mock.calls).toEqual([['d1']]);
    act(() => S().actions.setDevices([{ id: 'd1', name: 'TV', type: 'TV', active: true }, { id: 'd3', name: 'Car', offline: true }], 'd2'));
    expect([$('#dev')!.title, $('#dev')!.dataset.on]).toEqual(['Play on Device: TV', 'true']);
    press($('#dev')!);
    const car = [...document.querySelectorAll<HTMLElement>('[role=menu] [role^=menuitem]')][1]!;
    expect([car.textContent, car.dataset.disabled]).toEqual(['Device d3 · offline'.replace('Device d3', 'Car'), '']);
  });
});

function Devices() {
  const d = useDevices((k) => 'icon-' + k);
  return <Dropdown owner="devices" items={d.items} classes={CLS}><button id="dev" title={d.title} data-on={d.elsewhere || undefined}>d</button></Dropdown>;
}

describe('shortcuts', () => {
  it('the WMP 9 table by default, a skin\'s own table when it brings one', () => {
    mount(<div />);
    const key = (k: string, o: KeyboardEventInit = {}) => runShortcut(sh, new KeyboardEvent('keydown', { key: k, cancelable: true, ...o }));
    expect(key('3', { ctrlKey: true })).toBe(true);
    expect(S().ui.view).toBe('library');
    expect(key('4', { ctrlKey: true })).toBe(true);
    expect(S().ui.view).toBe('search');
    expect(key('f', { ctrlKey: true, shiftKey: true })).toBe(true);
    expect(cmd.skip).toHaveBeenCalledWith(10);
    expect(key(' ')).toBe(false);                           // the page's own key, listed but not dispatched here
    cleanup();
    const mine: Shortcut[] = [{ keys: 'Q', label: 'Quit', match: (e) => e.key === 'q', run: (s) => s.store.getState().commands.stop() }];
    mount(<div />, { shortcuts: mine });
    expect([key('3', { ctrlKey: true }), key('q')]).toEqual([false, true]);
    expect(cmd.stop).toHaveBeenCalledOnce();
  });
});

describe('query client', () => {
  it('no refetch on window focus or reconnect, a long cache, the engine\'s retry policy', () => {
    const retry = (): boolean => true, retryDelay = (): number => 7;
    const d = createQueryClient({ retryPolicy: { retry, retryDelay } }).getDefaultOptions().queries!;
    expect([d.refetchOnWindowFocus, d.refetchOnReconnect, d.staleTime, d.gcTime, d.retry, d.retryDelay])
      .toEqual([false, false, 60_000, 3_600_000, retry, retryDelay]);
  });
});
