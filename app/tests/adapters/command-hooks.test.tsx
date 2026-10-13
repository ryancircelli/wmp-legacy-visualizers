// The src/ui side of the 2026-10-05 commands over the fake catalogue (tests/skins/harness): an episode marked
// played / unplayed shows so in useCollection's rows at once, over what the fetched page says; usePlayback
// carries the three-way shuffle and whether Smart Shuffle is on offer.
import { act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Track } from '../../src/model';
import { useCollection, usePlayback } from '../../src/ui';
import { fakeData, mountSkin } from '../skins/harness';

const SHOW = 'spotify:show:s1';
const ep = (n: number, unplayed?: boolean): Track =>
  ({ uri: 'spotify:episode:e' + n, title: 'Episode ' + n, artist: 'Show', album: 'Show', duration: 60_000, ctx: SHOW, ...(unplayed === undefined ? {} : { unplayed }) });

/** what the hooks gave, rendered as data attributes the test reads back */
function Probe() {
  const c = useCollection(SHOW), p = usePlayback();
  return <i id="probe" data-rows={JSON.stringify(c.rows.map((t) => t.unplayed ?? null))} data-shuffle={JSON.stringify([p.shuffle, p.shuffleMode, p.canSmartShuffle])} />;
}
const seen = () => {
  const el = document.getElementById('probe')!;
  return { rows: JSON.parse(el.dataset.rows!) as unknown[], shuffle: JSON.parse(el.dataset.shuffle!) as unknown[] };
};

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('the commands\' marks in the shared hooks', () => {
  it('useCollection: a mark in store.played wins over the row\'s own unplayed, both ways; cleared, the row\'s again', async () => {
    const h = await mountSkin('spotify', fakeData({ collections: { [SHOW]: { tracks: [ep(1, true), ep(2, false), ep(3)] } } }), <Probe />);
    await h.settle();
    expect(seen().rows).toEqual([true, false, null]);
    act(() => { h.S().actions.setPlayed('spotify:episode:e1', true); h.S().actions.setPlayed('spotify:episode:e2', false); });
    expect(seen().rows).toEqual([false, true, null]);
    act(() => h.S().actions.setPlayed('spotify:episode:e1', null));
    expect(seen().rows).toEqual([true, true, null]);
  });

  it('usePlayback: shuffle, shuffleMode and canSmartShuffle from the playback slice', async () => {
    const h = await mountSkin('spotify', fakeData(), <Probe />);
    expect(seen().shuffle).toEqual([false, 'off', false]);
    act(() => h.S().actions.setPlayback({ shuffle: true, shuffleMode: 'smart', canSmartShuffle: true }));
    expect(seen().shuffle).toEqual([true, 'smart', true]);
  });
});
