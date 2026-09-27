#!/usr/bin/env python3
"""Print the Bars and Waves .rdata tables as the JS literals src/60-bars.js embeds.
  python3 bars_tables.py [/mnt/c/Windows/System32/wmp.dll]
T_lin float[256] @0x180851690 (hex of the LE float32 bytes), T_mant int[2048] @0x180851a90 (0..10,
monotone: the 10 indices where it steps), T_exp int[256] @0x180853a90 (T_exp[0], then each step - 9)."""
import struct, sys
d = open(sys.argv[1] if len(sys.argv) > 1 else '/mnt/c/Windows/System32/wmp.dll', 'rb').read()
pe = struct.unpack_from('<I', d, 0x3c)[0]
ns, osz = struct.unpack_from('<H', d, pe + 6)[0], struct.unpack_from('<H', d, pe + 20)[0]
def off(va):
    rva = va - 0x180000000
    for i in range(ns):
        vs, va_, rs, rp = struct.unpack_from('<IIII', d, pe + 24 + osz + 40 * i + 8)
        if va_ <= rva < va_ + max(vs, rs): return rva - va_ + rp
L = d[off(0x180851690):off(0x180851690) + 1024]
M = struct.unpack_from('<2048i', d, off(0x180851a90))
E = struct.unpack_from('<256i', d, off(0x180853a90))
assert M[0] == 0 and all(M[i] - M[i - 1] in (0, 1) for i in range(1, 2048))
assert all(E[i] - E[i - 1] in (9, 10) for i in range(1, 256))
print("var T_LIN_HEX = '%s';" % L.hex())
print('var T_MANT_STEPS = %s;' % [i for i in range(1, 2048) if M[i] != M[i - 1]])
print("var T_EXP0 = %d, T_EXP_STEPS = '%s';" % (E[0], ''.join(str(E[i] - E[i - 1] - 9) for i in range(1, 256))))
