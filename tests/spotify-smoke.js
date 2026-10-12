// Headless check that dist/spotify-inject.js runs mounted the way the Spotify host mounts it
// (CONTRACT.md v6): markup in an open shadow root on <div id="wmp-root">, css adopted as a
// constructed stylesheet, js run as a plain script, over a stand-in for Spotify's own page.
//   npm run build && NODE_PATH=$(npm root -g) node tests/spotify-smoke.js
// ESM (package.json "type": "module"); playwright comes from the global install via NODE_PATH,
// which only the CommonJS resolver honours, hence createRequire.
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const __dirname = require('path').dirname(fileURLToPath(import.meta.url));
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const B = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'dist', 'spotify-inject.js'), 'utf8'));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setContent('<body style="font: 20px serif"><h1>Spotify web player</h1></body>');
  await page.evaluate((B) => {
    // Spotify's own shortcut handler, which must never hear a key while the overlay shows.
    window.__spotifyKeys = 0;
    document.addEventListener('keydown', () => window.__spotifyKeys++);
    window.__calls = [];
    window.fetch = (url, init) => {
      init = init || { method: 'GET' };
      const b = init.body ? JSON.parse(init.body) : {}, op = b.operationName || (b.command && b.command.endpoint) || '';
      window.__calls.push(init.method + ' ' + url + ' ' + op);
      const j = op === 'libraryV3' ? { data: { me: { libraryV3: { totalCount: 1, items: [{ item: { data: { name: 'Mix A', uri: 'spotify:playlist:a',
            currentUserCapabilities: { canEditItems: true } } } }] } } } }
        // saved flags (track 2 is liked) and the playlists holding a track (Mix A)
        // (a playlist's entry carries no flag, as captured live)
        : op === 'areEntitiesInLibrary' ? { data: { lookup: b.variables.uris.map((u) => u.startsWith('spotify:playlist:')
            ? { __typename: 'PlaylistResponseWrapper' } : { data: { saved: u === 'spotify:track:2' } }) } }
        : op === 'isCuratedEntities' ? { data: { curated: ['spotify:playlist:a'] } }
        : op === 'fetchPlaylist' ? { data: { playlistV2: { name: 'Mix A', description: 'Road trip <b>songs</b>', followers: 12345,
            ownerV2: { data: { name: 'ryan', uri: 'spotify:user:ryan' } }, sharingInfo: { shareUrl: 'https://open.spotify.com/playlist/a' },
            content: { totalCount: 2, items: [1, 2].map((n) => ({ itemV2: { data: {
            name: 'Track ' + n, uri: 'spotify:track:' + n, artists: { items: [{ profile: { name: 'Band' } }] },
            albumOfTrack: { name: 'LP', uri: 'spotify:album:x' }, trackDuration: { totalMilliseconds: 125000 } } } })) } } } }
        : op === 'searchDesktop' ? (() => {
            // 30 songs, one artist / album / playlist, an artist on top; pages by offset/limit
            const v = JSON.parse(init.body).variables || {}, o = v.offset || 0, n = Math.max(0, Math.min(v.limit || 10, 30 - o));
            const q = { uri: 'spotify:artist:q', profile: { name: 'Queen' } };
            return { data: { searchV2: {
              tracksV2: { totalCount: 30, items: Array.from({ length: n }, (_, i) => ({ item: { data: { uri: 'spotify:track:s' + (o + i),
                name: 'Queen song ' + (o + i + 1), artists: { items: [q] }, albumOfTrack: { name: 'Opera', uri: 'spotify:album:o' },
                duration: { totalMilliseconds: 180000 } } } })) },
              artists: { totalCount: 1, items: [{ data: q }] },
              albumsV2: { totalCount: 1, items: [{ data: { uri: 'spotify:album:o', name: 'A Night at the Opera', artists: { items: [q] } } }] },
              playlists: { totalCount: 1, items: [{ data: { uri: 'spotify:playlist:q', name: 'This Is Queen', ownerV2: { data: { name: 'Spotify' } } } }] },
              topResultsV2: { itemsV2: [{ item: { __typename: 'ArtistResponseWrapper', data: q } }] } } } };
          })() : /player\/command/.test(url) ? { ack_id: 'x' } : null;
      return Promise.resolve({ status: j ? 200 : 404, headers: { get: () => null },
        text: () => Promise.resolve(j ? JSON.stringify(j) : '') });
    };
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
    window.__wmpSpotify = { token: 'tok', at: Date.now(), loggedIn: true, deviceId: 'd'.repeat(40), activeDeviceId: 'a'.repeat(40),
      hashes: { libraryV3: '1'.repeat(64), fetchLibraryTracks: '2'.repeat(64), searchDesktop: '3'.repeat(64), fetchPlaylist: '4'.repeat(64) },
      state: { timestamp: String(Date.now()), position_as_of_timestamp: '1000', duration: '200000', is_playing: true, is_paused: false,
        track: { uri: 'spotify:track:t', metadata: { title: 'Song', artist_name: 'Band', album_title: 'LP', duration: '200000' } },
        next_tracks: [], restrictions: {} } };
    (0, eval)(B.js);
  }, B);

  const R = (fn, arg) => page.evaluate(`(${fn})(document.getElementById('wmp-root').shadowRoot, ${JSON.stringify(arg)})`);
  await page.waitForFunction(() => document.getElementById('wmp-root').style.display === '' &&
    window.Alchemy.Shell.fps > 0, null, { timeout: 10000 });
  assert.deepStrictEqual(errors, [], 'page errors');
  assert.strictEqual(await R((r) => getComputedStyle(r.getElementById('chrome')).position), 'absolute', 'css applies in the shadow root');
  assert.ok(/Tahoma/.test(await R((r) => getComputedStyle(r.getElementById('status')).fontFamily)), ':host font reaches the chrome');
  // Tailwind in a shadow root: its @property registrations are ignored there, so the initial
  // values src/ui/theme.css declares must cover every variable the css registers.
  {
    const registered = [...B.css.matchAll(/@property\s+(--[\w-]+)/g)].map((m) => m[1]);
    const theme = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'ui', 'theme.css'), 'utf8');
    assert.deepStrictEqual(registered.filter((v) => !theme.includes(v + ':')), [], 'theme.css lacks initial values for');
    assert.ok(registered.length > 0, 'the css registers Tailwind properties');
  }
  assert.deepStrictEqual(await R((r) => { const b = getComputedStyle(r.getElementById('framebody')), n = getComputedStyle(r.getElementById('npill'));
    return [b.borderLeftStyle, b.borderLeftWidth, n.boxShadow !== 'none', getComputedStyle(r.getElementById('menubar')).display]; }),
    ['solid', '1px', true, 'flex'], 'utilities (border, shadow, layout) apply inside the shadow root');
  // no preflight: Spotify's own page keeps its styles
  assert.deepStrictEqual(await page.evaluate(() => [getComputedStyle(document.querySelector('h1')).fontSize,
    getComputedStyle(document.querySelector('h1')).marginTop, getComputedStyle(document.body).margin]),
    ['40px', '26.8px', '8px'], 'the overlay\'s css leaked into the host page');
  await page.waitForFunction(() => /Mix A/.test(document.getElementById('wmp-root').shadowRoot.getElementById('spLib').textContent));
  assert.strictEqual(await page.evaluate(() => getComputedStyle(document.querySelector('h1')).display), 'none',
                     'Spotify\'s page is not rendered under the overlay');

  // Now Playing from the web player's player_state
  await page.waitForFunction(() => document.getElementById('wmp-root').shadowRoot.getElementById('pltitle').textContent === 'Song',
    null, { timeout: 5000 });

  // the repeat disc (where the lyrics disc was) cycles the player's repeat; lyrics moved under the screen
  await page.evaluate(() => { window.__calls.length = 0; });
  await page.locator('#wmp-root #brepeat').click();
  await page.waitForFunction(() => window.__calls.some((c) => /set_options|repeat/.test(c)), null, { timeout: 3000 });
  assert.ok(await R((r) => !!r.getElementById('blyrics')), 'the lyrics button shows on Now Playing');

  // Menus live in the shadow root and a submenu survives the click that opens it
  const mi = (text) => page.locator(`#wmp-root [role^=menuitem]:has(span:text-is("${text}"))`);
  await page.locator('#wmp-root #mtops [data-menu="view"]').click();
  await mi('Refresh Rate').click();
  assert.strictEqual(await R((r) => r.querySelectorAll('[role=menu]').length), 2, 'submenu opened inside the shadow root');
  await mi('30 fps').click();
  assert.strictEqual(await page.evaluate(() => window.Alchemy.Shell.settings.fps), 30, 'submenu item acted');
  assert.strictEqual(await R((r) => r.querySelectorAll('[role=menu]').length), 0, 'menus closed');
  // while one menu is open, hovering another's button switches to it and a press on the open
  // menu's button closes it, as Windows' menu bar does; a press on another menu's button switches
  // too (the document sees that press retargeted to the host, as a press outside the open menu).
  const openMenus = () => R((r) => [...r.querySelectorAll('[role=menu]')].map((m) => m.querySelector('[role^=menuitem] span:nth-child(2)').textContent));
  await page.locator('#wmp-root #mtops [data-menu="view"]').click();
  await page.locator('#wmp-root #mtops [data-menu="play"]').hover();
  assert.deepStrictEqual(await openMenus(), ['Pause'], 'hover switches View -> Play inside the shadow root');
  await page.locator('#wmp-root #mtops [data-menu="play"]').click();
  assert.deepStrictEqual(await openMenus(), [], 'a press on the open menu\'s button closes it');
  await page.locator('#wmp-root #mtops [data-menu="view"]').click();
  await page.locator('#wmp-root #mtops [data-menu="help"]').dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse', bubbles: true, composed: true });
  assert.deepStrictEqual(await openMenus(), ['Keyboard Shortcuts'], 'a press on another menu\'s button switches');
  await page.keyboard.press('Escape');
  assert.deepStrictEqual(await openMenus(), [], 'Escape closes it');

  // Media Library view: the task pane button swaps the screen for the tree + details list
  await page.locator('#wmp-root #tlib').click();
  await page.waitForFunction(() => /Track 2/.test(document.getElementById('wmp-root').shadowRoot.getElementById('mlrows').textContent),
    null, { timeout: 5000 });
  assert.strictEqual(await R((r) => r.getElementById('view').offsetParent), null, 'canvas hidden in Media Library');
  assert.strictEqual(await R((r) => r.getElementById('blyrics')), null, 'the lyrics button is Now Playing\'s only');
  assert.ok(await R((r) => r.getElementById('mltable').offsetHeight > 0), 'details table visible');
  assert.strictEqual(await R((r) => getComputedStyle(r.getElementById('transport')).display !== 'none'), true, 'transport stays');
  assert.strictEqual(await page.evaluate(() => window.Alchemy.Shell.hold), true, 'engine held');
  assert.strictEqual(await R((r) => [].map.call(r.querySelectorAll('#mltable th'), (t) => t.textContent).join('|')), '|Title|Artist|Album|Length');
  assert.strictEqual(await R((r) => r.querySelector('#mlrows tr td:last-child').textContent), '2:05', 'length m:ss');
  // the details pane beside the table: the playlist from fetchPlaylist, a row in track mode, the grip
  await page.waitForFunction(() => /♥ 12,345 followers/.test(document.getElementById('wmp-root').shadowRoot.getElementById('mlinfo').textContent));
  assert.ok(await R((r) => /by ryan/.test(r.getElementById('mlinfo').textContent) && /2 tracks · 4 min/.test(r.getElementById('mlinfo').textContent)),
            'details pane: owner and stats');
  assert.strictEqual(await R((r) => r.querySelector('#mlinfo #daddto')), null, 'your own (editable) playlist: no heart');
  await page.locator('#wmp-root #mlrows tr >> nth=0').click();
  assert.strictEqual(await R((r) => r.getElementById('mlinfo').dataset.mode), 'track', 'a row puts the pane in track mode');
  // Add to: the rows' saved flags (one batched areEntitiesInLibrary), the pane's button and its menu
  await page.waitForFunction(() => document.getElementById('wmp-root').shadowRoot.querySelector('#mlrows tr:nth-child(2) [data-addto] button')?.getAttribute('aria-label') === 'Unlike');
  assert.deepStrictEqual(await R((r) => [r.getElementById('daddto').getAttribute('aria-label'), r.getElementById('daddto').title]), ['Like', 'Like'], 'track 1 not liked');
  await page.evaluate(() => { window.__calls.length = 0; });
  await page.locator('#wmp-root #daddto').click();
  await page.waitForFunction(() => window.__calls.some((c) => / addToLibrary$/.test(c)), null, { timeout: 3000 });
  // (the stub refuses it: rolled back, and the status line says so)
  await page.waitForFunction(() => document.getElementById('wmp-root').shadowRoot.getElementById('daddto').getAttribute('aria-label') === 'Like', null, { timeout: 3000 });
  await page.locator('#wmp-root #mlinfo [aria-label="Add to"]').click();
  await page.locator('#wmp-root [role=menu] [role^=menuitem]:has-text("Add to playlist")').hover();
  await page.waitForFunction(() => [...document.getElementById('wmp-root').shadowRoot.querySelectorAll('[role=menu][data-depth="1"] [role=menuitemcheckbox]')]
    .some((m) => m.textContent.includes('Mix A') && m.getAttribute('aria-checked') === 'true'), null, { timeout: 5000 });
  if (process.env.SHOT_ADDTO) await page.screenshot({ path: process.env.SHOT_ADDTO });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.locator('#wmp-root #mlrows tr >> nth=0').click();
  await page.keyboard.press('Escape');
  assert.strictEqual(await R((r) => r.getElementById('mlinfo').dataset.mode), 'context', 'Esc in the table: back to the playlist');
  await page.locator('#wmp-root #mlinfo > button').click();
  assert.deepStrictEqual(await R((r) => [r.getElementById('mlinfo').dataset.open, r.getElementById('mlinfo').offsetWidth]), [undefined, 12], 'grip collapses');
  await page.locator('#wmp-root #mlinfo > button').click();
  assert.strictEqual(await R((r) => r.getElementById('mlinfo').offsetWidth), 228, 'grip expands to 228 px');
  // tiles view and back
  // Tiles is a browse mode: covers of the collections (no tree, no track tiles); a cover opens the table
  await page.locator('#wmp-root #mlviewtiles').click();
  if (await R((r) => !!r.getElementById('mlcrumb'))) await page.locator('#wmp-root #mlcrumb').click();
  await page.waitForFunction(() => /Mix A/.test(document.getElementById('wmp-root').shadowRoot.getElementById('mltiles')?.textContent ?? ''));
  assert.deepStrictEqual(await R((r) => [!!r.getElementById('mltree'), [...r.querySelectorAll('#mltiles button[data-uri]')].map((b) => b.dataset.uri)]),
    [false, ['spotify:collection:tracks', 'spotify:playlist:a']], 'tiles: Liked Songs and the playlists as covers, the tree hidden');
  await page.locator('#wmp-root #mltiles button[data-uri="spotify:playlist:a"]').click();
  await page.waitForFunction(() => /Track 2/.test(document.getElementById('wmp-root').shadowRoot.getElementById('mlrows')?.textContent ?? ''));
  assert.strictEqual(await R((r) => r.getElementById('mlcrumb').textContent), '‹ Playlists', 'an opened cover: the table under a breadcrumb');
  await page.locator('#wmp-root #mlviewlist').click();
  assert.ok(await R((r) => !!r.getElementById('mltable')), 'details view back');
  // Search all of Spotify (its own view): Ctrl+E opens it with the box focused, Enter searches, the
  // results page, Show all pages
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('Control+e');
  assert.strictEqual(await R((r) => r.getElementById('tsearch').dataset.on), 'true', 'Ctrl+E: the Search view');
  await page.waitForFunction(() => document.getElementById('wmp-root').shadowRoot.activeElement?.id === 'mlq', null, { timeout: 2000 });
  await page.keyboard.type('queen');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('wmp-root').shadowRoot.querySelectorAll('#mlresults section').length === 4, null, { timeout: 5000 });
  assert.deepStrictEqual(await R((r) => [r.getElementById('mltitle').textContent, r.getElementById('mltop').textContent,
    [...r.querySelectorAll('#mlresults section')].map((x) => x.dataset.section + ' ' + x.querySelectorAll('tbody tr, button[data-uri]').length)]),
    ['Results for “queen”', 'Top resultQueenArtist', ['tracks 10', 'artists 1', 'albums 1', 'playlists 1']], 'results page');
  assert.strictEqual(await R((r) => r.querySelector('#mlresults [data-uri="spotify:album:o"]').textContent), 'A Night at the OperaQueen',
                     'an album row: its bare name, its artist under it');
  await page.locator('#wmp-root #mlresults button:has-text("Show all 30")').click();
  await page.locator('#wmp-root #mlresults td:has-text("Load more")').click();
  await page.waitForFunction(() => document.getElementById('wmp-root').shadowRoot.querySelectorAll('#mlresults tbody tr:not(:last-child)').length > 10,
    null, { timeout: 5000 });
  await page.locator('#wmp-root #mlall').click();
  assert.strictEqual(await R((r) => r.querySelectorAll('#mlresults section').length), 4, 'All results again');
  await page.locator('#wmp-root #tlib').click();
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  await page.locator('#wmp-root #mlrows tr >> nth=1').dblclick();
  await page.waitForFunction(() => window.__calls.some((c) => / play$/.test(c)));
  await page.locator('#wmp-root #tnow').click();
  assert.ok(await R((r) => r.getElementById('view').offsetParent !== null), 'Now Playing: canvas back');
  assert.strictEqual(await page.evaluate(() => window.Alchemy.Shell.hold), false, 'engine running again');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('Control+3');
  assert.ok(await R((r) => r.getElementById('view').offsetParent === null && !!r.getElementById('mlib')), 'Ctrl+3: Media Library');
  await page.keyboard.press('Control+1');
  assert.ok(await R((r) => r.getElementById('view').offsetParent !== null), 'Ctrl+1: Now Playing');

  // The other views, the pane's changes and the clock
  assert.strictEqual(await R((r) => r.getElementById('tcd')), null, 'Copy from CD hidden');
  assert.deepStrictEqual(await R((r) => [...r.querySelectorAll('#tasklist button')].map((b) => b.textContent)),
    ['Now Playing', 'Media Guide', 'Media Library', 'Search', 'Radio Tuner'], 'the task pane: Play on Device left it for the transport');
  for (const [task, view] of [['tguide', 'mguide'], ['tradio', 'mradio'], ['tsearch', 'msearch']]) {
    await page.locator('#wmp-root #' + task).click();
    assert.ok(await R((r, v) => r.getElementById(v).offsetHeight > 0 && r.getElementById('view').offsetParent === null, view), view + ' shown, canvas hidden');
  }
  // the Media Guide: a tile click opens its playlist in the Media Library; the corner ▶ plays it in place
  await page.evaluate(() => { const { client, keys } = window.Alchemy.query;
    client.setQueryData(keys.home(), { greeting: '', sections: [{ title: 'Recents', items: [{ uri: 'spotify:playlist:a', name: 'Mix A', sub: 'ryan', img: null }] }] }); });
  await page.locator('#wmp-root #tguide').click();
  await page.locator('#wmp-root #mguide button[data-uri="spotify:playlist:a"]').click();
  assert.deepStrictEqual(await page.evaluate(() => { const s = window.Alchemy.store.getState(); return [s.ui.view, s.ui.libNode]; }),
    ['library', 'spotify:playlist:a'], 'a Guide tile opens its playlist in the Media Library');
  await page.locator('#wmp-root #tguide').click();
  await page.evaluate(() => { window.__calls.length = 0; });
  await page.locator('#wmp-root #mguide button[data-uri="spotify:playlist:a"]').hover();
  await page.locator('#wmp-root #mguide button[data-uri="spotify:playlist:a"] [role=button]').click();
  await page.waitForFunction(() => window.__calls.length > 0, null, { timeout: 3000 });
  assert.strictEqual(await page.evaluate(() => window.Alchemy.store.getState().ui.view), 'guide', 'the corner ▶ plays without leaving the Guide');
  await page.locator('#wmp-root #tnow').click();
  assert.ok(await R((r) => r.getElementById('view').offsetParent !== null), 'back to Now Playing');
  // Ctrl+D saves the playing track (asked first: not known yet), and the pane's row carries the button
  assert.ok(await R((r) => !!r.getElementById('paddto')), 'the playing track\'s row has the Add to button');
  await page.evaluate(() => { window.__calls.length = 0; document.activeElement && document.activeElement.blur(); });
  await page.keyboard.press('Control+d');
  await page.waitForFunction(() => window.__calls.some((c) => / addToLibrary$/.test(c)), null, { timeout: 3000 });
  // where it plays from: the line under the song info (the pane has no group for it), a link that
  // opens the context in the Media Library
  await page.evaluate(() => window.Alchemy.store.getState().actions.setPlayback({ from: 'Playlist: Mix A',
    context: { uri: 'spotify:playlist:a', kind: 'playlist', label: 'Playlist: Mix A' } }));
  assert.strictEqual(await page.locator('#wmp-root #spLib button', { hasText: 'Playlist: Mix A' }).count(), 0, 'no Playing from group in the pane');
  const fromRow = page.locator('#wmp-root #plfrom');
  assert.strictEqual(await fromRow.textContent(), 'Playlist: Mix A', 'Playing from: the line under the song info');
  await fromRow.click();
  assert.deepStrictEqual(await page.evaluate(() => { const s = window.Alchemy.store.getState(); return [s.ui.view, s.ui.libNode]; }),
    ['library', 'spotify:playlist:a'], 'Playing from opens its playlist in the Media Library');
  await page.locator('#wmp-root #tnow').click();
  // Play on Device: the transport's device disc opens the device menu; a choice transfers
  await page.evaluate(() => window.Alchemy.store.getState().actions.setDevices([{ id: 'd'.repeat(40), name: 'Web Player', type: 'Computer', active: true },
    { id: 'k1', name: 'Kitchen', type: 'Speaker' }, { id: 'c1', name: 'Car', type: 'Automobile', offline: true }], 'd'.repeat(40)));
  assert.strictEqual(await R((r) => r.getElementById('bdevice').title), 'Play on Device: WMP Spotify (This Device)');
  await page.locator('#wmp-root #bdevice').click();
  assert.deepStrictEqual(await R((r) => [...r.querySelectorAll('[role=menu] [role^=menuitem]')].map((m) => m.textContent + (m.dataset.disabled !== undefined ? ' (disabled)' : ''))),
    ['✓WMP Spotify (This Device)', 'Kitchen', 'Car · offline (disabled)'], 'the device menu');
  if (process.env.SHOT_DEV) await page.screenshot({ path: process.env.SHOT_DEV });
  await page.evaluate(() => { window.__calls.length = 0; });
  await mi('Kitchen').click();
  await page.waitForFunction(() => window.__calls.some((c) => /transfer\/from\/d+\/to\/k1/.test(c)), null, { timeout: 3000 });
  // the seek bar pauses while held; the release seeks, then resumes
  await page.evaluate(() => { window.__calls.length = 0; });
  const sb = await page.locator('#wmp-root #seektrack').boundingBox();
  await page.mouse.move(sb.x + sb.width * 0.3, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.waitForFunction(() => window.__calls.some((c) => / pause$/.test(c)), null, { timeout: 3000 });
  await page.mouse.move(sb.x + sb.width * 0.6, sb.y + sb.height / 2, { steps: 4 });
  assert.ok(!(await page.evaluate(() => window.__calls.some((c) => / seek_to$/.test(c)))), 'no seek while held');
  await page.mouse.up();
  await page.waitForFunction(() => window.__calls.some((c) => / resume$/.test(c)), null, { timeout: 3000 });
  const seq = await page.evaluate(() => window.__calls.map((c) => c.split(' ').pop()).filter((c) => /^(pause|seek_to|resume)$/.test(c)));
  assert.deepStrictEqual(seq, ['pause', 'seek_to', 'resume'], 'seek bar: pause, then seek, then resume');
  await page.locator('#wmp-root #time').click();
  await page.waitForFunction(() => /^-/.test(document.getElementById('wmp-root').shadowRoot.getElementById('time').textContent));
  await page.locator('#wmp-root #time').click();
  await page.waitForFunction(() => /^\d/.test(document.getElementById('wmp-root').shadowRoot.getElementById('time').textContent));
  await page.locator('#wmp-root #mtops [data-menu="help"]').click();
  await mi('Keyboard Shortcuts').click();
  assert.ok(await R((r) => r.getElementById('dlgKeys').offsetHeight > 0), 'Keyboard Shortcuts dialog');
  await page.keyboard.press('Escape');
  assert.ok(await R((r) => r.getElementById('modal').hidden), 'Escape closes it');

  // Keys: Space with focus on Spotify's body is ours (Web API pause), and Spotify never hears it;
  // typing in the search box searches and does not toggle playback.
  await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.__calls.length = 0; });
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__calls.some((c) => /POST .*\/connect-state\/v1\/player\/command\/.* pause$/.test(c)));
  assert.strictEqual(await R((r) => r.querySelectorAll('input[type=search]').length), 0, 'no search box outside the Search view');
  await page.locator('#wmp-root #tsearch').click();
  await page.locator('#wmp-root #mlq').fill('');
  await page.locator('#wmp-root #mlq').press('a');
  await page.locator('#wmp-root #mlq').press('Space');
  await page.waitForFunction(() => window.__calls.some((c) => / searchDesktop$/.test(c)), null, { timeout: 3000 });
  assert.ok(!(await page.evaluate(() => window.__calls.filter((c) => / (pause|resume)$/.test(c)).length > 1)),
    'Space in the search box did not reach transport');
  assert.strictEqual(await page.evaluate(() => window.__spotifyKeys), 0, 'Spotify\'s page heard no key');

  // Full screen (bare) toggles on #chrome inside the shadow root
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('f');
  await page.waitForFunction(() => document.getElementById('wmp-root').shadowRoot.getElementById('chrome').dataset.bare === 'true' ||
    !!document.fullscreenElement, null, { timeout: 5000 });

  assert.deepStrictEqual(errors, [], 'page errors');
  await browser.close();
  console.log('spotify smoke: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
