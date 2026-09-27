#!/usr/bin/env python3
"""Compare stats.csv distributions: compare.py <label:glob-or-dir> ... [--from F] [--to T]

Each argument is LABEL=path where path is a stats.csv or a directory holding one; several
paths per label separated by commas are pooled (different DLL runs / JS seeds).
Prints mean / median / p10 / p90 of every metric over the frame window, per label.
"""
import csv, os, statistics as st, sys

METRICS = ['mean_lum', 'black_frac', 'p90_lum', 'mean_sat', 'lit_sat', 'lit_lum', 'mean_r', 'mean_g', 'mean_b', 'edge']

def load(paths, lo, hi):
    cols = {m: [] for m in METRICS}
    for p in paths:
        if os.path.isdir(p):
            p = os.path.join(p, 'stats.csv')
        with open(p, newline='') as fh:
            for row in csv.DictReader(fh):
                f = int(row['frame'])
                if f < lo or (hi and f >= hi):
                    continue
                for m in METRICS:
                    cols[m].append(float(row[m]))
    return cols

def q(v, p):
    v = sorted(v)
    return v[min(len(v) - 1, int(p * len(v)))]

def main():
    lo, hi, args = 0, 0, []
    a = sys.argv[1:]
    i = 0
    while i < len(a):
        if a[i] == '--from': lo = int(a[i + 1]); i += 2
        elif a[i] == '--to': hi = int(a[i + 1]); i += 2
        else: args.append(a[i]); i += 1
    print('frames [%d,%s)' % (lo, hi or 'end'))
    print('%-22s %7s %8s %8s %8s %8s' % ('label/metric', 'n', 'mean', 'median', 'p10', 'p90'))
    data = {}
    for arg in args:
        label, _, paths = arg.partition('=')
        c = load(paths.split(','), lo, hi)
        data[label] = c
        for m in METRICS:
            v = c[m]
            print('%-22s %7d %8.4f %8.4f %8.4f %8.4f' % (label + '/' + m, len(v), st.fmean(v), st.median(v), q(v, .10), q(v, .90)))
    labels = list(data)
    if len(labels) == 2:
        A, B = data[labels[0]], data[labels[1]]
        print('\nratio %s / %s (means):' % (labels[1], labels[0]))
        for m in METRICS:
            x, y = st.fmean(A[m]), st.fmean(B[m])
            print('  %-12s %8.4f -> %8.4f   x%.2f' % (m, x, y, (y / x) if x else float('inf')))


# ---- drilldowns (kept here so every number in the report is re-runnable) ----
# compare.py steps real=<dirs> js=<dirs>            paired bass-level response, 60-frame blocks
# compare.py decay real=<dirs> js=<dirs> [REF]      ratio to frame REF (default 89), charge/flash
def _dirs(arg):
    label, _, paths = arg.partition('=')
    return label, paths.split(',')

def _ser(p, k):
    if os.path.isdir(p): p = os.path.join(p, 'stats.csv')
    return [float(r[k]) for r in csv.DictReader(open(p))]

def _welch(a, b):
    return (st.fmean(b) - st.fmean(a)) / ((st.stdev(a) ** 2 / len(a) + st.stdev(b) ** 2 / len(b)) ** 0.5)

def cmd_steps(args):
    LV, BLOCK, SKIP = (0, 64, 128, 192, 255), 60, 30
    for k in ('mean_lum', 'lit_lum', 'black_frac', 'lit_sat', 'edge'):
        print(k)
        print('  %-6s' % 'side', ' '.join('%8s' % ('V=%d' % v) for v in LV))
        for arg in args:
            label, paths = _dirs(arg)
            per = []
            for p in paths:
                acc = {v: [] for v in LV}
                for f, val in enumerate(_ser(p, k)):
                    if f % BLOCK >= SKIP: acc[LV[(f // BLOCK) % 5]].append(val)
                per.append({v: st.fmean(acc[v]) for v in LV})
            print('  %-6s' % label, ' '.join('%8.3f' % st.fmean(d[v] for d in per) for v in LV))
            print('  %-6s' % '  +/-', ' '.join('%8.3f' % st.stdev(d[v] for d in per) for v in LV))
        print()

def cmd_decay(args, ref=89):
    F = (100, 110, 120, 150, 180, 210)
    got = [(lab, paths) for lab, paths in map(_dirs, args)]
    for k in ('mean_lum', 'lit_lum', 'edge', 'black_frac'):
        curves = {}
        for lab, paths in got:
            curves[lab] = {f: [_ser(p, k)[f] / (_ser(p, k)[ref] or 1) for p in paths] for f in F}
        for f in F:
            line = '%-10s f=%3d' % (k, f)
            for lab, _ in got:
                v = curves[lab][f]
                line += '   %s %6.3f (med %6.3f)' % (lab, st.fmean(v), st.median(v))
            if len(got) == 2:
                line += '   t=%+5.2f' % _welch(curves[got[0][0]][f], curves[got[1][0]][f])
            print(line)
        print()

if len(sys.argv) > 1 and sys.argv[1] in ('steps', 'decay'):
    if sys.argv[1] == 'steps': cmd_steps(sys.argv[2:])
    else: cmd_decay([a for a in sys.argv[2:] if '=' in a],
                    int([a for a in sys.argv[2:] if '=' not in a][0]) if any('=' not in a for a in sys.argv[2:]) else 89)
    sys.exit(0)

if __name__ == '__main__':
    main()
