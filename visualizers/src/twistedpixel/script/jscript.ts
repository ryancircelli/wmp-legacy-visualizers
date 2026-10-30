// A small JScript interpreter, covering what TwistedPixel's JScript presets use, with jscript.dll's results as
// TwistedPixel hosts it. Compiled once to closures, like the VBScript side.
//
// Covered: function declarations (hoisted), var, return, if / else, for, while, blocks; assignment and the compound
// operators, ++ / --, + - * / %, comparisons, ! && ||, unary + -, numeric / string / boolean / null literals,
// Math.sin cos round random sqrt floor abs, the host's variables and functions. Anything else is a syntax error.
//
// jscript.dll keeps numbers as VARIANTs, Long (VT_I4) or Double (VT_R8), and TwistedPixel sees which: the VARIANT
// type is passed on to the host with every assignment. Established against jscript.dll:
// - a numeric literal with an integral value in the Long range is a Long, whatever its spelling (20.0, 1e3, 0x10);
// - Long op Long (+ - * /) gives a Long when the result is integral, in range and not -0 (6/3 is a Long, 1/3 and
//   2147483647+1 are Doubles); anything with a Double gives a Double (6*0.5 is a Double 3);
// - unary minus keeps a Long a Long, except -0 which is a Double;
// - Math.round(x) is floor(x + 0.5), a Long under the same rule (Math.round(-0.4) is a Double -0); Math.sin and
//   Math.cos always give Doubles (Math.sin(0) too);
// - a host variable read comes in as Single and is held as a Double;
// - decimal literals are rounded correctly (unlike VBScript's, see vbscript.ts literalValue).
// Math.sin / Math.cos are msvcrt's sin / cos, the same C runtime family vbscript.dll uses; ./libm stands in for it.
// Math.random is seeded from the clock in jscript.dll; here the host may supply it (ScriptHost.random).

import * as libm from './libm';
import { BOOL, BSTR, EMPTY, I4, NULL, R4, R8, VbsError, convertArg, hrErr, lastHr, tpStore } from './variant';
import type { ScriptHost, ScriptValue } from './index';
import { SyntaxErr } from './vbscript';

interface V { vt: number; v: unknown }
const UNDEF: V = { vt: EMPTY, v: undefined };
const jsErr = (n: number, d: string) => new VbsError(n, d);

// ------------------------------------------------------------------------------------------------- values
/** a number as jscript.dll stores it: Long when integral, in range and not -0 (and `intOk`), else Double */
function num(d: number, intOk: boolean): V {
  return intOk && (d | 0) === d && !(d === 0 && 1 / d < 0) ? { vt: I4, v: d } : { vt: R8, v: d };
}
function toNum(a: V): number {
  switch (a.vt) {
    case I4: case R8: return a.v as number;
    case BOOL: return a.v ? 1 : 0;
    case NULL: return 0;
    case BSTR: { const s = (a.v as string).trim(); return s === '' ? 0 : Number(s); }
  }
  return NaN;
}
function toStr(a: V): string {
  switch (a.vt) {
    case BSTR: return a.v as string;
    case BOOL: return a.v ? 'true' : 'false';
    case NULL: return 'null';
    case EMPTY: return 'undefined';
  }
  return String(a.v); // ponytail: JS number formatting, not checked against jscript.dll (no preset prints numbers)
}
function truthy(a: V): boolean {
  switch (a.vt) {
    case BSTR: return (a.v as string) !== '';
    case EMPTY: case NULL: return false;
  }
  const d = toNum(a);
  return d === d && d !== 0;
}
const isInt = (a: V) => a.vt === I4;
function arith(op: string, a: V, b: V): V {
  if (op === '+' && (a.vt === BSTR || b.vt === BSTR)) return { vt: BSTR, v: toStr(a) + toStr(b) };
  const x = toNum(a), y = toNum(b), ints = isInt(a) && isInt(b);
  switch (op) {
    case '+': return num(x + y, ints);
    case '-': return num(x - y, ints);
    case '*': return num(x * y, ints);
    case '/': return num(x / y, ints);
    default: return num(x % y, ints);
  }
}
const bool = (b: boolean): V => ({ vt: BOOL, v: b ? -1 : 0 });
function looseEq(a: V, b: V): boolean {
  const na = a.vt === EMPTY || a.vt === NULL, nb = b.vt === EMPTY || b.vt === NULL;
  if (na || nb) return na && nb;
  if (a.vt === BSTR && b.vt === BSTR) return a.v === b.v;
  return toNum(a) === toNum(b);
}
function compare(op: string, a: V, b: V): V {
  switch (op) {
    case '==': return bool(looseEq(a, b));
    case '!=': return bool(!looseEq(a, b));
    case '===': return bool(sameKind(a, b) && looseEq(a, b));
    case '!==': return bool(!(sameKind(a, b) && looseEq(a, b)));
  }
  let r: boolean;
  if (a.vt === BSTR && b.vt === BSTR) {
    const s = a.v as string, t = b.v as string;
    r = op === '<' ? s < t : op === '>' ? s > t : op === '<=' ? s <= t : s >= t;
  } else {
    const x = toNum(a), y = toNum(b);
    r = op === '<' ? x < y : op === '>' ? x > y : op === '<=' ? x <= y : x >= y;
  }
  return bool(r);
}
const kind = (a: V) => (a.vt === I4 || a.vt === R8 ? 0 : a.vt);
const sameKind = (a: V, b: V) => kind(a) === kind(b);

// ------------------------------------------------------------------------------------------------- lexer
interface Tok { k: 'id' | 'num' | 'str' | 'op' | 'eof'; s: string; v: number; line: number; col: number }
const PUNCT = ['===', '!==', '+=', '-=', '*=', '/=', '%=', '++', '--', '==', '!=', '<=', '>=', '&&', '||'];
function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0, line = 0, ls = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '\n') { i++; line++; ls = i; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      if (e < 0) throw new SyntaxErr("Expected '*/'", line, i - ls);
      for (let k = i; k < e; k++) if (src[k] === '\n') { line++; ls = k + 1; }
      i = e + 2; continue;
    }
    const col = i - ls, start = i;
    if (/[A-Za-z_$]/.test(c)) {
      while (i < n && /[\w$]/.test(src[i])) i++;
      out.push({ k: 'id', s: src.slice(start, i), v: 0, line, col }); continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let v: number;
      const hex = /^0[xX][0-9a-fA-F]+/.exec(src.slice(i));
      if (hex) { v = parseInt(hex[0], 16); i += hex[0].length; } else {
        const m = /^(\d*\.?\d*)([eE][+-]?\d+)?/.exec(src.slice(i))!;
        v = parseFloat(m[0]); i += m[0].length;
      }
      out.push({ k: 'num', s: src.slice(start, i), v, line, col }); continue;
    }
    if (c === '"' || c === "'") {
      let s = '';
      i++;
      while (src[i] !== c) {
        if (i >= n || src[i] === '\n') throw new SyntaxErr('Unterminated string constant', line, col);
        if (src[i] === '\\') { const e = src[++i]; s += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e; i++; continue; }
        s += src[i++];
      }
      i++;
      out.push({ k: 'str', s, v: 0, line, col }); continue;
    }
    const p = PUNCT.find((q) => src.startsWith(q, i)) ?? c;
    if (!p.length || !'+-*/%=<>!&|(){}[];,.?:'.includes(p[0])) throw new SyntaxErr('Invalid character', line, col);
    i += p.length;
    out.push({ k: 'op', s: p, v: 0, line, col });
  }
  out.push({ k: 'eof', s: '', v: 0, line, col: 0 });
  return out;
}

// ------------------------------------------------------------------------------------------------- AST
type E =
  | { t: 'lit'; v: V }
  | { t: 'name'; s: string }
  | { t: 'math'; s: string }
  | { t: 'call'; f: E; args: E[]; line: number; col: number }
  | { t: 'un'; op: string; a: E }
  | { t: 'bin'; op: string; a: E; b: E }
  | { t: 'assign'; op: string; target: string; b: E }
  | { t: 'incdec'; op: string; prefix: boolean; target: string };
type S =
  | { t: 'expr'; e: E; line: number; col: number }
  | { t: 'var'; decls: { name: string; init: E | null }[]; line: number; col: number }
  | { t: 'ret'; e: E | null; line: number; col: number }
  | { t: 'if'; c: E; a: S; b: S | null; line: number; col: number }
  | { t: 'for'; init: S | null; c: E | null; step: E | null; body: S; line: number; col: number }
  | { t: 'while'; c: E; body: S; line: number; col: number }
  | { t: 'block'; body: S[] };
interface Fn { name: string; params: string[]; body: S[] }

function parse(toks: Tok[]): { fns: Fn[]; top: S[] } {
  let p = 0;
  const peek = () => toks[p];
  const err = (msg: string): never => { const t = toks[p]; throw new SyntaxErr(msg, t.line, t.col); };
  const isOp = (s: string) => toks[p].k === 'op' && toks[p].s === s;
  const eat = (s: string) => { if (!isOp(s)) err(`Expected '${s}'`); p++; };
  const ident = () => { if (toks[p].k !== 'id') err('Expected identifier'); return toks[p++].s; };
  const fns: Fn[] = [];

  const primary = (): E => {
    const t = toks[p++];
    if (t.k === 'num') return { t: 'lit', v: num(t.v, true) };
    if (t.k === 'str') return { t: 'lit', v: { vt: BSTR, v: t.s } };
    if (t.k === 'id') {
      if (t.s === 'true' || t.s === 'false') return { t: 'lit', v: bool(t.s === 'true') };
      if (t.s === 'null') return { t: 'lit', v: { vt: NULL, v: null } };
      if (t.s === 'Math' && isOp('.')) { p++; return { t: 'math', s: ident() }; }
      return { t: 'name', s: t.s };
    }
    if (t.k === 'op' && t.s === '(') { const e = expr(); eat(')'); return e; }
    p--; return err('Syntax error');
  };
  const postfix = (): E => {
    let e = primary();
    for (;;) {
      if (isOp('(')) {
        const t = toks[p++], args: E[] = [];
        if (!isOp(')')) for (;;) { args.push(assign()); if (isOp(',')) { p++; continue; } break; }
        eat(')');
        e = { t: 'call', f: e, args, line: t.line, col: t.col };
        continue;
      }
      if ((isOp('++') || isOp('--')) && e.t === 'name') { e = { t: 'incdec', op: toks[p++].s, prefix: false, target: e.s }; continue; }
      return e;
    }
  };
  const unary = (): E => {
    if (isOp('-') || isOp('+') || isOp('!')) { const op = toks[p++].s; return { t: 'un', op, a: unary() }; }
    if (isOp('++') || isOp('--')) {
      const op = toks[p++].s, a = unary();
      if (a.t !== 'name') err('Syntax error');
      return { t: 'incdec', op, prefix: true, target: (a as { s: string }).s };
    }
    return postfix();
  };
  const LEVELS = [['||'], ['&&'], ['==', '!=', '===', '!=='], ['<', '>', '<=', '>='], ['+', '-'], ['*', '/', '%']];
  const binary = (lv: number): E => {
    if (lv === LEVELS.length) return unary();
    let a = binary(lv + 1);
    while (toks[p].k === 'op' && LEVELS[lv].includes(toks[p].s)) { const op = toks[p++].s; a = { t: 'bin', op, a, b: binary(lv + 1) }; }
    return a;
  };
  const assign = (): E => {
    const a = binary(0);
    if (toks[p].k === 'op' && ['=', '+=', '-=', '*=', '/=', '%='].includes(toks[p].s)) {
      if (a.t !== 'name') err('Cannot assign to this expression');
      const op = toks[p++].s;
      return { t: 'assign', op, target: (a as { s: string }).s, b: assign() };
    }
    return a;
  };
  const expr = assign;
  const semi = () => { if (isOp(';')) p++; };
  const varDecl = (): S => {
    const t = toks[p++], decls: { name: string; init: E | null }[] = [];
    for (;;) {
      const name = ident();
      let init: E | null = null;
      if (isOp('=')) { p++; init = assign(); }
      decls.push({ name, init });
      if (isOp(',')) { p++; continue; }
      return { t: 'var', decls, line: t.line, col: t.col };
    }
  };
  const stmt = (): S => {
    const t = peek();
    if (t.k === 'op' && t.s === '{') { p++; const body: S[] = []; while (!isOp('}')) body.push(stmt()); p++; return { t: 'block', body }; }
    if (t.k === 'op' && t.s === ';') { p++; return { t: 'block', body: [] }; }
    if (t.k === 'id') {
      switch (t.s) {
        case 'var': { const s = varDecl(); semi(); return s; }
        case 'return': {
          p++;
          const e = isOp(';') || isOp('}') ? null : expr();
          semi(); return { t: 'ret', e, line: t.line, col: t.col };
        }
        case 'if': {
          p++; eat('('); const c = expr(); eat(')');
          const a = stmt();
          let b: S | null = null;
          if (peek().k === 'id' && peek().s === 'else') { p++; b = stmt(); }
          return { t: 'if', c, a, b, line: t.line, col: t.col };
        }
        case 'while': { p++; eat('('); const c = expr(); eat(')'); return { t: 'while', c, body: stmt(), line: t.line, col: t.col }; }
        case 'for': {
          p++; eat('(');
          let init: S | null = null;
          if (!isOp(';')) {
            const it = peek();
            init = it.k === 'id' && it.s === 'var' ? varDecl() : { t: 'expr', e: expr(), line: it.line, col: it.col };
          }
          eat(';');
          const c = isOp(';') ? null : expr(); eat(';');
          const step = isOp(')') ? null : expr(); eat(')');
          return { t: 'for', init, c, step, body: stmt(), line: t.line, col: t.col };
        }
        case 'function': err('Syntax error'); // nested functions are not supported
      }
    }
    const e = expr(); semi();
    return { t: 'expr', e, line: t.line, col: t.col };
  };
  const top: S[] = [];
  while (peek().k !== 'eof') {
    if (peek().k === 'id' && peek().s === 'function') {
      p++;
      const name = ident(), params: string[] = [];
      eat('(');
      if (!isOp(')')) for (;;) { params.push(ident()); if (isOp(',')) { p++; continue; } break; }
      eat(')'); eat('{');
      const body: S[] = [];
      while (!isOp('}')) { if (peek().k === 'eof') err("Expected '}'"); body.push(stmt()); }
      p++;
      fns.push({ name, params, body });
      continue;
    }
    top.push(stmt());
  }
  return { fns, top };
}

// ------------------------------------------------------------------------------------------------- compiler
type Ex = (f: V[]) => V;
type St = (f: V[]) => V | null;   // non-null: a return value
const RETURNED_NOTHING: V = { vt: EMPTY, v: undefined };

export function compileJs(source: string, host: ScriptHost) {
  const { fns, top } = parse(lex(source));
  const members = host.members;
  const hostIdx = new Map<string, number>();
  members.forEach((m, i) => { if (!hostIdx.has(m.name)) hostIdx.set(m.name, i); });
  const G: V[] = [], gslot = new Map<string, number>(), gdeclared: string[] = [];
  const global = (name: string, declared: boolean): number => {
    let s = gslot.get(name);
    if (s === undefined) { s = G.length; gslot.set(name, s); G.push(declared ? UNDEF : { vt: -1, v: undefined }); if (declared) gdeclared.push(name); }
    return s;
  };
  const collectVars = (ss: S[], add: (n: string) => void) => {
    for (const s of ss) {
      if (s.t === 'var') s.decls.forEach((d) => add(d.name));
      else if (s.t === 'block') collectVars(s.body, add);
      else if (s.t === 'if') { collectVars([s.a], add); if (s.b) collectVars([s.b], add); }
      else if (s.t === 'for') { if (s.init) collectVars([s.init], add); collectVars([s.body], add); }
      else if (s.t === 'while') collectVars([s.body], add);
    }
  };
  collectVars(top, (n) => global(n, true));
  const fnByName = new Map<string, { fn: Fn; locals: Map<string, number>; body: St | null }>();
  for (const fn of fns) {
    const locals = new Map<string, number>();
    fn.params.forEach((n) => { if (!locals.has(n)) locals.set(n, locals.size); });
    collectVars(fn.body, (n) => { if (!locals.has(n)) locals.set(n, locals.size); });
    fnByName.set(fn.name, { fn, locals, body: null });
  }
  const random = host.random ? () => host.random!() : Math.random;

  type Ref = { kind: 'local'; i: number } | { kind: 'global'; i: number } | { kind: 'host'; i: number };
  const resolve = (name: string, locals: Map<string, number> | null): Ref => {
    const l = locals?.get(name);
    if (l !== undefined) return { kind: 'local', i: l };
    const g = gslot.get(name);
    if (g !== undefined) return { kind: 'global', i: g };
    const h = hostIdx.get(name);
    if (h !== undefined) return { kind: 'host', i: h };
    return { kind: 'global', i: global(name, false) };   // an implicit global, created by its first assignment
  };
  const hostGet = (i: number): V => {
    const m = members[i];
    if (m.kind !== 'prop') throw hrErr(0x80020003);
    return { vt: R8, v: host.get(i) };
  };
  const hostPut = (i: number, a: V): void => {
    const m = members[i];
    const v = a.vt === EMPTY ? 0 : a.v;
    if (m.kind === 'prop') { host.set(i, tpStore(v, a.vt), a.vt); return; }
    if (m.kind !== 'put') throw hrErr(0x80020003);
    const c = convertArg(v, a.vt, (m.params ?? [])[0] ?? m.vt);
    if (c === null) throw hrErr(lastHr);
    host.call(i, [c], [a.vt]);
  };
  const hostCall = (i: number, args: V[]): V => {
    const m = members[i], params = m.params ?? [];
    if (m.kind !== 'method') throw jsErr(5002, 'Function expected');
    if (args.length !== params.length) throw hrErr(0x8002000e);
    const conv: (number | string)[] = [];
    for (let k = 0; k < args.length; k++) {
      const c = convertArg(args[k].vt === EMPTY ? 0 : args[k].v, args[k].vt, params[k]);
      if (c === null) throw hrErr(lastHr);
      conv.push(c);
    }
    const r = host.call(i, conv, args.map((a) => a.vt));
    if (m.vt === R4) return { vt: R8, v: Math.fround(r as number) };
    if (m.vt === 2 || m.vt === I4) return { vt: I4, v: r };
    return UNDEF;   // ponytail: array results (tp_Waveform...) are not supported in JScript
  };
  const read = (r: Ref, name: string): Ex => {
    const i = r.i;
    if (r.kind === 'local') return (f) => f[i];
    if (r.kind === 'host') return () => hostGet(i);
    return () => { const v = G[i]; if (v.vt === -1) throw jsErr(5009, `'${name}' is undefined`); return v; };
  };
  const write = (r: Ref): ((f: V[], v: V) => void) => {
    const i = r.i;
    if (r.kind === 'local') return (f, v) => { f[i] = v; };
    if (r.kind === 'host') return (_f, v) => hostPut(i, v);
    return (_f, v) => { G[i] = v; };
  };
  const MATH: Record<string, (a: V[]) => V> = {
    sin: (a) => ({ vt: R8, v: libm.sin(toNum(a[0] ?? UNDEF)) }),
    cos: (a) => ({ vt: R8, v: libm.cos(toNum(a[0] ?? UNDEF)) }),
    round: (a) => num(Math.round(toNum(a[0] ?? UNDEF)), true),
    random: () => ({ vt: R8, v: random() }),
    sqrt: (a) => num(Math.sqrt(toNum(a[0] ?? UNDEF)), true),   // Math.sqrt(4) is a Long
    floor: (a) => num(Math.floor(toNum(a[0] ?? UNDEF)), true),
    abs: (a) => num(Math.abs(toNum(a[0] ?? UNDEF)), isInt(a[0] ?? UNDEF)),
  };
  let at = { line: 0, col: 0 };
  const cx = (e: E, locals: Map<string, number> | null): Ex => {
    switch (e.t) {
      case 'lit': { const v = e.v; return () => v; }
      case 'name': return read(resolve(e.s, locals), e.s);
      case 'math': throw new SyntaxErr(`Math.${e.s} is not supported`, at.line, at.col);
      case 'un': {
        const a = cx(e.a, locals);
        if (e.op === '!') return (f) => bool(!truthy(a(f)));
        if (e.op === '+') return (f) => { const v = a(f); return num(toNum(v), isInt(v)); };
        return (f) => { const v = a(f); return num(-toNum(v), isInt(v)); };
      }
      case 'bin': {
        const a = cx(e.a, locals), b = cx(e.b, locals), op = e.op;
        if (op === '&&') return (f) => { const x = a(f); return truthy(x) ? b(f) : x; };
        if (op === '||') return (f) => { const x = a(f); return truthy(x) ? x : b(f); };
        if ('+-*/%'.includes(op)) return (f) => arith(op, a(f), b(f));
        return (f) => compare(op, a(f), b(f));
      }
      case 'assign': {
        const r = resolve(e.target, locals), w = write(r), b = cx(e.b, locals);
        if (e.op === '=') return (f) => { const v = b(f); w(f, v); return v; };
        const rd = read(r, e.target), op = e.op[0];
        return (f) => { const v = arith(op, rd(f), b(f)); w(f, v); return v; };
      }
      case 'incdec': {
        const r = resolve(e.target, locals), w = write(r), rd = read(r, e.target);
        const one: V = { vt: I4, v: 1 }, op = e.op[0], prefix = e.prefix;
        return (f) => { const old = rd(f), o = num(toNum(old), isInt(old)), v = arith(op, o, one); w(f, v); return prefix ? v : o; };
      }
      case 'call': {
        const args = e.args.map((a) => cx(a, locals));
        if (e.f.t === 'math') {
          const fn = MATH[e.f.s];
          if (!fn) throw new SyntaxErr(`Math.${e.f.s} is not supported`, e.line, e.col);
          return (f) => fn(args.map((a) => a(f)));
        }
        if (e.f.t !== 'name') throw new SyntaxErr('Function expected', e.line, e.col);
        const name = e.f.s, user = fnByName.get(name);
        if (user && !locals?.has(name)) return (f) => invoke(user, args.map((a) => a(f)));
        const r = resolve(name, locals);
        if (r.kind === 'host') { const i = r.i; return (f) => hostCall(i, args.map((a) => a(f))); }
        const i = r.i, local = r.kind === 'local';
        return (f) => {
          const v = local ? f[i] : G[i];
          if (v.vt === -1 || v.vt === EMPTY || v.vt === NULL) throw jsErr(5007, `The value of the property '${name}' is null or undefined, not a Function object`);
          throw jsErr(5002, 'Function expected');
        };
      }
    }
  };
  const cs = (s: S, locals: Map<string, number> | null): St => {
    switch (s.t) {
      case 'block': { const b = s.body.map((x) => cs(x, locals)); return (f) => { for (const x of b) { const r = x(f); if (r) return r; } return null; }; }
      case 'expr': { const e = cx(s.e, locals), pos = { line: s.line, col: s.col }; return (f) => { at = pos; e(f); return null; }; }
      case 'var': {
        const pos = { line: s.line, col: s.col };
        const sets = s.decls.filter((d) => d.init).map((d) => { const w = write(resolve(d.name, locals)), e = cx(d.init!, locals); return (f: V[]) => w(f, e(f)); });
        return (f) => { at = pos; for (const x of sets) x(f); return null; };
      }
      case 'ret': { const e = s.e ? cx(s.e, locals) : null, pos = { line: s.line, col: s.col }; return (f) => { at = pos; return e ? e(f) : RETURNED_NOTHING; }; }
      case 'if': {
        const c = cx(s.c, locals), a = cs(s.a, locals), b = s.b ? cs(s.b, locals) : null, pos = { line: s.line, col: s.col };
        return (f) => { at = pos; return truthy(c(f)) ? a(f) : b ? b(f) : null; };
      }
      case 'while': {
        const c = cx(s.c, locals), body = cs(s.body, locals), pos = { line: s.line, col: s.col };
        return (f) => { for (;;) { at = pos; if (!truthy(c(f))) return null; const r = body(f); if (r) return r; } };
      }
      case 'for': {
        const init = s.init ? cs(s.init, locals) : null, c = s.c ? cx(s.c, locals) : null, step = s.step ? cx(s.step, locals) : null;
        const body = cs(s.body, locals), pos = { line: s.line, col: s.col };
        return (f) => {
          if (init) init(f);
          for (;;) { at = pos; if (c && !truthy(c(f))) return null; const r = body(f); if (r) return r; at = pos; if (step) step(f); }
        };
      }
    }
  };
  function invoke(u: { fn: Fn; locals: Map<string, number>; body: St | null }, args: V[]): V {
    const f: V[] = new Array<V>(u.locals.size).fill(UNDEF);
    for (let k = 0; k < u.fn.params.length && k < args.length; k++) f[k] = args[k];
    const caller = at;   // a later error in the caller's statement is reported there (one in the callee, where it happened)
    const r = u.body!(f);
    at = caller;
    return r ?? RETURNED_NOTHING;
  }
  for (const u of fnByName.values()) u.body = cs({ t: 'block', body: u.fn.body }, u.locals);
  const run = <T>(fn: () => T): T => {
    try { return fn(); } catch (e) {
      if (e instanceof VbsError) { if (e.line < 0) { e.line = at.line; e.col = at.col; } }
      throw e;
    }
  };
  run(() => cs({ t: 'block', body: top }, null)([]));
  const conv = (a: unknown): V => typeof a === 'string' ? { vt: BSTR, v: a } : typeof a === 'boolean' ? bool(a) : a === undefined ? UNDEF : num(a as number, false);
  return {
    has: (entry: string) => fnByName.has(entry),
    call(entry: string, args: unknown[] = []): ScriptValue {
      const u = fnByName.get(entry);
      if (!u) throw hrErr(0x80020003);
      const r = run(() => invoke(u, args.map(conv)));
      return { vt: r.vt, v: r.v ?? 0 };
    },
    globals(): Map<string, ScriptValue> {
      const m = new Map<string, ScriptValue>();
      for (const n of gdeclared) { const v = G[gslot.get(n)!]; m.set(n, { vt: v.vt, v: v.v ?? 0 }); }
      return m;
    },
  };
}
