#!/usr/bin/env python3
"""tools/crref.py — correctly-rounded sin/cos/atan2 reference (60-70 digit `decimal`), used to decide
whether ucrtbase or V8 is the one that is 1 ulp off.  Reads <fn>_oracle.txt lines
"<fn> <argbits>[,<argbits>] -> <ucrtbase result bits>" as produced by tools/libm.ps1."""
from decimal import Decimal, getcontext
import struct, random, math, sys
getcontext().prec = 70
PI = Decimal('3.141592653589793238462643383279502884197169399375105820974944592307816406286209')
def sin_dec(x):
    k = int((x/(2*PI)).to_integral_value(rounding='ROUND_HALF_EVEN')); x -= 2*PI*k
    t=x; s=x; xx=x*x; n=1
    while True:
        t = -t*xx/((2*n)*(2*n+1))
        if abs(t) < Decimal('1e-65'): break
        s += t; n += 1
    return s
def cos_dec(x): return sin_dec(PI/2 - x)
def atan_dec(x):
    one=Decimal(1); n=0
    while abs(x) > Decimal('0.05'):
        x = x/(one+(one+x*x).sqrt()); n += 1
    t=x; s=x; xx=x*x; k=1
    while True:
        t = -t*xx; term = t/(2*k+1)
        if abs(term) < Decimal('1e-55'): break
        s += term; k += 1
    return s*(1<<n)
def atan2_dec(y,x):
    if x>0: return atan_dec(Decimal(y)/Decimal(x))
    if x<0:
        a=atan_dec(Decimal(y)/Decimal(x)); return a+PI if y>=0 else a-PI
    return PI/2 if y>0 else (-PI/2 if y<0 else Decimal(0))
def nearest(dv):
    f=float(dv); c=[f, math.nextafter(f,math.inf), math.nextafter(f,-math.inf)]
    return min(c, key=lambda v: abs(Decimal(v)-dv))
bits=lambda v:'%016x'%struct.unpack('<Q',struct.pack('<d',v))[0]
dd=lambda h:struct.unpack('<d',struct.pack('<Q',int(h,16)))[0]
fn=sys.argv[1]; N=int(sys.argv[2]) if len(sys.argv)>2 else 2000
lines=[l.strip() for l in open(fn+'_oracle.txt') if l.strip()]
random.seed(11); badU=badJ=n=0
for line in random.sample(lines, min(N,len(lines))):
    p=line.split(' ')
    if fn=='atan2':
        ya,xa=p[1].split(','); y=dd(ya); x=dd(xa)
        if x==0 and y==0: continue
        cr=bits(nearest(atan2_dec(int(y),int(x)))); py=bits(math.atan2(y,x))
    else:
        x=dd(p[1])
        if x==0: continue
        cr=bits(nearest((sin_dec if fn=='sin' else cos_dec)(Decimal(x))))
        py=bits((math.sin if fn=='sin' else math.cos)(x))
    n+=1
    if cr!=p[3]: badU+=1
    if cr!=py: badJ+=1
print(f'{fn}: n={n}  ucrtbase != correctly-rounded {badU} ({100*badU/n:.3f}%)  glibc != cr {badJ} ({100*badJ/n:.3f}%)')
