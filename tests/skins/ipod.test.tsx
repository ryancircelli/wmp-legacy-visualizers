// The iPod skin mounted: the wheel (its keyboard stand-in) reaches the top screen only, MENU goes back.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { makeShell } from '../../src/app/App';
import type { Ticker } from '../../src/app/ticker';
import { createAppStore } from '../../src/model';
import { Root } from '../../src/skins/ipod/Root';
import { ShellContext } from '../../src/ui';

afterEach(cleanup);
const key = (k: string) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, cancelable: true })); });

it('arrows move the selection, Enter opens Music, Escape comes back; each tick is a haptic', () => {
  const store = createAppStore({ persist: false });
  const sh = makeShell(store, {} as Ticker);
  const haptic = vi.fn();
  window.alchemyHaptic = haptic;
  const { container } = render(<ShellContext.Provider value={sh}><Root /></ShellContext.Provider>);
  // the selected row of the screen on top (the ones under it are mounted, hidden)
  const sel = () => [...container.querySelectorAll('[aria-selected=true]')].filter((x) => !x.closest('[hidden]')).map((x) => x.textContent);
  expect(sel()).toEqual(['Music']);
  key('ArrowDown');
  expect(sel()).toEqual(['Videos']);
  expect(haptic).toHaveBeenCalledWith('selection');
  key('ArrowUp');
  key('Enter');
  expect(container.textContent).toContain('Cover Flow');
  expect(sel()).toEqual(['Cover Flow']);
  key('Escape');
  expect(sel()).toEqual(['Music']);
  delete window.alchemyHaptic;
});
