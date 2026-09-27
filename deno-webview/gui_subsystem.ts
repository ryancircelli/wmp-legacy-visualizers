#!/usr/bin/env -S deno run --allow-read --allow-write
// `deno compile` always emits a console-subsystem PE, which makes Windows open a console window
// next to the screensaver. There is no flag for it, so the one field that decides it is patched
// here: IMAGE_OPTIONAL_HEADER.Subsystem, 3 (CUI) -> 2 (GUI). Nothing else in the file moves, and
// the field is not covered by a checksum Windows enforces for a normal exe.
const path = Deno.args[0];
if (!path) {
  console.error("usage: gui_subsystem.ts <exe>");
  Deno.exit(2);
}

const f = await Deno.open(path, { read: true, write: true });
const head = new Uint8Array(0x400);
await f.read(head);
const dv = new DataView(head.buffer);

if (dv.getUint16(0, true) !== 0x5a4d) throw new Error(`${path}: not a PE (no MZ)`);
const pe = dv.getUint32(0x3c, true);
if (dv.getUint32(pe, true) !== 0x00004550) throw new Error(`${path}: no PE signature`);
const opt = pe + 24;
const magic = dv.getUint16(opt, true);
if (magic !== 0x20b && magic !== 0x10b) {
  throw new Error(`${path}: unexpected optional header ${magic}`);
}
const at = opt + 68; // Subsystem: same offset for PE32 and PE32+

const was = dv.getUint16(at, true);
if (was === 2) {
  console.log(`${path}: already GUI subsystem`);
} else {
  if (was !== 3) throw new Error(`${path}: subsystem is ${was}, refusing to patch`);
  await f.seek(at, Deno.SeekMode.Start);
  await f.write(new Uint8Array([2, 0]));
  console.log(`${path}: subsystem 3 (console) -> 2 (GUI)`);
}
f.close();
