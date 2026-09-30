//! What the desktop apps give the page (CONTRACT.md; deno-webview/main.ts): the window globals
//! (`host.js`), the page's own title bar driving this window, full screen over every monitor, the
//! covered-window pause, page updates on demand, and the page's share of the log.

use crate::{mark, mode::Mode, update::Updates};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow, WindowEvent};

/// The init script every document gets before its own.
pub fn script(mode: Mode, host_update: bool) -> String {
    let h = serde_json::json!({
        "mode": if mode == Mode::Saver { "screensaver" } else { "config" },
        "hostUpdate": host_update,
        // the host draws the title bar (titlebar.rs): the page hides its own
        "nativeTitle": cfg!(windows) && mode != Mode::Saver,
    });
    format!("{}({h});", include_str!("host.js"))
}

/// Whether the player window is covered (win.rs `occluded`); the page is told on each change and
/// again when it has painted, since a change before that reached no page.
static COVERED: AtomicBool = AtomicBool::new(false);

fn tell_covered<R: Runtime>(w: &WebviewWindow<R>, on: bool) {
    let _ = w.eval(format!(
        "window.alchemyOccluded && window.alchemyOccluded({on})"
    ));
}

/// Ask whether the window can be seen, and tell the page when that changed.
#[cfg(windows)]
fn seen<R: Runtime>(w: &WebviewWindow<R>, hwnd: isize) {
    let now = crate::win::occluded(hwnd);
    if COVERED.swap(now, Ordering::Relaxed) != now {
        log::info!("{}: {}", w.label(), if now { "covered" } else { "seen" });
        tell_covered(w, now);
    }
}

/// Everything a window needs beyond what its builder set.
pub fn attach<R: Runtime>(w: &WebviewWindow<R>, mode: Mode) {
    #[cfg(windows)]
    let hwnd = w.hwnd().map(|h| h.0 as isize).unwrap_or_default();
    #[cfg(windows)]
    crate::win::chrome(hwnd);
    if mode == Mode::Saver {
        return;
    }
    // the title bar keeps the web view below it
    #[cfg(windows)]
    let _ = w.with_webview(move |pw| crate::titlebar::adopt(hwnd, pw.controller()));
    // Four times a second and whenever the window is activated, as the Deno host did: WebView2
    // keeps drawing a window nobody can see, at 60 fps (deno-webview/README.md, 27 % of a core).
    #[cfg(windows)]
    {
        let w = w.clone();
        std::thread::spawn(move || {
            while crate::win::alive(hwnd) {
                seen(&w, hwnd);
                std::thread::sleep(std::time::Duration::from_millis(250));
            }
        });
    }
    let w2 = w.clone();
    w.on_window_event(move |e| match e {
        #[cfg(windows)]
        WindowEvent::Focused(true) => seen(&w2, hwnd),
        // Closed while full screen: come back to the window's own box first, so that box and not
        // the desktop's is the one remembered (the window-state plugin records it as it closes).
        WindowEvent::CloseRequested { api, .. } if w2.is_fullscreen().unwrap_or(false) => {
            api.prevent_close();
            let _ = full(&w2, false);
            let _ = w2.close();
        }
        _ => {}
    });
}

/// The page's first painted frame: the startup mark the Deno host's `alchemyReady` gave, and the
/// window state that reached no page before it.
#[tauri::command]
pub fn ready<R: Runtime>(window: WebviewWindow<R>) {
    let epoch = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    mark(&format!("{}: page painted (epoch {epoch})", window.label()));
    if window.label() == "player" && COVERED.load(Ordering::Relaxed) {
        tell_covered(&window, true);
    }
}

/// `alchemyLog`: the page's lines (its startup marks, its periodic report) into the host's log.
#[tauri::command]
pub fn host_log<R: Runtime>(window: WebviewWindow<R>, line: String) {
    let line: String = line.chars().take(2000).collect();
    log::info!("{}: {line}", window.label());
}

/// The screensaver's page saw input: it ends. Only the saver window can be dismissed this way.
#[tauri::command]
pub fn dismiss<R: Runtime>(window: WebviewWindow<R>, why: String) {
    if window.label() == "saver" {
        log::info!("saver: exit: {why}");
        let _ = window.destroy(); // the process ends with its last window
    }
}

/// F / Esc in the page (`alchemyWinFull`): the window over every monitor, on top, the display
/// kept awake; off, back to the box it left.
#[tauri::command]
pub fn win_full<R: Runtime>(window: WebviewWindow<R>, on: bool) -> Result<(), String> {
    full(&window, on).map_err(|e| e.to_string())
}

fn full<R: Runtime>(w: &WebviewWindow<R>, on: bool) -> tauri::Result<()> {
    // Tauri's own full screen, which it also enters by itself when the page's element goes full
    // screen: frameless over this monitor, and it keeps the box (and maximized) to come back to.
    w.set_fullscreen(on)?;
    if on {
        // Then the whole virtual screen. Twice: tao keeps a full-screen window on the monitor a
        // new box mostly covers, so the first box moves its idea of "this monitor" to the one
        // the whole desktop covers most, and the second, on that same monitor, is left alone.
        let (pos, size) = crate::virtual_screen(w.app_handle())?;
        for _ in 0..2 {
            w.set_position(pos)?;
            w.set_size(size)?;
        }
    }
    w.set_always_on_top(on)?;
    #[cfg(windows)]
    let was = crate::win::keep_awake(on);
    #[cfg(not(windows))]
    let was = 0;
    log::info!(
        "{}: full screen {on} (execution state was {was:#x})",
        w.label()
    );
    Ok(())
}

/// Help > Check for Player Updates (`alchemyCheckUpdate`): the launch's check, again, on demand.
#[tauri::command]
pub async fn check_update<R: Runtime>(app: AppHandle<R>) -> crate::update::CheckResult {
    match app.try_state::<Updates>() {
        Some(u) => u.check().await,
        None => crate::update::CheckResult {
            running: String::new(),
            ready: None,
            host_update: false,
            error: Some("This build does not update.".into()),
        },
    }
}
