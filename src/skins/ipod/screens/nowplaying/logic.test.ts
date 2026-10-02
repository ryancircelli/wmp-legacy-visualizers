import { describe, expect, it } from 'vitest';
import { A } from '../../../../engine';
import { barsFit, clock, nextMode, ofText, scrubAccel, scrubStep, times, turnPct, volumeBy, VOLUME_TURN, type Mode } from './logic';

describe('Now Playing logic', () => {
  it('formats the clock as the iPod does', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(65.9)).toBe('1:05');
    expect(clock(3725)).toBe('1:02:05');
    expect(times(61_400, 200_000)).toEqual(['1:01', '-2:19']);
    expect(times(0, 0)).toEqual(['0:00', '-0:00']);
  });
  it('scrubs 1 % a detent (at least 1 s), accelerated, within the track', () => {
    expect(scrubStep(10_000, 1, 200_000)).toBe(12_000);
    expect(scrubStep(10_000, 1, 200_000, 4)).toBe(18_000);
    expect(scrubStep(10_000, -1, 60_000)).toBe(9_000);
    expect(scrubStep(1_000, -1, 200_000)).toBe(0);
    expect(scrubStep(199_000, 1, 200_000)).toBe(200_000);
  });
  it('accelerates the scrub by the detent rate', () => {
    expect(scrubAccel(500)).toBe(1);
    expect(scrubAccel(150)).toBe(2);
    expect(scrubAccel(80)).toBe(4);
  });
  it('steps the volume within its range', () => {
    expect([volumeBy(50, 2), volumeBy(1, -2), volumeBy(99.5, 2), volumeBy(0, -10)]).toEqual([52, 0, 100, 0]);
    // a full turn of the ring is 65 % of the range; 1 % is about 5.5 degrees
    expect([VOLUME_TURN, turnPct(360), turnPct(-360 / 65 * 10)]).toEqual([65, 65, -10]);
  });
  it('cycles the modes on center in the nano order, skipping what the track lacks (no lyrics mode)', () => {
    const all = { scrub: true, radio: true };
    const order: Mode[] = ['default'];
    for (let i = 0; i < 3; i++) order.push(nextMode(order[i]!, all));
    expect(order).toEqual(['default', 'scrub', 'radio', 'default']);
    expect(nextMode('default', { radio: true })).toBe('radio');
    expect(nextMode('scrub', {})).toBe('default');
    expect(nextMode('radio', { scrub: true, radio: true })).toBe('default');
    expect(nextMode('default', {})).toBe('default');
  });
  it('says N of M only when the track is among the rows', () => {
    const rows = [{ uri: 'a' }, { uri: 'b' }];
    expect(ofText(rows, 'b', 12)).toBe('2 of 12');
    expect(ofText(rows, 'c', 12)).toBe('');
    expect(ofText(rows, '', 12)).toBe('');
  });

  it('sizes Bars and Waves\' Bars to a width its bars fill edge to edge, as the engine draws them', () => {
    // the engine itself (src/engine/bars.ts), a loud frame at each width: [xoff, bars, first and last lit column]
    let t = 0;
    const draw = (w: number, preset = 0) => {
      const b = new (A.Bars as unknown as new (c: object) => { render(l: object): { px: Uint32Array; w: number; h: number }; debug(): Record<string, number> })(
        { width: w, height: 120, options: { intended: false, fps: 60, backgroundColor: 0 }, preset });
      const mk = () => new Uint8Array(1024).fill(200), loud = () => ({ freq: [mk(), mk()], wave: [mk(), mk()], state: 2, timeStamp: ++t });
      let s = b.render(loud());
      for (let k = 0; k < 6; k++) s = b.render(loud());
      const lit = [...Array(s.w).keys()].filter((x) => { for (let y = 0; y < s.h; y++) if (s.px[y * s.w + x]) return true; return false; });
      const d = b.debug();
      return [d.xoff, d.bars, lit[0], lit.at(-1)];
    };
    expect(draw(349)).toEqual([24, 50, 24, 322]);   // the phone's area as it is: 24 columns clear either side
    expect(barsFit(349, 50, 5, 1)).toBe(299);
    expect(draw(299)).toEqual([0, 50, 0, 298]);      // edge to edge
    expect([barsFit(280, 50, 5, 1), barsFit(299, 50, 5, 1), barsFit(298, 50, 5, 1), barsFit(1100, 50, 5, 1)]).toEqual([275, 299, 293, 299]);
    expect(draw(275)).toEqual([0, 46, 0, 274]);
    // the 1024-bar mode (Ocean Mist, Fire Storm): a bar a column, no margin at any width under 1025
    expect(draw(349, 1).slice(0, 1)).toEqual([0]);
  });
});
