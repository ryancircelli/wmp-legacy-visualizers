// What the desktop host gives the page, before any page script, on every document (host.rs
// `script` calls this with H = {mode, hostUpdate, chrome, nativeTitle}). The same globals the Deno host's
// init script set (its main.ts initScript; src/adapters/host/globals.ts), implemented
// with Tauri's IPC and window API instead of webview bindings.
(function (H) {
  function call(cmd, args) { return window.__TAURI__.core.invoke(cmd, args); }
  function win() { return window.__TAURI__.window.getCurrentWindow(); }
  var ss = H.mode === 'screensaver';

  // The name the page has always looked for: app mode (full chrome, first run Battery).
  // loopback stays false: with no host audio the page would otherwise ask getDisplayMedia.
  window.alchemyElectron = { loopback: false, mode: H.mode };
  // a newer exe is out (update.rs): the page offers the download (Help menu)
  window.alchemyHostUpdate = H.hostUpdate;
  // The page prefers the host's system audio over a display-media loopback when audio is true.
  // Merged, not replaced: a plugin's init script (the audio socket's) runs before this one and
  // sets audio and url.
  window.alchemyScreensaver = Object.assign({ audio: false, url: '' }, window.alchemyScreensaver);
  window.alchemyLog = function (line) { return call('host_log', { line: String(line) }); };
  window.alchemyOpenUrl = function (url) {
    // Only the project's own addresses: the opener plugin's scope (capabilities/default.json).
    call('plugin:opener|open_url', { url: String(url) }).catch(function (e) {
      window.alchemyLog('open url refused: ' + String(url).slice(0, 120) + ' (' + e + ')');
    });
  };
  // Restart Now after a checked page update: the cached page is served on the next launch.
  window.alchemyRestart = function () { call('plugin:process|restart'); };
  // Help > Check for Player Updates: {running, ready, hostUpdate, error} (update.rs check).
  window.alchemyCheckUpdate = function () { return call('check_update'); };

  // Startup marks, milliseconds since this document started loading; src/ pushes its own boot
  // stages into the same array, and the whole list goes to the log at the first painted frame.
  var M = window.alchemyMarks = [];
  function at(n) { M.push(n + '=' + Math.round(performance.now())); }
  addEventListener('DOMContentLoaded', function () { at('DOMContentLoaded'); });
  // Two frames after load, so the mark is a painted frame and not a scheduled one.
  addEventListener('load', function () {
    at('load');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        at('firstPaint');
        call('ready');
        window.alchemyLog('page marks: ' + M.join(' '));
      });
    });
  });
  // What the page is doing, twice after load (the Deno host's line, for the same log readers).
  function report() {
    var S = window.Alchemy && window.Alchemy.Shell, saved = '(none)';
    try { saved = localStorage.getItem('alchemy.settings') || '(none)'; } catch (e) { /* none */ }
    window.alchemyLog(
      'page: source=' + (S && S.source ? S.source.label : 'none') +
      ' vis=' + (S && S.settings ? S.settings.vis + ':' + S.settings.preset : '?') +
      ' fps=' + (S ? S.fps : '?') + ' size=' + innerWidth + 'x' + innerHeight + ' dpr=' + devicePixelRatio +
      ' status="' + (((window.alchemyRoot || document).getElementById('status') || {}).textContent || '') + '"' +
      ' energy=' + (S && S.level ? S.level.freq[0].reduce(function (a, b) { return a + b; }, 0) : '?') +
      ' saved=' + saved);
  }
  addEventListener('load', function () { setTimeout(report, 3000); setTimeout(report, 9000); });

  if (ss) {
    // No settings panel and no cursor; any key, click or more than 10 px of mouse travel (after a
    // 1 s grace, so the nudge that started it does not end it) closes it.
    addEventListener('DOMContentLoaded', function () {
      var s = document.createElement('style');
      s.textContent = '#panel{display:none!important} *{cursor:none!important}';
      document.documentElement.appendChild(s);
    });
    var t0 = Date.now(), x = null, y = null, done = false;
    var bail = function (why) { if (!done) { done = true; call('dismiss', { why: why }); } };
    addEventListener('keydown', function (e) { bail('key ' + e.key); }, true);
    addEventListener('mousedown', function () { bail('mousedown'); }, true);
    addEventListener('mousemove', function (e) {
      if (x === null) { x = e.screenX; y = e.screenY; return; }
      if (Date.now() - t0 > 1000 && (Math.abs(e.screenX - x) > 10 || Math.abs(e.screenY - y) > 10)) bail('mousemove');
    }, true);
    // A screensaver nobody can dismiss is worse than none: a page that never came up gives the
    // desktop back.
    setTimeout(function () { if (!document.querySelector('canvas')) bail('page did not load'); }, 15000);
    return;
  }

  // The player. The window has no frame of its own (decorations off). On Windows the host draws the
  // XP title bar (titlebar.rs) and the page hides its own; elsewhere the page's is the only one. The
  // skin's status-bar grip is the resize handle. The corners are DWM's (win.rs chrome), so the page
  // draws its own square, as template.html does when maximized.
  window.alchemyNativeTitle = H.nativeTitle === true;
  // A skin that draws a window of its own (iTunes) takes the host's away while it is up, and gives
  // it back as it goes: on = the XP title bar and frame, off = the page fills the window. edge is
  // the colour of the page's top row ('#RRGGBB', needed when off): Windows 11 keeps a row or two of
  // frame above the page and paints it so. The host remembers the last word for the window's next
  // launch, whose alchemyNativeTitle then says what it opened with (host.rs win_chrome).
  if (H.chrome) {
    window.alchemyNativeChrome = function (on, edge) {
      call('win_chrome', { native: on === true, edge: edge }).catch(function (e) {
        window.alchemyLog('native chrome refused (' + e + ')');
      });
    };
  }
  addEventListener('DOMContentLoaded', function () {
    var q = document.createElement('style');
    q.textContent = '#chrome,#titlebar{border-radius:0!important}';
    document.documentElement.appendChild(q);
  });
  window.alchemyWinDrag = function () { win().startDragging(); };
  window.alchemyWinMin = function () { win().minimize(); };
  window.alchemyWinMax = function () { win().toggleMaximize(); };
  window.alchemyWinClose = function () { win().close(); };
  window.alchemyWinSize = function () { win().startResizeDragging('SouthEast'); };
  // F / Esc: the window covers every monitor, not just the page inside it (host.rs full).
  window.alchemyWinFull = function (on) { call('win_full', { on: on === true }); };
  // Maximized squares the chrome (template.html): the host's to say, since the page cannot tell a
  // maximized window from a large one.
  function zoomed() {
    win().isMaximized().then(function (m) { if (document.body) document.body.classList.toggle('maximized', m); });
  }
  addEventListener('DOMContentLoaded', zoomed);
  addEventListener('resize', zoomed);
})
