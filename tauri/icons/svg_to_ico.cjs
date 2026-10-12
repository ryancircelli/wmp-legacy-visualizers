// node svg_to_ico.cjs <in.svg> <out.ico> — rasterise an SVG in Chromium (gradients, filters
// and all, which this machine's ImageMagick mangles) at 1024 px on a transparent background, then
// let PIL write the .ico at 16/24/32/48/64/128/256 (downscaled from the 1024 master).
//   NODE_PATH=$(npm root -g) node tauri/icons/svg_to_ico.cjs tauri/icons/spotify.svg tauri/icons/spotify.ico
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
(async () => {
  const [src, out] = process.argv.slice(2);
  const svg = fs.readFileSync(src, 'utf8');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  await page.setContent(`<html><body style="margin:0;background:transparent">
    <img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="1024" height="1024"></body></html>`);
  await page.waitForFunction(() => document.images[0].complete);
  const png = out.replace(/\.ico$/, '') + '-1024.png';
  await page.screenshot({ path: png, omitBackground: true, clip: { x: 0, y: 0, width: 1024, height: 1024 } });
  await browser.close();
  execFileSync('python3', ['-c', `
from PIL import Image
m = Image.open(${JSON.stringify(png)}).convert('RGBA')
S = [16, 24, 32, 48, 64, 128, 256]
m.resize((256, 256), Image.LANCZOS).save(${JSON.stringify(out)}, sizes=[(n, n) for n in S])
`]);
  fs.unlinkSync(png);
  console.log('wrote', out, fs.statSync(out).size, 'bytes');
})();
