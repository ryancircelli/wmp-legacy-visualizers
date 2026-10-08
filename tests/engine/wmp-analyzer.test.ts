// @vitest-environment node
// WMP's spectrum analyzer (src/engine/audio/wmp.ts) and the PCM source on top of it (pcm.ts). Proven bit-exact
// against the DLL in the private harness; here, the shape of what it does and a golden hash of the port's own
// output on a synthetic stream (made once the port matched the DLL on that same stream).
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WmpAnalyzer, type WmpBuild } from '../../src/engine/audio/wmp';
import { createPcmSource } from '../../src/engine/audio/pcm';
import { makeLevel } from '../../src/engine';

const peak = (f: Uint8Array) => f.reduce((at, v, i) => (v > f[at]! ? i : at), 0);

/** `frames` of interleaved stereo int16, each channel a sine on FFT bin `k` (of 2048) at `amp`. */
function tone(frames: number, k: number, amp: number, kR = k): Int16Array {
  const pcm = new Int16Array(frames * 2);
  for (let i = 0; i < frames; i++) {
    pcm[2 * i] = Math.round(amp * Math.sin((2 * Math.PI * k * i) / 2048));
    pcm[2 * i + 1] = Math.round(amp * Math.sin((2 * Math.PI * kR * i) / 2048));
  }
  return pcm;
}

/** The golden stream, 44.1 kHz stereo: silence, tones, noise from loud to 1 LSB, a full-scale square, L/R apart. */
export function goldenStream(): Int16Array {
  let s = 12345;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
  const seg = 22050, out = new Int16Array(seg * 8 * 2);
  for (let i = 0; i < seg * 8; i++) {
    const part = Math.floor(i / seg), t = i / 44100;
    let l = 0, r = 0;
    if (part === 1) { l = 12000 * Math.sin(2 * Math.PI * 440 * t); r = 12000 * Math.sin(2 * Math.PI * 1000 * t); }
    if (part >= 2 && part <= 5) { const a = [30000, 3000, 30, 1][part - 2]!; l = (rnd() * 2 - 1) * a; r = (rnd() * 2 - 1) * a; }
    if (part === 6) l = r = (i >> 5) & 1 ? 32767 : -32768;
    if (part === 7) { l = 20000 * Math.sin(2 * Math.PI * 60 * t); r = -l; }
    out[2 * i] = Math.max(-32768, Math.min(32767, Math.round(l)));
    out[2 * i + 1] = Math.max(-32768, Math.min(32767, Math.round(r)));
  }
  return out;
}

function hashRun(feed: (a: WmpAnalyzer) => void, build: WmpBuild = 'wmp12'): { n: number; sha1: string } {
  const a = new WmpAnalyzer(44100, 2, build), h = createHash('sha1');
  a.onSnapshot = () => { h.update(String(a.ts)); for (let c = 0; c < 2; c++) { h.update(a.freq[c]!); h.update(a.wave[c]!); } };
  feed(a);
  return { n: a.count, sha1: h.digest('hex') };
}

describe('WmpAnalyzer', () => {
  it('puts FFT bin k at frequency[k - 3] at 44.1 and 48 kHz, 255/80 bytes per dB', () => {
    for (const rate of [44100, 48000]) {
      const a = new WmpAnalyzer(rate, 2);
      a.push(tone(a.hop * 10, 46, 16384, 300));
      expect(peak(a.freq[0])).toBe(43);
      expect(peak(a.freq[1])).toBe(297);
      // -6 dBFS: 221 on a fresh window; the overlap carried over is windowed twice, more of it at 44.1 kHz
      expect(a.freq[0][43]).toBe(rate === 44100 ? 219 : 220);
      expect([...a.freq[0].subarray(1021)]).toEqual([0, 0, 0]);
    }
  });

  it('turns 20 dB into 64 bytes or so', () => {
    const a = new WmpAnalyzer(48000, 2);
    a.push(tone(a.hop * 10, 43, 3277));
    expect(a.freq[0][40]).toBe(176);
  });

  it('gives digital silence frequency 0 and wave 128', () => {
    const a = new WmpAnalyzer(44100, 2);
    a.push(new Int16Array(a.hop * 4 * 2));
    expect(a.count).toBeGreaterThan(0);
    expect(a.freq[0].every((v) => v === 0) && a.wave[1].every((v) => v === 128)).toBe(true);
  });

  it('takes the wave bytes from the oldest 1024 samples, as the sample\'s top byte with the sign flipped', () => {
    const a = new WmpAnalyzer(44100, 2), pcm = new Int16Array(2048 * 2);
    for (let i = 0; i < 2048; i++) pcm[2 * i] = pcm[2 * i + 1] = i < 1024 ? -1 - i * 31 : 32767;
    a.process(pcm, 2048, 0);
    expect(a.count).toBe(1);
    expect(a.wave[0][0]).toBe(127);           // -1 >> 8 = -1
    expect(a.wave[0][1023]).toBe(((-1 - 1023 * 31) >> 8) + 128);
  });

  it('makes 30 snapshots a second, 2048 samples each ending hop after the last', () => {
    const a = new WmpAnalyzer(48000, 2), ts: number[] = [];
    a.onSnapshot = () => ts.push(a.ts);
    a.push(new Int16Array(48000 * 2 * 2));
    expect(a.hop).toBe(1600);
    expect(a.count).toBe(59);                 // 60 hop buffers; the first two fill the first window
    // hop · 10^7 / rate, truncated each buffer: 333333 or 333334 apart
    expect(ts.slice(2).every((t, i) => t - ts[i + 1]! === 333333 || t - ts[i + 1]! === 333334)).toBe(true);
  });

  it('hands mono out on both channels', () => {
    const a = new WmpAnalyzer(44100, 1), m = tone(a.hop * 4, 46, 16384).filter((_, i) => i % 2 === 0);
    a.push(m);
    expect(a.freq[1]).toEqual(a.freq[0]);
    expect(a.wave[1]).toEqual(a.wave[0]);
    expect(peak(a.freq[0])).toBe(43);
  });

  it('push() in pieces of any size is process() in hop-sized buffers', () => {
    const pcm = goldenStream(), hop = 1470;
    const whole = hashRun((a) => { for (let i = 0; i + hop <= pcm.length / 2; i += hop) a.process(pcm.subarray(i * 2, (i + hop) * 2), hop, Math.floor((i * 1e7) / 44100)); });
    const pieces = hashRun((a) => { for (let i = 0, n = 1; i < pcm.length / 2; i += n, n = (n * 7 + 3) % 5000 + 1) a.push(pcm.subarray(i * 2, Math.min(pcm.length, (i + n) * 2))); });
    expect(pieces).toEqual(whole);
  });

  // The port's own output; the private harness found the DLL identical on this stream, in both feeds.
  it('golden: hop buffers and odd buffers', () => {
    const pcm = goldenStream();
    expect(hashRun((a) => a.push(pcm))).toEqual({ n: 119, sha1: 'bbc4e12a6ab118f36dc9e119bc479f8875b4d4f9' });
    const sizes = [1000, 333, 4410, 1, 2047, 2049, 8192, 1470, 7, 577, 578, 579, 3000];
    expect(hashRun((a) => {
      for (let k = 0, fed = 0; fed < pcm.length / 2; k++) {
        const n = Math.min(sizes[k % sizes.length]!, pcm.length / 2 - fed);
        a.process(pcm.subarray(fed * 2, (fed + n) * 2), n, Math.floor((fed * 1e7) / 44100));
        fed += n;
      }
    })).toEqual({ n: 101, sha1: '0e9ffdea03af29b05861f2312474fa7ca28a9d5a' });
  });

  // The three builds' arithmetic on a stream where it shows: noise at four levels over two tones, 4 s. Each
  // build matched its own DLL here (WMP 12's wmpeffects.dll x64 and x86, WMP 9 and 10's wmp.dll, WMP 11's
  // wmpeffects.dll) and missed the others' by a byte of 1 in one or two snapshots.
  it('golden: WMP 12, WMP 9/10 and WMP 11 arithmetic', () => {
    let s = 2;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
    const pcm = new Int16Array(44100 * 4 * 2);
    for (let i = 0; i < 44100 * 4; i++) {
      const t = i / 44100, a = [20000, 3000, 300, 12000][Math.floor(i / 22050) % 4]!;
      const l = (rnd() * 2 - 1) * a + 4000 * Math.sin(2 * Math.PI * 523.25 * t), r = (rnd() * 2 - 1) * a + 4000 * Math.sin(2 * Math.PI * 97 * t);
      pcm[2 * i] = Math.max(-32768, Math.min(32767, Math.round(l)));
      pcm[2 * i + 1] = Math.max(-32768, Math.min(32767, Math.round(r)));
    }
    expect(hashRun((a) => a.push(pcm), 'wmp12')).toEqual({ n: 119, sha1: '477c22bd52e33431e81271e6c6be159d57f115b9' });
    expect(hashRun((a) => a.push(pcm), 'wmp9')).toEqual({ n: 119, sha1: '5a2ce7a3d13f637f078f30b13526cbd8d43c744e' });
    expect(hashRun((a) => a.push(pcm), 'wmp11')).toEqual({ n: 119, sha1: 'c6831fd311a1f23c43e3260aabd5ef2af020aba5' });
  });
});

describe('createPcmSource', () => {
  afterEach(() => vi.useRealTimers());

  it('fills the newest snapshot and its timestamp, float samples taken as 16-bit', () => {
    const src = createPcmSource(48000), level = makeLevel(), f = new Float32Array(1600 * 6 * 2);
    for (let i = 0; i < f.length / 2; i++) f[2 * i] = f[2 * i + 1] = 0.5 * Math.sin((2 * Math.PI * 46 * i) / 2048);
    src.push(f);
    src.fill(level);
    expect(peak(level.freq[0])).toBe(43);
    expect(level.timeStamp).toBe(1573333);    // 100 ns: the window's first sample, 7552 / 48000 s
  });

  it('takes a quarter second without samples as silence: frequency 0, wave 128, the timestamps moving on', () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    const src = createPcmSource(44100), level = makeLevel();
    src.push(new Float32Array(1470 * 4 * 2).fill(0.3));
    src.fill(level);
    const ts = level.timeStamp;
    expect(level.wave[0][0]).toBe(((0.3 * 32768) >> 8) + 128);
    vi.advanceTimersByTime(300);
    src.fill(level);
    expect(level.wave[0].every((v) => v === 128) && level.freq[1].every((v) => v === 0)).toBe(true);
    expect(level.timeStamp).toBeGreaterThan(ts);
  });
});
