// A VBScript interpreter for TwistedPixel's presets, giving the same results, bit for bit, as Windows' vbscript.dll
// hosted the way TwistedPixel.dll hosts it. The source is parsed once and compiled to a tree of JavaScript closures
// (no eval / new Function). Every expression closure returns its value and leaves the value's VARIANT type in the
// module register T, so arithmetic allocates nothing: numbers travel as numbers, strings as strings, arrays as
// VbArray objects.
//
// The language covered is what the 333 presets use (and a little more): Option Explicit, Dim / Private / Public /
// Const / ReDim [Preserve] / Erase, Sub and Function with ByVal / ByRef parameters, If / ElseIf / Else (block and
// single line), Select Case, For ... To ... Step ... Next, Exit, Call, On Error Resume Next / GoTo 0, Err.Number /
// Description / Clear, all operators, and the builtins listed in BUILTINS. Anything else is a syntax error.

import * as libm from './libm';
import {
  ARRAY, BOOL, BSTR, EMPTY, I2, I4, NULL, R4, R8, UI1, VARR, VbArray, VbsError, convertArg, formatReal, hrErr,
  lastHr, parseNumber, roundEven, tpStore, vbErr,
} from './variant';
import type { HostMember, ScriptHost, ScriptValue } from './index';

const fround = Math.fround;

/** type of the value the last evaluated expression returned */
let T = 0;

// ================================================================================================ lexer

const ID = 1, NUM = 2, STR = 3, OP = 4, NL = 5, COLON = 6, EOF = 7;
interface Tok { k: number; s: string; v: number; vt: number; line: number; col: number }

export class SyntaxErr extends Error {
  constructor(msg: string, public line: number, public col: number) { super(msg); }
}

const KEYWORDS = new Set(('and byref byval call case const dim do each else elseif empty end eqv erase exit false for function if ' +
  'imp in is loop mod next not nothing null on option or preserve private public redim rem select set sub then to true until ' +
  'wend while with xor').split(' '));


/**
 * A numeric literal's value as vbscript.dll computes it: the first 19 significant digits as an integer (later digits
 * are dropped), divided (or multiplied) by the power of ten exactly, rounded to a 64-bit significand as on the x87,
 * then rounded again to a double. The double rounding makes about one literal in 1500 differ by an ulp from the
 * correctly rounded value (0.671653 is one).
 */
export function literalValue(s: string): number {
  const m = /^(\d*)\.?(\d*)(?:[eE]([+-]?\d+))?$/.exec(s)!;
  let d = (m[1] + m[2]).replace(/^0+/, '');
  let k = m[2].length - (m[3] ? +m[3] : 0);
  if (d.length > 19) { k -= d.length - 19; d = d.slice(0, 19); }
  if (!d) return 0;
  let num = BigInt(d), den = 1n;
  if (k > 0) den = 10n ** BigInt(k); else num *= 10n ** BigInt(-k);
  // num/den = q * 2^e with 2^63 <= q < 2^64, rounded to nearest even
  let e = num.toString(2).length - den.toString(2).length - 64;
  let q: bigint, r: bigint, dd: bigint;
  for (;;) {
    const nn = e < 0 ? num << BigInt(-e) : num;
    dd = e > 0 ? den << BigInt(e) : den;
    q = nn / dd; r = nn % dd;
    if (q >= 1n << 64n) e++; else if (q < 1n << 63n) e--; else break;
  }
  if (2n * r > dd || (2n * r === dd && (q & 1n))) q++;
  // then to the double's precision: 53 bits, fewer for a subnormal (q may have carried to 2^64, which stays exact)
  const lsb = Math.max(e + 11, -1074), drop = BigInt(lsb - e);
  let h = q >> drop;
  const low = q - (h << drop), half = 1n << (drop - 1n);
  if (low > half || (low === half && (h & 1n))) h++;
  // ponytail: no overflow handling; literals beyond the double range don't occur in presets
  return Number(h) * 2 ** lsb;
}

function lex(src: string, spelling: Map<string, string>): Tok[] {
  const toks: Tok[] = [];
  let i = 0, line = 0, ls = 0;
  const n = src.length;
  const push = (k: number, s: string, start: number, v = 0, vt = 0) => toks.push({ k, s, v, vt, line, col: start - ls });
  while (i < n) {
    const c = src.charCodeAt(i);
    if (c === 10 || c === 13) {
      push(NL, '\n', i);
      if (c === 13 && src.charCodeAt(i + 1) === 10) i++;
      i++; line++; ls = i;
      continue;
    }
    if (c === 32 || c === 9 || c < 32) { i++; continue; }
    if (c === 39) { while (i < n && src.charCodeAt(i) !== 10 && src.charCodeAt(i) !== 13) i++; continue; }
    if (c === 95) { // '_' line continuation
      let j = i + 1;
      while (j < n && (src.charCodeAt(j) === 32 || src.charCodeAt(j) === 9)) j++;
      if (j >= n || src.charCodeAt(j) === 10 || src.charCodeAt(j) === 13) {
        if (src.charCodeAt(j) === 13 && src.charCodeAt(j + 1) === 10) j++;
        i = j + 1; line++; ls = i;
        continue;
      }
      throw new SyntaxErr('Invalid character', line, i - ls);
    }
    const start = i;
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) {
      while (i < n && /[A-Za-z0-9_]/.test(src[i])) i++;
      const s = src.slice(start, i), lo = s.toLowerCase();
      if (lo === 'rem') { while (i < n && src.charCodeAt(i) !== 10 && src.charCodeAt(i) !== 13) i++; continue; }
      if (!KEYWORDS.has(lo) && !spelling.has(lo)) spelling.set(lo, s);
      push(ID, s, start);
      continue;
    }
    if ((c >= 48 && c <= 57) || (c === 46 && /[0-9]/.test(src[i + 1] ?? ''))) {
      let real = false;
      while (i < n && /[0-9]/.test(src[i])) i++;
      if (src[i] === '.') { real = true; i++; while (i < n && /[0-9]/.test(src[i])) i++; }
      if ((src[i] === 'e' || src[i] === 'E') && /[0-9+-]/.test(src[i + 1] ?? '')) {
        real = true; i++;
        if (src[i] === '+' || src[i] === '-') i++;
        while (i < n && /[0-9]/.test(src[i])) i++;
      }
      const s = src.slice(start, i);
      const v = literalValue(s);
      const vt = real || v > 2147483647 ? R8 : v > 32767 ? I4 : I2;
      push(NUM, s, start, v, vt);
      continue;
    }
    if (c === 34) {
      let s = '';
      i++;
      for (;;) {
        if (i >= n || src.charCodeAt(i) === 10 || src.charCodeAt(i) === 13) throw new SyntaxErr('Unterminated string constant', line, start - ls);
        if (src.charCodeAt(i) === 34) {
          if (src.charCodeAt(i + 1) === 34) { s += '"'; i += 2; continue; }
          i++;
          break;
        }
        s += src[i++];
      }
      push(STR, s, start);
      continue;
    }
    if (c === 38 && /[hHoO]/.test(src[i + 1] ?? '')) { // &H.. / &O..
      const hex = /[hH]/.test(src[i + 1]);
      i += 2;
      const d0 = i;
      while (i < n && (hex ? /[0-9a-fA-F]/ : /[0-7]/).test(src[i])) i++;
      const digits = src.slice(d0, i);
      if (src[i] === '&') i++;
      const raw = parseInt(digits, hex ? 16 : 8);
      const long = raw > 0xffff;
      push(NUM, src.slice(start, i), start, long ? raw | 0 : (raw << 16) >> 16, long ? I4 : I2);
      continue;
    }
    if (c === 58) { push(COLON, ':', start); i++; continue; }
    const two = src.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '<>') { push(OP, two, start); i += 2; continue; }
    if ('+-*/\\^&=<>(),.'.includes(src[i])) { push(OP, src[i], start); i++; continue; }
    throw new SyntaxErr('Invalid character', line, i - ls);
  }
  push(NL, '\n', i);
  toks.push({ k: EOF, s: '', v: 0, vt: 0, line, col: i - ls });
  return toks;
}

// ================================================================================================ parser

type Expr =
  | { k: 'lit'; v: unknown; t: number }
  | { k: 'name'; name: string; args: Expr[] | null; line: number; col: number }
  | { k: 'member'; obj: string; prop: string }
  | { k: 'bin'; op: string; a: Expr; b: Expr }
  | { k: 'un'; op: string; a: Expr }
  | { k: 'paren'; e: Expr };

type Stmt = { line: number; col: number } & (
  | { k: 'assign'; target: Expr; e: Expr }
  | { k: 'call'; target: Expr; args: Expr[] }
  | { k: 'if'; conds: { c: Expr; body: Stmt[]; line: number; col: number }[]; els: Stmt[] | null }
  | { k: 'for'; v: Expr; from: Expr; to: Expr; step: Expr | null; body: Stmt[] }
  | { k: 'select'; e: Expr; cases: { vals: Expr[] | null; body: Stmt[] }[] }
  | { k: 'dim'; items: { name: string; dims: Expr[] | null }[] }
  | { k: 'const'; items: { name: string; e: Expr }[] }
  | { k: 'redim'; preserve: boolean; items: { name: string; dims: Expr[] }[] }
  | { k: 'erase'; names: string[] }
  | { k: 'exit'; what: string }
  | { k: 'onerror'; resume: boolean }
  | { k: 'nop' });

interface ProcDecl { name: string; isFunc: boolean; params: { name: string; byref: boolean }[]; body: Stmt[]; line: number }

class Parser {
  p = 0;
  constructor(public toks: Tok[]) {}
  get t(): Tok { return this.toks[this.p]; }
  err(msg: string, tok = this.t): never { throw new SyntaxErr(msg, tok.line, tok.col); }
  isKw(w: string, tok = this.t): boolean { return tok.k === ID && tok.s.toLowerCase() === w; }
  isOp(o: string, tok = this.t): boolean { return tok.k === OP && tok.s === o; }
  eatKw(w: string): boolean { if (this.isKw(w)) { this.p++; return true; } return false; }
  eatOp(o: string): boolean { if (this.isOp(o)) { this.p++; return true; } return false; }
  needKw(w: string): void { if (!this.eatKw(w)) this.err(`Expected '${w}'`); }
  needOp(o: string): void { if (!this.eatOp(o)) this.err(`Expected '${o}'`); }
  ident(): string {
    const t = this.t;
    if (t.k !== ID || KEYWORDS.has(t.s.toLowerCase())) this.err('Expected identifier');
    this.p++;
    return t.s;
  }
  endOfStmt(): boolean { const k = this.t.k; return k === NL || k === COLON || k === EOF || this.isKw('else'); }
  sep(): void {
    if (this.t.k === NL || this.t.k === COLON) { while (this.t.k === NL || this.t.k === COLON) this.p++; return; }
    if (this.t.k !== EOF) this.err('Expected end of statement');
  }
  skipSeps(): void { while (this.t.k === NL || this.t.k === COLON) this.p++; }

  program(): { procs: ProcDecl[]; top: Stmt[]; explicit: boolean } {
    const procs: ProcDecl[] = [], top: Stmt[] = [];
    let explicit = false;
    this.skipSeps();
    while (this.t.k !== EOF) {
      if (this.isKw('option')) { this.p++; this.needKw('explicit'); explicit = true; this.sep(); continue; }
      let q = this.p;
      if (this.isKw('private') || this.isKw('public')) q++;
      if (this.isKw('sub', this.toks[q]) || this.isKw('function', this.toks[q])) { this.p = q; procs.push(this.proc()); continue; }
      top.push(this.stmt());
      this.sep();
    }
    return { procs, top, explicit };
  }

  proc(): ProcDecl {
    const line = this.t.line;
    const isFunc = this.isKw('function');
    this.p++;
    const name = this.ident();
    const params: { name: string; byref: boolean }[] = [];
    if (this.eatOp('(')) {
      if (!this.isOp(')')) {
        do {
          let byref = true;
          if (this.eatKw('byval')) byref = false;
          else this.eatKw('byref');
          params.push({ name: this.ident(), byref });
          if (this.eatOp('(')) this.needOp(')');
        } while (this.eatOp(','));
      }
      this.needOp(')');
    }
    this.sep();
    const body = this.block(['end']);
    this.needKw('end');
    this.needKw(isFunc ? 'function' : 'sub');
    this.sep();
    return { name, isFunc, params, body, line };
  }

  /** statements up to (not including) one starting with any of the keywords in `ends` */
  block(ends: string[]): Stmt[] {
    const out: Stmt[] = [];
    this.skipSeps();
    while (this.t.k !== EOF && !ends.some((e) => this.isKw(e))) {
      out.push(this.stmt());
      this.sep();
    }
    return out;
  }

  stmt(): Stmt {
    const t = this.t, line = t.line, col = t.col;
    const at = <S extends object>(s: S) => ({ line, col, ...s }) as unknown as Stmt;
    if (t.k !== ID) this.err('Expected statement');
    const kw = t.s.toLowerCase();
    switch (kw) {
      case 'dim': case 'private': case 'public': {
        this.p++;
        const items: { name: string; dims: Expr[] | null }[] = [];
        do {
          const name = this.ident();
          let dims: Expr[] | null = null;
          if (this.eatOp('(')) { dims = this.isOp(')') ? [] : this.exprList(); this.needOp(')'); }
          items.push({ name, dims });
        } while (this.eatOp(','));
        return at({ k: 'dim', items });
      }
      case 'const': {
        this.p++;
        const items: { name: string; e: Expr }[] = [];
        do { const name = this.ident(); this.needOp('='); items.push({ name, e: this.expr() }); } while (this.eatOp(','));
        return at({ k: 'const', items });
      }
      case 'redim': {
        this.p++;
        const preserve = this.eatKw('preserve');
        const items: { name: string; dims: Expr[] }[] = [];
        do { const name = this.ident(); this.needOp('('); const dims = this.exprList(); this.needOp(')'); items.push({ name, dims }); } while (this.eatOp(','));
        return at({ k: 'redim', preserve, items });
      }
      case 'erase': {
        this.p++;
        const names: string[] = [];
        do names.push(this.ident()); while (this.eatOp(','));
        return at({ k: 'erase', names });
      }
      case 'exit': {
        this.p++;
        const w = this.t.s.toLowerCase();
        if (!['sub', 'function', 'for', 'do'].includes(w)) this.err('Expected Sub, Function, For or Do');
        this.p++;
        return at({ k: 'exit', what: w });
      }
      case 'on': {
        this.p++;
        this.needKw('error');
        if (this.eatKw('resume')) { this.needKw('next'); return at({ k: 'onerror', resume: true }); }
        if (this.t.k === ID && this.t.s.toLowerCase() === 'goto') { this.p++; if ((this.t.k as number) === NUM && this.t.v === 0) { this.p++; return at({ k: 'onerror', resume: false }); } }
        return this.err("Expected 'Resume Next' or 'GoTo 0'");
      }
      case 'if': return this.ifStmt(line, col);
      case 'select': {
        this.p++;
        this.needKw('case');
        const e = this.expr();
        this.sep();
        const cases: { vals: Expr[] | null; body: Stmt[] }[] = [];
        while (this.eatKw('case')) {
          let vals: Expr[] | null = null;
          if (!this.eatKw('else')) vals = this.exprList();
          this.sep();
          cases.push({ vals, body: this.block(['case', 'end']) });
        }
        this.needKw('end');
        this.needKw('select');
        return at({ k: 'select', e, cases });
      }
      case 'for': {
        this.p++;
        if (this.isKw('each')) this.err('For Each is not supported');
        const v = this.lvalue();
        this.needOp('=');
        const from = this.expr();
        this.needKw('to');
        const to = this.expr();
        let step: Expr | null = null;
        if (this.t.k === ID && this.t.s.toLowerCase() === 'step') { this.p++; step = this.expr(); }
        this.sep();
        const body = this.block(['next']);
        this.needKw('next');
        if (this.t.k === ID && !this.endOfStmt()) this.ident();
        return at({ k: 'for', v, from, to, step, body });
      }
      case 'call': {
        this.p++;
        const target = this.primaryName();
        return at({ k: 'call', target, args: [] });
      }
      case 'option': this.err("'Option' must come first");
    }
    if (KEYWORDS.has(kw)) this.err('Expected statement');
    // assignment or call
    const save = this.p;
    const name = this.ident();
    if (this.isOp('.')) { // Err.Clear and friends
      this.p++;
      const prop = this.ident();
      return at({ k: 'call', target: { k: 'member', obj: name, prop }, args: [] });
    }
    if (this.eatOp('=')) return at({ k: 'assign', target: { k: 'name', name, args: null, line, col }, e: this.expr() });
    if (this.isOp('(')) {
      this.p++;
      const args = this.isOp(')') ? [] : this.exprList();
      this.needOp(')');
      if (this.eatOp('=')) return at({ k: 'assign', target: { k: 'name', name, args, line, col }, e: this.expr() });
      if (this.endOfStmt()) {
        // `Foo(x)` as a statement passes x by value (the parentheses belong to the argument)
        const a = args.length === 1 ? [{ k: 'paren', e: args[0] } as Expr] : args;
        if (args.length > 1) this.err('Cannot use parentheses when calling a Sub');
        return at({ k: 'call', target: { k: 'name', name, args: null, line, col }, args: a });
      }
      this.p = save + 1; // `Foo (a) + 1, b`: the parentheses start the first argument
    }
    const args = this.endOfStmt() ? [] : this.exprList();
    return at({ k: 'call', target: { k: 'name', name, args: null, line, col }, args });
  }

  ifStmt(line: number, col: number): Stmt {
    this.p++;
    const c = this.expr();
    this.needKw('then');
    if (this.t.k !== NL && this.t.k !== COLON) {
      // single-line If
      const body = this.lineStmts();
      let els: Stmt[] | null = null;
      if (this.eatKw('else')) els = this.lineStmts();
      if (this.isKw('end') && this.isKw('if', this.toks[this.p + 1])) this.p += 2;
      return { line, col, k: 'if', conds: [{ c, body, line, col }], els };
    }
    const conds = [{ c, body: this.block(['elseif', 'else', 'end']), line, col }];
    let els: Stmt[] | null = null;
    for (;;) {
      if (this.isKw('elseif')) {
        const at = this.t;
        this.p++;
        const c2 = this.expr();
        this.needKw('then');
        conds.push({ c: c2, body: this.block(['elseif', 'else', 'end']), line: at.line, col: at.col });
        continue;
      }
      if (this.eatKw('else')) { els = this.block(['end']); }
      break;
    }
    this.needKw('end');
    this.needKw('if');
    return { line, col, k: 'if', conds, els };
  }
  lineStmts(): Stmt[] {
    const out: Stmt[] = [this.stmt()];
    while (this.t.k === COLON) {
      this.p++;
      if ((this.t.k as number) === NL || (this.t.k as number) === EOF || this.isKw('else')) break;
      out.push(this.stmt());
    }
    return out;
  }

  lvalue(): Expr { return this.primaryName(); }
  primaryName(): Expr {
    const t = this.t;
    const name = this.ident();
    if (this.isOp('.')) { this.p++; return { k: 'member', obj: name, prop: this.ident() }; }
    let args: Expr[] | null = null;
    if (this.eatOp('(')) { args = this.isOp(')') ? [] : this.exprList(); this.needOp(')'); }
    return { k: 'name', name, args, line: t.line, col: t.col };
  }

  exprList(): Expr[] {
    const out = [this.expr()];
    while (this.eatOp(',')) out.push(this.expr());
    return out;
  }
  expr(): Expr { return this.binLevel(0); }
  // precedence levels, loosest first; 'not' and the unary signs are handled in between
  static LEVELS: string[][] = [['imp'], ['eqv'], ['xor'], ['or'], ['and'], ['=', '<>', '<', '>', '<=', '>=', 'is'], ['&'], ['+', '-'], ['mod'], ['\\'], ['*', '/']];
  binLevel(l: number): Expr {
    if (l === 5 && this.isKw('not')) { this.p++; return { k: 'un', op: 'not', a: this.binLevel(5) }; }
    if (l === Parser.LEVELS.length) return this.unary();
    let a = this.binLevel(l + 1);
    for (;;) {
      const t = this.t;
      const s = t.k === OP ? t.s : t.k === ID ? t.s.toLowerCase() : '';
      if (!Parser.LEVELS[l].includes(s) || (t.k === ID && !KEYWORDS.has(s))) return a;
      this.p++;
      a = { k: 'bin', op: s, a, b: this.binLevel(l + 1) };
    }
  }
  unary(): Expr {
    if (this.isOp('-')) { this.p++; return { k: 'un', op: '-', a: this.unary() }; }
    if (this.isOp('+')) { this.p++; return this.unary(); }
    let a = this.primary();
    while (this.isOp('^')) { this.p++; a = { k: 'bin', op: '^', a, b: this.powOperand() }; }
    return a;
  }
  powOperand(): Expr {
    if (this.isOp('-')) { this.p++; return { k: 'un', op: '-', a: this.powOperand() }; }
    if (this.isOp('+')) { this.p++; return this.powOperand(); }
    return this.primary();
  }
  primary(): Expr {
    const t = this.t;
    if (t.k === NUM) { this.p++; return { k: 'lit', v: t.v, t: t.vt }; }
    if (t.k === STR) { this.p++; return { k: 'lit', v: t.s, t: BSTR }; }
    if (this.eatOp('(')) { const e = this.expr(); this.needOp(')'); return { k: 'paren', e }; }
    if (t.k === ID) {
      switch (t.s.toLowerCase()) {
        case 'true': this.p++; return { k: 'lit', v: -1, t: BOOL };
        case 'false': this.p++; return { k: 'lit', v: 0, t: BOOL };
        case 'empty': this.p++; return { k: 'lit', v: 0, t: EMPTY };
        case 'null': this.p++; return { k: 'lit', v: 0, t: NULL };
      }
      return this.primaryName();
    }
    return this.err('Expected expression');
  }
}

// ================================================================================================ runtime values

/** a variable scope: per slot a type, a number, and an object (string / array / ByRef reference) */
class Frame {
  t: Uint16Array;
  n: Float64Array;
  o: unknown[];
  onErr = false;
  constructor(size: number) {
    this.t = new Uint16Array(size);
    this.n = new Float64Array(size);
    this.o = new Array(size).fill(undefined);
  }
  reset(): void { this.t.fill(0); this.n.fill(0); this.o.fill(undefined); this.onErr = false; }
}

function isObj(t: number): boolean { return t === BSTR || t >= ARRAY; }
function rd(f: Frame, i: number): unknown { const t = f.t[i]; T = t; return t === BSTR || t >= ARRAY ? f.o[i] : f.n[i]; }
function wr(f: Frame, i: number, v: unknown, t: number): void {
  f.t[i] = t;
  if (t === BSTR) f.o[i] = v;
  else if (t >= ARRAY) f.o[i] = (v as VbArray).copy();
  else { f.n[i] = v as number; f.o[i] = undefined; }
}
function rdEl(a: VbArray, k: number): unknown { const t = a.t[k]; T = t; return t === BSTR || t >= ARRAY ? a.o[k] : a.n[k]; }
function wrEl(a: VbArray, k: number, v: unknown, t: number): void {
  a.t[k] = t;
  if (t === BSTR) a.o[k] = v;
  else if (t >= ARRAY) a.o[k] = (v as VbArray).copy();
  else { a.n[k] = v as number; a.o[k] = undefined; }
}

/** a ByRef parameter: the caller's variable, or a private box when the argument was not a variable */
interface Ref { get(): unknown; set(v: unknown, t: number): void }
class SlotRef implements Ref {
  constructor(public f: Frame, public i: number) {}
  get(): unknown { return rd(this.f, this.i); }
  set(v: unknown, t: number): void { wr(this.f, this.i, v, t); }
}
class ElemRef implements Ref {
  constructor(public a: VbArray, public k: number) {}
  get(): unknown { return rdEl(this.a, this.k); }
  set(v: unknown, t: number): void { wrEl(this.a, this.k, v, t); }
}
class BoxRef implements Ref {
  f = new Frame(1);
  get(): unknown { return rd(this.f, 0); }
  set(v: unknown, t: number): void { wr(this.f, 0, v, t); }
}

// ================================================================================================ conversions

/** the number a value stands for in arithmetic (Empty 0, Boolean -1/0, numeric strings) */
function num(v: unknown, t: number): number {
  switch (t) {
    case EMPTY: return 0;
    case I2: case I4: case R4: case R8: case BOOL: case UI1: return v as number;
    case BSTR: { const d = parseNumber(v as string); if (d !== d) throw vbErr(13, valDetail(v, t)); return d; }
    case NULL: throw vbErr(94);
  }
  throw vbErr(13);
}
/** how an unhandled error's description shows an operand that failed: '[string: "first 20 chars"]', '[number: 5.5]', 'True' */
function valDetail(v: unknown, t: number): string | undefined {
  switch (t) {
    case BSTR: return `[string: "${(v as string).slice(0, 20)}"]`;
    case BOOL: return v ? 'True' : 'False';
    case I2: case I4: case R4: case R8: case UI1: return `[number: ${str(v, t)}]`;
  }
  return undefined;
}
/** VARIANT -> Long: round half to even, error 6 out of range */
function lng(v: unknown, t: number): number {
  const d = num(v, t);
  if (t === R4 || t === R8 || t === BSTR) {
    if (!(d >= -2147483648.5 && d < 2147483647.5)) throw vbErr(6, valDetail(v, t));
    return roundEven(d);
  }
  return d;
}
function str(v: unknown, t: number): string {
  switch (t) {
    case BSTR: return v as string;
    case EMPTY: return '';
    case I2: case I4: case UI1: return String(v);
    case R4: return formatReal(v as number, 7);
    case R8: return formatReal(v as number, 15);
    case BOOL: return v ? 'True' : 'False';
    case NULL: throw vbErr(94);
  }
  throw vbErr(13);
}
function truthy(v: unknown, t: number): boolean {
  switch (t) {
    case BOOL: case I2: case I4: case R4: case R8: case UI1: return v !== 0;
    case EMPTY: return false;
    case BSTR: return boolFromStr(v as string) !== 0;
    case NULL: throw vbErr(94);
  }
  throw vbErr(13);
}
/** String -> Boolean: "True" / "False" in any case (no blanks around), else a number; -1 or 0 */
function boolFromStr(v: string): number {
  const lo = v.toLowerCase();
  if (lo === 'true') return -1;
  if (lo === 'false') return 0;
  return num(v, BSTR) !== 0 ? -1 : 0;
}

// ================================================================================================ operators

/** result type of + - * for two (non-Null) operand types */
function arithType(ta: number, tb: number): number {
  if (ta >= ARRAY || tb >= ARRAY) throw vbErr(13);
  if (ta === R8 || tb === R8 || ta === BSTR || tb === BSTR) return R8;
  if (ta === R4 || tb === R4) return ta === I4 || tb === I4 ? R8 : R4;
  if (ta === I4 || tb === I4) return I4;
  if ((ta === UI1 || ta === EMPTY) && (tb === UI1 || tb === EMPTY) && (ta === UI1 || tb === UI1)) return UI1;
  return I2;
}
/** a result in the type an operation asked for, promoted the way VBScript promotes on overflow (integers to the
 * next wider integer, then Double; Single to Double); a Double that overflows is error 6 */
function fit(r: number, rt: number): number {
  if (rt === UI1 && r >= 0 && r <= 255) { T = UI1; return r + 0; }
  if (rt === I2 || rt === I4 || rt === UI1) {
    if (rt !== I4 && r >= -32768 && r <= 32767) { T = I2; return r + 0; }
    if (r >= -2147483648 && r <= 2147483647) { T = I4; return r + 0; }
    T = R8;
    return r;
  }
  if (rt === R4) { const f = fround(r); if (f - f === 0) { T = R4; return f; } }
  T = R8;
  return r;
}
/** a Double result of + - * / ^: overflowing to infinity from finite operands is error 6 */
function r8(r: number, x: number, y: number): number {
  if (r - r !== 0 && r === r && x - x === 0 && y - y === 0) throw vbErr(6);
  T = R8;
  return r;
}
function opAdd(a: unknown, ta: number, b: unknown, tb: number): unknown {
  if (ta === NULL || tb === NULL) { T = NULL; return 0; }
  // a string with a string or with Empty concatenates
  if ((ta === BSTR || ta === EMPTY) && (tb === BSTR || tb === EMPTY) && ta !== tb) { T = BSTR; return ta === BSTR ? a : b; }
  if (ta === BSTR && tb === BSTR) { T = BSTR; return (a as string) + (b as string); }
  const rt = arithType(ta, tb), x = num(a, ta), y = num(b, tb);
  return rt === R8 ? r8(x + y, x, y) : fit(x + y, rt);
}
function opSub(a: unknown, ta: number, b: unknown, tb: number): unknown {
  if (ta === NULL || tb === NULL) { T = NULL; return 0; }
  const rt = arithType(ta, tb), x = num(a, ta), y = num(b, tb);
  return rt === R8 ? r8(x - y, x, y) : fit(x - y, rt);
}
function opMul(a: unknown, ta: number, b: unknown, tb: number): unknown {
  if (ta === NULL || tb === NULL) { T = NULL; return 0; }
  const rt = arithType(ta, tb), x = num(a, ta), y = num(b, tb);
  return rt === R8 ? r8(x * y, x, y) : fit(x * y, rt);
}
function opDiv(a: unknown, ta: number, b: unknown, tb: number): unknown {
  if (ta === NULL || tb === NULL) { T = NULL; return 0; }
  if (ta >= ARRAY || tb >= ARRAY) throw vbErr(13);
  // Single when a Single (or Empty, which divides like one) meets only small integers
  const sng = (t: number) => t === R4 || t === EMPTY, wide = (t: number) => t === R8 || t === BSTR || t === I4;
  const rt = (sng(ta) || sng(tb)) && !wide(ta) && !wide(tb) ? R4 : R8;
  const x = num(a, ta), y = num(b, tb);
  if (y === 0) throw vbErr(x === 0 ? 6 : 11);
  return rt === R8 ? r8(x / y, x, y) : fit(x / y, rt);
}
/** result type of \ and Mod */
function intType(ta: number, tb: number): number {
  const small = (t: number) => t === I2 || t === BOOL || t === EMPTY || t === UI1;
  if (small(ta) && small(tb)) return ta === UI1 && tb === UI1 ? UI1 : I2;
  return I4;
}
function opIdiv(a: unknown, ta: number, b: unknown, tb: number, mod: boolean): unknown {
  if (ta === NULL || tb === NULL) { T = NULL; return 0; }
  const x = lng(a, ta), y = lng(b, tb);
  if (y === 0) throw vbErr(11);
  const r = mod ? x % y : (x / y) | 0;
  const rt = intType(ta, tb);
  T = rt;
  // the quotient is stored in the operands' type: -32768 \ -1 wraps to Integer -32768
  return rt === I2 ? (r << 16) >> 16 : r | 0;
}
function opPow(a: unknown, ta: number, b: unknown, tb: number): unknown {
  if (ta === NULL || tb === NULL) { T = NULL; return 0; }
  const x = num(a, ta), y = num(b, tb);
  if (x === 0 && y < 0) throw vbErr(5);
  if (x < 0 && y !== Math.trunc(y)) throw vbErr(5);
  return r8(libm.pow(x, y), x, y);
}
function opConcat(a: unknown, ta: number, b: unknown, tb: number): unknown {
  if (ta === NULL && tb === NULL) { T = NULL; return 0; }
  const s = (ta === NULL ? '' : str(a, ta)) + (tb === NULL ? '' : str(b, tb));
  T = BSTR;
  return s;
}
/**
 * -1, 0, 1 for a <, =, > b; 2 when either is Null or a NaN is involved. `lit` says which operands are literals
 * in the source (1 the left, 2 the right, parentheses allowed): a string compared with a number or Boolean is
 * converted when a literal is involved. With one literal, the other operand takes the literal's kind (string,
 * Double, Boolean); with two, the string becomes a number, or the Boolean a string. Without literals a number
 * (or Boolean) is less than any string, as VarCmp orders them.
 */
function compare(a: unknown, ta: number, b: unknown, tb: number, lit = 0): number {
  if (ta === NULL || tb === NULL) return 2;
  if (ta >= ARRAY || tb >= ARRAY) throw vbErr(13);
  if (ta === BSTR || tb === BSTR) {
    if (ta === BSTR && tb === BSTR) return strCmp(a as string, b as string);
    if (ta === EMPTY) return (b as string) === '' ? 0 : -1;
    if (tb === EMPTY) return (a as string) === '' ? 0 : 1;
    const sLeft = ta === BSTR, s = (sLeft ? a : b) as string, o = sLeft ? b : a, to = sLeft ? tb : ta;
    if (lit === 0) return sLeft ? 1 : -1;
    const litIsStr = lit === 3 ? to === BOOL : (lit === 1) === sLeft;
    if (litIsStr) { const os = str(o, to); return sLeft ? strCmp(s, os) : strCmp(os, s); }
    const d = to === BOOL ? boolFromStr(s) : num(s, BSTR), x = o as number;
    const c = d < x ? -1 : d > x ? 1 : d === x ? 0 : 2;
    return sLeft || c === 2 ? c : -c;
  }
  let x = num(a, ta), y = num(b, tb);
  if ((ta === R4 && tb === R8) || (ta === R8 && tb === R4)) { x = fround(x); y = fround(y); }
  return x < y ? -1 : x > y ? 1 : x === y ? 0 : 2;
}
function strCmp(a: string, b: string): number { return a === b ? 0 : a < b ? -1 : 1; }
function opCmp(op: string, a: unknown, ta: number, b: unknown, tb: number, lit: number): unknown {
  const c = compare(a, ta, b, tb, lit);
  if (c === 2) { T = ta === NULL || tb === NULL ? NULL : BOOL; return op === '<>' && T === BOOL ? -1 : 0; }
  T = BOOL;
  let r: boolean;
  switch (op) {
    case '=': r = c === 0; break;
    case '<>': r = c !== 0; break;
    case '<': r = c < 0; break;
    case '>': r = c > 0; break;
    case '<=': r = c <= 0; break;
    default: r = c >= 0;
  }
  return r ? -1 : 0;
}

/**
 * An operand of Not / And / Or / Xor / Eqv / Imp as an integer: its value and the type the operation works in
 * (Integer, Byte, Boolean, or Long for everything else; Empty counts as Long 0, and a variable holding Empty is
 * itself turned into Long 0 by the compiled code).
 */
let LT = 0;
function logicOperand(v: unknown, t: number): number {
  switch (t) {
    case I2: case UI1: case BOOL: LT = t; return v as number;
    case I4: LT = I4; return v as number;
    case EMPTY: LT = I4; return 0;
    case BSTR: {
      const lo = (v as string).toLowerCase();
      if (lo === 'true' || lo === 'false') { LT = BOOL; return lo === 'true' ? -1 : 0; }
      LT = I4;
      return lng(v, t);
    }
  }
  LT = I4;
  return lng(v, t);
}
/** a logic result r in type rt */
function logicResult(r: number, rt: number): number {
  T = rt;
  switch (rt) {
    case BOOL: return r ? -1 : 0;
    case UI1: return r & 255;
    case I2: return (r << 16) >> 16;
  }
  return r | 0;
}
/** same types keep their type; anything with a Long is Long; mixed Integer / Byte / Boolean is Integer */
function logicType(ta: number, tb: number): number {
  return ta === tb ? ta : ta === I4 || tb === I4 ? I4 : I2;
}
function opLogic(op: string, a: unknown, ta: number, b: unknown, tb: number): unknown {
  if (ta === NULL || tb === NULL) {
    // Null propagates except where the other operand decides the result alone
    if (ta === NULL && tb === NULL) { T = NULL; return 0; }
    const x = ta === NULL ? logicOperand(b, tb) : logicOperand(a, ta), xt = LT;
    const nullLeft = ta === NULL;
    switch (op) {
      case 'and': if (x === 0) return logicResult(0, xt); break;
      case 'or': if (x !== 0) return logicResult(x, xt); break;
      case 'imp':
        if (nullLeft) { if (x !== 0) return logicResult(x, xt); } // Null Imp x: x where x is non-zero
        else if (logicResult(~x, xt) !== 0) return logicResult(~x, xt); // x Imp Null: Not x where non-zero
        break;
    }
    T = NULL;
    return 0;
  }
  const x = logicOperand(a, ta), xt = LT, y = logicOperand(b, tb), rt = logicType(xt, LT);
  switch (op) {
    case 'and': return logicResult(x & y, rt);
    case 'or': return logicResult(x | y, rt);
    case 'xor': return logicResult(x ^ y, rt);
    case 'eqv': return logicResult(~(x ^ y), rt);
  }
  return logicResult(~x | y, rt);
}
function opNeg(a: unknown, ta: number): unknown {
  switch (ta) {
    case R8: T = R8; return -(a as number);
    case R4: T = R4; return -(a as number);
    case I2: case BOOL: case UI1: case EMPTY: return fit(-num(a, ta), I2);
    case I4: return fit(-(a as number), I4);
    case NULL: T = NULL; return 0;
    case BSTR: T = R8; return -num(a, ta);
  }
  throw vbErr(13);
}
function opNot(a: unknown, ta: number): unknown {
  if (ta === NULL) { T = NULL; return 0; }
  const x = logicOperand(a, ta);
  return logicResult(~x, LT);
}

// ================================================================================================ compiler

type Ex = (f: Frame) => unknown;
const LOGIC = new Set(['and', 'or', 'xor', 'eqv', 'imp']);
const CMP = new Set(['=', '<>', '<', '>', '<=', '>=']);
/** a literal in the source, possibly parenthesized (a negative number is a negation, not a literal) */
function isLit(e: Expr): boolean { return e.k === 'lit' || (e.k === 'paren' && isLit(e.e)); }
type St = (f: Frame) => number;
interface Block { s: St[]; line: Int32Array; col: Int32Array }
const EXIT_PROC = 1, EXIT_FOR = 2;

class Proc {
  slots = new Map<string, number>();
  byref: boolean[] = [];
  nslots = 0;
  /** local arrays declared with Dim a(n) (fixed size) or Dim a() (dynamic, unallocated): slots, bounds */
  fixed: { slot: number; dims: Expr[]; ub: number[] }[] = [];
  block: Block = { s: [], line: new Int32Array(0), col: new Int32Array(0) };
  pool: Frame[] = [];
  constructor(public decl: ProcDecl) {
    if (decl.isFunc) this.slot(decl.name); // slot 0: the return value
    for (const p of decl.params) { this.byref.push(p.byref); this.slot(p.name); }
  }
  slot(name: string): number {
    const lo = name.toLowerCase();
    let s = this.slots.get(lo);
    if (s === undefined) { s = this.nslots++; this.slots.set(lo, s); }
    return s;
  }
  get first(): number { return this.decl.isFunc ? 1 : 0; }
}

type GlobalSym = { kind: 'var'; slot: number } | { kind: 'const'; v: unknown; t: number } | { kind: 'proc'; p: Proc };

/** run a block; a runtime error gets the position of the statement it happened in, and On Error Resume Next skips it */
function runBlock(b: Block, f: Frame, ctx: Ctx): number {
  const s = b.s, n = s.length;
  let i = 0;
  while (i < n) {
    try {
      for (; i < n; i++) { const r = s[i](f); if (r !== 0) return r; }
      return 0;
    } catch (e) {
      if (!(e instanceof VbsError)) throw e;
      if (e.line < 0) { e.line = b.line[i]; e.col = b.col[i]; }
      if (!f.onErr) throw e;
      ctx.errNumber = e.number;
      ctx.errDescription = e.description;
      i++;
    }
  }
  return 0;
}

class Ctx {
  errNumber = 0;
  errDescription = '';
  rndSeed = 0x50000;
  hostIdx = new Map<string, number>();
}

interface Builtin { min: number; max: number; f: (a: unknown[], t: number[], ctx: Ctx) => unknown }
/** the builtin being called, as the script first spelled it: a builtin's own checks name it in the error */
let curFn = '';
const fnErr = (n: number): VbsError => vbErr(n, curFn);
/** a conversion builtin (CInt, CStr, UBound...): every error it raises names it */
function named(b: Builtin): Builtin {
  return {
    min: b.min, max: b.max, f: (a, t, ctx) => {
      try { return b.f(a, t, ctx); } catch (e) { if (e instanceof VbsError) e.detail = curFn; throw e; }
    },
  };
}

/** a math builtin: Null is error 94; f checks its argument; a finite argument overflowing to infinity is error 6 */
const RN = (f: (x: number) => number): Builtin => ({
  min: 1, max: 1, f: (a, t) => {
    if (t[0] === NULL) throw vbErr(94);
    const x = num(a[0], t[0]);
    const r = f(x);
    if (r - r !== 0 && r === r && x - x === 0) throw fnErr(6);
    T = R8;
    return r;
  },
});
const TRIG_MAX = 2147483648;
function trigArg(x: number): number { if (x >= TRIG_MAX || x <= -TRIG_MAX) throw fnErr(5); return x; }
function typeName(t: number): string {
  if (t >= ARRAY) return 'Variant()';
  return ({ 0: 'Empty', 1: 'Null', 2: 'Integer', 3: 'Long', 4: 'Single', 5: 'Double', 8: 'String', 11: 'Boolean', 17: 'Byte' } as Record<number, string>)[t] ?? 'Unknown';
}
/** Int / Fix / Round: integers pass through (Round keeps Boolean, and rejects Null) */
function intLike(f: (x: number) => number, round = false): Builtin {
  return {
    min: 1, max: 1, f: (a, t) => {
      switch (t[0]) {
        case NULL: if (round) throw vbErr(94); T = NULL; return 0;
        case EMPTY: T = I2; return 0;
        case BOOL: T = round ? BOOL : I2; return a[0];
        case I2: case I4: case UI1: T = t[0]; return a[0];
        case R4: T = R4; return f(a[0] as number);
        case R8: T = R8; return f(a[0] as number);
        case BSTR: T = R8; return f(num(a[0], BSTR));
      }
      throw vbErr(13);
    },
  };
}
function toIntRange(lo: number, hi: number, rt: number): Builtin {
  return {
    min: 1, max: 1, f: (a, t) => {
      if (t[0] === NULL) throw vbErr(94);
      const d = num(a[0], t[0]);
      const r = t[0] === R4 || t[0] === R8 || t[0] === BSTR ? roundEven(d) : d;
      if (!(r >= lo && r <= hi)) throw vbErr(6);
      T = rt;
      return r + 0;
    },
  };
}
function rndNext(ctx: Ctx): number { ctx.rndSeed = (Math.imul(ctx.rndSeed, 0x43fd43fd) + 0xc39ec3) & 0xffffff; return ctx.rndSeed; }
const F32 = new Float32Array(1), U32F = new Uint32Array(F32.buffer);

const BUILTINS: Record<string, Builtin> = {
  sin: RN((x) => libm.sin(trigArg(x))),
  cos: RN((x) => libm.cos(trigArg(x))),
  tan: RN((x) => { const c = libm.cos(trigArg(x)); if (c === 0) throw fnErr(5); return libm.sin(x) / c; }),
  atn: RN((x) => libm.atan(x)),
  exp: RN((x) => (x < -746 ? 0 : libm.exp(x))),
  log: RN((x) => { if (!(x > 0)) throw fnErr(5); return libm.log(x); }),
  sqr: RN((x) => { if (x < 0) throw fnErr(5); return libm.sqrt(x); }),
  abs: {
    min: 1, max: 1, f: (a, t) => {
      switch (t[0]) {
        case NULL: T = NULL; return 0;
        case EMPTY: T = I2; return 0;
        case BOOL: case I2: return fit(Math.abs(a[0] as number), I2);
        case I4: return fit(Math.abs(a[0] as number), I4);
        case UI1: T = UI1; return a[0];
        case R4: T = R4; return Math.abs(a[0] as number);
        case R8: T = R8; return Math.abs(a[0] as number);
        case BSTR: T = R8; return Math.abs(num(a[0], BSTR));
      }
      throw vbErr(13);
    },
  },
  sgn: {
    min: 1, max: 1, f: (a, t) => {
      if (t[0] === NULL) throw vbErr(94);
      const x = num(a[0], t[0]);
      T = I2;
      return x > 0 ? 1 : x < 0 ? -1 : 0;
    },
  },
  int: intLike(Math.floor), fix: intLike(Math.trunc), round: intLike(roundEven, true),
  cint: named(toIntRange(-32768, 32767, I2)), clng: named(toIntRange(-2147483648, 2147483647, I4)), cbyte: named(toIntRange(0, 255, UI1)),
  csng: named({
    min: 1, max: 1, f: (a, t) => {
      if (t[0] === NULL) throw vbErr(94);
      const d = num(a[0], t[0]), r = fround(d);
      if (r - r !== 0 && d - d === 0) throw vbErr(6); // only what rounds beyond the float range overflows
      T = R4;
      return r;
    },
  }),
  cdbl: named({ min: 1, max: 1, f: (a, t) => { if (t[0] === NULL) throw vbErr(94); const d = num(a[0], t[0]); T = R8; return d; } }),
  cbool: named({ min: 1, max: 1, f: (a, t) => { const b = truthy(a[0], t[0]); T = BOOL; return b ? -1 : 0; } }),
  cstr: named({ min: 1, max: 1, f: (a, t) => { const s = str(a[0], t[0]); T = BSTR; return s; } }),
  typename: { min: 1, max: 1, f: (_a, t) => { T = BSTR; return typeName(t[0]); } },
  vartype: { min: 1, max: 1, f: (_a, t) => { T = I2; return t[0]; } },
  isnumeric: {
    min: 1, max: 1, f: (a, t) => {
      T = BOOL;
      if (t[0] === BSTR) return parseNumber(a[0] as string) === parseNumber(a[0] as string) ? -1 : 0;
      return t[0] === EMPTY || t[0] === I2 || t[0] === I4 || t[0] === R4 || t[0] === R8 || t[0] === BOOL || t[0] === UI1 ? -1 : 0;
    },
  },
  isempty: { min: 1, max: 1, f: (_a, t) => { T = BOOL; return t[0] === EMPTY ? -1 : 0; } },
  rnd: {
    min: 0, max: 1, f: (a, t, ctx) => {
      if (a.length) {
        const x = fround(num(a[0], t[0]));
        if (x === 0) { T = R4; return ctx.rndSeed / 16777216; }
        if (x < 0) {
          F32[0] = x;
          const bits = U32F[0];
          ctx.rndSeed = (bits + (bits >>> 24)) & 0xffffff;
        }
      }
      T = R4;
      return rndNext(ctx) / 16777216;
    },
  },
  lbound: named({
    min: 1, max: 2, f: (a, t) => {
      if (t[0] < ARRAY) throw vbErr(13);
      const arr = a[0] as VbArray, d = a.length > 1 ? lng(a[1], t[1]) : 1;
      if (d < 1 || d > arr.ub.length) throw vbErr(9);
      T = I4;
      return 0;
    },
  }),
  ubound: named({
    min: 1, max: 2, f: (a, t) => {
      if (t[0] < ARRAY) throw vbErr(13);
      const arr = a[0] as VbArray, d = a.length > 1 ? lng(a[1], t[1]) : 1;
      if (d < 1 || d > arr.ub.length) throw vbErr(9);
      T = I4;
      return arr.ub[d - 1];
    },
  }),
};
const CONSTS: Record<string, [unknown, number]> = {
  vbcrlf: ['\r\n', BSTR], vbnewline: ['\r\n', BSTR], vbcr: ['\r', BSTR], vblf: ['\n', BSTR], vbtab: ['\t', BSTR],
  vbnullstring: ['', BSTR], vbokonly: [0, I4], vbcritical: [16, I4], vbquestion: [32, I4], vbexclamation: [48, I4],
  vbinformation: [64, I4], vbtrue: [-1, I4], vbfalse: [0, I4],
};
/** VBScript builtins the presets never use: named here so a script using one fails loudly instead of reaching the host */
const UNSUPPORTED = new Set(('array asc ccur cdate chr createobject date dateadd datediff datepart dateserial datevalue day escape eval ' +
  'filter formatcurrency formatdatetime formatnumber formatpercent getlocale getobject getref hex hour inputbox instr instrrev isarray ' +
  'isdate isnull isobject join lcase left len loadpicture ltrim mid minute month monthname now oct replace rgb right rtrim scriptengine ' +
  'second setlocale space split strcomp string strreverse time timer timeserial timevalue trim ucase unescape weekday weekdayname year').split(' '));

export interface CompiledVbs {
  has(entry: string): boolean;
  call(entry: string, args?: unknown[]): ScriptValue;
  /** script-level variables by name (for tests and state dumps) */
  globals(): Map<string, ScriptValue>;
}

/** position of a runtime error inside the compiler output */
export function compileVbs(source: string, host: ScriptHost): CompiledVbs {
  const spelling = new Map<string, string>();
  const toks = lex(source, spelling);
  const prog = new Parser(toks).program();
  const ctx = new Ctx();
  const members: HostMember[] = host.members;
  members.forEach((m, i) => { if (!ctx.hostIdx.has(m.name)) ctx.hostIdx.set(m.name, i); });

  // ---- script-level symbols
  const globals = new Map<string, GlobalSym>();
  const gnames: string[] = [];
  const gfixed: { slot: number; ub: Expr[] }[] = [];
  const declareGlobal = (name: string): number => {
    const lo = name.toLowerCase();
    const g = globals.get(lo);
    if (g) { if (g.kind === 'var') return g.slot; throw new SyntaxErr(`Name redefined: '${name}'`, 0, 0); }
    globals.set(lo, { kind: 'var', slot: gnames.length });
    gnames.push(name);
    return gnames.length - 1;
  };
  const procs: Proc[] = prog.procs.map((d) => new Proc(d));
  for (const p of procs) globals.set(p.decl.name.toLowerCase(), { kind: 'proc', p });
  const constValue = (e: Expr): [unknown, number] => {
    if (e.k === 'lit') return [e.v, e.t];
    if (e.k === 'paren') return constValue(e.e);
    if (e.k === 'un' && e.op === '-') { const [v, t] = constValue(e.a); const r = opNeg(v, t); return [r, T]; }
    throw new SyntaxErr('Expected literal constant', 0, 0);
  };
  for (const s of prog.top) {
    if (s.k === 'dim') for (const it of s.items) { const slot = declareGlobal(it.name); if (it.dims) gfixed.push({ slot, ub: it.dims }); }
    else if (s.k === 'const') for (const it of s.items) { const [v, t] = constValue(it.e); globals.set(it.name.toLowerCase(), { kind: 'const', v, t }); }
  }
  // locals: parameters, then every Dim / Const anywhere in the body
  const localConsts = new Map<Proc, Map<string, [unknown, number]>>();
  for (const p of procs) {
    const consts = new Map<string, [unknown, number]>();
    localConsts.set(p, consts);
    const walk = (body: Stmt[]) => {
      for (const s of body) {
        if (s.k === 'dim') for (const it of s.items) { const slot = p.slot(it.name); if (it.dims) p.fixed.push({ slot, dims: it.dims, ub: [] }); }
        else if (s.k === 'const') for (const it of s.items) consts.set(it.name.toLowerCase(), constValue(it.e));
        else if (s.k === 'if') { s.conds.forEach((c) => walk(c.body)); if (s.els) walk(s.els); }
        else if (s.k === 'for') walk(s.body);
        else if (s.k === 'select') s.cases.forEach((c) => walk(c.body));
      }
    };
    walk(p.decl.body);
  }
  const G = new Frame(Math.max(gnames.length, 1));

  // ---- name resolution
  type Sym =
    | { kind: 'local'; slot: number; byref: boolean }
    | { kind: 'global'; slot: number }
    | { kind: 'const'; v: unknown; t: number }
    | { kind: 'proc'; p: Proc }
    | { kind: 'builtin'; b: Builtin; name: string }
    | { kind: 'host'; name: string };
  const resolve = (name: string, p: Proc | null): Sym => {
    const lo = name.toLowerCase();
    if (p) {
      const s = p.slots.get(lo);
      if (s !== undefined) {
        const pi = s - p.first;
        return { kind: 'local', slot: s, byref: pi >= 0 && pi < p.byref.length && p.byref[pi] };
      }
      const c = localConsts.get(p)!.get(lo);
      if (c) return { kind: 'const', v: c[0], t: c[1] };
    }
    const g = globals.get(lo);
    if (g) return g.kind === 'var' ? { kind: 'global', slot: g.slot } : g.kind === 'const' ? { kind: 'const', v: g.v, t: g.t } : { kind: 'proc', p: g.p };
    if (BUILTINS[lo]) return { kind: 'builtin', b: BUILTINS[lo], name: lo };
    if (CONSTS[lo]) return { kind: 'const', v: CONSTS[lo][0], t: CONSTS[lo][1] };
    if (lo === 'msgbox') return { kind: 'builtin', name: lo, b: { min: 1, max: 5, f: (a, t) => { T = I2; return host.msgBox ? host.msgBox(str(a[0], t[0]), a.length > 2 ? str(a[2], t[2]) : '') : 1; } } };
    if (UNSUPPORTED.has(lo)) throw new SyntaxErr(`Unsupported builtin '${name}'`, 0, 0);
    return { kind: 'host', name: spelling.get(lo) ?? name };
  };

  // ---- host access (TwistedPixel's MilkdropVars dispatch semantics)
  /** an unknown name is "Variable is undefined", except called (with arguments, or as a statement) without Option Explicit: "Type mismatch" */
  const hostIndex = (name: string, call = false): number => {
    const i = ctx.hostIdx.get(name);
    if (i === undefined) throw vbErr(call && !prog.explicit ? 13 : 500, name);
    return i;
  };
  const srcVts: number[] = [];
  /** DISPATCH_METHOD (statement call) or METHOD|PROPERTYGET (value) with arguments */
  const hostInvoke = (i: number, method: boolean, vals: unknown[], vts: number[]): unknown => {
    const m = members[i];
    if (m.kind === 'prop') {
      if (method) throw hrErr(0x8000ffff, m.name);
      T = R4;
      return host.get(i);
    }
    const params = m.params ?? [];
    if (m.kind === 'put') throw hrErr(0x80020003, m.name);
    if (vals.length !== params.length) throw hrErr(0x8002000e, m.name);
    const conv: (number | string)[] = new Array<number | string>(vals.length);
    for (let k = 0; k < vals.length; k++) {
      const c = convertArg(vals[k], vts[k], params[k]);
      if (c === null) throw hrErr(lastHr, m.name);
      conv[k] = c;
    }
    srcVts.length = 0;
    for (let k = 0; k < vts.length; k++) srcVts.push(vts[k]);
    const r = host.call(i, conv, srcVts);
    return hostResult(m.vt, r);
  };
  const hostResult = (vt: number, r: unknown): unknown => {
    if (vt === 12) {
      if (Array.isArray(r) || ArrayBuffer.isView(r)) {
        const src = r as ArrayLike<number>;
        const a = new VbArray([src.length - 1], false);
        a.t.fill(I2);
        for (let k = 0; k < src.length; k++) a.n[k] = src[k];
        T = VARR;
        return a;
      }
      T = EMPTY;
      return 0;
    }
    T = vt;
    return vt === R4 ? fround(r as number) : r;
  };
  const hostPut = (i: number, v: unknown, t: number): void => {
    const m = members[i];
    if (m.kind === 'prop') { host.set(i, tpStore(v, t), t); return; }
    // a function entry: PROPERTYPUT with the value as its one argument, converted to the declared type
    const params = m.params ?? [];
    if ((m.vt !== 0 ? 0 : 1) + params.length !== 1 && params.length !== 0) throw hrErr(0x8002000e, m.name);
    if (m.kind !== 'put') throw hrErr(0x80020003, m.name);
    const c = convertArg(v, t, params.length ? params[0] : m.vt);
    if (c === null) throw hrErr(lastHr, m.name);
    host.call(i, [c], [t]);
  };

  // ---- expressions
  const compileArgs = (args: Expr[], p: Proc | null): Ex[] => args.map((a) => cx(a, p));
  const evalArgs = (exs: Ex[], f: Frame, vals: unknown[], vts: number[]): void => {
    for (let k = 0; k < exs.length; k++) { vals[k] = exs[k](f); vts[k] = T; }
  };
  /**
   * the flat index of arr(exs...), or "Subscript out of range" naming the array (wrong number of subscripts, or no
   * storage) or showing the subscript's value as the script gave it
   */
  const elemIndex = (arr: VbArray, exs: Ex[], f: Frame, name: string): number => {
    const subs = new Array<number>(exs.length), raw = new Array<unknown>(exs.length), rawT = new Array<number>(exs.length);
    for (let k = 0; k < exs.length; k++) { const v = exs[k](f); raw[k] = v; rawT[k] = T; subs[k] = lng(v, T); }
    const k = arr.index(subs);
    if (k >= 0) return k;
    throw vbErr(9, k === -1 ? spelling.get(name.toLowerCase()) ?? name : valDetail(raw[-2 - k], rawT[-2 - k]));
  };

  function readSym(s: Sym, p: Proc | null): Ex {
    switch (s.kind) {
      case 'local': {
        const i = s.slot;
        if (s.byref) return (f) => (f.o[i] as Ref).get();
        return (f) => { const t = f.t[i]; T = t; return t === BSTR || t >= ARRAY ? f.o[i] : f.n[i]; };
      }
      case 'global': { const i = s.slot; return () => { const t = G.t[i]; T = t; return t === BSTR || t >= ARRAY ? G.o[i] : G.n[i]; }; }
      case 'const': { const v = s.v, t = s.t; return () => { T = t; return v; }; }
      case 'proc': return callProc(s.p, [], p);
      case 'builtin': return callBuiltin(s.b, s.name, [], p);
      case 'host': {
        const name = s.name;
        let idx = -1;
        const noArgs: unknown[] = [], noVts: number[] = [];
        return () => {
          if (idx < 0) idx = hostIndex(name);
          if (members[idx].kind === 'prop') { T = R4; return host.get(idx); }
          return hostInvoke(idx, false, noArgs, noVts);
        };
      }
    }
  }
  function writeSym(s: Sym): (f: Frame, v: unknown, t: number) => void {
    switch (s.kind) {
      case 'local': { const i = s.slot; return s.byref ? (f, v, t) => (f.o[i] as Ref).set(v, t) : (f, v, t) => wr(f, i, v, t); }
      case 'global': { const i = s.slot; return (_f, v, t) => wr(G, i, v, t); }
      case 'host': {
        const name = s.name;
        let idx = -1;
        return (_f, v, t) => { if (idx < 0) idx = hostIndex(name); hostPut(idx, v, t); };
      }
      default: return () => { throw vbErr(501); };
    }
  }
  function callBuiltin(b: Builtin, name: string, args: Expr[], p: Proc | null): Ex {
    const exs = compileArgs(args, p), nm = spelling.get(name) ?? name;
    const n = exs.length;
    if (n < b.min || n > b.max) return () => { throw vbErr(450, nm); };
    if (n === 1 && b.min === 1 && b.max === 1) {
      const a0 = exs[0], va = [0 as unknown], ta = [0];
      return (f) => { va[0] = a0(f); ta[0] = T; curFn = nm; return b.f(va, ta, ctx); };
    }
    return (f) => { const va = new Array<unknown>(n), ta = new Array<number>(n); evalArgs(exs, f, va, ta); curFn = nm; return b.f(va, ta, ctx); };
  }
  function callProc(q: Proc, args: Expr[], p: Proc | null): Ex {
    const np = q.decl.params.length;
    if (args.length !== np) return () => { throw vbErr(450, spelling.get(q.decl.name.toLowerCase()) ?? q.decl.name); };
    // per argument: how to bind it
    const binders = args.map((a, k): ((f: Frame, callee: Frame) => void) => {
      const slot = q.first + k;
      if (q.byref[k] && a.k === 'name' && a.args === null) {
        const s = resolve(a.name, p);
        if (s.kind === 'local') {
          const i = s.slot;
          if (s.byref) return (f, c) => { c.o[slot] = f.o[i]; };
          return (f, c) => { c.o[slot] = new SlotRef(f, i); };
        }
        if (s.kind === 'global') { const i = s.slot; return (_f, c) => { c.o[slot] = new SlotRef(G, i); }; }
      }
      if (q.byref[k] && a.k === 'name' && a.args !== null && a.args.length) {
        // an array element passes by reference too
        const s = resolve(a.name, p);
        if ((s.kind === 'local' && !(p && p.decl.isFunc && s.slot === 0)) || s.kind === 'global') {
          const get = readSym(s, p), exs = compileArgs(a.args, p);
          return (f, c) => {
            const arr = get(f);
            if (T < ARRAY) throw vbErr(13);
            c.o[slot] = new ElemRef(arr as VbArray, elemIndex(arr as VbArray, exs, f, a.name));
          };
        }
      }
      const ex = cx(a, p);
      if (q.byref[k]) return (f, c) => { const v = ex(f); const box = new BoxRef(); box.set(v, T); c.o[slot] = box; };
      return (f, c) => { const v = ex(f); wr(c, slot, v, T); };
    });
    return (f) => invoke(q, f, binders);
  }
  const invoke = (q: Proc, f: Frame | null, binders: ((f: Frame, c: Frame) => void)[]): unknown => {
    const callee = q.pool.pop() ?? new Frame(q.nslots);
    for (let k = 0; k < binders.length; k++) binders[k](f!, callee);
    for (const fx of q.fixed) { callee.t[fx.slot] = VARR; callee.o[fx.slot] = new VbArray(fx.ub, fx.ub.length > 0); }
    runBlock(q.block, callee, ctx);
    let v: unknown = 0, t = EMPTY;
    if (q.decl.isFunc) { t = callee.t[0]; v = isObj(t) ? callee.o[0] : callee.n[0]; }
    callee.reset();
    q.pool.push(callee);
    T = t;
    return v;
  };

  function cx(e: Expr, p: Proc | null): Ex {
    switch (e.k) {
      case 'lit': { const v = e.v, t = e.t; return () => { T = t; return v; }; }
      case 'paren': return cx(e.e, p);
      case 'member': {
        if (e.obj.toLowerCase() !== 'err') throw new SyntaxErr(`Unsupported object '${e.obj}'`, 0, 0);
        const prop = e.prop.toLowerCase();
        if (prop === 'number') return () => { T = I4; return ctx.errNumber; };
        if (prop === 'description') return () => { T = BSTR; return ctx.errDescription; };
        if (prop === 'source') return () => { T = BSTR; return ctx.errNumber ? 'Microsoft VBScript runtime error' : ''; };
        throw new SyntaxErr(`Unsupported member 'Err.${e.prop}'`, 0, 0);
      }
      case 'un': {
        const a = cx(e.a, p);
        if (e.op === '-') return (f) => { const v = a(f); if (T === R8) return -(v as number); return opNeg(v, T); };
        const n = logicArg(e.a, p);
        return (f) => { const v = n(f); return opNot(v, T); };
      }
      case 'bin':
        if (LOGIC.has(e.op)) return cbin(e.op, logicArg(e.a, p), logicArg(e.b, p), 0);
        if (CMP.has(e.op)) {
          const A = cmpArg(e.a, p), B = cmpArg(e.b, p), op = e.op, lit = (isLit(e.a) ? 1 : 0) | (isLit(e.b) ? 2 : 0);
          if (A.fix || B.fix) {
            const a = A.ex, b = B.ex, fa = A.fix, fb = B.fix;
            return (f) => {
              const x = a(f), tx = T, y = b(f), ty = T;
              if (tx === R8 && ty === R4) fa?.(f); else if (tx === R4 && ty === R8) fb?.(f);
              return opCmp(op, x, tx, y, ty, lit);
            };
          }
        }
        return cbin(e.op, cx(e.a, p), cx(e.b, p), (isLit(e.a) ? 1 : 0) | (isLit(e.b) ? 2 : 0));
      case 'name': return cname(e, p);
    }
  }
  /**
   * an operand of a logic operator: vbscript.dll converts a variable (or array element) that holds Empty to Long 0
   * in place when it is used there
   */
  function logicArg(e: Expr, p: Proc | null): Ex {
    const ex = cx(e, p);
    if (e.k !== 'name') return ex;
    const s = resolve(e.name, p);
    if (s.kind !== 'local' && s.kind !== 'global') return ex;
    if (e.args === null) {
      const i = s.slot;
      if (s.kind === 'local' && s.byref) return (f) => { const r = f.o[i] as Ref, v = r.get(); if (T === EMPTY) { r.set(0, I4); T = EMPTY; } return v; };
      if (s.kind === 'local') return (f) => { const v = ex(f); if (T === EMPTY) { f.t[i] = I4; T = EMPTY; } return v; };
      return (f) => { const v = ex(f); if (T === EMPTY) { G.t[i] = I4; T = EMPTY; } return v; };
    }
    if (s.kind === 'local' && p && p.decl.isFunc && s.slot === 0) return ex;
    const get = readSym(s, p), exs = compileArgs(e.args, p);
    return (f) => {
      const arr = get(f);
      if (T < ARRAY) throw vbErr(13);
      const a = arr as VbArray, k = elemIndex(a, exs, f, e.name);
      if (a.t[k] === EMPTY) { a.t[k] = I4; T = EMPTY; return 0; }
      return rdEl(a, k);
    };
  }
  /**
   * an operand of a comparison. vbscript.dll compares a Double with a Single by rounding the Double to float, and when
   * the Double is a variable (or array element, or ByRef parameter) it rounds the variable's own value: `fix` does
   * that (the type stays Double).
   */
  function cmpArg(e: Expr, p: Proc | null): { ex: Ex; fix: ((f: Frame) => void) | null } {
    const ex = cx(e, p);
    if (e.k !== 'name') return { ex, fix: null };
    const s = resolve(e.name, p);
    if (s.kind !== 'local' && s.kind !== 'global') return { ex, fix: null };
    if (e.args === null) {
      const i = s.slot;
      if (s.kind === 'local' && s.byref) return { ex, fix: (f) => { const r = f.o[i] as Ref, v = r.get(); if (T === R8) r.set(fround(v as number), R8); } };
      if (s.kind === 'local') return { ex, fix: (f) => { if (f.t[i] === R8) f.n[i] = fround(f.n[i]); } };
      return { ex, fix: () => { if (G.t[i] === R8) G.n[i] = fround(G.n[i]); } };
    }
    if (s.kind === 'local' && p && p.decl.isFunc && s.slot === 0) return { ex, fix: null };
    // ponytail: the element is remembered per call site, so a recursive call between reading it and comparing would confuse it
    const get = readSym(s, p), exs = compileArgs(e.args, p), name = e.name;
    let la: VbArray | null = null, lk = 0;
    return {
      ex: (f) => {
        const arr = get(f);
        if (T < ARRAY) throw vbErr(13);
        la = arr as VbArray; lk = elemIndex(la, exs, f, name);
        return rdEl(la, lk);
      },
      fix: () => { if (la && la.t[lk] === R8) la.n[lk] = fround(la.n[lk]); },
    };
  }
  function cbin(op: string, a: Ex, b: Ex, lit: number): Ex {
    switch (op) {
      case '+': return (f) => { const x = a(f), tx = T, y = b(f); if (tx === T && (T === R8 || T === R4)) { const r = (x as number) + (y as number); if (T === R8 ? r - r === 0 : fround(r) - fround(r) === 0) return T === R8 ? r : fround(r); } return opAdd(x, tx, y, T); };
      case '-': return (f) => { const x = a(f), tx = T, y = b(f); if (tx === T && (T === R8 || T === R4)) { const r = (x as number) - (y as number); if (T === R8 ? r - r === 0 : fround(r) - fround(r) === 0) return T === R8 ? r : fround(r); } return opSub(x, tx, y, T); };
      case '*': return (f) => { const x = a(f), tx = T, y = b(f); if (tx === T && (T === R8 || T === R4)) { const r = (x as number) * (y as number); if (T === R8 ? r - r === 0 : fround(r) - fround(r) === 0) return T === R8 ? r : fround(r); } return opMul(x, tx, y, T); };
      case '/': return (f) => { const x = a(f), tx = T, y = b(f); if (tx === T && (T === R8 || T === R4) && y !== 0) { const r = (x as number) / (y as number); if (T === R8 ? r - r === 0 : fround(r) - fround(r) === 0) return T === R8 ? r : fround(r); } return opDiv(x, tx, y, T); };
      case '\\': return (f) => { const x = a(f), tx = T, y = b(f); return opIdiv(x, tx, y, T, false); };
      case 'mod': return (f) => { const x = a(f), tx = T, y = b(f); return opIdiv(x, tx, y, T, true); };
      case '^': return (f) => { const x = a(f), tx = T, y = b(f); return opPow(x, tx, y, T); };
      case '&': return (f) => { const x = a(f), tx = T, y = b(f); return opConcat(x, tx, y, T); };
      case '=': case '<>': case '<': case '>': case '<=': case '>=':
        return (f) => { const x = a(f), tx = T, y = b(f); return opCmp(op, x, tx, y, T, lit); };
      case 'is': throw new SyntaxErr("Unsupported operator 'Is'", 0, 0);
      default: return (f) => { const x = a(f), tx = T, y = b(f); return opLogic(op, x, tx, y, T); };
    }
  }
  function cname(e: Extract<Expr, { k: 'name' }>, p: Proc | null): Ex {
    const s = resolve(e.name, p);
    if (e.args === null) return readSym(s, p);
    switch (s.kind) {
      case 'proc': return callProc(s.p, e.args, p);
      case 'builtin': return callBuiltin(s.b, s.name, e.args, p);
      case 'host': {
        const name = s.name, exs = compileArgs(e.args, p);
        let idx = -1;
        return (f) => {
          if (idx < 0) idx = hostIndex(name, true);
          const vals = new Array<unknown>(exs.length), vts = new Array<number>(exs.length);
          evalArgs(exs, f, vals, vts);
          return hostInvoke(idx, false, vals, vts);
        };
      }
      case 'const': return () => { throw vbErr(13); };
      default: {
        // array element (or a function's return value read with arguments: recursion)
        if (s.kind === 'local' && p && p.decl.isFunc && s.slot === 0) return callProc(p, e.args, p);
        const get = readSym(s, p), exs = compileArgs(e.args, p);
        return (f) => {
          const arr = get(f);
          if (T < ARRAY) throw vbErr(13);
          const k = elemIndex(arr as VbArray, exs, f, e.name);
          return rdEl(arr as VbArray, k);
        };
      }
    }
  }

  // ---- statements
  function cblock(body: Stmt[], p: Proc | null): Block {
    const s: St[] = [];
    const line: number[] = [], col: number[] = [];
    for (const st of body) {
      const c = cstmt(st, p);
      if (c) { s.push(c); line.push(st.line); col.push(st.col); }
    }
    return { s, line: Int32Array.from(line), col: Int32Array.from(col) };
  }
  function cstmt(st: Stmt, p: Proc | null): St | null {
    switch (st.k) {
      case 'nop': case 'dim': case 'const': return null;
      case 'assign': {
        const ex = cx(st.e, p);
        const tg = st.target;
        if (tg.k !== 'name') throw new SyntaxErr('Illegal assignment', st.line, st.col);
        const s = resolve(tg.name, p);
        if (tg.args === null || (s.kind === 'local' && p?.decl.isFunc && s.slot === 0 && tg.args.length === 0)) {
          const w = writeSym(s);
          return (f) => { const v = ex(f); w(f, v, T); return 0; };
        }
        if (s.kind === 'host') {
          throw new SyntaxErr('Unsupported assignment to a host member with arguments', st.line, st.col);
        }
        const get = readSym(s, p), exs = compileArgs(tg.args, p);
        return (f) => {
          const arr = get(f);
          if (T < ARRAY) throw vbErr(13);
          const k = elemIndex(arr as VbArray, exs, f, tg.name);
          const v = ex(f);
          wrEl(arr as VbArray, k, v, T);
          return 0;
        };
      }
      case 'call': {
        const tg = st.target;
        if (tg.k === 'member') {
          if (tg.obj.toLowerCase() === 'err' && tg.prop.toLowerCase() === 'clear') return () => { ctx.errNumber = 0; ctx.errDescription = ''; return 0; };
          throw new SyntaxErr(`Unsupported statement '${tg.obj}.${tg.prop}'`, st.line, st.col);
        }
        if (tg.k !== 'name') throw new SyntaxErr('Expected statement', st.line, st.col);
        const args = tg.args ?? st.args;
        const s = resolve(tg.name, p);
        if (s.kind === 'host') {
          const name = s.name, exs = compileArgs(args, p);
          let idx = -1;
          return (f) => {
            if (idx < 0) idx = hostIndex(name, true);
            const vals = new Array<unknown>(exs.length), vts = new Array<number>(exs.length);
            evalArgs(exs, f, vals, vts);
            hostInvoke(idx, true, vals, vts);
            return 0;
          };
        }
        if (s.kind === 'local' || s.kind === 'global') {
          const ex = cname({ k: 'name', name: tg.name, args: args.length ? args : null, line: st.line, col: st.col }, p);
          return (f) => { ex(f); return 0; };
        }
        const ex = s.kind === 'proc' ? callProc(s.p, args, p) : s.kind === 'builtin' ? callBuiltin(s.b, s.name, args, p) : readSym(s, p);
        return (f) => { ex(f); return 0; };
      }
      case 'if': {
        const conds = st.conds.map((c) => cx(c.c, p)), blocks = st.conds.map((c) => cblock(c.body, p));
        const els = st.els ? cblock(st.els, p) : null;
        const n = conds.length, at = st.conds;
        return (f) => {
          for (let k = 0; k < n; k++) {
            let go: boolean;
            try {
              const v = conds[k](f);
              go = truthy(v, T);
            } catch (e) {
              // a failing condition: under On Error Resume Next execution resumes inside its branch
              if (!(e instanceof VbsError)) throw e;
              if (e.line < 0) { e.line = at[k].line; e.col = at[k].col; }
              if (!f.onErr) throw e;
              ctx.errNumber = e.number;
              ctx.errDescription = e.description;
              go = true;
            }
            if (go) return runBlock(blocks[k], f, ctx);
          }
          return els ? runBlock(els, f, ctx) : 0;
        };
      }
      case 'for': {
        if (st.v.k !== 'name' || st.v.args) throw new SyntaxErr('Expected variable', st.line, st.col);
        const s = resolve(st.v.name, p);
        const get = readSym(s, p), set = writeSym(s);
        const from = cx(st.from, p), to = cx(st.to, p), step = st.step ? cx(st.step, p) : null;
        const body = cblock(st.body, p);
        return (f) => {
          // the counter, limit and step all take the type the three widen to (as + widens them)
          const v0 = from(f), t0 = T, ve = to(f), te = T;
          let vs: unknown = 1, ts = I2;
          if (step) { vs = step(f); ts = T; }
          if (t0 === NULL || te === NULL || ts === NULL) throw vbErr(94);
          const ct = arithType(arithType(t0, te), ts);
          const cv = (v: unknown, t: number) => { const d = num(v, t); return ct === R4 ? fround(d) : d; };
          const end = cv(ve, te), inc = cv(vs, ts), down = inc < 0;
          set(f, cv(v0, t0), ct);
          for (;;) {
            const c = get(f), tc = T;
            const cmp = compare(c, tc, end, ct);
            if (down ? cmp < 0 : cmp > 0) break;
            const r = runBlock(body, f, ctx);
            if (r === EXIT_FOR) break;
            if (r !== 0) return r;
            const cur = get(f), tcur = T;
            const nv = opAdd(cur, tcur, inc, ct);
            set(f, nv, T);
          }
          return 0;
        };
      }
      case 'select': {
        const { ex: sel, fix: selFix } = cmpArg(st.e, p);
        const selLit = isLit(st.e) ? 1 : 0;
        const cases = st.cases.map((c) => ({
          vals: c.vals ? c.vals.map((v) => cmpArg(v, p)) : null, lits: c.vals ? c.vals.map((v) => selLit | (isLit(v) ? 2 : 0)) : [],
          body: cblock(c.body, p),
        }));
        return (f) => {
          let v = sel(f);
          const tv = T;
          for (const c of cases) {
            if (!c.vals) return runBlock(c.body, f, ctx);
            for (let k = 0; k < c.vals.length; k++) {
              const cv = c.vals[k], w = cv.ex(f), tw = T;
              // the Double / Single rounding of comparisons (cmpArg) applies here too, to either side
              if (tv === R8 && tw === R4 && selFix) { selFix(f); v = fround(v as number); } else if (tv === R4 && tw === R8) cv.fix?.(f);
              if (compare(v, tv, w, tw, c.lits[k]) === 0) return runBlock(c.body, f, ctx);
            }
          }
          return 0;
        };
      }
      case 'redim': {
        const items = st.items.map((it) => {
          const s = resolve(it.name, p);
          return { get: readSym(s, p), set: writeSym(s), dims: compileArgs(it.dims, p) };
        });
        const preserve = st.preserve;
        return (f) => {
          for (const it of items) {
            const old = it.get(f), told = T;
            if (told >= ARRAY && (old as VbArray).fixed) throw vbErr(10);
            const ub = it.dims.map((d) => { const v = d(f); return lng(v, T); });
            const a = new VbArray(ub, false);
            if (preserve && told >= ARRAY) {
              const o = old as VbArray;
              const n = Math.min(o.size, a.size);
              for (let k = 0; k < n; k++) { a.t[k] = o.t[k]; a.n[k] = o.n[k]; a.o[k] = o.o[k]; }
            }
            T = VARR;
            it.set(f, a, VARR);
          }
          return 0;
        };
      }
      case 'erase': {
        const items = st.names.map((nm) => { const s = resolve(nm, p); return { get: readSym(s, p), set: writeSym(s) }; });
        return (f) => {
          for (const it of items) {
            const a = it.get(f);
            if (T < ARRAY) throw vbErr(13);
            const arr = a as VbArray;
            if (arr.fixed) { arr.t.fill(0); arr.n.fill(0); arr.o.fill(undefined); } else it.set(f, new VbArray([], false), VARR);
          }
          return 0;
        };
      }
      case 'exit': {
        const code = st.what === 'for' ? EXIT_FOR : st.what === 'do' ? 3 : EXIT_PROC;
        return () => code;
      }
      case 'onerror': {
        const on = st.resume;
        return (f) => { f.onErr = on; if (!on) { ctx.errNumber = 0; ctx.errDescription = ''; } return 0; };
      }
    }
  }

  // array bounds in Dim are constant expressions
  for (const p of procs) {
    p.block = cblock(p.decl.body, p);
    for (const fx of p.fixed) fx.ub = fx.dims.map((x) => { const v = cx(x, p)(G); return lng(v, T); });
  }
  for (const g of gfixed) {
    G.t[g.slot] = VARR;
    G.o[g.slot] = new VbArray(g.ub.map((x) => { const v = cx(x, null)(G); return lng(v, T); }), g.ub.length > 0);
  }
  const top = cblock(prog.top, null);
  runBlock(top, G, ctx);

  const byName = new Map<string, Proc>();
  for (const p of procs) byName.set(p.decl.name.toLowerCase(), p);
  return {
    has: (entry) => byName.has(entry.toLowerCase()),
    call(entry, args = []) {
      const q = byName.get(entry.toLowerCase());
      if (!q) throw vbErr(438);
      const binders = q.decl.params.map((_, k) => (_f: Frame, c: Frame) => {
        const a = args[k];
        const [v, t] = typeof a === 'string' ? [a, BSTR] : typeof a === 'boolean' ? [a ? -1 : 0, BOOL] : a === undefined ? [0, EMPTY] : [a as number, R8];
        if (q.byref[k]) { const box = new BoxRef(); box.set(v, t); c.o[q.first + k] = box; } else wr(c, q.first + k, v, t);
      });
      if (args.length !== q.decl.params.length) throw vbErr(450);
      const v = invoke(q, null, binders);
      return { vt: T, v };
    },
    globals() {
      const m = new Map<string, ScriptValue>();
      gnames.forEach((nm, i) => { const v = rd(G, i); m.set(nm, { vt: T, v }); });
      return m;
    },
  };
}
