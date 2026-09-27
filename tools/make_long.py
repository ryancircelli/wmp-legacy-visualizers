#!/usr/bin/env python3
"""Deterministic ~8.5 min composition + its frames.bin, for full-render-cycle exactness runs.

  python3 make_long.py OUT.wav OUT.bin [N=30000] [FPS=60]

Section plan (repeats with a different tempo/key each pass, random.seed(7)):
  silence (digital zero) -> quiet pad (-40 dB) -> kick+hat beat -> sustained chord
  -> sparse clicks over near-silence -> log sweep 40 Hz..8 kHz -> noise bursts -> fast beat -> fade out
Section lengths are 6..22 s so the Alchemy scheduler sees several full effect cycles.
Frames are analysed exactly as gen_frames.py wav mode (same freq_bytes/wave_bytes), in parallel.
"""
import math, random, struct, sys, wave
from multiprocessing import Pool
import gen_frames as G

SR = 44100

def compose(dur):
    random.seed(7)
    L, R = [0.0] * (SR * dur), [0.0] * (SR * dur)
    t0, p = 0, 0
    kinds = ['silence', 'pad', 'beat', 'chord', 'clicks', 'sweep', 'bursts', 'fastbeat', 'fade']
    while t0 < SR * dur:
        kind = kinds[p % len(kinds)]
        seg = int(SR * random.uniform(6, 22)) if kind != 'silence' else int(SR * random.uniform(2, 6))
        f0 = 55.0 * 2 ** (random.randint(0, 11) / 12.0)
        bpm = random.choice([90, 110, 128, 140]) * (1.4 if kind == 'fastbeat' else 1.0)
        pan = random.uniform(0.6, 1.0)
        for i in range(seg):
            n = t0 + i
            if n >= len(L): break
            t = i / SR
            if kind == 'silence': v = 0.0
            elif kind == 'pad':
                v = 0.01 * (math.sin(2*math.pi*f0*2*t) + 0.5*math.sin(2*math.pi*f0*3*t))
            elif kind in ('beat', 'fastbeat'):
                bt = (t * bpm / 60.0) % 1.0
                kick = math.exp(-bt * 18) * math.sin(2*math.pi*(f0*(1 + 2*math.exp(-bt*30)))*t)
                hat = (random.random() - 0.5) * math.exp(-((bt*2) % 1.0) * 60) * 0.5
                v = 0.8 * kick + hat + 0.1 * math.sin(2*math.pi*f0*4*t)
            elif kind == 'chord':
                v = 0.25 * sum(math.sin(2*math.pi*f0*4*r*t) for r in (1.0, 1.25, 1.5)) \
                    * (0.8 + 0.2*math.sin(2*math.pi*0.3*t))
            elif kind == 'clicks':
                v = 0.002 * (random.random() - 0.5) + (0.9 if random.random() < 2.0 / SR else 0.0)
            elif kind == 'sweep':
                v = 0.5 * math.sin(2*math.pi*40.0*seg/SR/math.log(200.0)*(200.0**(i/seg) - 1))
            elif kind == 'bursts':
                v = (random.random() - 0.5) * 1.6 if (t % 1.3) < 0.15 else 0.0
            else:  # fade: chord fading to nothing
                v = 0.4 * (1 - i / seg) ** 2 * math.sin(2*math.pi*f0*2*t)
            v = max(-1.0, min(1.0, v))
            L[n] = v; R[n] = v * pan
        t0 += seg; p += 1
    return L, R

def write_wav(path, L, R):
    w = wave.open(path, 'wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(b''.join(struct.pack('<hh', int(a * 32767), int(b * 32767)) for a, b in zip(L, R)))
    w.close()

CH = None
def one(f):
    end = int(round((f + 1) * SR / FPS)); row = []
    for c in CH:
        seg = ([0.0] * G.N_FFT + c[max(0, end - G.N_FFT):end])[-G.N_FFT:]
        row.append((G.freq_bytes(seg), G.wave_bytes(seg)))
    return G.frame(row[0][0], row[1][0], row[0][1], row[1][1])

if __name__ == '__main__':
    wav, out = sys.argv[1], sys.argv[2]
    N = int(sys.argv[3]) if len(sys.argv) > 3 else 30000
    FPS = float(sys.argv[4]) if len(sys.argv) > 4 else 60.0
    write_wav(wav, *compose(int(N / FPS) + 2))
    CH, _ = G.read_wav(wav)                  # analyse the 16-bit-quantised samples, like wav mode
    with Pool() as pool:
        frames = pool.map(one, range(N), chunksize=200)
    open(out, 'wb').write(b''.join(frames))
    print('%d frames -> %s' % (N, out))
