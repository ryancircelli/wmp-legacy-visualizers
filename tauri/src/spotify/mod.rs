//! Spotify mode (`--mode=spotify`, CONTRACT.md v8): open.spotify.com, unmodified, in a hidden child
//! WebView2 the host creates with wry itself, so no Tauri IPC or script is ever in Spotify's page.
//! The host watches that page through the DevTools Protocol (`win.rs`, `seen.rs`) and runs our
//! page's requests inside it, in an isolated world, with the web player's own credentials. The
//! bearer lives in Spotify's page and in host memory only: never in our page, a file or the log.
//!
//! Our page (the Tauri window, https://wmp.localhost/) talks to it through the commands below and
//! the events `sp:auth`, `sp:hash`, `sp:device` and `sp:cluster` (src/adapters/spotify/bridge.ts).

mod seen;
#[cfg(windows)]
mod win;

use serde_json::Value;
use std::collections::BTreeMap;
use tauri::{AppHandle, Runtime, WebviewWindow, async_runtime::Sender};

/// Tells our page it is the Spotify player (CONTRACT.md v6: the Deno host sets the same global).
pub const INIT_JS: &str = "window.alchemyEngine = 'spotify';";
pub const HOME: &str = "https://open.spotify.com/";
/// Spotify's login page, back to the web player once signed in (deno-webview/spotify.ts).
pub const LOGIN: &str =
    "https://accounts.spotify.com/login?continue=https%3A%2F%2Fopen.spotify.com%2F";
/// Ends the session and lands on the login page (deno-webview/main.ts SPOTIFY_LOGOUT).
pub const LOGOUT: &str = "https://accounts.spotify.com/logout?continue=https%3A%2F%2Faccounts.spotify.com%2Flogin%3Fcontinue%3Dhttps%253A%252F%252Fopen.spotify.com%252F";

type Reply<T> = Sender<Result<T, String>>;

/// Opens Spotify's web view in `w` (the window labelled "spotify").
pub fn attach<R: Runtime>(w: &WebviewWindow<R>) {
    #[cfg(windows)]
    win::attach(w);
    #[cfg(not(windows))]
    let _ = w; // ponytail: Windows only for now; macOS needs another observer (WKWebView has no CDP)
}

/// Runs `f` on the main thread, where the web view lives, and waits for what it sends back.
async fn on_main<R: Runtime, T: Send + 'static>(
    app: &AppHandle<R>,
    f: impl FnOnce(Reply<T>) + Send + 'static,
) -> Result<T, String> {
    let (tx, mut rx) = tauri::async_runtime::channel(1);
    app.run_on_main_thread(move || f(tx))
        .map_err(|e| e.to_string())?;
    rx.recv()
        .await
        .unwrap_or_else(|| Err("Spotify's web view is not there".into()))
}

#[cfg(not(windows))]
mod win {
    use super::*;
    fn no<T>(tx: Reply<T>) {
        let _ = tx.try_send(Err("Spotify mode is Windows only for now".into()));
    }
    pub fn snapshot(tx: Reply<Value>) {
        no(tx)
    }
    pub fn fetch(
        tx: Reply<Value>,
        _: String,
        _: String,
        _: Option<String>,
        _: BTreeMap<String, String>,
    ) {
        no(tx)
    }
    pub fn route(tx: Reply<()>, _: String) {
        no(tx)
    }
    pub fn cookie(tx: Reply<String>, _: String) {
        no(tx)
    }
    pub fn logout(tx: Reply<()>) {
        no(tx)
    }
}

/// What the host has seen so far (the page starts after the observers do): `{loggedIn, hasToken,
/// expiresAt, deviceId, hobs, spclient, hashes, scanned, cluster}`.
#[tauri::command]
pub async fn sp_snapshot<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    on_main(&app, win::snapshot).await
}

/// One request with the web player's credentials, from inside its page: `{status, text,
/// retryAfter}`, status 0 when there is no token yet. Only Spotify's API hosts; rejects on a
/// network error, as fetch does.
#[tauri::command]
pub async fn sp_request<R: Runtime>(
    app: AppHandle<R>,
    url: String,
    method: Option<String>,
    body: Option<String>,
    headers: Option<BTreeMap<String, String>>,
) -> Result<Value, String> {
    let method = method.unwrap_or_else(|| "GET".into());
    if !seen::api_host(&url) || !["GET", "POST", "PUT", "DELETE"].contains(&method.as_str()) {
        return Err(format!(
            "not a Spotify API request: {method} {}",
            seen::short(&url)
        ));
    }
    let (t0, what) = (
        std::time::Instant::now(),
        format!("{method} {}", seen::short(&url)),
    );
    let r = on_main(&app, move |tx| {
        win::fetch(tx, url, method, body, headers.unwrap_or_default())
    })
    .await;
    match &r {
        Ok(v) => log::info!(
            "spotify: request {what} -> {} ({} bytes, {} ms)",
            v["status"],
            v["text"].as_str().map_or(0, str::len),
            t0.elapsed().as_millis()
        ),
        Err(e) => log::info!("spotify: request {what} failed: {e}"),
    }
    r
}

/// Sends the hidden web player to a route of its own (`/search`, `/artist/<id>`), whose script
/// chunk declares the operations there: the Deno page's history.pushState + popstate.
#[tauri::command]
pub async fn sp_route<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    let ok = path.starts_with('/')
        && path
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"/_-:".contains(&b));
    if !ok {
        return Err("not a route".into());
    }
    on_main(&app, move |tx| win::route(tx, path)).await
}

/// One of the web player's cookies that its requests carry in their bodies (`sp_t`, home's).
#[tauri::command]
pub async fn sp_cookie<R: Runtime>(app: AppHandle<R>, name: String) -> Result<String, String> {
    if name != "sp_t" {
        return Err("not a cookie the page may read".into());
    }
    on_main(&app, move |tx| win::cookie(tx, name)).await
}

/// File > Log out: ends Spotify's session and shows its login page.
#[tauri::command]
pub async fn sp_logout<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    on_main(&app, win::logout).await
}
