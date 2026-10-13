// Capture frames of the real engine. NODE_PATH=$(npm root -g) node tests/frames.js outdir seconds...
// env: ALC_URL (page url, default file://<repo>/alchemy.html?src=tone)
//      ALC_W / ALC_H (viewport, default 960x540)
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
(async () => {
  const out = process.argv[2] || '/tmp/frames'; fs.mkdirSync(out, { recursive: true });
  const times = process.argv.slice(3).map(Number); if (!times.length) times.push(3, 15, 40);
  const url = process.env.ALC_URL || ('file://' + path.resolve(__dirname, '..', 'alchemy.html') + '?src=tone');
  const viewport = { width: +(process.env.ALC_W || 960), height: +(process.env.ALC_H || 540) };
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream'] });
  const page = await browser.newPage({ viewport });
  page.on('pageerror', e => console.log('PAGEERROR', e.message)); page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
  await page.goto(url);
  let last = 0;
  for (const t of times) { await page.waitForTimeout((t - last) * 1000); last = t;
    const dbg = await page.evaluate(() => JSON.stringify(Alchemy.Shell.engine.debug()));
    console.log('t=' + t, dbg); await page.screenshot({ path: `${out}/f${String(t).padStart(3,'0')}.png` }); }
  await browser.close();
})();
