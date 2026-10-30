// VARIANT-level helpers shared by the VBScript and JScript interpreters: type codes, runtime errors, arrays, the
// number <-> string conversions of OLE Automation (en-US), and the host boundary conversions TwistedPixel's
// dispatch object applies (argument coercion to the declared parameter type, and the float32 store of a variable).

export const EMPTY = 0, NULL = 1, I2 = 2, I4 = 3, R4 = 4, R8 = 5, BSTR = 8, ERROR = 10, BOOL = 11, VARIANT = 12, UI1 = 17;
export const ARRAY = 0x2000;
/** VT_ARRAY | VT_VARIANT: every VBScript array */
export const VARR = 0x200c;

const fround = Math.fround;

/** Error with V8's stackTraceLimit (absent from the DOM lib typings) */
export const V8Error = Error as ErrorConstructor & { stackTraceLimit: number };

/**
 * A VBScript runtime error: number is the VBScript error number (the engine reports 0x800A0000 | number).
 * description is what the script's Err.Description reads; an unhandled error's EXCEPINFO description adds
 * ": '<detail>'" when there is a detail (a function or variable name, or the offending value).
 */
export class VbsError extends Error {
  line = -1;
  col = -1;
  constructor(public number: number, public description: string, public detail?: string) {
    // no stack trace: a preset can raise an error on every pixel of every frame, and capturing the (deep) stack
    // would cost more than running the script
    const limit = V8Error.stackTraceLimit;
    V8Error.stackTraceLimit = 0;
    super(description);
    V8Error.stackTraceLimit = limit;
  }
}

const DESCRIPTIONS: Record<number, string> = {
  5: 'Invalid procedure call or argument', 6: 'Overflow', 9: 'Subscript out of range',
  10: 'This array is fixed or temporarily locked', 11: 'Division by zero', 13: 'Type mismatch', 94: 'Invalid use of Null',
  424: 'Object required', 438: "Object doesn't support this property or method",
  446: "Object doesn't support named arguments", 450: 'Wrong number of arguments or invalid property assignment',
  500: 'Variable is undefined', 501: 'Illegal assignment', 5017: 'Syntax error in regular expression',
};
export function vbErr(n: number, detail?: string): VbsError {
  return new VbsError(n, DESCRIPTIONS[n] ?? 'Unknown runtime error', detail);
}

/** HRESULT a dispatch call failed with -> the VBScript error it surfaces as */
export function hrErr(hr: number, name?: string): VbsError {
  switch (hr >>> 0) {
    case 0x8002000a: return vbErr(6, name);
    case 0x80020005: return vbErr(13, name);
    case 0x8002000e: return vbErr(450, name);
    case 0x80020003: return vbErr(438, name);
    case 0x80020007: return vbErr(446, name);
    default: return new VbsError(hr | 0, 'Unknown runtime error', name);
  }
}
export const DISP_E_OVERFLOW = 0x8002000a, DISP_E_TYPEMISMATCH = 0x80020005;

/**
 * A VBScript array (a SAFEARRAY of VARIANTs): per element a type code and a number or an object (string, array).
 * Dimensions all have lower bound 0, as VBScript's own; elements are stored with the first index varying fastest,
 * as a SAFEARRAY lays them out. No dimensions stands for the unallocated array of `Dim a()` or Erase (a null
 * SAFEARRAY: every access is "Subscript out of range").
 */
export class VbArray {
  t: Uint16Array;
  n: Float64Array;
  o: unknown[];
  constructor(public ub: number[], public fixed: boolean) {
    let size = ub.length ? 1 : 0;
    for (const u of ub) size *= u + 1;
    this.t = new Uint16Array(size);
    this.n = new Float64Array(size);
    this.o = new Array(size);
  }
  get size(): number { return this.t.length; }
  /** flat index of the subscripts; -1 for a wrong number of them (or no storage), -2 - d when subscript d is out of range */
  index(subs: number[]): number {
    const ub = this.ub;
    if (subs.length !== ub.length) return -1;
    let k = 0, mul = 1;
    for (let d = 0; d < ub.length; d++) {
      const s = subs[d];
      if (s < 0 || s > ub[d]) return -2 - d;
      k += s * mul;
      mul *= ub[d] + 1;
    }
    return k;
  }
  copy(): VbArray {
    const a = new VbArray(this.ub.slice(), false);
    a.t.set(this.t);
    a.n.set(this.n);
    for (let i = 0; i < this.o.length; i++) {
      const v = this.o[i];
      a.o[i] = v instanceof VbArray ? v.copy() : v;
    }
    return a;
  }
}

// ---------------------------------------------------------------------------------------------- number <-> string

/**
 * Number -> string as OLE Automation formats it (VarBstrFromR8 / VarBstrFromR4, en-US): `digits` significant digits
 * (15 for Double, 7 for Single), trailing zeros dropped; plain notation when that needs no more than `digits` digit
 * positions, otherwise d.dddE+XX.
 */
export function formatReal(x: number, digits: number): string {
  if (x !== x) {
    // the NaN the FPU produces (sign set) prints as -1.#IND; a positive quiet NaN as 1.#QNAN
    F64[0] = x;
    return (U32[1] >>> 31) ? '-1.#IND' : '1.#QNAN';
  }
  if (x === Infinity) return '1.#INF';
  if (x === -Infinity) return '-1.#INF';
  if (x === 0) return '0';
  const neg = x < 0;
  const s = (neg ? -x : x).toExponential(digits - 1);
  const ei = s.indexOf('e');
  let mant = s.slice(0, 1) + s.slice(2, ei);
  const e = +s.slice(ei + 1);
  let end = mant.length;
  while (end > 1 && mant.charCodeAt(end - 1) === 48) end--;
  mant = mant.slice(0, end);
  const nd = mant.length;
  let r: string;
  if (e >= 0 && e < digits) {
    r = nd <= e + 1 ? mant + '0'.repeat(e + 1 - nd) : mant.slice(0, e + 1) + '.' + mant.slice(e + 1);
  } else if (e < 0 && -e - 1 + nd <= digits) {
    r = '0.' + '0'.repeat(-e - 1) + mant;
  } else {
    const ae = e < 0 ? -e : e;
    r = mant[0] + (nd > 1 ? '.' + mant.slice(1) : '') + 'E' + (e < 0 ? '-' : '+') + (ae < 10 ? '0' : '') + ae;
  }
  return neg ? '-' + r : r;
}
const F64 = new Float64Array(1), U32 = new Uint32Array(F64.buffer);

/**
 * String -> Double as VarR8FromStr parses it (en-US): surrounding blanks, a sign, digits with ',' group separators,
 * '.', an exponent, or &H / &O integers. Returns NaN when the string is not a number.
 */
export function parseNumber(s: string): number {
  const t = s.trim();
  let m = /^&H([0-9a-f]{1,8})$/i.exec(t);
  if (m) return hexOct(parseInt(m[1], 16), m[1].length > 4);
  m = /^&O?([0-7]{1,11})$/i.exec(t);
  if (m) { const v = parseInt(m[1], 8); return hexOct(v, v > 0xffff); }
  if (!/^[+-]?(\d[\d,]*\.?\d*|\.\d+)([eEdD][+-]?\d+)?$/.test(t)) return NaN;
  return parseFloat(t.replace(/,/g, '').replace(/[dD]/, 'e'));
}
function hexOct(v: number, long: boolean): number { return long ? v | 0 : (v << 16) >> 16; }

// ---------------------------------------------------------------------------------------------- integer rounding

/** round half to even, as every VARIANT -> integer conversion does */
export function roundEven(x: number): number {
  const r = Math.round(x);
  return r - x === 0.5 && (r & 1) !== 0 ? r - 1 : r;
}

// ---------------------------------------------------------------------------------------------- host boundary

/**
 * The value TwistedPixel stores into a float32 script variable when a script assigns `v` of type `vt` to it:
 * Single as is; Double rounded to float (an overflow becomes infinity, never an error); Integer/Long converted;
 * Boolean stored NEGATED (True stores +1.0); anything else through VariantChangeType to Single, whose failure
 * leaves garbage in the DLL (we store 0).
 */
export function tpStore(v: unknown, vt: number): number {
  switch (vt) {
    case R4: case R8: case I2: case I4: case UI1: return fround(v as number);
    case BOOL: return -(v as number);
    case EMPTY: return 0;
    case BSTR: {
      const d = parseNumber(v as string);
      const r = fround(d);
      return r - r === 0 ? r : 0;
    }
    default: return 0;
  }
}

/**
 * VariantChangeTypeEx(lcid en-US, flags 0) of an argument to the parameter type TwistedPixel declares
 * (Single, Integer, Long or String).
 */
export function convertArg(v: unknown, vt: number, to: number): number | string | null {
  // returns null with lastHr set on failure, to keep the hot path allocation-free
  if (vt === to) return v as number | string;
  if (vt === NULL || (vt & ARRAY) !== 0) { lastHr = DISP_E_TYPEMISMATCH; return null; }
  if (to === BSTR) {
    switch (vt) {
      case EMPTY: return '';
      case I2: case I4: case UI1: return String(v);
      case R4: return formatReal(v as number, 7);
      case R8: return formatReal(v as number, 15);
      case BOOL: return (v as number) ? 'True' : 'False';
    }
    lastHr = DISP_E_TYPEMISMATCH; return null;
  }
  let d: number;
  switch (vt) {
    case EMPTY: d = 0; break;
    case BOOL: case I2: case I4: case UI1: case R4: case R8: d = v as number; break;
    case BSTR: d = parseNumber(v as string); if (d !== d) { lastHr = DISP_E_TYPEMISMATCH; return null; } break;
    default: lastHr = DISP_E_TYPEMISMATCH; return null;
  }
  switch (to) {
    case R4:
    {
      // overflow only when the value rounds beyond the float range (VarR4FromR8, as CSng shows)
      const r = fround(d);
      if (r - r !== 0 && d - d === 0) { lastHr = DISP_E_OVERFLOW; return null; }
      return r;
    }
    case R8: return d;
    case I2:
      if (!(d >= -32768.5 && d < 32767.5)) { lastHr = DISP_E_OVERFLOW; return null; }
      return roundEven(d);
    case I4:
      if (!(d >= -2147483648.5 && d < 2147483647.5)) { lastHr = DISP_E_OVERFLOW; return null; }
      return roundEven(d);
  }
  lastHr = DISP_E_TYPEMISMATCH;
  return null;
}
export let lastHr = 0;
