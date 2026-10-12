#!/usr/bin/env python3
"""frames.bin generator for the ground-truth harness: TimedLevel streams the visualizers can be fed.

frames.bin layout, 4100 bytes per frame, no header:
    freq[0][1024] freq[1][1024] wave[0][1024] wave[1][1024] int32le state

Sound is analysed the way the app does it (src/engine/audio/wmp.ts and pcm.ts): Windows Media Player's own
spectrum analyzer, the same arithmetic in float32 operation for operation (bit-exact against WMP 12's
wmpeffects.dll in the private harness; `gen_frames.py selftest GOLDEN.wav` on the golden stream of
tests/engine/wmp-analyzer.test.ts prints the sha1 that test pins):
  16-bit samples, fed in buffers of hop = rate // 30 frames; a snapshot per hop of 2048 samples: 4-term
  Blackman-Harris window applied in place to the history (the overlap is windowed again next time),
  Sorensen's split-radix real FFT, power (re^2 + im^2) / 2048^2, bytes through WMP's two dB tables (255/80
  bytes per dB); freq[i] = FFT bin i + 3 at 44.1/48 kHz, the last 3 bytes 0; wave = the window's OLDEST 1024
  samples as (s >> 8) + 128. Frame f gets the newest snapshot complete by (f+1)/FPS s of sound (frequency 0 and
  wave 128 before the first), as WMP's host hands a Render the newest one.

Pure Python: about 35 ms per snapshot. (Streams made before 2026-10-07 used Web Audio's AnalyserNode bytes:
Blackman, -93..-15.1 dB, the newest 1024 samples.)

usage:
  gen_frames.py synth  OUT                 20 silent, 20 bass=128, 60 frames of a 220 Hz sine, 20 silent
  gen_frames.py wav    OUT WAV [N] [FPS]   analysis of a 16-bit WAV, one frame per 1/FPS s (FPS 60; WMP: 30)
  gen_frames.py bass   OUT V [N]           freq bins 0..7 = V both channels, silence elsewhere
  gen_frames.py flash  OUT [N]             frame 0 = full-scale waveform, then silence
  gen_frames.py steps  OUT [BLOCK] [REPS]  bass level cycles 0,64,128,192,255 every BLOCK frames
  gen_frames.py selftest [GOLDEN.wav]      checks; with the test's golden stream, its sha1s
"""
import hashlib, math, struct, sys, wave
from array import array

N, HALF = 2048, 1024
_F = array('f', [0.0])

def f(x):
    """round to float32, as every SSE single-precision operation does"""
    _F[0] = x
    return _F[0]

W = array('f', [0.35875 - math.cos(n * (6.28318530717958 / (N - 1))) * 0.48829
                + math.cos(n * (6.28318530717958 / (N - 1) + 6.28318530717958 / (N - 1))) * 0.14128
                - math.cos(n * (6.28318530717958 / (N - 1) * 3.0)) * 0.01168 for n in range(N)])
S = array('f', [0.0] * (2 * N))
for _k in range(1, N // 2):
    _s = f(math.sin(3.14159265358979 / N * _k))
    S[_k] = S[N - _k] = _s
    S[N + _k] = S[2 * N - _k] = -_s
S[N // 2], S[3 * N // 2] = 1.0, -1.0
REV = [int(format(i, '011b')[::-1], 2) for i in range(N)]
_K = 255.0 / 80.0 * 10.0 * math.log10(2.0)
T1 = [int(_K * math.log2(1 + m / 2048.0) + 0.5) for m in range(2048)]
T2 = [int(_K * (e - 127) + 0.5) for e in range(256)]
R2 = f(math.sqrt(0.5))

def to_byte(p):
    b = struct.unpack('<I', struct.pack('<f', p))[0]
    v = T1[(b >> 12) & 0x7ff] + T2[(b >> 23) & 0xff]
    return 255 if v > 255 else 0 if v < 0 else v

def fft(x):
    """split-radix real FFT, half-complex out; wmp.ts fft() line for line"""
    d = [0.0] * N
    for i in range(N):
        d[REV[i]] = x[i]
    i0, id_ = 0, 4
    while i0 < N - 1:
        for i in range(i0, N, id_):
            a, b = d[i], d[i + 1]
            d[i], d[i + 1] = f(a + b), f(a - b)
        i0, id_ = 2 * id_ - 2, id_ * 4
    n2, ts = 4, N // 2
    while n2 <= N:
        n4, n8 = n2 >> 2, n2 >> 3
        i, id_ = 0, 2 * n2
        while i < N:
            for i1 in range(i, N, id_):
                i2 = i1 + n4; i3 = i2 + n4; i4 = i3 + n4
                t1 = f(d[i3] + d[i4])
                d[i4] = f(d[i4] - d[i3])
                d[i3] = f(d[i1] - t1)
                d[i1] = f(t1 + d[i1])
                if n4 > 1:
                    j0, j2, j3, j4 = i1 + n8, i2 + n8, i3 + n8, i4 + n8
                    a = f(f(d[j3] + d[j4]) * R2); b = f(f(d[j3] - d[j4]) * R2)
                    d[j4] = f(d[j2] - a); d[j3] = f(-d[j2] - a)
                    d[j2] = f(d[j0] - b); d[j0] = f(b + d[j0])
            i, id_ = 2 * id_ - n2, id_ * 4
        for j in range(1, n8):
            ss1, cc1, ss3, cc3 = S[j * ts], S[j * ts + N // 2], S[3 * j * ts], S[3 * j * ts + N // 2]
            i, id_ = 0, 2 * n2
            while i < N:
                for b in range(i, N, id_):
                    i1 = b + j; i2 = i1 + n4; i3 = i2 + n4; i4 = i3 + n4
                    i5 = b + n4 - j; i6 = i5 + n4; i7 = i6 + n4; i8 = i7 + n4
                    t1 = f(f(d[i7] * ss1) + f(d[i3] * cc1)); t2 = f(f(d[i7] * cc1) - f(d[i3] * ss1))
                    t3 = f(f(d[i8] * ss3) + f(d[i4] * cc3)); t4 = f(f(d[i8] * cc3) - f(d[i4] * ss3))
                    t5 = f(t3 + t1); t6 = f(t4 + t2); u1 = f(t1 - t3); u2 = f(t2 - t4)
                    a6 = d[i6]; d[i3] = f(t6 - a6); d[i8] = f(a6 + t6)
                    a2 = d[i2]; d[i7] = f(-a2 - u1); d[i4] = f(a2 - u1)
                    a1 = d[i1]; d[i6] = f(a1 - t5); d[i1] = f(a1 + t5)
                    a5 = d[i5]; d[i5] = f(a5 - u2); d[i2] = f(a5 + u2)
                i, id_ = 2 * id_ - n2, id_ * 4
        n2, ts = n2 * 2, ts // 2
    return d

class Analyzer:
    """wmp.ts WmpAnalyzer: process() is one DMO input buffer, push() a stream cut into hop-sized buffers."""
    def __init__(self, rate, channels=2):
        self.rate, self.ch, self.hop = rate, channels, rate // 30
        bw = f(rate * 0.00048828125)
        e, x = 1, 0.0
        while not x >= 20.0:
            e += 1; x = f(x + bw)
            if e >= HALF: break
        self.e = e
        self.hist = [array('f', [0.0] * N) for _ in range(2)]
        self.wb = [bytearray(N) for _ in range(2)]
        self.fill = self.skip = self.clock = self.ts = self.count = self.fed = 0
        self.pending = []
        self.freq = [bytes(HALF), bytes(HALF)]
        self.wave = [bytes([128]) * HALF, bytes([128]) * HALF]

    def process(self, frames, ts):
        """frames: a list of per-frame tuples of int16 samples"""
        sr, hop, n = self.rate, self.hop, len(frames)
        self.clock = ts - (self.fill * 10000000) // sr
        p = anchor = 0
        if self.skip > 0:
            p = self.skip; self.clock += (self.skip * 10000000) // sr; self.skip = 0
        ok = self._read(frames, p, n)
        while ok:
            self.fill = 0
            self._snapshot()
            anchor += hop
            self.clock += (hop * 10000000) // sr
            if anchor > n:
                self.skip = N - hop; break
            if hop < N:
                for c in range(self.ch):
                    self.hist[c][:N - hop] = self.hist[c][hop:]
                    self.wb[c][:N - hop] = self.wb[c][hop:]
                self.fill = N - hop
            ok = self._read(frames, anchor, n)

    def push(self, frames):
        for fr in frames:
            self.pending.append(fr)
            if len(self.pending) == self.hop:
                self.process(self.pending, (self.fed * 10000000) // self.rate)
                self.fed += self.hop; self.pending = []

    def _read(self, frames, p, end):
        while self.fill < N:
            if p >= end: return False
            for c in range(self.ch):
                s = frames[p][c]
                self.hist[c][self.fill] = s
                self.wb[c][self.fill] = (s >> 8) + 128
            p += 1; self.fill += 1
        return True

    def _snapshot(self):
        e, last = self.e, HALF - 1 - self.e
        for c in range(self.ch):
            h = self.hist[c]
            for n in range(N):
                h[n] = f(W[n] * h[n])
            P = fft(h)
            for k in range(1, HALF):
                re, im = P[k], P[N - k]
                P[k] = f(f(f(im * im) + f(re * re)) * 2.384185791015625e-07)
            self.freq[c] = bytes(to_byte(P[e + 1 + i]) if i < last else 0 for i in range(HALF))
            self.wave[c] = bytes(self.wb[c][:HALF])
        if self.ch == 1:
            self.freq[1], self.wave[1] = self.freq[0], self.wave[0]
        self.ts = self.clock; self.count += 1

def frame(f0, f1, w0, w1, state=2):
    return f0 + f1 + w0 + w1 + struct.pack('<i', state)

SIL_F = bytes(HALF)
SIL_W = bytes([128]) * HALF

def read_wav(path):
    """-> (frames as (l, r) int16 tuples, rate); mono is duplicated, as WMP's GetTimedLevel does"""
    w = wave.open(path, 'rb')
    ch, sw, sr, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
    assert sw == 2, 'only 16-bit PCM'
    ints = struct.unpack('<%dh' % (n * ch), w.readframes(n))
    w.close()
    return [(ints[i * ch], ints[i * ch + (1 if ch > 1 else 0)]) for i in range(n)], sr

def analyse(frames, sr, n, fps):
    """n frames of the newest snapshot at (f+1)/fps s of the stream"""
    an, out, fed = Analyzer(sr, 2), [], 0
    for fi in range(n):
        end = int(round((fi + 1) * sr / fps))
        while fed + an.hop <= min(end, len(frames)):
            an.push(frames[fed:fed + an.hop]); fed += an.hop
        out.append(frame(an.freq[0], an.freq[1], an.wave[0], an.wave[1]))
        if fi % 200 == 0:
            print('  frame %d/%d' % (fi, n), file=sys.stderr)
    return out

def main():
    mode, out = sys.argv[1], sys.argv[2]
    frames = []
    if mode == 'synth':
        bass = bytes([128] * 8) + bytes(HALF - 8)
        sr = 44100
        frames += [frame(SIL_F, SIL_F, SIL_W, SIL_W)] * 20 + [frame(bass, bass, SIL_W, SIL_W)] * 20
        tone = [(v, v) for v in (round(0.8 * 32767 * math.sin(2 * math.pi * 220.0 * j / sr)) for j in range(sr * 3))]
        frames += analyse(tone, sr, 60, 30.0)
        frames += [frame(SIL_F, SIL_F, SIL_W, SIL_W)] * 20
    elif mode == 'wav':
        n = int(sys.argv[4]) if len(sys.argv) > 4 else 3600
        fps = float(sys.argv[5]) if len(sys.argv) > 5 else 60.0
        pcm, sr = read_wav(sys.argv[3])
        frames = analyse(pcm, sr, n, fps)
    elif mode == 'bass':
        v = int(sys.argv[3]); n = int(sys.argv[4]) if len(sys.argv) > 4 else 300
        b = bytes([v] * 8) + bytes(HALF - 8)
        frames = [frame(b, b, SIL_W, SIL_W)] * n
    elif mode == 'steps':
        block = int(sys.argv[3]) if len(sys.argv) > 3 else 60
        reps = int(sys.argv[4]) if len(sys.argv) > 4 else 6
        for _ in range(reps):
            for v in (0, 64, 128, 192, 255):
                b = bytes([v] * 8) + bytes(HALF - 8)
                frames += [frame(b, b, SIL_W, SIL_W)] * block
    elif mode == 'flash':
        n = int(sys.argv[3]) if len(sys.argv) > 3 else 120
        wv = bytes([0 if (i // 8) % 2 else 255 for i in range(HALF)])   # full-scale square
        loud = bytes([255] * 64 + [0] * (HALF - 64))
        frames = [frame(loud, loud, wv, wv)] + [frame(SIL_F, SIL_F, SIL_W, SIL_W)] * (n - 1)
    else:
        sys.exit(__doc__)
    with open(out, 'wb') as fh:
        fh.write(b''.join(frames))
    print('%s: %d frames -> %s' % (mode, len(frames), out))

def selftest():
    # a -6 dBFS sine on bin 46 at 44.1 kHz: frequency[43]; 221 on the first window, 219 once the carried-over
    # overlap has been windowed twice (tests/engine/wmp-analyzer.test.ts has the same numbers)
    an, peaks = Analyzer(44100), []
    sine = [(v, v) for v in (round(16384 * math.sin(2 * math.pi * 46 * i / 2048)) for i in range(1470 * 4))]
    for k in range(4):
        an.push(sine[k * 1470:(k + 1) * 1470])
        if an.count: peaks.append((max(range(HALF), key=lambda i: an.freq[0][i]), max(an.freq[0])))
    assert peaks == [(43, 221), (43, 219), (43, 219)], peaks
    assert an.freq[0][-3:] == bytes(3) and an.wave[0][0] == ((sine[4 * 1470 - 2048][0] >> 8) + 128)
    silent = Analyzer(48000)
    silent.push([(0, 0)] * 1600 * 3)
    assert silent.count == 2 and silent.freq[1] == SIL_F and silent.wave[0] == SIL_W
    print('selftest ok: bin 46 -> frequency[43] = 221, then 219')
    if len(sys.argv) > 2:   # the golden stream: the sha1 the TypeScript test pins (hop buffers)
        pcm, sr = read_wav(sys.argv[2])
        an, h = Analyzer(sr), hashlib.sha1()
        for i in range(0, len(pcm) - an.hop + 1, an.hop):
            before = an.count
            an.process(pcm[i:i + an.hop], (i * 10000000) // sr)
            if an.count > before:
                h.update(str(an.ts).encode())
                for c in range(2): h.update(an.freq[c]); h.update(an.wave[c])
        print('golden: %d snapshots, sha1 %s' % (an.count, h.hexdigest()))

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'selftest':
        selftest()
    else:
        main()
