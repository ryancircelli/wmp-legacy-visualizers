// The DLL's MMX draw_line (0x1001f550, what it installs at goomInfo+0x1ef8 on any MMX CPU): a line with
// any end off the w x h buffer is not drawn at all; pixels get the colour added with unsigned saturation
// per byte (PADDUSB). 16.16 fixed-point stepping along the longer axis.

/** per-byte unsigned saturating add */
export function addSat(p: number, c: number): number {
  // two bytes per 16-bit lane: a carry lands in the lane's ninth bit and turns that byte to 255
  const lo = (p & 0xff00ff) + (c & 0xff00ff), hi = ((p >>> 8) & 0xff00ff) + ((c >>> 8) & 0xff00ff);
  const ol = lo & 0x1000100, oh = hi & 0x1000100;
  return ((((lo | (ol - (ol >>> 8))) & 0xff00ff) | (((hi | (oh - (oh >>> 8))) & 0xff00ff) << 8)) >>> 0);
}

export function drawLine(data: Uint32Array, x1: number, y1: number, x2: number, y2: number, col: number,
  screenx: number, screeny: number): void {
  if (y1 < 0 || y2 < 0 || x1 < 0 || x2 < 0 || y1 >= screeny || y2 >= screeny || x1 >= screenx || x2 >= screenx) return;
  let dx = x2 - x1, dy = y2 - y1;
  if (x1 >= x2) {
    let t = x1; x1 = x2; x2 = t;
    t = y1; y1 = y2; y2 = t;
    dx = x2 - x1; dy = y2 - y1;
  }
  if (dx === 0) {
    if (y1 < y2) {
      for (let y = y1, p = screenx * y1 + x1; y <= y2; y++, p += screenx) data[p] = addSat(data[p], col);
    } else {
      for (let y = y2, p = screenx * y2 + x1; y <= y1; y++, p += screenx) data[p] = addSat(data[p], col);
    }
    return;
  }
  if (dy === 0) {
    if (x1 < x2) {
      for (let x = x1, p = screenx * y1 + x1; x <= x2; x++, p++) data[p] = addSat(data[p], col);
    } else {
      for (let x = x2, p = screenx * y1 + x2; x <= x1; x++, p++) data[p] = addSat(data[p], col);
    }
    return;
  }
  if (y2 > y1) {
    if (dy > dx) {
      const step = ((dx << 16) / dy) | 0;
      let xx = x1 << 16;
      for (let y = y1; y <= y2; y++, xx += step) { const p = screenx * y + (xx >> 16); data[p] = addSat(data[p], col); }
    } else {
      const step = ((dy << 16) / dx) | 0;
      let yy = y1 << 16;
      for (let x = x1; x <= x2; x++, yy += step) { const p = (yy >> 16) * screenx + x; data[p] = addSat(data[p], col); }
    }
  } else {
    const ndy = -dy;
    if (ndy > dx) {
      const step = ((dx << 16) / ndy) | 0;
      let xx = (x1 + 1) << 16;
      for (let y = y1; y >= y2; y--, xx += step) { const p = screenx * y + (xx >> 16); data[p] = addSat(data[p], col); }
    } else {
      const step = ((dy << 16) / dx) | 0;
      let yy = y1 << 16;
      for (let x = x1; x <= x2; x++, yy += step) { const p = (yy >> 16) * screenx + x; data[p] = addSat(data[p], col); }
    }
  }
}
