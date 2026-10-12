// The iPod's boot screen in the iOS app (Boot.tsx): shown at mount while nothing is known, filling on
// the milestones and gone once they are in, gone at 6 s regardless, gone at once when logged out, never
// shown to a mount that is ready already (a refresh in place), and never outside the app.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Queries } from '../../src/adapters';
import { makeShell } from '../../src/app/App';
import type { Ticker } from '../../src/app/ticker';
import { createAppStore } from '../../src/model';
import { Root } from '../../src/skins/ipod/Root';
import { ShellContext } from '../../src/ui';
import { fakeData, fakeQueries } from './harness';

beforeEach(() => { vi.useFakeTimers(); window.alchemyLayout = vi.fn(); });
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete window.alchemyLayout; delete window.__wmpSpotify; delete window.__wmpSpeaker;
});

const ticker = { nativeSize: () => [640, 480], debugText: () => '' } as unknown as Ticker;
/** the iPod alone over a Spotify store whose sign-in is `loggedIn` (the adapter not started yet) */
function mount(loggedIn: boolean | null = null) {
  const store = createAppStore({ persist: false });
  store.getState().actions.setAuth({ engine: 'spotify', loggedIn });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const sh = makeShell(store, ticker, document.body, undefined, fakeQueries(fakeData()) as unknown as Queries, client);
  const r = render(<QueryClientProvider client={client}><ShellContext.Provider value={sh}><Root /></ShellContext.Provider></QueryClientProvider>);
  const bar = () => r.container.querySelector('[role=progressbar]');
  return { store, bar, at: () => Number(bar()?.getAttribute('aria-valuenow')), wait: (ms: number) => act(() => { vi.advanceTimersByTime(ms); }) };
}

it('shows at mount with nothing known, fills on each milestone without going back, and fades out once all are in', () => {
  window.__wmpSpeaker = { id: null, name: '' };
  const m = mount();
  expect(m.bar()).not.toBeNull();
  expect(m.at()).toBe(15);
  m.wait(1000);
  const crept = m.at();
  expect(crept).toBeGreaterThan(15);                  // eased on with nothing new
  expect(crept).toBeLessThan(43);                     // but not to the next milestone (15 + 85 / 3)
  act(() => m.store.getState().actions.setAuth({ loggedIn: true }));
  m.wait(100);
  expect(m.at()).toBeGreaterThanOrEqual(43);
  act(() => m.store.getState().actions.setPlayback({ status: 'paused' }));
  m.wait(100);
  const two = m.at();
  expect(two).toBeGreaterThanOrEqual(72);             // 15 + 85 * 2 / 3, rounded
  act(() => m.store.getState().actions.setPlayback({ status: 'none' }));   // a milestone lost: the bar stays
  m.wait(100);
  expect(m.at()).toBeGreaterThanOrEqual(two);
  act(() => m.store.getState().actions.setPlayback({ status: 'paused' }));
  act(() => { window.__wmpSpeaker = { id: 'spk', name: 'WMP Spotify (iOS)' }; });
  m.wait(100);
  expect(m.at()).toBe(100);                            // all in: full, fading
  m.wait(300);
  expect(m.bar()).toBeNull();
});

it('takes no wheel input while it shows', () => {
  const m = mount(), haptic = vi.fn();
  window.alchemyHaptic = haptic;
  const sel = () => document.querySelector('[role=option][aria-selected=true]')?.textContent;
  const press = () => {
    const wheel = document.querySelector('[aria-label="Click wheel"]')!;
    fireEvent.pointerDown(wheel, { pointerId: 1, button: 0, pointerType: 'touch' });
    fireEvent.pointerUp(wheel, { pointerId: 1, button: 0, pointerType: 'touch' });
  };
  const down = () => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true })); });
  expect(sel()).toBe('Home');
  down();
  press();
  expect(sel()).toBe('Home');
  expect(haptic).not.toHaveBeenCalled();
  m.wait(6300);
  down();
  expect(sel()).toBe('Search');
  press();
  expect(haptic).toHaveBeenCalledWith('prepare');
  delete window.alchemyHaptic;
});

it('gives up at 6 s with whatever is there', () => {
  const m = mount(true);
  m.wait(5900);
  expect(m.bar()).not.toBeNull();
  expect(m.at()).toBeLessThan(100);
  m.wait(100);
  expect(m.at()).toBe(100);
  m.wait(300);
  expect(m.bar()).toBeNull();
});

it('logged out: gone at once (Spotify\'s login page shows), or never shown', () => {
  const m = mount();
  expect(m.bar()).not.toBeNull();
  act(() => m.store.getState().actions.setAuth({ loggedIn: false }));
  m.wait(100);
  expect(m.bar()).toBeNull();
  cleanup();
  expect(mount(false).bar()).toBeNull();
});

it('not shown to a mount that is ready already: a refresh in place, with the host\'s observer knowing it all', () => {
  window.__wmpSpotify = { loggedIn: true, state: {}, devices: [] };
  window.__wmpSpeaker = { id: 'spk', name: 'WMP Spotify (iOS)' };
  expect(mount().bar()).toBeNull();
  cleanup();
  window.__wmpSpeaker = { id: null, name: '' };       // the speaker not up yet: it boots
  expect(mount().bar()).not.toBeNull();
});

it('not shown outside the iOS app', () => {
  delete window.alchemyLayout;
  expect(mount().bar()).toBeNull();
});
