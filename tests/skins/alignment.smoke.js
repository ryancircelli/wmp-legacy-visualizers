// Measured alignment checks (the visual quality pass): every view of the page, standalone and in
// the Spotify shadow root, at 1x and 2x device pixels, against the rules in checks() below —
// boxes with an edge on whole device pixels, a header row's controls on one centre line, table
// header cells over their columns, tiles of one width / gap / name height, the transport's
// small discs one size on one line with even gaps (clock and status on it), the lyrics button
// matching the picker, the seek pills on the groove, the details pane level with the list
// header, no near-black panel borders, no doubled borders, button labels centred, the flag-well
// emblem centred in the well's light bulge; and (from screenshots) the task pane's swoosh one
// gradient with the top band across their join, and the volume slider's drawn groove and thumb on
// the transport buttons' centre line; the status text on the clock's baseline.
//   npm run build && NODE_PATH=$(npm root -g) node tests/skins/alignment.smoke.js
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const __dirname = require('path').dirname(fileURLToPath(import.meta.url));
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const DIST = path.resolve(__dirname, '..', '..', 'dist');
const cover = (c) => 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${c}"/></svg>`).toString('base64');

async function mountSpotify(page, B) {
  await page.setContent('<body style="font: 20px serif"><h1>Spotify web player</h1></body>');
  await page.evaluate((B) => {
    window.fetch = () => Promise.resolve({ status: 404, headers: { get: () => null }, text: () => Promise.resolve('') });
    const host = document.createElement('div');
    host.id = 'wmp-root';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647';
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = B.html;
    const sheet = new CSSStyleSheet(); sheet.replaceSync(B.css);
    root.adoptedStyleSheets = [sheet];
    window.alchemyEngine = 'spotify';
    window.alchemyRoot = root;
    window.__wmpSpotify = { token: 'tok', at: Date.now(), loggedIn: true, deviceId: 'me', activeDeviceId: 'me', hashes: {},
      state: { timestamp: String(Date.now()), position_as_of_timestamp: '1000', duration: '200000', is_playing: false, is_paused: true,
        track: { uri: 'spotify:track:t', metadata: { title: 'Song', artist_name: 'Band', album_title: 'LP', duration: '200000' } },
        next_tracks: [], restrictions: {} } };
    (0, eval)(B.js);
  }, B);
  await page.waitForFunction(() => document.getElementById('wmp-root').style.display === '', null, { timeout: 10000 });
  await page.waitForTimeout(300);
}

async function seed(page) {
  const C = ['#6A2E8A', '#E8483C', '#2A6FE0', '#F3C517'].map(cover);
  await page.evaluate((C) => {
    const a = window.Alchemy.store.getState().actions, PL = 'spotify:playlist:a', AR = 'spotify:artist:q';
    const names = ['Bohemian Rhapsody', "Don't Stop Me Now", 'Another One Bites the Dust', 'Under Pressure', 'Somebody to Love', 'We Will Rock You'];
    const tr = names.map((t, i) => ({ uri: 'spotify:track:q' + i, title: t, artist: 'Queen', album: 'A Night at the Opera', duration: 180000 + i * 17000,
      image: C[i % 4], playcount: 2500000000 - i * 1e8, explicit: i === 2, ctx: PL, albumUri: 'spotify:album:x' + (i % 3), artistUris: [AR], releaseDate: '1975-11-21', trackNumber: i + 1 }));
    const al = ['A Night at the Opera', 'Jazz', 'The Game', 'Hot Space', 'Innuendo'].map((n, i) => ({ uri: 'spotify:album:x' + i, name: n, owner: 'Queen', image: C[i % 4] }));
    // fetched data lives in the query cache: seed it under the engine's own keys (fresh, so nothing refetches)
    const { client, keys } = window.Alchemy.query, put = (k, v) => client.setQueryData(k, v);
    put(keys.libraryList(), [{ uri: PL, name: 'Road Trip', owner: 'ryan', image: C[0] }, { uri: 'spotify:playlist:b', name: 'Focus', owner: 'Spotify', image: C[1] }, ...al.slice(0, 2)]);
    put(keys.search('queen', 'all'), { top: { kind: 'artist', item: { uri: AR, name: 'Queen', kind: 'artist', image: C[0] } },
      tracks: { items: tr, total: 489, offset: 0, exact: false, hasMore: true },
      artists: { items: [{ uri: AR, name: 'Queen', kind: 'artist', image: C[0] }], total: 12, offset: 0, exact: false, hasMore: true },
      albums: { items: al.slice(0, 4), total: 40, offset: 0, exact: false, hasMore: true },
      playlists: { items: [{ uri: 'spotify:playlist:q', name: 'This Is Queen', owner: 'Spotify', image: C[2] }], total: 90, offset: 0, exact: false, hasMore: true } });
    a.setUi({ searchQ: 'queen' });
    put(keys.collection(PL), { pageParams: [0], pages: [{ tracks: tr, total: 42, nextOffset: tr.length, meta: { kind: 'playlist', name: 'Road Trip', total: 42, image: C[0], followers: 12345,
      owner: { name: 'ryan', uri: 'spotify:user:ryan' }, description: 'Windows down, volume up. Four hours of the songs that make a long drive short.', shareUrl: 'https://open.spotify.com/playlist/a' } }] });
    put(keys.home(), { greeting: '', sections: [{ title: 'Made for you', items: al.map((x) => ({ uri: x.uri, name: x.name, sub: 'Queen', img: x.image })) }] });
    put(keys.radio([]), [{ uri: 'spotify:playlist:r1', name: 'Queen Radio', sub: 'With Freddie Mercury' }, { uri: 'spotify:playlist:r2', name: 'Rock Radio', sub: 'Classics' }]);
    for (const x of al) put(keys.album(x.uri), { kind: 'album', name: x.name, total: 10, label: 'EMI', releaseDate: '1975-11-21' });
    a.setDevices([{ id: 'me', name: 'Web Player', type: 'Computer', active: true }, { id: 'k', name: 'Kitchen', type: 'Speaker' },
      { id: 'p', name: 'Pixel 8', type: 'Smartphone' }, { id: 'c', name: 'Car', type: 'Automobile', offline: true }], 'me');
  }, C);
}

/** In the page: the alignment rules. Returns [{ el, issue }]. */
function checks({ dpr }) {
  const r = document.getElementById('wmp-root')?.shadowRoot ?? document, v = [];
  const $ = (s) => r.querySelector(s), $$ = (s) => [...r.querySelectorAll(s)];
  const vis = (e) => e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const R = (e) => e.getBoundingClientRect();
  const name = (e) => e.id ? '#' + e.id : e.tagName.toLowerCase() + (e.getAttribute('data-uri') ? '[' + e.getAttribute('data-uri').split(':').pop() + ']' : '') + (e.parentElement && e.parentElement.id ? ' in #' + e.parentElement.id : '');
  const off = (x) => Math.abs(x * dpr - Math.round(x * dpr));
  const bad = (el, issue) => v.push({ el: typeof el === 'string' ? el : name(el), issue });
  const cy = (e) => { const b = R(e); return b.top + b.height / 2; };
  // 1. whole device pixels for the new panes' boxes (a half pixel blurs a 1 px edge)
  for (const e of $$('#mlinfo, #mlinfo > *, #mlinfoband, #mlhead > *, #mltiles button[data-uri], #mlresults section, #mltop, #bshuffle, #brepeat, #bdevice, #blyrics, #vpick, #mlalbums button[data-uri]')) {
    if (!vis(e)) continue;
    const b = R(e), cs = getComputedStyle(e);
    // bare text (no border, fill or shadow) has no edge to blur: its glyph-advance width may be fractional
    const edged = parseFloat(cs.borderLeftWidth) > 0 || parseFloat(cs.borderTopWidth) > 0 || cs.backgroundImage !== 'none'
      || cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.boxShadow !== 'none';
    const f = (edged ? ['left', 'top', 'width', 'height'] : ['top', 'height']).filter((k) => off(b[k]) > 0.01).map((k) => k + ' ' + b[k].toFixed(2));
    if (f.length) bad(e, 'fractional ' + f.join(', '));
  }
  // 2. a header row's controls share one centre line
  for (const row of $$('#mlhead, #mvhead')) {
    if (!vis(row)) continue;
    const kids = [...row.children].filter(vis), c = kids.map(cy), m = c[0];
    kids.forEach((k, i) => { if (Math.abs(c[i] - m) > 0.5) bad(k, 'centre ' + (c[i] - m).toFixed(2) + ' px off the header row'); });
  }
  // 3. table header cells over their columns
  const th = $$('#mltable th, #mlresults table th'), td = $$('#mltable tbody tr:first-child td');
  th.slice(0, td.length).forEach((h, i) => { const a = R(h), b = R(td[i]); if (Math.abs(a.left - b.left) > 0.5 || Math.abs(a.width - b.width) > 0.5) bad(h, 'column ' + i + ' header ' + (a.left - b.left).toFixed(2) + '/' + (a.width - b.width).toFixed(2) + ' px off its cells'); });
  // 4. tiles: equal widths, equal gaps, names clipped at one height
  for (const grid of $$('#mltiles, #mlalbums, #mlresults, #mguide')) {
    if (!vis(grid)) continue;
    for (const row of [...grid.querySelectorAll('div')].filter((d) => d.querySelector(':scope > button[data-uri]'))) {
      const t = [...row.querySelectorAll(':scope > button[data-uri]')].filter(vis);
      if (t.length < 2) continue;
      const w = t.map((x) => R(x).width), nh = t.map((x) => R(x.children[1]).height);
      if (Math.max(...w) - Math.min(...w) > 0.5) bad(t[0], 'tile widths differ ' + Math.min(...w).toFixed(1) + '..' + Math.max(...w).toFixed(1));
      if (Math.max(...nh) - Math.min(...nh) > 0.5) bad(t[0], 'tile name heights differ');
      const gaps = t.slice(1).map((x, i) => R(x).top === R(t[i]).top ? R(x).left - R(t[i]).right : null).filter((g) => g !== null);
      if (gaps.length && Math.max(...gaps) - Math.min(...gaps) > 0.5) bad(t[0], 'tile gaps differ ' + gaps.map((g) => g.toFixed(1)).join('/'));
    }
  }
  // 4b. tracks are list rows, never tiles; Tiles mode hides the tree
  for (const t of $$('#mltiles button[data-uri^="spotify:track:"], #mlresults button[data-uri^="spotify:track:"], #mlalbums button[data-uri^="spotify:track:"]'))
    if (vis(t)) bad(t, 'a track shown as a tile');
  if (vis($('#mltiles')) && !$('#mlcrumb') && vis($('#mltree')) && window.Alchemy && Alchemy.store.getState().settings.libraryView === 'tiles') bad('#mltree', 'the tree shows in Tiles mode');
  // 5. the transport's small discs: one size, one centre line, even gaps; the clock and status on it
  const discs = ['#bshuffle', '#brepeat', '#bdevice'].map($).filter(vis);
  if (discs.length > 1) {
    const s = discs.map((d) => R(d).width + 'x' + R(d).height);
    if (new Set(s).size > 1) bad('#bshuffle/#brepeat/#bdevice', 'disc sizes differ ' + s.join(' '));
    const c = discs.map(cy);
    discs.forEach((d, i) => { if (Math.abs(c[i] - c[0]) > 0.5) bad(d, 'disc centre ' + (c[i] - c[0]).toFixed(2) + ' px off'); });
    const g = discs.slice(1).map((d, i) => R(d).left - R(discs[i]).right);
    if (Math.max(...g) - Math.min(...g) > 0.5) bad('#bshuffle/#brepeat/#bdevice', 'disc gaps differ ' + g.join('/'));
    for (const t of ['#time', '#status'].map($).filter(vis)) if (Math.abs(cy(t) - c[0]) > 1) bad(t, 'text centre ' + (cy(t) - c[0]).toFixed(2) + ' px off the discs');
  }
  // 5b. the transport's controls on the bar's centre line; the volume slider inside the light well
  const bar = $('#transport');
  if (vis(bar)) {
    const mid = R(bar).top + R(bar).height / 2;
    for (const c of ['#bplay', '#bstop', '#tgroup', '#bmute', '#volwrap'].map($).filter(vis))
      if (Math.abs(cy(c) - mid) > 0.5) bad(c, 'centre ' + (cy(c) - mid).toFixed(2) + ' px off the transport bar\'s');
    const loz = $('#lozpath'), vol = $('#vol');
    if (loz && vis(vol)) {
      const m = loz.ownerSVGElement.getScreenCTM().inverse(), v = R(vol), pt = loz.ownerSVGElement.createSVGPoint();
      for (const y of [v.top + 4, v.top + v.height / 2, v.bottom - 4]) {
        pt.x = v.right - 1; pt.y = y;
        if (!loz.isPointInFill(pt.matrixTransform(m))) { bad(vol, 'the slider runs out of the light well at y ' + (y - R(bar).top).toFixed(1)); break; }
      }
    }
  }
  // 5b'. the status text on the clock's baseline (one optical line)
  const base = (e) => { const m = document.createElement('span'); m.style.cssText = 'display:inline-block;width:0;height:0';
    e.appendChild(m); const y = m.getBoundingClientRect().top; m.remove(); return y; };
  const stt = $('#status'), clk = $('#time');
  if (vis(stt) && vis(clk) && Math.abs(base(stt) - base(clk)) > 0.5) bad(stt, 'baseline ' + (base(stt) - base(clk)).toFixed(2) + ' px off the clock\'s');
  // 5b''. the window's resize grip clear of every control on the transport bar (the device disc
  //       once sat on it)
  const grip = $('#grip');
  if (vis(grip)) for (const id of ['#bshuffle', '#brepeat', '#bdevice', '#time', '#status']) {
    const c = $(id);
    if (!vis(c)) continue;
    const a = R(grip), b = R(c), m = 2;                             // touching counts: the disc's white ring is outside its box
    if (a.left < b.right + m && b.left < a.right + m && a.top < b.bottom + m && b.top < a.bottom + m) bad(c, 'overlaps or touches the resize grip');
  }
  // 5c. the swoosh's band rows (#tbedge, the band's own svg) start at the band's background's 15 px
  //     (under its 1 px top border), and the task pane's part (#tpsw) exactly at the band's bottom;
  //     the light band under the view pill spans to its end
  const tb = $('#topbar'), be = $('#tbedge'), sw = $('#tpsw');
  if (vis(tb) && vis(be) && Math.abs(R(be).top - (R(tb).top + 16)) > 0.01) bad(be, 'top ' + (R(be).top - R(tb).top).toFixed(2) + ' px below the band, not 16');
  if (vis(tb) && vis(sw) && Math.abs(R(sw).top - R(tb).bottom) > 0.01) bad(sw, 'top ' + (R(sw).top - R(tb).bottom).toFixed(2) + ' px off the band\'s bottom');
  const band = $('#npband');
  if (vis(band) && /rgb\(127, 144, 181\) 34px\)\s*$/.test(getComputedStyle(band).backgroundImage)) bad(band, 'the band fades to the steel sep where the sweep does not');
  // 5d. the flag-well emblem centred in the well's light bulge: level with the middle of its fill
  //     between the highlight line and the floor, and with the middle of its fill on that row
  const well = $('#tpwell'), hi = $('#tpwellhi'), emb = $('#taskfoot');
  if (well && hi && vis(emb)) {
    const m = well.ownerSVGElement.getScreenCTM().inverse(), e = R(emb);
    const c = new DOMPoint(e.left + e.width / 2, e.top + e.height / 2).matrixTransform(m);
    const inF = (x, y) => well.isPointInFill(new DOMPoint(x, y)), step = 0.25;
    let top = hi.getBBox().y, bot = top, l = c.x, rt = c.x;
    while (inF(c.x, bot + step)) bot += step;
    while (inF(l - step, c.y)) l -= step;
    while (inF(rt + step, c.y)) rt += step;
    const dx = c.x - (l + rt) / 2, dy = c.y - (top + bot) / 2;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) bad(emb, 'emblem centre ' + dx.toFixed(2) + ', ' + dy.toFixed(2) + ' px off the well bulge\'s ' + ((l + rt) / 2).toFixed(2) + ', ' + ((top + bot) / 2).toFixed(2));
  }
  // 6. the lyrics button beside the picker ▾
  const ly = $('#blyrics'), pk = $('#vpick');
  if (vis(ly) && vis(pk)) {
    if (R(ly).width !== R(pk).width || R(ly).height !== R(pk).height) bad(ly, 'size ' + R(ly).width + 'x' + R(ly).height + ' vs the picker ' + R(pk).width + 'x' + R(pk).height);
    if (Math.abs(cy(ly) - cy(pk)) > 0.5) bad(ly, 'centre ' + (cy(ly) - cy(pk)).toFixed(2) + ' px off the picker');
  }
  // 7. the seek pills on the groove's centre line
  const st = $('#seektrack');
  if (vis(st)) for (const p of $$('#seekrow > span:not(#seektrack)')) if (Math.abs(cy(p) - cy(st)) > 0.5) bad(p, 'seek pill centre ' + (cy(p) - cy(st)).toFixed(2) + ' px off the groove');
  // 8. the details pane starts level with the list and its header band
  const pane = $('#mlinfo'), head = $('#mlhead');
  if (vis(pane) && vis(head) && Math.abs(R(pane).top - R(head).top) > 0.5) bad(pane, 'top ' + (R(pane).top - R(head).top).toFixed(2) + ' px off the list header');
  // 9. harsh edges: near-black borders on panels (buttons may keep XP's dark blue rim), and doubled borders
  const luma = (c) => { const m = /rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?/.exec(c); return m && (m[4] === undefined || +m[4] > 0) ? 0.3 * m[1] + 0.59 * m[2] + 0.11 * m[3] : 255; };
  for (const e of $$('#mlib *, #msearch *, #mguide *, #mradio *, [role=menu], [role=dialog] *')) {
    if (!vis(e) || e.tagName === 'BUTTON' || e.tagName === 'INPUT') continue;
    const cs = getComputedStyle(e);
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      if (cs['border' + side + 'Style'] === 'none' || parseFloat(cs['border' + side + 'Width']) === 0) continue;
      const L = luma(cs['border' + side + 'Color']);
      if (L < 60) bad(e, 'harsh ' + side.toLowerCase() + ' border ' + cs['border' + side + 'Color']);
    }
  }
  for (const e of $$('#mlib *, #msearch *')) {
    if (!vis(e) || !e.previousElementSibling || !vis(e.previousElementSibling)) continue;
    const a = getComputedStyle(e.previousElementSibling), b = getComputedStyle(e);
    const ar = R(e.previousElementSibling), br = R(e);
    if (a.display !== 'none' && Math.abs(ar.right - br.left) < 0.5 && parseFloat(a.borderRightWidth) > 0 && parseFloat(b.borderLeftWidth) > 0)
      bad(e, 'doubled vertical border with ' + name(e.previousElementSibling));
    if (Math.abs(ar.bottom - br.top) < 0.5 && Math.abs(ar.left - br.left) < 1 && parseFloat(a.borderBottomWidth) > 0 && parseFloat(b.borderTopWidth) > 0)
      bad(e, 'doubled horizontal border with ' + name(e.previousElementSibling));
  }
  // 10. single-line buttons: the label centred in the box
  for (const b of $$('#mlhead button, #mlinfo button, #mltolib, #mlall, [role=dialog] button')) {
    if (!vis(b) || !b.firstChild || b.firstChild.nodeType !== 3) continue;
    const rg = document.createRange(); rg.selectNodeContents(b); const t = rg.getBoundingClientRect(), o = R(b);
    const d = (t.top + t.height / 2) - (o.top + o.height / 2);
    if (o.height > t.height + 1 && Math.abs(d) > 0.75) bad(b, 'label ' + d.toFixed(2) + ' px off centre');
  }
  return v;
}

/** A screenshot of `clip` as RGBA rows (decoded in the page: an Image, not fetch, which the
 *  Spotify mount stubs). */
async function grab(page, clip) {
  const png = await page.screenshot({ clip });
  return page.evaluate(async (b64) => {
    const im = new Image();
    im.src = 'data:image/png;base64,' + b64;
    await im.decode();
    const c = new OffscreenCanvas(im.width, im.height), x = c.getContext('2d');
    x.drawImage(im, 0, 0);
    return { w: im.width, h: im.height, d: [...x.getImageData(0, 0, im.width, im.height).data] };
  }, png.toString('base64'));
}

/** The volume slider as rendered (the browser draws a native range's track and thumb, so the
 *  input's box says nothing): the thumb's rows (bright green) and the groove's (its grey green)
 *  from a screenshot, each centre on the transport buttons' centre line within 0.5 px. */
async function slider(page, dpr) {
  const g = await page.evaluate(() => {
    const r = document.getElementById('wmp-root')?.shadowRoot ?? document;
    const v = r.querySelector('#vol'), b = r.querySelector('#bplay');
    if (!v || !b || !v.getClientRects().length) return null;
    const a = v.getBoundingClientRect(), p = b.getBoundingClientRect();
    return { x: a.left, w: a.width, top: a.top - 8, h: a.height + 16, line: p.top + p.height / 2 };
  });
  if (!g) return [];
  const px = await grab(page, { x: g.x, y: g.top, width: g.w, height: g.h });
  const tc = new Array(px.h).fill(0), gc = new Array(px.h).fill(0);
  for (let y = 0; y < px.h; y++) for (let x = 0; x < px.w; x++) {
    const i = (y * px.w + x) * 4, r = px.d[i], gr = px.d[i + 1], b = px.d[i + 2];
    if (gr > r + 80 && gr > b + 80) tc[y]++;
    else if (Math.abs(r - 0x6D) < 20 && Math.abs(gr - 0x95) < 20 && Math.abs(b - 0x68) < 20) gc[y]++;
  }
  // a row counts when it carries at least a quarter of the fullest row's pixels: at 125 % a few of
  // the thumb's antialiased edge pixels match the groove's colour and would drag its centre
  const rowsOf = (c) => { const m = Math.max(...c); return m ? [...c.keys()].filter((y) => c[y] >= m / 4) : []; };
  const thumb = rowsOf(tc), track = rowsOf(gc);
  const out = [];
  for (const [name, rows] of [['thumb', thumb], ['track', track]]) {
    if (!rows.length) { out.push({ el: '#vol', issue: 'no ' + name + ' pixels found' }); continue; }
    const c = g.top + (Math.min(...rows) + Math.max(...rows) + 1) / 2 / dpr;
    if (Math.abs(c - g.line) > 0.5) out.push({ el: '#vol', issue: name + ' centre ' + (c - g.line).toFixed(2) + ' px off the buttons\' line' });
  }
  return out;
}

/** The swoosh / top band join, from a screenshot: the device-pixel columns 2 px left and right of
 *  the swoosh's visible right edge (the task pane's: the svg runs on under its mask), over the band's
 *  rows, within 2 levels per channel row for row — and every column in between too (at 125 % /
 *  150 % the edge column itself once carried a darker line). */
async function seam(page, dpr) {
  const g = await page.evaluate(() => {
    const r = document.getElementById('wmp-root')?.shadowRoot ?? document;
    // the swoosh's band rows are #tbedge's (the band's own svg); the task pane's #tpsw starts below them
    const sw = r.querySelector('#tbedge'), tb = r.querySelector('#topbar'), tp = r.querySelector('#taskpane');
    if (!sw || !tb || !tp || !tp.getClientRects().length || !tb.getClientRects().length) return null;
    const a = sw.getBoundingClientRect(), b = tb.getBoundingClientRect();
    return { x: tp.getBoundingClientRect().right, top: a.top, bottom: Math.min(a.bottom, b.bottom) };
  });
  if (!g) return [];
  // whole device rows inside the band only: at 150 % a clip on CSS pixels rounds to one device row
  // past the band's bottom, where the swoosh's panel meets the screen's black frame, not the band
  const t = Math.ceil(g.top * dpr) / dpr, bt = Math.floor(g.bottom * dpr) / dpr;
  const px = await grab(page, { x: g.x - 2, y: t, width: 4, height: bt - t });
  const out = [];
  for (let y = 0; y < px.h; y++) {
    const L = (y * px.w) * 4, R = (y * px.w + px.w - 1) * 4;
    const d = [0, 1, 2].map((k) => Math.abs(px.d[L + k] - px.d[R + k]));
    if (Math.max(...d) > 2) { out.push({ el: '#tpsw', issue: 'seam row ' + (y / dpr).toFixed(1) + ': ' + px.d.slice(L, L + 3).join(',') + ' | ' + px.d.slice(R, R + 3).join(',') }); continue; }
    for (let x = 1; x < px.w - 1; x++) {
      const M = (y * px.w + x) * 4;
      if (Math.max(...[0, 1, 2].map((k) => Math.abs(px.d[M + k] - px.d[R + k]))) > 3) {
        out.push({ el: '#tpsw', issue: 'join column ' + x + ' row ' + (y / dpr).toFixed(1) + ': ' + px.d.slice(M, M + 3).join(',') + ' between ' + px.d.slice(R, R + 3).join(',') });
        break;
      }
    }
  }
  // the dark edge under the band (#2B448B, 1 px as WMP 9 draws it) on the same rows both sides
  const edge = (col) => [...Array(px.h).keys()].filter((y) => { const k = (y * px.w + col) * 4;
    return Math.abs(px.d[k] - 0x2B) < 8 && Math.abs(px.d[k + 1] - 0x44) < 8 && Math.abs(px.d[k + 2] - 0x8B) < 8; });
  const el = edge(0), er = edge(px.w - 1);
  // at a whole-number scale the 1 px edge is exactly dpr device rows; at 125 % / 150 % it covers a
  // fractional row too, and all that can be asked is the same rows on both sides
  const want = Number.isInteger(dpr) ? er.length === dpr : er.length > 0;
  if (el.join() !== er.join() || !want) out.push({ el: '#tpsw', issue: 'dark edge rows ' + el.join('/') + ' left vs ' + er.join('/') + ' right (want ' + (Number.isInteger(dpr) ? dpr + ' device rows, ' : '') + 'the same)' });
  return out;
}

const SPOTIFY_VIEWS = [
  ['now', async () => {}],
  ['library', async (p) => {
    await p.evaluate(() => { const a = Alchemy.store.getState().actions; a.setView('library'); a.setUi({ libNode: 'spotify:playlist:a', libSel: null }); });
    // the seeded data must be what is measured
    await p.waitForFunction(() => document.getElementById('wmp-root').shadowRoot.querySelectorAll('#mlrows tr').length === 7, null, { timeout: 3000 });
  }],
  ['library track', async (p) => { await p.evaluate(() => Alchemy.store.getState().actions.setUi({ libSel: 'spotify:track:q0' })); }],
  ['library tiles covers', async (p) => { await p.evaluate(() => { const a = Alchemy.store.getState().actions; a.setSettings({ libraryView: 'tiles' }); a.setUi({ libNode: null, libSel: null }); }); }],
  ['library tiles opened', async (p) => { await p.evaluate(() => Alchemy.store.getState().actions.setUi({ libNode: 'spotify:playlist:a' })); }],
  ['library pane closed', async (p) => { await p.evaluate(() => Alchemy.store.getState().actions.setSettings({ libraryView: 'details', detailsPane: false })); }],
  ['search', async (p) => {
    await p.evaluate(() => { const a = Alchemy.store.getState().actions; a.setSettings({ detailsPane: true }); a.setView('search'); });
    await p.waitForFunction(() => document.getElementById('wmp-root').shadowRoot.querySelectorAll('#mlresults section').length === 4, null, { timeout: 3000 });
  }],
  ['search tiles', async (p) => { await p.evaluate(() => Alchemy.store.getState().actions.setSettings({ libraryView: 'tiles' })); }],
  ['guide', async (p) => { await p.evaluate(() => { const a = Alchemy.store.getState().actions; a.setSettings({ libraryView: 'details' }); a.setView('guide'); }); }],
  ['radio', async (p) => { await p.evaluate(() => Alchemy.store.getState().actions.setView('radio')); }],
  ['device menu', async (p) => { await p.evaluate(() => Alchemy.store.getState().actions.setView('now')); await p.locator('#wmp-root #bdevice').click(); }],
  ['view menu', async (p) => { await p.keyboard.press('Escape'); await p.locator('#wmp-root #mtops [data-menu="view"]').click(); }],
  ['options', async (p) => { await p.keyboard.press('Escape'); await p.evaluate(() => Alchemy.store.getState().actions.setUi({ dialog: 'options' })); }],
  ['shortcuts', async (p) => { await p.evaluate(() => Alchemy.store.getState().actions.setUi({ dialog: 'keys' })); }],
  ['open link', async (p) => { await p.evaluate(() => Alchemy.store.getState().actions.setUi({ dialog: 'link' })); }],
  ['about', async (p) => { await p.evaluate(() => Alchemy.store.getState().actions.setUi({ dialog: 'about' })); }],
];
const WEB_VIEWS = [
  ['now', async () => {}],
  ['options', async (p) => { await p.evaluate(() => Alchemy.store.getState().actions.setUi({ dialog: 'options' })); }],
  ['about', async (p) => { await p.evaluate(() => Alchemy.store.getState().actions.setUi({ dialog: 'about' })); }],
  ['bare', async (p) => { await p.evaluate(() => Alchemy.store.getState().actions.setUi({ dialog: null, bare: true })); }],
];

(async () => {
  const browser = await chromium.launch({ args: ['--mute-audio'] });
  const B = JSON.parse(fs.readFileSync(path.join(DIST, 'spotify-inject.js'), 'utf8'));
  const found = [];
  for (const dpr of [1, 2]) {
    for (const [w, h] of [[1200, 700], [620, 560], [520, 520], [440, 520]]) {
      const sp = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
      await mountSpotify(sp, B);
      await seed(sp);
      for (const [name, act] of w === 1200 ? SPOTIFY_VIEWS : SPOTIFY_VIEWS.slice(0, 2)) {
        await act(sp);
        await sp.waitForTimeout(200);
        for (const x of await sp.evaluate(checks, { dpr })) found.push(['spotify ' + name + ' ' + w + 'px ' + dpr + 'x', x.el, x.issue]);
        if (name === 'now') for (const x of [...await seam(sp, dpr), ...await slider(sp, dpr)]) found.push(['spotify now ' + w + 'px ' + dpr + 'x', x.el, x.issue]);
      }
      await sp.close();
      const web = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
      await web.goto('file://' + path.join(DIST, 'index.html') + '?vis=battery&preset=3');
      await web.waitForFunction(() => window.Alchemy && Alchemy.Shell.engine);
      for (const [name, act] of w === 1200 ? WEB_VIEWS : WEB_VIEWS.slice(0, 1)) {
        await act(web);
        await web.waitForTimeout(200);
        for (const x of await web.evaluate(checks, { dpr })) found.push(['web ' + name + ' ' + w + 'px ' + dpr + 'x', x.el, x.issue]);
        if (name === 'now') for (const x of [...await seam(web, dpr), ...await slider(web, dpr)]) found.push(['web now ' + w + 'px ' + dpr + 'x', x.el, x.issue]);
      }
      await web.close();
    }
  }
  for (const dpr of [1.25, 1.5]) {
    for (const [w, h] of [[1200, 700], [1493, 1021]]) {
      const sp = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
      await mountSpotify(sp, B);
      await seed(sp);
      await sp.waitForTimeout(200);
      for (const x of [...await seam(sp, dpr), ...await slider(sp, dpr)]) found.push(['spotify now ' + w + 'px ' + dpr + 'x', x.el, x.issue]);
      await sp.close();
      const web = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
      await web.goto('file://' + path.join(DIST, 'index.html') + '?vis=battery&preset=3');
      await web.waitForFunction(() => window.Alchemy && Alchemy.Shell.engine);
      await web.waitForTimeout(200);
      for (const x of [...await seam(web, dpr), ...await slider(web, dpr)]) found.push(['web now ' + w + 'px ' + dpr + 'x', x.el, x.issue]);
      await web.close();
    }
  }
  await browser.close();
  if (found.length) {
    for (const f of found) console.error(f.join('  |  '));
    console.error(found.length + ' alignment violations');
    process.exit(1);
  }
  console.log('alignment smoke: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
