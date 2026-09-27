#!/usr/bin/env python3
"""frames.bin generator for the Alchemy ground-truth harness.

frames.bin layout, 4100 bytes per frame, no header:
    freq[0][1024] freq[1][1024] wave[0][1024] wave[1][1024] int32le state

freq bytes replicate Web Audio AnalyserNode.getByteFrequencyData:
  fftSize 2048, Blackman window over the most recent 2048 samples, |X[k]|/fftSize,
  dB = 20log10, byte = 255*(dB-min)/(max-min) clamped, min=-93 max=-15.1, smoothing 0.
wave bytes = the most recent 1024 samples, byte = clamp(round(128*(1+x)), 0, 255).

usage:
  gen_frames.py synth  OUT                 20 silent, 20 bass=128, 60 sine wave, 20 silent
  gen_frames.py wav    OUT WAV [N] [FPS]   analysis of a WAV, one frame per 1/FPS s
  gen_frames.py bass   OUT V [N]           freq bins 0..7 = V both channels, silence elsewhere
  gen_frames.py flash  OUT [N]             frame 0 = full-scale waveform, then silence
  gen_frames.py steps  OUT [BLOCK] [REPS]  bass level cycles 0,64,128,192,255 every BLOCK frames
"""
import math, struct, sys, wave

N_FFT, N_BINS, MIN_DB, MAX_DB = 2048, 1024, -93.0, -15.1

# ---- iterative radix-2 FFT, twiddles cached ----
_TW = {}
def _tw(n):
    if n not in _TW:
        _TW[n] = [complex(math.cos(-2 * math.pi * k / n), math.sin(-2 * math.pi * k / n))
                  for k in range(n // 2)]
    return _TW[n]

def _rev(n):
    key = ('r', n)
    if key not in _TW:
        bits = n.bit_length() - 1
        t = [0] * n
        for i in range(n):
            r, x = 0, i
            for _ in range(bits):
                r = (r << 1) | (x & 1); x >>= 1
            t[i] = r
        _TW[key] = t
    return _TW[key]

def fft(a):
    n = len(a)
    rev, w = _rev(n), _tw(n)
    a = [complex(a[r], 0.0) for r in rev]
    size = 2
    while size <= n:
        half, step = size >> 1, n // size
        for i in range(0, n, size):
            k = 0
            for j in range(i, i + half):
                t = w[k] * a[j + half]
                u = a[j]
                a[j] = u + t
                a[j + half] = u - t
                k += step
        size <<= 1
    return a

_BLACKMAN = [0.42 - 0.5 * math.cos(2 * math.pi * i / N_FFT) + 0.08 * math.cos(4 * math.pi * i / N_FFT)
             for i in range(N_FFT)]
_SCALE = 255.0 / (MAX_DB - MIN_DB)

def freq_bytes(samples):
    """samples: the most recent N_FFT floats in [-1,1] -> bytes(N_BINS)"""
    spec = fft([samples[i] * _BLACKMAN[i] for i in range(N_FFT)])
    out = bytearray(N_BINS)
    for k in range(N_BINS):
        m = abs(spec[k]) / N_FFT
        if m <= 0.0:
            continue
        b = int(_SCALE * (20.0 * math.log10(m) - MIN_DB))
        out[k] = 0 if b < 0 else (255 if b > 255 else b)
    return bytes(out)

def wave_bytes(samples):
    """the most recent 1024 floats -> bytes(1024)"""
    out = bytearray(N_BINS)
    for i, x in enumerate(samples[-N_BINS:]):
        b = int(128.0 * (1.0 + x) + 0.5)
        out[i] = 0 if b < 0 else (255 if b > 255 else b)
    return bytes(out)

def frame(f0, f1, w0, w1, state=2):
    return f0 + f1 + w0 + w1 + struct.pack('<i', state)

SIL_F = bytes(N_BINS)                  # -inf dB clamps to 0
SIL_W = bytes([128]) * N_BINS

def read_wav(path):
    w = wave.open(path, 'rb')
    ch, sw, sr, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
    assert sw == 2, 'only 16-bit PCM'
    raw = w.readframes(n)
    w.close()
    ints = struct.unpack('<%dh' % (len(raw) // 2), raw)
    chans = [[ints[i] / 32768.0 for i in range(c, len(ints), ch)] for c in range(ch)]
    if ch == 1:
        chans.append(chans[0])
    return chans, sr

def main():
    mode, out = sys.argv[1], sys.argv[2]
    frames = []
    if mode == 'synth':
        bass = bytearray(N_BINS)
        for i in range(8):
            bass[i] = 128
        bass = bytes(bass)
        sr = 44100
        for i in range(20):
            frames.append(frame(SIL_F, SIL_F, SIL_W, SIL_W))
        for i in range(20):
            frames.append(frame(bass, bass, SIL_W, SIL_W))
        for i in range(60):                      # 220 Hz sine, real analysis
            ph = i * N_FFT
            s = [0.8 * math.sin(2 * math.pi * 220.0 * (ph + j) / sr) for j in range(N_FFT)]
            f = freq_bytes(s); wv = wave_bytes(s)
            frames.append(frame(f, f, wv, wv))
        for i in range(20):
            frames.append(frame(SIL_F, SIL_F, SIL_W, SIL_W))
    elif mode == 'wav':
        path = sys.argv[3]
        n = int(sys.argv[4]) if len(sys.argv) > 4 else 3600
        fps = float(sys.argv[5]) if len(sys.argv) > 5 else 60.0
        chans, sr = read_wav(path)
        pad = [0.0] * N_FFT
        for f in range(n):
            end = int(round((f + 1) * sr / fps))
            row = []
            for c in (0, 1):
                seg = (pad + chans[c][max(0, end - N_FFT):end])[-N_FFT:]
                row.append((freq_bytes(seg), wave_bytes(seg)))
            frames.append(frame(row[0][0], row[1][0], row[0][1], row[1][1]))
            if f % 200 == 0:
                print('  frame %d/%d' % (f, n), file=sys.stderr)
    elif mode == 'bass':
        v = int(sys.argv[3]); n = int(sys.argv[4]) if len(sys.argv) > 4 else 300
        b = bytearray(N_BINS)
        for i in range(8):
            b[i] = v
        b = bytes(b)
        frames = [frame(b, b, SIL_W, SIL_W)] * n
    elif mode == 'steps':
        block = int(sys.argv[3]) if len(sys.argv) > 3 else 60
        reps = int(sys.argv[4]) if len(sys.argv) > 4 else 6
        for _ in range(reps):
            for v in (0, 64, 128, 192, 255):
                b = bytearray(N_BINS)
                for i in range(8):
                    b[i] = v
                b = bytes(b)
                frames += [frame(b, b, SIL_W, SIL_W)] * block
    elif mode == 'flash':
        n = int(sys.argv[3]) if len(sys.argv) > 3 else 120
        wv = bytes([0 if (i // 8) % 2 else 255 for i in range(N_BINS)])   # full-scale square
        loud = bytes([255] * 64 + [0] * (N_BINS - 64))
        frames = [frame(loud, loud, wv, wv)]
        frames += [frame(SIL_F, SIL_F, SIL_W, SIL_W)] * (n - 1)
    else:
        sys.exit(__doc__)
    with open(out, 'wb') as fh:
        fh.write(b''.join(frames))
    print('%s: %d frames -> %s' % (mode, len(frames), out))

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'selftest':
        # a 1 kHz full-scale sine must land near the top of the dB window, silence at 0
        sr = 44100
        s = [1.0 * math.sin(2 * math.pi * 1000.0 * j / sr) for j in range(N_FFT)]
        fb = freq_bytes(s)
        peak = max(range(N_BINS), key=lambda k: fb[k])
        assert 45 <= peak <= 47, peak                       # 1000/(44100/2048) = 46.4
        assert fb[peak] > 230, fb[peak]
        assert max(freq_bytes([0.0] * N_FFT)) == 0
        wb = wave_bytes(s)
        assert min(wb) <= 1 and max(wb) >= 254, (min(wb), max(wb))
        # round trip: an impulse's spectrum is flat-ish, and Parseval holds on the raw FFT
        sp = fft([1.0] + [0.0] * (N_FFT - 1))
        assert all(abs(abs(x) - 1.0) < 1e-9 for x in sp)
        print('selftest ok: peak bin %d = %d' % (peak, fb[peak]))
    else:
        main()
