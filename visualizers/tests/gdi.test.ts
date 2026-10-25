// Self-consistency checks for the GDI rasterizer (Kid Drawing's, Shacojin's and Celestial's) (the pixel-exactness
// against Windows GDI is verified by private oracle tooling; nothing here comes from it).
import { describe, expect, it } from 'vitest';
import { Gdi } from '../src/gdi';

const WHITE = 0xffffff;
const lit = (g: Gdi): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = 0; i < g.px.length; i++) if (g.px[i]) out.push([i % g.w, Math.floor(i / g.w)]);
  return out;
};
/** Draw on a big canvas and on a small one shifted by (ox,oy): clipping must not move any pixel. */
function clipInvariant(draw: (g: Gdi, dx: number, dy: number) => void): void {
  const big = new Gdi(160, 120);
  draw(big, 0, 0);
  for (const [ox, oy, w, h] of [[40, 30, 50, 40], [70, 55, 30, 20], [0, 0, 17, 13], [120, 90, 40, 30]] as const) {
    const small = new Gdi(w, h);
    draw(small, -ox, -oy);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) expect(small.px[y * w + x]).toBe(big.px[(y + oy) * 160 + x + ox]);
  }
}

describe('Gdi basics', () => {
  it('stores COLORREF 0x00BBGGRR as 0x00RRGGBB and clips/normalises FillRect', () => {
    const g = new Gdi(8, 6);
    g.fillRect(6, 5, -3, 2, 0x332211);
    expect(lit(g).length).toBe(6 * 3);
    expect(g.px[2 * 8]).toBe(0x112233);
    expect(g.px[1 * 8]).toBe(0);
  });

  it('LineTo is Bresenham with the end excluded and moves the current position', () => {
    const g = new Gdi(16, 8);
    g.moveTo(0, 0);
    g.lineTo(10, 4, WHITE);
    // one pixel per column, row = round(4x/10) with ties to the smaller row
    expect(lit(g).sort((a, b) => a[0] - b[0])).toEqual(
      Array.from({ length: 10 }, (_, x) => [x, Math.ceil((4 * x) / 10 - 0.5) || 0]),
    );
    g.lineTo(10, 7, 0x00ff00); // continues from (10,4)
    expect([4, 5, 6].map((y) => g.px[y * 16 + 10])).toEqual([0x00ff00, 0x00ff00, 0x00ff00]);
    expect(g.px[7 * 16 + 10]).toBe(0);
  });

  it('a zero-length cosmetic line draws nothing; refused huge lines draw nothing', () => {
    const g = new Gdi(10, 10);
    g.moveTo(3, 3);
    g.lineTo(3, 3, WHITE);
    g.moveTo(5, 5);
    g.lineTo(2 ** 27, 5, WHITE);
    g.moveTo(-2e9, 1);
    g.lineTo(2e9, 1, WHITE);
    expect(lit(g)).toEqual([]);
  });
});

describe('Gdi shapes', () => {
  it('Polygon fills the interior and outlines every edge including the closing one', () => {
    const g = new Gdi(12, 10);
    g.polygon([2, 8, 8, 2], [2, 2, 6, 6], 0x0000ff, WHITE);
    for (let y = 0; y < 10; y++)
      for (let x = 0; x < 12; x++) {
        const border = x >= 2 && x <= 8 && y >= 2 && y <= 6 && (x === 2 || x === 8 || y === 2 || y === 6);
        const inside = x > 2 && x < 8 && y > 2 && y < 6;
        expect(g.px[y * 12 + x]).toBe(border ? WHITE : inside ? 0xff0000 : 0);
      }
  });

  it('Ellipse stays within its box [l,r)x[t,b), and the outline encloses the fill', () => {
    for (const [w, h] of [[2, 2], [3, 3], [8, 5], [17, 30], [64, 9]] as const) {
      const g = new Gdi(80, 40);
      g.ellipse(5, 3, 5 + w, 3 + h, 0x0000ff, WHITE);
      const px = lit(g);
      expect(px.length).toBeGreaterThan(0);
      for (const [x, y] of px) expect(x >= 5 && x < 5 + w && y >= 3 && y < 3 + h).toBe(true);
      // every fill pixel's 4-neighbours are fill or outline
      for (const [x, y] of px)
        if (g.px[y * 80 + x] === 0xff0000)
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) expect(g.px[(y + dy) * 80 + x + dx]).not.toBe(0);
    }
    const g = new Gdi(10, 10);
    g.ellipse(2, 2, 2, 8, 0x0000ff, WHITE);
    g.ellipse(7, 2, 3, 2, 0x0000ff, WHITE);
    expect(lit(g)).toEqual([]);
  });

  it('a width-8 line is 8 rows thick, and a zero-length one leaves a round dot', () => {
    const g = new Gdi(40, 20);
    g.moveTo(10, 10);
    g.wideLineTo(30, 10, WHITE, 8);
    const ys = new Set(lit(g).filter(([x]) => x === 20).map(([, y]) => y));
    expect([...ys].sort((a, b) => a - b)).toEqual([6, 7, 8, 9, 10, 11, 12, 13]);
    const d = new Gdi(20, 20);
    d.moveTo(10, 10);
    d.wideLineTo(10, 10, WHITE, 8);
    const dot = lit(d);
    expect(dot.length).toBeGreaterThan(40);
    for (const [x, y] of dot) expect(Math.hypot(x - 10, y - 10)).toBeLessThan(4.6);
  });

  it('Rectangle: the outline on [l,r-1]x[t,b-1], the brush inside, nothing for an empty box', () => {
    const g = new Gdi(12, 10);
    g.rectangle(9, 7, 2, 1, 0x0000ff, WHITE);
    for (let y = 0; y < 10; y++)
      for (let x = 0; x < 12; x++) {
        const inBox = x >= 2 && x <= 8 && y >= 1 && y <= 6, edge = x === 2 || x === 8 || y === 1 || y === 6;
        expect(g.px[y * 12 + x]).toBe(inBox ? (edge ? WHITE : 0xff0000) : 0);
      }
    const e = new Gdi(10, 10);
    e.rectangle(3, 3, 3, 8, 0xff, WHITE);
    e.rectangle(2, 5, 8, 5, 0xff, WHITE);
    expect(lit(e)).toEqual([]);
  });

  it('Arc from the top-left radial round to itself: a ring round an empty centre, within the box (widened by half the pen)', () => {
    for (const width of [1, 3, 5]) {
      const g = new Gdi(80, 60);
      g.arc(20, 15, 60, 45, WHITE, width);          // symmetric about (40, 30)
      const px = lit(g), pad = width >> 1;
      expect(px.length).toBeGreaterThan(80);
      for (const [x, y] of px) expect(x >= 20 - pad && x < 60 + pad && y >= 15 - pad && y < 45 + pad).toBe(true);
      expect(g.px[30 * 80 + 40]).toBe(0);           // a ring: the centre stays empty
    }
    const g = new Gdi(10, 10);
    g.arc(2, 2, 2, 8, WHITE, 3);
    expect(lit(g)).toEqual([]);
  });

  it('a w-pixel horizontal line is w rows thick', () => {
    for (let w = 2; w <= 40; w++) {
      const g = new Gdi(80, 60);
      g.moveTo(20, 30);
      g.wideLineTo(60, 30, WHITE, w);
      const ys = [...new Set(lit(g).filter(([x]) => x === 40).map(([, y]) => y))].sort((a, b) => a - b);
      expect(ys.length).toBe(w);
      expect(Math.max(...ys) - Math.min(...ys)).toBe(w - 1);
    }
  });

  it('clipping never shifts pixels', () => {
    clipInvariant((g, dx, dy) => {
      g.moveTo(3 + dx, 100 + dy);
      g.lineTo(150 + dx, 7 + dy, WHITE);
      g.lineTo(20 + dx, 20 + dy, 0x00ff00);
    });
    clipInvariant((g, dx, dy) => g.ellipse(10 + dx, 8 + dy, 151 + dx, 113 + dy, 0x0000ff, WHITE));
    clipInvariant((g, dx, dy) => g.polygon([5 + dx, 150 + dx, 90 + dx, 30 + dx], [5 + dy, 40 + dy, 115 + dy, 70 + dy], 0xff, WHITE));
    clipInvariant((g, dx, dy) => {
      g.moveTo(8 + dx, 110 + dy);
      g.wideLineTo(152 + dx, 12 + dy, WHITE, 8);
    });
    clipInvariant((g, dx, dy) => g.rectangle(10 + dx, 8 + dy, 151 + dx, 113 + dy, 0x0000ff, WHITE));
    for (const w of [1, 3, 5]) clipInvariant((g, dx, dy) => g.arc(12 + dx, 9 + dy, 148 + dx, 111 + dy, WHITE, w));
    for (const rop of [13, 7]) {
      const xs = [5, 150, 90, 30, 140], ys = [5, 40, 115, 70, 100];
      const at = (a: number[], d: number) => a.map((v) => v + d);
      clipInvariant((g, dx, dy) => {
        g.rop = rop;
        g.polyline(at(xs, dx), at(ys, dy), WHITE, 9);
      });
      clipInvariant((g, dx, dy) => {
        g.rop = rop;
        g.polygon(at(xs, dx), at(ys, dy), 0xff, 0xff00, 6);
      });
      clipInvariant((g, dx, dy) => {
        g.rop = rop;
        g.ellipse(10 + dx, 8 + dy, 151 + dx, 113 + dy, 0x0000ff, WHITE, 13);
      });
    }
  });
});

describe('Gdi pens and ROP2 (Celestial)', () => {
  const XS = [10, 70, 40, 40, 20, 65],
    YS = [10, 15, 50, 50, 45, 5];

  it('draws into a given buffer', () => {
    const px = new Uint32Array(12);
    const g = new Gdi(4, 3, px);
    g.fillRect(0, 0, 4, 3, 0x0000ff);
    expect(px[11]).toBe(0xff0000);
  });

  it('a cosmetic Polyline is the LineTo chain and leaves the current position alone', () => {
    for (const w of [0, 1]) {
      const a = new Gdi(80, 60),
        b = new Gdi(80, 60);
      a.moveTo(3, 3);
      a.polyline(XS, YS, WHITE, w);
      a.lineTo(79, 59, 0xff);
      b.moveTo(10, 10);
      XS.forEach((x, i) => i && b.lineTo(x, YS[i] ?? 0, WHITE));
      b.moveTo(3, 3);
      b.lineTo(79, 59, 0xff);
      expect(a.px).toEqual(b.px);
    }
  });

  it('a wide two-point Polyline is wideLineTo; a zero-length one leaves a dot', () => {
    for (const w of [2, 3, 8, 21]) {
      const a = new Gdi(80, 60),
        b = new Gdi(80, 60);
      a.polyline([12, 61], [50, 17], WHITE, w);
      b.moveTo(12, 50);
      b.wideLineTo(61, 17, WHITE, w);
      expect(a.px).toEqual(b.px);
      const d = new Gdi(80, 60);
      d.polyline([40, 40], [30, 30], WHITE, w);
      expect(lit(d).length).toBeGreaterThan(0);
    }
  });

  it('Polygon and Ellipse keep their cosmetic-pen pixels with the default width; the NULL pen only fills', () => {
    const a = new Gdi(80, 60),
      b = new Gdi(80, 60);
    a.polygon(XS, YS, 0xff, WHITE);
    b.polygon(XS, YS, 0xff, WHITE, 1);
    expect(a.px).toEqual(b.px);
    const n = new Gdi(80, 60);
    n.polygon(XS, YS, 0xff, null);
    expect(n.px.some((v) => v === WHITE)).toBe(false);
    for (let i = 0; i < n.px.length; i++) if (n.px[i]) expect(a.px[i]).not.toBe(0);
  });

  it('under XOR every pixel of a wide figure is painted once: drawing it twice restores the canvas', () => {
    for (const w of [2, 3, 6, 7, 14, 40]) {
      const g = new Gdi(80, 60);
      g.fillRect(0, 0, 80, 60, 0x406080);
      const before = g.px.slice();
      g.rop = 7;
      const draw = (): void => {
        g.polyline(XS, YS, 0xff00ff, w);
        g.polygon(XS, YS, 0x00ff00, 0xff0000, w);
        g.ellipse(15, 12, 55, 52, 0x00ff00, 0xff0000, w);
      };
      draw();
      expect(g.px).not.toEqual(before);
      draw();
      expect(g.px).toEqual(before);
      // a single figure on black: only the pen and brush colours, never their XOR
      const s = new Gdi(80, 60);
      s.rop = 7;
      s.ellipse(15, 12, 55, 52, 0x00ff00, 0xff0000, w);
      for (const v of new Set(s.px)) expect([0, 0xff00, 0xff]).toContain(v);
    }
  });

  it('MERGE ORs the colours; FillRect ignores the ROP', () => {
    const g = new Gdi(80, 60);
    g.rop = 15;
    g.fillRect(0, 0, 80, 60, 0x000080);
    expect(g.px[0]).toBe(0x800000);
    g.fillRect(0, 0, 80, 60, 0x000001);
    expect(g.px[0]).toBe(0x010000);
    g.polyline(XS, YS, 0x00ff00, 5);
    expect(new Set(g.px)).toEqual(new Set([0x010000, 0x01ff00]));
  });
});
