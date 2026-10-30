// TwistedPixel's corner text. The DLL's CD3DFont renders "Comic Sans MS" 9 pt with GDI into its atlas; that
// rendering is Windows' font, so this port draws the same text with lettering of its own: 3x5 glyphs doubled into
// 8x14 cells, laid out and drawn exactly as the DLL lays out and draws its own (../d3d8/d3dfont.ts). The private
// comparison passes the DLL's atlas and cells instead (cfg.font).
import { type FontData, layoutCells } from '../d3d8/d3dfont';

// one glyph a character from 32 to 126: five rows of three pixels, top first, one octal digit a row (4 = left pixel);
// lower case uses the capitals
const GLYPHS = ('00000 22202 55000 57575 36236 51245 25253 22000 12221 42224 05250 02720 00024 00700 00002 11244 ' +
  '75557 26227 71747 71317 55711 74717 74757 71111 75757 75717 02020 02024 12421 07070 42124 71202 25543 ' +
  '25755 65656 34443 65556 74647 74644 34553 55755 72227 11153 55655 44447 57755 65555 25552 65644 25573 ' +
  '65655 34216 72222 55557 55552 55775 55255 55222 71247 64446 44211 31113 25000 00007 42000').split(' ');
const UPPER = GLYPHS.slice(33, 59);
const ALL = [...GLYPHS, ...UPPER, '32623', '22222', '62326', '03600'];

const CELL_W = 8, CELL_H = 14, TEX = 256;

export function ownFont(): FontData {
  const cells = layoutCells(new Array<number>(95).fill(CELL_W), CELL_H, TEX);
  const atlas = new Uint16Array(TEX * TEX);
  for (let i = 0; i < 95; i++) {
    const g = ALL[i], x0 = cells[i * 4] + 1, y0 = cells[i * 4 + 1] + 2;
    for (let r = 0; r < 5; r++) {
      const bits = g.charCodeAt(r) - 48;
      for (let c = 0; c < 3; c++) {
        if (!(bits & (4 >> c))) continue;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) atlas[(y0 + r * 2 + dy) * TEX + x0 + c * 2 + dx] = 0xffff;
      }
    }
  }
  return { texW: TEX, texH: TEX, atlas, cells };
}
