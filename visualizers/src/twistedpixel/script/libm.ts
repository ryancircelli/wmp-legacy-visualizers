// The C runtime math vbscript.dll calls for Sin, Cos, Tan, Atn, Exp, Log, Sqr and ^ (msvcrt's SSE2 "precise"
// entries, which ignore the x87 control word). Math.* stands in for them: Sqr is identical; the others match
// except for 1-ulp differences on a few percent of inputs (about 0.1% for ^), and msvcrt reduces trigonometric
// arguments of magnitude 2^30 and above differently. The error rules VBScript wraps around them live in vbscript.ts.
export const sin = Math.sin, cos = Math.cos, atan = Math.atan, exp = Math.exp, log = Math.log, pow = Math.pow, sqrt = Math.sqrt;
