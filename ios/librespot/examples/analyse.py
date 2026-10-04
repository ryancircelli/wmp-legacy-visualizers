#!/usr/bin/env python3
"""Reads a harness run (examples/harness.rs; ios/README.md, "Testing on a desktop"): the WAV it wrote and
its log (its stdout, `<seconds> <frame> <kind> <text>` a line), by convention side by side with the same
name (--out run.wav | tee run.log).

  analyse.py crossfade run.wav [run.log]
      each crossfade boundary in the log: RMS and peak (dB, a full-scale sine is -3) in 0.5 s windows
      from 2 s before the fade to 2 s after, and a verdict: a blend holds its level, with no window
      dropping to silence and none well over both sides (both songs at full: a doubling)
  analyse.py bands run.wav START+SECS [START+SECS | other.wav ...]
      the level in each of the equalizer's ten bands over each range, and each range's difference from
      the first: START is seconds into the WAV, or a mark's text from the WAV's log; a .wav switches
      the file the ranges after it read
  analyse.py selftest
      synthetic runs through both, checked

Standard library only. With numpy installed the bands are octave bands by FFT; without it, the level at
each band's centre by Goertzel (--stdlib forces that). The two are different measures: compare within one.
"""
import array
import math
import os
import re
import sys
import tempfile
import wave

try:
    import numpy as np
except ImportError:
    np = None

RATE = 44100
BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
FULL = 32768.0


def db(ms):
    """A mean square (full scale 1.0) in dB, -99 for silence."""
    return max(-99.0, 10 * math.log10(ms)) if ms > 0 else -99.0


def read(path, start=0, n=None):
    """Frames [start, start + n) as interleaved int16."""
    with wave.open(path) as w:
        if (w.getnchannels(), w.getsampwidth(), w.getframerate()) != (2, 2, RATE):
            sys.exit(f"{path}: not the harness's 16-bit stereo 44.1 kHz")
        start = max(0, min(start, w.getnframes()))
        w.setpos(start)
        a = array.array("h", w.readframes(w.getnframes() - start if n is None else n))
    if sys.byteorder == "big":
        a.byteswap()
    return a


def log_of(wav):
    return os.path.splitext(wav)[0] + ".log"


def log_lines(path):
    """(seconds, frame, kind, text) per harness line; anything else skipped."""
    out = []
    with open(path, errors="replace") as f:
        for line in f:
            p = line.rstrip("\n").split(None, 3)
            try:
                out.append((float(p[0]), int(p[1]), p[2], p[3] if len(p) > 3 else ""))
            except (ValueError, IndexError):
                pass
    return out


def window(a):
    """(RMS dB, peak dB, clipped) of interleaved int16."""
    if not a:
        return -99.0, -99.0, False
    peak = max(max(a), -min(a))
    return db(sum(x * x for x in a) / len(a) / FULL**2), db((peak / FULL) ** 2), peak >= 32767


FADE = re.compile(r"librespot: crossfade over ([\d.]+) s")
GAPLESS = "librespot: crossfade: too little queued, gapless"


def crossfade(wav, log=None, win=0.5, pad=2.0, out=print):
    """Each boundary's windows, printed; returns each one's verdict."""
    lines = log_lines(log or log_of(wav))
    verdicts = []
    for i, (t, frame, kind, text) in enumerate(lines):
        m = FADE.search(text) if kind == "log" else None
        if not m and not (kind == "log" and GAPLESS in text):
            continue
        fade = float(m.group(1)) if m else 0.0
        mixed = None  # the library's own line on the fade's levels, before the next boundary
        for x in lines[i + 1:]:
            if FADE.search(x[3]) or GAPLESS in x[3]:
                break
            if "crossfade mixed" in x[3]:
                mixed = x[3]
                break
        out(f"\n{'crossfade over %.1f s' % fade if m else 'gapless (too little queued)'} at {frame / RATE:.3f} s (frame {frame})")
        if mixed:
            out(f"  {mixed}")
        span = read(wav, frame + round(-pad * RATE), round((fade + 2 * pad) * RATE))
        step = round(win * RATE) * 2
        rows = []
        out(f"  {'window (s)':>13}  {'rms dB':>7}  {'peak dB':>7}")
        for k in range(0, len(span) - step + 1, step):
            a = k / 2 / RATE - pad
            rms, peak, clip = window(span[k:k + step])
            where = "fade" if a >= 0 and a + win <= fade + 1e-9 else "before" if a + win <= 1e-9 else "after" if a >= fade - 1e-9 else "edge"
            rows.append((where, rms, peak, clip))
            out(f"  {a:6.1f}..{a + win:<5.1f}  {rms:7.1f}  {peak:7.1f}{'  clipped' if clip else ''}{'  *' if where == 'fade' else ''}")
        side = lambda w: db(sum(10 ** (r / 10) for x, r, _, _ in rows if x == w) / max(1, sum(x == w for x, *_ in rows)))
        inside = [r for r in rows if r[0] == "fade"]
        before, after = side("before"), side("after")
        flags = []
        # a gap need not line up with the windows: silence is looked for 50 ms at a time
        fade_span = span[round(pad * RATE) * 2:round((pad + fade) * RATE) * 2]
        blk = RATE // 20 * 2
        silent = sum(window(fade_span[k:k + blk])[0] < -50 for k in range(0, len(fade_span) - blk + 1, blk))
        if silent:
            flags.append(f"silent: {silent * 50} ms of the fade under -50 dB (a gap, not a blend)")
        if inside and max(r[1] for r in inside) > max(before, after) + 2:
            flags.append("loud: the fade over 2 dB above both sides (both songs at full?)")
        if any(r[3] for r in inside):
            flags.append("clipped in the fade")
        lo, hi = (min(r[1] for r in inside), max(r[1] for r in inside)) if inside else (-99.0, -99.0)
        out(f"  before {before:.1f} dB, after {after:.1f} dB" + (f", fade {lo:.1f} to {hi:.1f} dB" if inside else ""))
        out("  verdict: " + ("; ".join(flags) if flags else "continuous: no dip to silence, no doubling" if inside else "no fade"))
        verdicts.append({"at": frame, "fade": fade, "flags": flags, "before": before, "after": after, "lo": lo, "hi": hi})
    if not verdicts:
        out("no crossfade boundary in the log (a 'librespot: crossfade over' line needs crossfade:<s>, real time, and a natural track end)")
    return verdicts


def levels(x, use_numpy):
    """Mono samples (-1..1) to each band's mean square (a sine of amplitude A: A²/2)."""
    if use_numpy:
        b = 16384  # 2.7 Hz bins, so even the 32 Hz octave (23 to 45 Hz) has eight
        x = np.asarray(x, dtype=float)
        x = np.pad(x, (0, max(0, b - len(x))))
        w = np.hanning(b)
        p = np.mean([np.abs(np.fft.rfft(x[i:i + b] * w)) ** 2 for i in range(0, len(x) - b + 1, b // 2)], axis=0)
        f = np.fft.rfftfreq(b, 1 / RATE)
        return [float(p[(f >= c / 2**0.5) & (f < c * 2**0.5)].sum() * 2 / (b * np.sum(w**2))) for c in BANDS]
    # ponytail: Goertzel at the centre in Hann blocks of 4096 (11 Hz bins), not an octave's energy; numpy
    # gives the octave
    b = 4096
    w = [0.5 - 0.5 * math.cos(2 * math.pi * n / b) for n in range(b)]
    acc, blocks = [0.0] * len(BANDS), 0
    for i in range(0, len(x) - b + 1, b):
        xw = [s * v for s, v in zip(x[i:i + b], w)]
        for k, c in enumerate(BANDS):
            co, s1, s2 = 2 * math.cos(2 * math.pi * c / RATE), 0.0, 0.0
            for v in xw:
                s1, s2 = v + co * s1 - s2, s1
            acc[k] += s1 * s1 + s2 * s2 - co * s1 * s2
        blocks += 1
    return [2 * a / max(1, blocks) / sum(w) ** 2 for a in acc]


def start_of(spec, wav):
    """A range's start in frames: seconds, or a mark's text from the WAV's log."""
    try:
        return round(float(spec) * RATE)
    except ValueError:
        log = log_of(wav)
        marks = [f for _, f, kind, text in (log_lines(log) if os.path.exists(log) else []) if kind == "mark" and text == spec]
        if not marks:
            sys.exit(f"no mark {spec!r} in {log}")
        return marks[0]


def bands(items, use_numpy=None, out=print):
    """Each range's band levels in dB, printed with differences from the first; returns the levels."""
    use_numpy = np is not None if use_numpy is None else use_numpy
    wav, cols = None, []
    for it in items:
        if it.lower().endswith(".wav"):
            wav = it
            continue
        if wav is None or "+" not in it:
            sys.exit("bands wants run.wav START+SECS [START+SECS | other.wav ...]")
        spec, secs = it.rsplit("+", 1)
        n = round(float(secs) * RATE)
        if n < RATE // 2:
            sys.exit(f"{it}: half a second at least")
        a = read(wav, start_of(spec, wav), n)
        if len(a) < 2 * n:
            sys.exit(f"{it}: past the end of {wav}")
        mono = [(a[i] + a[i + 1]) / (2 * FULL) for i in range(0, len(a), 2)]
        cols.append((f"{os.path.basename(wav)} {it}" if len({x for x in items if x.lower().endswith('.wav')}) > 1 else it, [db(m) for m in levels(mono, use_numpy)]))
    if not cols:
        sys.exit("no range")
    out("octave-band levels by FFT (numpy)" if use_numpy else "levels at the band centres by Goertzel (numpy not used)")
    width = max(12, *(len(c) + 2 for c, _ in cols))
    head = "".join(f"{c:>{width}}" for c, _ in cols) + "".join(f"{'diff ' + str(k + 2):>9}" for k in range(len(cols) - 1))
    out(f"{'band':>8}{head}")
    for i, f in enumerate(BANDS):
        name = f"{f // 1000} kHz" if f >= 1000 else f"{f} Hz"
        row = "".join(f"{v[i]:>{width}.1f}" for _, v in cols) + "".join(f"{v[i] - cols[0][1][i]:>+9.1f}" for _, v in cols[1:])
        out(f"{name:>8}{row}")
    return [v for _, v in cols]


def write_wav(path, mono):
    a = array.array("h", (max(-32767, min(32767, int(s * 32767))) for s in mono for _ in (0, 1)))
    if sys.byteorder == "big":
        a.byteswap()
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(a.tobytes())


def selftest():
    sine = lambda f, a, i: a * math.sin(2 * math.pi * f * i / RATE)
    with tempfile.TemporaryDirectory() as d:
        # Three boundaries 2 s long between tones a fifth apart: an equal-power blend, a gap (each side
        # faded to nothing, half a second of silence between), and both at full (a doubling).
        L = 2.0
        at = [5.0, 15.0, 25.0]
        def sample(i):
            t = i / RATE
            k = sum(t >= a for a in at)  # boundaries passed
            old, new = sine(220 * 1.5 ** ((k - 1) % 2), 0.4, i), sine(220 * 1.5 ** (k % 2), 0.4, i)
            if k == 0 or t >= at[k - 1] + L:
                return new
            u = (t - at[k - 1]) / L
            if k == 1:
                return old * math.cos(u * math.pi / 2) + new * math.sin(u * math.pi / 2)
            if k == 2:
                return old * max(0.0, 1 - u / 0.375) + new * max(0.0, (u - 0.625) / 0.375)
            return old + new
        wav = os.path.join(d, "fade.wav")
        write_wav(wav, [sample(i) for i in range(30 * RATE)])
        with open(log_of(wav), "w") as f:
            for a in at:
                f.write(f"{a:9.3f} {round(a * RATE):10} log librespot: crossfade over {L:.1f} s\n")
            f.write(f"{7.0:9.3f} {7 * RATE:10} log librespot: crossfade mixed 2.0 s of the new song (-11 dB) over 2.0 s of the old (-11 dB)\n")
        v = crossfade(wav)
        assert [x["flags"] for x in v][0] == [], v[0]
        assert v[1]["flags"] and v[1]["flags"][0].startswith("silent"), v[1]
        assert v[2]["flags"] and v[2]["flags"][0].startswith("loud"), v[2]
        assert abs(v[0]["hi"] - v[0]["lo"]) < 1.0 and abs(v[0]["before"] - v[0]["after"]) < 0.5, v[0]  # the blend holds level
        # EQ: the ten centres at 0.05 each (-29 dB), then the same with the three lowest 6 dB up
        def tones(i):
            boost = 2.0 if i >= 4 * RATE else 1.0
            return sum(sine(f, 0.05 * (boost if f <= 125 else 1.0), i) for f in BANDS)
        wav = os.path.join(d, "eq.wav")
        write_wav(wav, [tones(i) for i in range(8 * RATE)])
        with open(log_of(wav), "w") as f:
            f.write(f"{0.5:9.3f} {RATE // 2:10} mark flat\n{4.5:9.3f} {9 * RATE // 2:10} mark bass booster\n")
        for use in [False] + ([True] if np is not None else []):
            print()
            flat, bass = bands([wav, "flat+3", "bass booster+3"], use_numpy=use)
            for i, f in enumerate(BANDS):
                assert abs(flat[i] + 29.03) < 0.3, (use, f, flat[i])
                assert abs(bass[i] - flat[i] - (6.02 if f <= 125 else 0.0)) < 0.3, (use, f, bass[i] - flat[i])
    print("\nselftest ok" + ("" if np is not None else " (numpy not installed: the FFT path not run)"))


def main(argv):
    use = False if "--stdlib" in argv else None
    argv = [a for a in argv if a != "--stdlib"]
    if argv[:1] == ["crossfade"] and len(argv) in (2, 3):
        crossfade(*argv[1:])
    elif argv[:1] == ["bands"] and len(argv) >= 3:
        bands(argv[1:], use)
    elif argv == ["selftest"]:
        selftest()
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
