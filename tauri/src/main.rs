// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! The WMP Legacy Visualizers desktop host on Tauri: the screensaver (`Alchemy.scr /s`) and its
//! player window (`/c`, or no arguments). The page is the website's own build (`../dist`), embedded
//! in the executable and served at the origin the Deno host used, `https://wmp.localhost/`.

mod audio;
mod host;
mod mode;
mod spotify;
mod update;
#[cfg(target_os = "windows")]
mod win;

use mode::Mode;
use std::path::PathBuf;
use std::sync::LazyLock;
use std::time::Instant;
use tauri::http::{Request, Response, header};
use tauri::webview::Color;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize, Runtime,
    UriSchemeContext, UriSchemeResponder, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_log::{Target, TargetKind};
use tauri_plugin_window_state::StateFlags;

static START: LazyLock<Instant> = LazyLock::new(Instant::now);

/// A startup stage in the log, stamped with how long the process has been alive (the `t+` lines
/// deno-webview/README.md "Startup" measured with).
pub(crate) fn mark(stage: &str) {
    log::info!("t+{}ms {stage}", START.elapsed().as_millis());
}

/// The folder everything is kept in, when it is not the one Tauri would pick (see `win.rs`).
fn data_root() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    return win::data_root();
    #[cfg(not(target_os = "windows"))]
    None
}

/// `browserArgs` from settings.json (beside the exe, else in the data folder; deno-webview/README.md
/// "settings.json") replaces wry's WebView2 arguments (`--disable-features=msWebOOUI,msPdfOOUI,
/// msSmartScreenProtection --autoplay-policy=no-user-gesture-required`): a switch can be tried, or a
/// DevTools port opened, without a rebuild. Unlike the Deno host's webview.dll, WebView2 here does
/// receive them. `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` does not: the arguments wry passes win.
fn browser_args() -> Option<String> {
    let beside = std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(PathBuf::from));
    [beside, data_root()]
        .into_iter()
        .flatten()
        .find_map(|d| std::fs::read(d.join("settings.json")).ok())
        .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
        .and_then(|v| v["browserArgs"].as_str().map(String::from))
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

/// Serves `../dist`, embedded at compile time, for `page()` — except `index.html`, which is the
/// newest verified page update when there is one (update.rs).
fn serve<R: Runtime>(ctx: UriSchemeContext<'_, R>, req: Request<Vec<u8>>, res: UriSchemeResponder) {
    let app = ctx.app_handle().clone();
    let path = match req.uri().path().trim_start_matches('/') {
        "" => "index.html",
        p => p,
    }
    .to_string();
    tauri::async_runtime::spawn(async move {
        let newer = match app.try_state::<update::Updates>() {
            Some(u) if path == "index.html" => u.page().await,
            _ => None,
        };
        let body = match newer {
            Some(bytes) => Some(("text/html".to_string(), bytes)),
            None => app
                .asset_resolver()
                .get(path.clone())
                .map(|a| (a.mime_type, a.bytes)),
        };
        if path == "index.html" {
            mark("page served");
        }
        res.respond(
            match body {
                Some((mime, bytes)) => Response::builder()
                    .header(header::CONTENT_TYPE, mime)
                    // a newer exe or page must never be shown an older cached copy
                    .header(header::CACHE_CONTROL, "no-store")
                    .body(bytes),
                None => Response::builder().status(404).body(Vec::new()),
            }
            .unwrap(),
        );
    });
}

fn builder<'a, R: Runtime>(
    app: &'a AppHandle<R>,
    label: &str,
    mode: Mode,
) -> WebviewWindowBuilder<'a, R, AppHandle<R>> {
    let query = if mode == Mode::Saver {
        "mode=screensaver&ss=1"
    } else {
        "mode=config"
    };
    let host_update = app
        .try_state::<update::Updates>()
        .is_some_and(|u| u.host_update());
    let b = WebviewWindowBuilder::new(app, label, page(query))
        // what the taskbar and Alt+Tab show: neither window has a native caption (deno-webview/main.ts)
        .title(if mode == Mode::Spotify { "WMP Spotify" } else { "Alchemy screensaver" })
        .use_https_scheme(true)
        // On screen at once, at its final box and in the skin's colour, before WebView2 is started
        // (which `build` then waits for): the window a native app gives, filled in a moment later.
        .visible(true)
        .initialization_script(host::script(mode, host_update));
    let b = match browser_args() {
        Some(args) => b.additional_browser_args(&args),
        None => b,
    };
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

/// A box in physical pixels as the logical one the builder takes, in the scale of the monitor it
/// starts on — the scale tao converts it back with, so the window is created exactly there.
fn logical<R: Runtime>(
    app: &AppHandle<R>,
    pos: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
) -> Option<(LogicalPosition<f64>, LogicalSize<f64>)> {
    let m = app.available_monitors().ok()?.into_iter().find(|m| {
        let (p, s) = (m.position(), m.size());
        (p.x..p.x + s.width as i32).contains(&pos.x)
            && (p.y..p.y + s.height as i32).contains(&pos.y)
    })?;
    let f = m.scale_factor();
    Some((pos.to_logical(f), size.to_logical(f)))
}

/// Where the player was left, from the window-state plugin's own file (`skip_initial_state` below:
/// the plugin restores after the window and its WebView2 exist, which is a window that visibly
/// moves; this is the same box before there is a window at all). None on a first run, or when the
/// box no longer starts on a monitor.
fn remembered<R: Runtime>(
    app: &AppHandle<R>,
) -> Option<(LogicalPosition<f64>, LogicalSize<f64>, bool)> {
    let s: serde_json::Value = serde_json::from_slice(&std::fs::read(state_file()?).ok()?).ok()?;
    let s = &s["player"];
    let max = s["maximized"].as_bool().unwrap_or(false);
    let at = |k: &str| s[k].as_i64().map(|v| v as i32);
    // maximized, x/y is the monitor's corner and prev_x/prev_y the box under it
    let (x, y) = if max {
        (at("prev_x")?, at("prev_y")?)
    } else {
        (at("x")?, at("y")?)
    };
    let (w, h) = (s["width"].as_u64()? as u32, s["height"].as_u64()? as u32);
    if w == 0 || h == 0 {
        return None;
    }
    let (p, z) = logical(app, PhysicalPosition::new(x, y), PhysicalSize::new(w, h))?;
    Some((p, z, max))
}

fn state_file() -> Option<PathBuf> {
    data_root().map(|r| r.join("window-state.json"))
}

/// Open the window a mode asks for, or bring it forward if this process already has it: a second
/// launch lands here too, through the single-instance plugin.
fn open<R: Runtime>(app: &AppHandle<R>, mode: Mode) -> tauri::Result<()> {
    let label = match mode {
        Mode::Saver => "saver",
        Mode::Spotify => "spotify",
        _ => "player",
    };
    if let Some(w) = app.get_webview_window(label) {
        w.unminimize()?;
        w.show()?;
        return w.set_focus();
    }
    let w = match mode {
        // One window over every monitor, topmost and off the taskbar.
        // ponytail: one spanning window, as the Deno host; one per monitor if per-display framing is wanted.
        Mode::Saver => {
            let (pos, size) = virtual_screen(app)?;
            let b = builder(app, label, mode)
                .decorations(false)
                .resizable(false)
                .shadow(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .background_color(Color(0, 0, 0, 255));
            let w = match logical(app, pos, size) {
                Some((p, z)) => b.position(p.x, p.y).inner_size(z.width, z.height),
                None => b,
            }
            .build()?;
            // in physical pixels again: monitors of different scales make the logical box approximate
            w.set_position(pos)?;
            w.set_size(size)?;
            w
        }
        // The player: no frame of its own. The page draws the XP title bar and drives this window
        // through it (host.js).
        _ => {
            #[cfg(target_os = "windows")]
            win::chrome_when_created("AlchemyHost");
            let b = builder(app, label, mode)
                .window_classname("AlchemyHost") // the Deno host's class, for whatever looks for it
                .decorations(false)
                .min_inner_size(480.0, 360.0)
                .background_color(Color(20, 99, 235, 255)); // Luna blue, never a white first frame
            let b = if mode == Mode::Spotify {
                b.initialization_script(spotify::INIT_JS)
            } else {
                b
            };
            match remembered(app) {
                Some((p, z, max)) => b
                    .position(p.x, p.y)
                    .inner_size(z.width, z.height)
                    .maximized(max),
                None => b.inner_size(1100.0, 720.0).center(),
            }
            .build()?
        }
    };
    host::attach(&w, mode);
    if mode == Mode::Spotify {
        spotify::attach(&w);
    }
    w.show()?;
    w.set_focus()?;
    mark(&format!("{label}: window and WebView2 up"));
    Ok(())
}

/// Anything that ends the process early: in the log, and in front of the user unless the
/// screensaver is running, which nobody is looking at.
fn fatal(saver: bool, what: &str) -> ! {
    log::error!("fatal: {what}");
    #[cfg(target_os = "windows")]
    if !saver {
        let log = data_root().map(|r| r.join("alchemy.log").display().to_string());
        win::error_box(
            &format!(
                "{what}\n\nThe log has the details:\n{}",
                log.unwrap_or_default()
            ),
            "Alchemy",
        );
    }
    let _ = saver;
    std::process::exit(1)
}

fn main() {
    LazyLock::force(&START);
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mode = mode::parse(&args);
    if mode == Mode::Preview {
        return; // the preview pane stays black: exit 0 before anything starts
    }
    let saver = mode == Mode::Saver;
    std::panic::set_hook(Box::new(move |p| fatal(saver, &p.to_string())));
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

    // The plugin remembers the player's box; `open` puts the window there as it is created.
    let mut state = tauri_plugin_window_state::Builder::new()
        .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
        .with_denylist(&["saver"]);
    if let Some(f) = state_file() {
        // where `remembered` reads it; elsewhere (no data folder) the plugin restores as usual
        state = state
            .with_filename(f.to_string_lossy())
            .skip_initial_state("player");
    }

    let run = tauri::Builder::default()
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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(audio::init())
        .register_asynchronous_uri_scheme_protocol("wmp", serve)
        .invoke_handler(tauri::generate_handler![
            host::ready,
            host::host_log,
            host::dismiss,
            host::win_full,
            host::check_update,
            spotify::sp_snapshot,
            spotify::sp_request,
            spotify::sp_route,
            spotify::sp_cookie,
            spotify::sp_logout
        ])
        .setup(move |app| {
            mark(&format!(
                "argv {args:?} -> {mode:?}; browser args {}",
                browser_args().as_deref().unwrap_or("wry's")
            ));
            // Page updates, asked for now, while WebView2 starts (never in a debug build, whose
            // page is the working tree's).
            let own = app.asset_resolver().get("update.json".into());
            let own = own.and_then(|a| serde_json::from_slice(&a.bytes).ok());
            if let (Some(own), Some(root), false) = (own, &root, cfg!(debug_assertions)) {
                app.manage(update::Updates::start(root.join("update"), own));
            }
            Ok(open(app.handle(), mode)?)
        })
        .run(tauri::generate_context!());
    if let Err(e) = run {
        fatal(saver, &e.to_string());
    }
}
