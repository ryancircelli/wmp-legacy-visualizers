// TwistedPixel's preset scripts, VBScript and JScript (the plug-in shipped 332 and 1; ours are 10 and 2), interpreted with the results
// of Windows' vbscript.dll / jscript.dll as TwistedPixel.dll hosts them.
//
// The host is TwistedPixel's "MilkdropVars" dispatch object, described by `members`: script names resolve to it
// last (after the script's own names and the language's builtins), case-sensitively, with the spelling the name has
// at its first appearance in the source (VBScript interns names case-insensitively at parse time). Its semantics are
// TwistedPixel's, applied here so the host only sees plain values:
// - 'prop' members are float32 variables. get() returns the float; set() receives the float to store, already
//   converted the way TwistedPixel's put does (Double rounded to float, Boolean True stored as +1.0, ...).
// - 'method' members take arguments already converted to their declared VARIANT types (params: 4 Single,
//   2 Integer, 3 Long, 8 String) and return a value of type `vt` (4 Single, 2 Integer, 3 Long, 12 an array, which
//   call() returns as a JS array of numbers: a SAFEARRAY of Integer VARIANTs to the script).
// - 'put' members (tp_Script, tp_NextPreset) are property-put-only functions: assignment calls call(i, [string]).
// A conversion failure or a wrong argument count surfaces as the VBScript runtime error vbscript.dll raises for the
// HRESULT TwistedPixel returns (Overflow, Type mismatch, Wrong number of arguments...).

import { compileVbs, SyntaxErr } from './vbscript';
import { compileJs } from './jscript';
import { V8Error, VbsError } from './variant';

export interface HostMember {
  name: string;
  kind: 'prop' | 'method' | 'put';
  /** VARIANT type of the value: 4 for every 'prop'; a method's return type; 8 for a 'put' */
  vt: number;
  /** VARIANT types of a method's parameters */
  params?: number[];
}
export interface ScriptHost {
  members: HostMember[];
  get(i: number): number;
  /** srcVt: the VARIANT type the script assigned (for tracing; the value is already converted) */
  set(i: number, v: number, srcVt: number): void;
  /** srcVts: the VARIANT types the script passed (for tracing; the values are already converted) */
  call(i: number, args: (number | string)[], srcVts: number[]): unknown;
  msgBox?(text: string, caption: string): number;
  /** JScript's Math.random (jscript.dll seeds it from the clock); Math.random when absent */
  random?(): number;
}
/** a VARIANT coming out of a script: its type code and value (number, string, or VbArray) */
export interface ScriptValue { vt: number; v: unknown }
export interface Script {
  has(entry: string): boolean;
  /** calls a Sub / Function of the script; a runtime error throws ScriptError */
  call(entry: string, args?: unknown[]): ScriptValue;
  /** the script-level variables (VBScript Dim / JScript var at top level), for inspection */
  globals(): Map<string, ScriptValue>;
}

/**
 * A syntax error (compileScript) or a runtime error (Script.call), with what the engine reports through
 * IActiveScriptSite::OnScriptError, as measured on vbscript.dll and jscript9Legacy.dll:
 * - number / scode: EXCEPINFO.scode is 0x800A0000 | number; wCode is always 0.
 * - description: EXCEPINFO.bstrDescription. For a VBScript runtime error it adds ": '<detail>'" to the text the
 *   script's own Err.Description reads (the function, variable or host member, or the offending value).
 * - source: EXCEPINFO.bstrSource.
 * - line / col: GetSourcePosition, 0-based (ParseScriptText is given start line 0). A runtime error's column is the
 *   start of the statement; a syntax error's is where the parser stopped.
 * - lineText: GetSourceLineText. It fails (E_FAIL, the BSTR stays NULL) for every runtime error; for a syntax error
 *   it is the source line without its line break.
 */
export class ScriptError extends Error {
  readonly wCode = 0;
  constructor(public number: number, public description: string, public line: number, public col: number, public syntax: boolean,
    public source: string, public lineText: string | null) {
    super(`${syntax ? 'Syntax' : 'Runtime'} error ${number} at line ${line + 1}: ${description}`);
  }
  /** the SCODE the engine reports (0x800A0000 | number) */
  get scode(): number { return (0x800a0000 | (this.number & 0xffff)) >>> 0; }
}

const SOURCE = {
  vbscript: ['Microsoft VBScript runtime error', 'Microsoft VBScript compilation error'],
  jscript: ['JavaScript runtime error', 'JavaScript compilation error'],
};

function wrap(e: unknown, lang: 'vbscript' | 'jscript'): unknown {
  if (!(e instanceof VbsError)) return e;
  const limit = V8Error.stackTraceLimit;   // cheap, as VbsError: runtime errors can come once per pixel
  V8Error.stackTraceLimit = 0;
  const d = e.detail === undefined ? e.description : `${e.description}: '${e.detail}'`;
  const se = new ScriptError(e.number, d, e.line, e.col, false, SOURCE[lang][0], null);
  V8Error.stackTraceLimit = limit;
  return se;
}

export function compileScript(source: string, lang: 'vbscript' | 'jscript', host: ScriptHost): Script {
  let s: Script;
  try {
    s = lang === 'vbscript' ? compileVbs(source, host) : compileJs(source, host);
  } catch (e) {
    if (e instanceof SyntaxErr) throw new ScriptError(1002, e.message, e.line, e.col, true, SOURCE[lang][1], source.split(/\r\n|\r|\n/)[e.line] ?? '');
    throw wrap(e, lang);
  }
  return {
    has: (entry) => s.has(entry),
    call(entry, args) {
      try { return s.call(entry, args); } catch (e) { throw wrap(e, lang); }
    },
    globals: () => s.globals(),
  };
}

/**
 * TwistedPixel's test of a ProcessWaveform / ProcessCustomShape result: the call succeeded and the low 16 bits of
 * the VARIANT's value are all ones (True, or an integer -1; not the Single -1.0).
 */
export function tpTrue(r: ScriptValue): boolean {
  switch (r.vt) {
    case 2: case 3: case 11: case 17: return ((r.v as number) & 0xffff) === 0xffff;
    case 4: { F32[0] = r.v as number; return (U32[0] & 0xffff) === 0xffff; }
    case 5: { F64[0] = r.v as number; return (U32b[0] & 0xffff) === 0xffff; }
  }
  return false;
}
const F32 = new Float32Array(1), U32 = new Uint32Array(F32.buffer);
const F64 = new Float64Array(1), U32b = new Uint32Array(F64.buffer);

export { VbArray } from './variant';
