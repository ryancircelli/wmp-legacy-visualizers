// NODE_PATH=$(npm root -g) node tests/perf.js  -> live fps and ms/render at several viewport sizes
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const [w, h] of [[640, 360], [960, 540], [1280, 720], [1920, 1080]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.goto('file://' + path.resolve(__dirname, '..', 'alchemy.html') + '?src=tone&scale=1');
    await page.waitForTimeout(6000);
    const r = await page.evaluate(() => {
      const e = Alchemy.Shell.engine, lv = Alchemy.Shell.lastLevel || null;
      const t0 = performance.now(); const n = 30;
      for (let i = 0; i < n; i++) e.render(Alchemy.Shell.level || lv || { freq: [new Uint8Array(1024), new Uint8Array(1024)], wave: [new Uint8Array(1024).fill(128), new Uint8Array(1024).fill(128)], state: 2, timeStamp: 0 });
      return { msPerRender: (performance.now() - t0) / n, liveFps: Alchemy.Shell.fps || Alchemy.Shell.liveFps || null, buf: [e.w, e.h] };
    });
    console.log(w + 'x' + h, JSON.stringify(r)); await page.close();
  }
  await browser.close();
})();
