// The contract between the Energy Bliss engine (mp10/engine.ts) and the GDI+ equalizer panel (mp10/eqpanel.ts).
//
// The engine owns everything around the panel: the guard (sprite 2 matches I[0xf11f] x I[0xf120], sprite 6's
// second buffer and the source picture exist), the output size I[0xf116] = window width and
// I[0xf117] = ftol(f120 / f11f * window width) capped at ftol(window height * 0.5), the sprite 6 checks, the
// d8d5/d8d6/d8fe stores before the call, and afterwards the row copy of the returned image into sprite 6's
// pixels at row (sprite 6 height - f117) with the 0x1fa5/0x1fa6/d89f/d870/d872/d87a stores.
//
// The panel does everything in between: from the GDI+ startup flag I[0x1f82] through the LockBits of its scaled
// result. It reads and writes its own fields in the engine heap exactly as the DLL does (int index = byte offset / 4):
//   reads   I[0xcf86 + i] / I[0xd18e + i]  spectrum, channel 0 / 1 (the audio step's per-bin levels)
//           I[0xf11f], I[0xf120]           source size (sprite 2); I[0xf118], I[0xf119] for the hd variant
//           I[0xf116], I[0xf117]           output size (already set by the engine)
//           I[0xf131]                      1 when the frame rate is too low (draws the warning string)
//   state   I[0x1f82]                      GDI+ started flag (and I[0x241e] receives the startup token once)
//           I[0x241e + b], I[0x2446 + b]   per-band level and raw level
//           F[0x246e + b]                  per-band decaying peak
//   scratch I[0xd89d], I[0xd89f], I[0xd8d5], I[0xd8d6], I[0xd8ec], I[0xd8f8], I[0x2431], I[0x2432], I[0x2459], I[0x245a]
// and returns the f116 x f117 picture as 32bpp BGRA bytes (LockBits PixelFormat32bppARGB, rows top-down, stride w*4).
// The button pictures come from the art: eqpanel.ts exports makeEqPanel(buttons) returning an EqPanelDraw.

export interface EqPanelHeap { I: Int32Array; U: Uint32Array; F: Float32Array; B: Uint8Array }

export interface EqPanelCall {
  /** the engine heap; the panel reads and writes the fields listed above */
  heap: EqPanelHeap;
  /** the source picture, BGRA, read only: sprite 2's pixels (I[0xf11f] x I[0xf120]), or for the high-resolution
   *  variant sprite 2's second buffer I[0xa4b] (I[0xf118] x I[0xf119]; the guard still compares f11f/f120 with
   *  sprite 2's size). The high-resolution variant runs once, at frame 0, from the resize handler 0x10018340 */
  src: Uint8Array;
  /** false: the panel at 0x10015bd0; true: the high-resolution variant at 0x10016dc0 */
  hd: boolean;
}

/** Draws one panel frame; returns I[0xf116] * I[0xf117] * 4 bytes of BGRA. */
export type EqPanelDraw = (call: EqPanelCall) => Uint8Array;
