// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! The WMP Legacy Visualizers desktop host on Tauri: the screensaver (`Alchemy.scr /s`) and its
//! player window (`/c`, or no arguments). The page is the website's own build (`../dist`), embedded
//! in the executable and served at the origin the Deno host used, `https://wmp.localhost/`.

mod audio;
mod mode;
#[cfg(target_os = "windows")]
mod win;

use mode::Mode;
use std::path::PathBuf;
use std::sync::LazyLock;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::http::{Request, Response, header};
use tauri::webview::Color;
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, Runtime, UriSchemeContext, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_log::{Target, TargetKind};
use tauri_plugin_window_state::StateFlags;

static START: LazyLock<Instant> = LazyLock::new(Instant::now);

/// The folder everything is kept in, when it is not the one Tauri would pick (see `win.rs`).
fn data_root() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    return win::data_root();
    #[cfg(not(target_os = "windows"))]
    None
}

/// The page, at the origin its settings (`localStorage`) are keyed by. A custom protocol and not
/// Tauri's own `tauri.localhost`, so the origin is the one the Deno host's virtual host has always
/// had and nothing has to be carried over to a new one. On Windows a custom protocol is served as
/// `https://<name>.localhost/`; `.localhost` resolves inside the browser, with no DNS lookup (see
/// deno-webview/README.md for the two seconds a `.local` name cost).
fn page(query: &str) -> WebviewUrl {
    #[cfg(target_os = "windows")]
    return WebviewUrl::External(
        format!("https://wmp.localhost/index.html?{query}")
            .parse()
            .unwrap(),
    );
    #[cfg(not(target_os = "windows"))]
    WebviewUrl::CustomProtocol(
        format!("wmp://localhost/index.html?{query}")
            .parse()
            .unwrap(),
    )
}

/// Serves `../dist`, embedded at compile time, for `page()`.
fn serve<R: Runtime>(ctx: UriSchemeContext<'_, R>, req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let path = match req.uri().path().trim_start_matches('/') {
        "" => "index.html",
        p => p,
    };
    match ctx.app_handle().asset_resolver().get(path.into()) {
        Some(a) => Response::builder()
            .header(header::CONTENT_TYPE, a.mime_type)
            // the page comes out of this exe: a newer exe must never be shown an older cached copy
            .header(header::CACHE_CONTROL, "no-store")
            .body(a.bytes),
        None => Response::builder().status(404).body(Vec::new()),
    }
    .unwrap()
}

/// Every window: say when the page has a painted frame (two frames after `load`), the
/// startup mark the Deno host's `alchemyReady` gave.
const PAINTED_JS: &str = "addEventListener('load', function () {
  requestAnimationFrame(function () { requestAnimationFrame(function () {
    window.__TAURI__.core.invoke('painted');
  }); });
});";

/// The screensaver: no cursor, and any key, click or more than 10 px of mouse travel (after a
/// 1 s grace, so the nudge that started it does not end it) closes it.
const SAVER_JS: &str = "(function () {
  addEventListener('DOMContentLoaded', function () {
    var s = document.createElement('style');
    s.textContent = '*{cursor:none!important}';
    document.documentElement.appendChild(s);
  });
  var t0 = Date.now(), x = null, y = null, done = false;
  function bail() { if (!done) { done = true; window.__TAURI__.core.invoke('dismiss'); } }
  addEventListener('keydown', bail, true);
  addEventListener('mousedown', bail, true);
  addEventListener('mousemove', function (e) {
    if (x === null) { x = e.screenX; y = e.screenY; return; }
    if (Date.now() - t0 > 1000 && (Math.abs(e.screenX - x) > 10 || Math.abs(e.screenY - y) > 10)) bail();
  }, true);
})();";

#[tauri::command]
fn painted(window: WebviewWindow) {
    let epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    log::info!(
        "{}: page painted t+{}ms (epoch {epoch})",
        window.label(),
        START.elapsed().as_millis()
    );
}

#[tauri::command]
fn dismiss(window: WebviewWindow) {
    if window.label() == "saver" {
        log::info!("saver: dismissed");
        let _ = window.destroy(); // the last window: the process ends with it
    }
}

fn builder<'a, R: Runtime>(
    app: &'a AppHandle<R>,
    label: &str,
    url: WebviewUrl,
) -> WebviewWindowBuilder<'a, R, AppHandle<R>> {
    let b = WebviewWindowBuilder::new(app, label, url)
        .title("Alchemy screensaver")
        .use_https_scheme(true)
        .visible(false) // shown once, placed
        .initialization_script(PAINTED_JS);
    match data_root() {
        Some(root) => b.data_directory(root.join("WebView2")),
        None => b,
    }
}

/// The union of every monitor, in physical pixels: the virtual screen.
fn virtual_screen<R: Runtime>(
    app: &AppHandle<R>,
) -> tauri::Result<(PhysicalPosition<i32>, PhysicalSize<u32>)> {
    let (mut l, mut t, mut r, mut b) = (i32::MAX, i32::MAX, i32::MIN, i32::MIN);
    for m in app.available_monitors()? {
        let (p, s) = (m.position(), m.size());
        (l, t) = (l.min(p.x), t.min(p.y));
        (r, b) = (r.max(p.x + s.width as i32), b.max(p.y + s.height as i32));
    }
    if l > r {
        return Err(tauri::Error::WindowNotFound); // no monitor at all
    }
    Ok((
        PhysicalPosition::new(l, t),
        PhysicalSize::new((r - l) as u32, (b - t) as u32),
    ))
}

/// Open the window a mode asks for, or bring it forward if this process already has it: a second
/// launch lands here too, through the single-instance plugin.
fn open<R: Runtime>(app: &AppHandle<R>, mode: Mode) -> tauri::Result<()> {
    let label = if mode == Mode::Saver {
        "saver"
    } else {
        "player"
    };
    if let Some(w) = app.get_webview_window(label) {
        w.unminimize()?;
        w.show()?;
        return w.set_focus();
    }
    let w = match mode {
        // One window over every monitor, topmost and off the taskbar.
        // ponytail: one spanning window, as the Deno host; one per monitor if per-display framing is wanted.
        Mode::Saver => builder(app, label, page("mode=screensaver&ss=1"))
            .decorations(false)
            .resizable(false)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .background_color(Color(0, 0, 0, 255))
            .initialization_script(SAVER_JS)
            .build()?,
        // The player. Native decorations until the host bindings drive the page's own title bar.
        _ => builder(app, label, page("mode=config"))
            .inner_size(1100.0, 720.0)
            .min_inner_size(480.0, 360.0)
            .center()
            .background_color(Color(20, 99, 235, 255)) // Luna blue, never a white first frame
            .build()?,
    };
    if mode == Mode::Saver {
        let (pos, size) = virtual_screen(app)?;
        w.set_position(pos)?;
        w.set_size(size)?;
    }
    w.show()?;
    w.set_focus()?;
    log::info!("{label}: shown t+{}ms", START.elapsed().as_millis());
    Ok(())
}

fn main() {
    LazyLock::force(&START);
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mode = mode::parse(&args);
    if mode == Mode::Preview {
        return; // the preview pane stays black: exit 0 before anything starts
    }
    let root = data_root();

    let mut log = tauri_plugin_log::Builder::new()
        .clear_targets()
        .level(log::LevelFilter::Info);
    log = log.target(Target::new(match &root {
        Some(r) => TargetKind::Folder {
            path: r.clone(),
            file_name: Some("alchemy".into()),
        },
        None => TargetKind::LogDir { file_name: None },
    }));
    if cfg!(debug_assertions) {
        log = log.target(Target::new(TargetKind::Stdout));
    }

    let mut state = tauri_plugin_window_state::Builder::new()
        .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
        .with_denylist(&["saver"]);
    if let Some(r) = &root {
        state = state.with_filename(r.join("window-state.json").to_string_lossy());
    }

    tauri::Builder::default()
        // First, as the plugin requires: a second launch hands its arguments to this process and exits.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let mode = mode::parse(argv.iter().skip(1));
            log::info!("second launch {argv:?} -> {mode:?}");
            if let Err(e) = open(app, mode) {
                log::error!("second launch: {e}");
            }
        }))
        .plugin(log.build())
        .plugin(state.build())
        .plugin(audio::init())
        .register_uri_scheme_protocol("wmp", serve)
        .invoke_handler(tauri::generate_handler![painted, dismiss])
        .setup(move |app| {
            log::info!(
                "argv {args:?} -> {mode:?}, t+{}ms",
                START.elapsed().as_millis()
            );
            Ok(open(app.handle(), mode)?)
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
