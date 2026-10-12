// Settings > Sound on the iPod (docs/ipod-skin.md "Sound"): shown only while the host has its own player
// (auth.hostPlayer, which the adapter's hostSettings sets); its rows cycle, the EQ page applies the preset
// the wheel is on, and every change goes to the host as the contract's command.
import { act, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { hostSettings } from '../../src/adapters/spotify';
import { Root } from '../../src/skins/ipod/Root';
import { fakeData, mountSkinNow } from './harness';

beforeEach(() => { vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });
const key = (k: string) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, cancelable: true })); });

/** the iPod at Settings; `host`: the host has the player (its binding stubbed, hostSettings run) */
function atSettings(host: boolean) {
  const sent: string[] = [];
  if (host) vi.stubGlobal('alchemyPlayer', (c: string) => { sent.push(c); });
  const m = mountSkinNow('spotify', fakeData(), <div data-testid="ipod"><Root /></div>);
  if (host) act(() => { hostSettings(m.store); });
  const ipod = m.getByTestId('ipod'), shown = (q: string) => [...ipod.querySelectorAll(q)].filter((x) => !x.closest('[hidden]'));
  const rows = () => shown('[role=option]').map((x) => x.textContent);
  const click = (label: string) => act(() => { fireEvent.click(shown('[role=option]').find((x) => x.textContent === label)!); });
  click('Settings');
  return { ...m, sent, rows, click, headers: () => shown('[data-header]').map((x) => x.textContent),
           sel: () => shown('[aria-selected=true]').map((x) => x.textContent),
           title: () => shown('[class*=status] [class*=title]')[0]?.textContent };
}
const SOUND = ['EQOff', 'Audio QualityHigh', 'Sound CheckOn', 'CrossfadeOff', 'Audio CacheOn'];

it('without the host\'s player there is no Sound section', () => {
  const m = atSettings(false);
  expect(m.headers()).toEqual(['Appearance', 'Menus', 'General', 'Support']);
  expect(m.rows().filter((r) => SOUND.includes(r))).toEqual([]);
});

it('with it, Sound after Menus: EQ, Audio Quality, Sound Check, Crossfade, Audio Cache; each row cycles and the host is sent the command', () => {
  const m = atSettings(true);
  expect(m.headers()).toEqual(['Appearance', 'Menus', 'Sound', 'General', 'Support']);
  const at = m.rows().indexOf('Library ViewGrid') + 1;
  expect(m.rows().slice(at, at + 6)).toEqual([...SOUND, 'About']);
  m.sent.length = 0;
  for (const r of ['Audio QualityHigh', 'Audio QualityVery High']) m.click(r);
  m.click('Sound CheckOn');
  m.click('Audio CacheOn');
  m.click('CrossfadeOff');
  expect(m.rows().slice(at, at + 5)).toEqual(['EQOff', 'Audio QualityNormal', 'Sound CheckOff', 'Crossfade2 s', 'Audio CacheOff']);
  expect(m.sent).toEqual(['quality:320', 'quality:96', 'normalise:0', 'cache:0', 'crossfade:2']);
  const { quality, normalise, audioCache, crossfade } = m.S().settings;
  expect({ quality, normalise, audioCache, crossfade }).toEqual({ quality: 96, normalise: false, audioCache: false, crossfade: 2 });
});

it('EQ: the iPod\'s presets, the chosen one checked; the wheel applies each as it passes, so it is heard; MENU keeps the last; the row names it', () => {
  const m = atSettings(true);
  m.sent.length = 0;
  m.click('EQOff');
  expect([m.title(), m.rows().slice(0, 4), m.sel()]).toEqual(['EQ', ['Off✓', 'Acoustic', 'Bass Booster', 'Bass Reducer'], ['Off✓']]);
  key('ArrowDown');
  key('ArrowDown');
  expect([m.sel(), m.S().settings.eq]).toEqual([['Bass Booster✓'], 'bass-booster']);
  expect(m.sent).toEqual(['eq:[5,4.9,3.95,1.05,2.15,1.75,3.5,4.1,3.55,2.15]', 'eq:[5.5,4.25,3.5,2.5,1.25,0,0,0,0,0]']);
  m.click('Rock');                                   // a tap picks too
  expect([m.sel(), m.sent.at(-1)]).toEqual([['Rock✓'], 'eq:[5,4,3,1.5,-0.5,-1,0.5,2.5,3.5,4.5]']);
  key('Escape');
  expect([m.title(), m.rows()]).toEqual(['Settings', expect.arrayContaining(['EQRock'])]);
  m.click('EQRock');
  expect(m.sel()).toEqual(['Rock✓']);                // it opens on the choice
});
