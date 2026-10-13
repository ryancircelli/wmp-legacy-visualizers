// PRESET1, "Oddworld: Munch's Oddysee" (Init 0x1000fe10, Render 0x1000ff00, Animate 0x10010610, CreateScene
// 0x100107c0, CreateVideoResources 0x10010a80, the behaviour graph 0x10010ed0): PRESET2's scene (./blobby.ts) with
// the ANL_MUNCH skinned character playing its matrix-animated dances, louder colour bands, a dark blue clear, the sky
// box z-tested and clamped and the character alpha-blended.
import { Blobby, type BlobbyCfg } from './blobby';

const MUNCH: BlobbyCfg = { base: 0x10062440, anl: 'ANL_MUNCH', beh: 'BEH_MUNCH', bgnd: 'MUNCH',
  move: [0x3ca3d70a, 0xc0c75c29, 0x3f4f5c29], scale: 0x3d615d51, colourScale: 10, clear: 0x82, munch: true };

export class Munch extends Blobby {
  protected cfg = MUNCH;
}
