//! Windows: Spotify's web view, a wry child WebView2 in the "spotify" window, and the DevTools
//! Protocol (CallDevToolsProtocolMethod and the DevTools event receivers) the host watches and
//! drives it through. `Runtime.enable` is never called: nothing is added to Spotify's page but the
//! isolated world our requests run in, and nothing of Spotify's is changed.

use super::seen::{self, Out, Seen};
use super::{HOME, LOGIN, LOGOUT, Reply};
use base64::Engine;
use serde_json::{Value, json};
use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::rc::Rc;
use std::time::{Duration, Instant};
use tauri::{Emitter, EventTarget, Runtime, WebviewWindow, WindowEvent};
use webview2_com::Microsoft::Web::WebView2::Win32::*;
use webview2_com::{
    CallDevToolsProtocolMethodCompletedHandler, DevToolsProtocolEventReceivedEventHandler,
    SetPermissionStateCompletedHandler, take_pwstr,
};
use windows::core::{HSTRING, Interface, PWSTR};
use wry::dpi::{PhysicalPosition, PhysicalSize};
use wry::{PageLoadEvent, Rect, WebViewBuilder, WebViewBuilderExtWindows, WebViewExtWindows};

/// Responses whose bodies the host reads (Network.getResponseBody once they finish).
enum Body {
    Token,
    Cluster,
    Script,
}

struct Host {
    view: wry::WebView,
    core: ICoreWebView2,
    seen: Seen,
    emit: Box<dyn Fn(&str, Value)>,
    /// the web view's current URL, the window's size, and whether it is shown over our page
    url: String,
    size: PhysicalSize<u32>,
    shown: bool,
    login_at: Option<Instant>,
    bodies: HashMap<String, Body>,
    dealer: HashSet<String>,
    requests: u32,
    pushes: u32,
    /// debug builds, ALCHEMY_SPOTIFY_PROBE set: never redirected to the login, never shown
    probe: bool,
}

thread_local! {
    static HOST: RefCell<Option<Host>> = const { RefCell::new(None) };
}

/// `f` on the host, if there is one and nothing else is using it. Everything here runs on the main
/// thread; an event that arrived during a call would be dropped rather than re-entered.
fn with<T>(f: impl FnOnce(&mut Host) -> T) -> Option<T> {
    HOST.with(|h| h.try_borrow_mut().ok()?.as_mut().map(f))
}

/// One DevTools Protocol method; `done` gets its result, or why it failed.
fn cdp(
    core: &ICoreWebView2,
    method: &str,
    params: Value,
    done: impl FnOnce(Result<Value, String>) + 'static,
) {
    let slot = Rc::new(RefCell::new(Some(done)));
    let s2 = slot.clone();
    let m = method.to_owned();
    let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |hr, json| {
        let f = s2.borrow_mut().take();
        if let Some(f) = f {
            f(match hr {
                Ok(()) => serde_json::from_str(&json).map_err(|e| e.to_string()),
                Err(_) => Err(format!("{m}: {json}")),
            });
        }
        Ok(())
    }));
    let r = unsafe {
        core.CallDevToolsProtocolMethod(
            &HSTRING::from(method),
            &HSTRING::from(params.to_string()),
            &handler,
        )
    };
    if let Err(e) = r {
        let f = slot.borrow_mut().take();
        if let Some(f) = f {
            f(Err(format!("{method}: {e}")));
        }
    }
}

/// Every `event` the protocol reports, as its parameters.
fn on(core: &ICoreWebView2, event: &str, f: fn(&mut Host, Value)) -> windows::core::Result<()> {
    let mut token = 0i64;
    unsafe {
        core.GetDevToolsProtocolEventReceiver(&HSTRING::from(event))?
            .add_DevToolsProtocolEventReceived(
                &DevToolsProtocolEventReceivedEventHandler::create(Box::new(move |_, args| {
                    if let Some(args) = args {
                        let mut p = PWSTR::null();
                        args.ParameterObjectAsJson(&mut p)?;
                        if let Ok(v) = serde_json::from_str(&take_pwstr(p)) {
                            with(|h| f(h, v));
                        }
                    }
                    Ok(())
                })),
                &mut token,
            )
    }
}

/// `js` in an isolated world of Spotify's page (its DOM and origin, none of its script), awaited;
/// the value it returns.
fn evaluate(core: &ICoreWebView2, js: String, done: impl FnOnce(Result<Value, String>) + 'static) {
    let c = core.clone();
    cdp(core, "Page.getFrameTree", json!({}), move |r| {
        let frame = match r {
            Ok(v) => v["frameTree"]["frame"]["id"]
                .as_str()
                .unwrap_or("")
                .to_owned(),
            Err(e) => return done(Err(e)),
        };
        let c2 = c.clone();
        let world = json!({ "frameId": frame, "worldName": "wmp" });
        cdp(&c, "Page.createIsolatedWorld", world, move |r| {
            let id = match r.map(|v| v["executionContextId"].as_i64()) {
                Ok(Some(id)) => id,
                Ok(None) => return done(Err("no isolated world".into())),
                Err(e) => return done(Err(e)),
            };
            let p = json!({ "expression": js, "contextId": id, "awaitPromise": true,
                            "returnByValue": true, "silent": true });
            cdp(&c2, "Runtime.evaluate", p, move |r| {
                done(r.and_then(|v| {
                    match v.get("exceptionDetails") {
                        // the first line only: never the expression, which may hold the bearer
                        Some(x) => Err(x["exception"]["description"]
                            .as_str()
                            .or(x["text"].as_str())
                            .and_then(|s| s.lines().next())
                            .unwrap_or("script error")
                            .to_owned()),
                        None => Ok(v["result"]["value"].clone()),
                    }
                }))
            });
        });
    });
}

pub fn attach<R: Runtime>(w: &WebviewWindow<R>) {
    let w2 = w.clone();
    let r = w.with_webview(move |pw| {
        if let Err(e) = create(&w2, pw.environment()) {
            log::error!("spotify: no web view: {e}");
        }
    });
    if let Err(e) = r {
        log::error!("spotify: no web view: {e}");
    }
    #[cfg(debug_assertions)]
    probe_thread(w.clone());
}

/// Where the web view sits: over the whole window while shown, else parked, 1x1 px just outside
/// it. Parked and not hidden: with IsVisible=false the page is `hidden`, and then (measured)
/// Chromium holds a page's first media play() until it is shown and throttles its timers.
fn rect(size: PhysicalSize<u32>, shown: bool) -> Rect {
    let (position, size) = if shown {
        (PhysicalPosition::new(0, 0), size)
    } else {
        (PhysicalPosition::new(-1, -1), PhysicalSize::new(1, 1))
    };
    Rect {
        position: position.into(),
        size: size.into(),
    }
}

fn create<R: Runtime>(
    w: &WebviewWindow<R>,
    env: ICoreWebView2Environment,
) -> Result<(), Box<dyn std::error::Error>> {
    let t0 = Instant::now();
    let size = w.inner_size()?;
    // Tauri's browser process (one environment, so no browser arguments of its own) and a profile
    // of its own, WebView2\EBWebView\WV2Profile_spotify: its cookies and storage are not our page's.
    // A browser of its own measured 100 MB more (CONTRACT.md v8).
    let view = WebViewBuilder::new()
        .with_environment(env)
        .with_profile_name("spotify")
        .with_bounds(rect(size, false))
        .with_focused(false)
        .with_devtools(cfg!(debug_assertions))
        .with_on_page_load_handler(|ev, url| {
            with(|h| h.loaded(ev, url));
        })
        .build_as_child(w)?;
    let core = view.webview();
    autoplay(&core);
    let probe = cfg!(debug_assertions) && std::env::var_os("ALCHEMY_SPOTIFY_PROBE").is_some();
    let w2 = w.clone();
    HOST.with(|h| {
        *h.borrow_mut() = Some(Host {
            view,
            core: core.clone(),
            seen: Seen::default(),
            emit: Box::new(move |n, v| {
                let _ = w2.emit_to(EventTarget::webview_window(w2.label()), n, v);
            }),
            url: String::new(),
            size,
            shown: false,
            login_at: None,
            bodies: HashMap::new(),
            dealer: HashSet::new(),
            requests: 0,
            pushes: 0,
            probe,
        })
    });
    on(&core, "Network.requestWillBeSent", Host::on_request)?;
    on(&core, "Network.loadingFinished", Host::on_finished)?;
    on(&core, "Network.loadingFailed", Host::on_failed)?;
    on(&core, "Network.webSocketCreated", Host::on_socket)?;
    on(&core, "Network.webSocketFrameReceived", Host::on_frame)?;
    // Bodies stay in the protocol's buffer until read; scripts are a few MB each.
    let net = json!({ "maxTotalBufferSize": 64 << 20, "maxResourceBufferSize": 16 << 20,
                      "maxPostDataSize": 1 << 16 });
    cdp(&core, "Network.enable", net, move |r| match r {
        Ok(_) => {
            log::info!(
                "spotify: web view up, watching its network, t+{}ms",
                t0.elapsed().as_millis()
            );
            with(|h| h.view.load_url(HOME));
        }
        Err(e) => log::error!("spotify: no network observer: {e}"),
    });
    w.on_window_event(|e| match e {
        WindowEvent::Resized(s) => {
            with(|h| {
                h.size = *s;
                h.view.set_bounds(rect(*s, h.shown))
            });
        }
        WindowEvent::Destroyed => {
            HOST.with(|h| h.try_borrow_mut().map(|mut h| h.take()).ok());
        }
        _ => {}
    });
    Ok(())
}

/// Media on open.spotify.com may start without a click in its page: the permission WebView2 keeps
/// per origin in the profile, not the browser argument, which would have to be the whole
/// environment's. (WebView2 154 was measured to allow it by default; this keeps it so.)
fn autoplay(core: &ICoreWebView2) {
    let r = unsafe {
        core.cast::<ICoreWebView2_13>()
            .and_then(|c| c.Profile())
            .and_then(|p| p.cast::<ICoreWebView2Profile4>())
            .and_then(|p| {
                p.SetPermissionState(
                    COREWEBVIEW2_PERMISSION_KIND_AUTOPLAY,
                    &HSTRING::from("https://open.spotify.com"),
                    COREWEBVIEW2_PERMISSION_STATE_ALLOW,
                    &SetPermissionStateCompletedHandler::create(Box::new(|r| {
                        match r {
                            Ok(()) => log::info!("spotify: autoplay allowed for open.spotify.com"),
                            Err(e) => log::warn!("spotify: autoplay permission: {e}"),
                        }
                        Ok(())
                    })),
                )
            })
    };
    if let Err(e) = r {
        log::warn!("spotify: autoplay permission: {e}");
    }
}

impl Host {
    fn send(&mut self, out: Out) {
        for (n, v) in out {
            if n == "sp:cluster" {
                self.pushes += 1;
                if self.pushes <= 3 || self.pushes.is_power_of_two() {
                    log::info!(
                        "spotify: cluster #{}: {} devices, player_state {}",
                        self.pushes,
                        v["devices"].as_object().map_or(0, |d| d.len()),
                        if v["player_state"].is_object() {
                            "yes"
                        } else {
                            "no"
                        }
                    );
                }
            }
            let auth = n == "sp:auth";
            (self.emit)(n, v);
            if auth {
                self.auth_changed();
            }
        }
    }

    fn on_request(&mut self, p: Value) {
        let r = &p["request"];
        let (id, url) = (
            p["requestId"].as_str().unwrap_or(""),
            r["url"].as_str().unwrap_or(""),
        );
        let api = seen::api_host(url);
        if api {
            self.requests += 1;
            if self.requests <= 40 || self.requests.is_power_of_two() {
                let m = r["method"].as_str().unwrap_or("");
                log::info!("spotify: seen #{} {m} {}", self.requests, seen::short(url));
            }
        }
        let body = if url.starts_with("https://open.spotify.com/api/token") {
            Some(Body::Token)
        } else if api && url.contains("/connect-state/v1/devices/") {
            Some(Body::Cluster)
        } else if p["type"] == "Script" && url.starts_with("https://open.spotifycdn.com/") {
            Some(Body::Script)
        } else {
            None
        };
        if let Some(b) = body {
            self.bodies.insert(id.to_owned(), b);
        }
        let post = r["postData"].as_str();
        if api && post.is_none() && r["hasPostData"] == true {
            // a body too long to come with the event
            let (url, headers) = (url.to_owned(), r["headers"].clone());
            let q = json!({ "requestId": id });
            cdp(&self.core, "Network.getRequestPostData", q, move |b| {
                let b = b
                    .ok()
                    .and_then(|v| v["postData"].as_str().map(str::to_owned));
                with(|h| {
                    let out = h.seen.request(&url, &headers, b.as_deref());
                    h.send(out)
                });
            });
            return;
        }
        let out = self.seen.request(url, &r["headers"], post);
        self.send(out);
    }

    fn on_finished(&mut self, p: Value) {
        let id = p["requestId"].as_str().unwrap_or("").to_owned();
        let Some(kind) = self.bodies.remove(&id) else {
            return;
        };
        cdp(
            &self.core,
            "Network.getResponseBody",
            json!({ "requestId": id }),
            move |r| {
                let Ok(v) = r else { return };
                let raw = v["body"].as_str().unwrap_or("");
                let text = if v["base64Encoded"] == true {
                    base64::engine::general_purpose::STANDARD
                        .decode(raw)
                        .ok()
                        .and_then(|b| String::from_utf8(b).ok())
                        .unwrap_or_default()
                } else {
                    raw.to_owned()
                };
                with(|h| h.body(kind, &text));
            },
        );
    }

    fn on_failed(&mut self, p: Value) {
        self.bodies.remove(p["requestId"].as_str().unwrap_or(""));
    }

    fn body(&mut self, kind: Body, text: &str) {
        let out = match kind {
            Body::Token => {
                let (out, anon, secs) = self.seen.token_reply(text);
                log::info!(
                    "spotify: /api/token seen: isAnonymous={} expires in {secs} s (the token stays in memory, unlogged)",
                    anon.map_or("?".into(), |a| a.to_string())
                );
                out
            }
            Body::Cluster => serde_json::from_str(text)
                .map(|c| self.seen.cluster(c))
                .unwrap_or_default(),
            Body::Script => {
                let out = self.seen.script(text);
                if !out.is_empty() {
                    log::info!("spotify: {} query hashes declared in a script", out.len());
                }
                out
            }
        };
        self.send(out);
    }

    /// The dealer socket: its URL carries the token, so it is never logged.
    fn on_socket(&mut self, p: Value) {
        let url = p["url"].as_str().unwrap_or("");
        let host = url.strip_prefix("wss://").and_then(|r| r.split('/').next());
        if host.is_some_and(|h| h.contains("dealer") && h.ends_with(".spotify.com")) {
            self.dealer
                .insert(p["requestId"].as_str().unwrap_or("").to_owned());
            log::info!("spotify: dealer socket opened");
        }
    }

    fn on_frame(&mut self, p: Value) {
        if !self.dealer.contains(p["requestId"].as_str().unwrap_or(""))
            || p["response"]["opcode"] != 1
        {
            return;
        }
        let out = self
            .seen
            .dealer(p["response"]["payloadData"].as_str().unwrap_or(""));
        self.send(out);
    }

    fn loaded(&mut self, ev: PageLoadEvent, url: String) {
        if matches!(ev, PageLoadEvent::Finished) {
            log::info!("spotify: page loaded {}", seen::short(&url));
        }
        self.url = url;
        self.fit();
    }

    /// Logged out: Spotify's login page instead of the anonymous web player, at most once a minute
    /// so a session still anonymous after signing in cannot bounce (deno-webview/spotify.ts).
    fn auth_changed(&mut self) {
        let due = self
            .login_at
            .is_none_or(|t| t.elapsed() > Duration::from_secs(60));
        if self.seen.logged_in == Some(false) && !self.probe && due && self.on_player() {
            self.login_at = Some(Instant::now());
            log::info!("spotify: logged out: to the login page");
            let _ = self.view.load_url(LOGIN);
        }
        self.fit();
    }

    fn on_player(&self) -> bool {
        self.url.starts_with(HOME)
    }

    /// Shown over our page only while Spotify needs the user: any page but the web player (the
    /// login, a captcha), or the web player logged out.
    fn fit(&mut self) {
        let want = !self.probe
            && if self.on_player() {
                self.seen.logged_in == Some(false)
            } else {
                self.url.starts_with("https://")
            };
        if want == self.shown {
            return;
        }
        self.shown = want;
        let _ = self.view.set_bounds(rect(self.size, want));
        let _ = if want {
            self.view.focus()
        } else {
            self.view.focus_parent()
        };
        log::info!(
            "spotify: {} Spotify's page ({})",
            if want { "showing" } else { "hiding" },
            seen::short(&self.url).split('/').next().unwrap_or("")
        );
    }
}

pub fn snapshot(tx: Reply<Value>) {
    let v = with(|h| h.seen.snapshot()).ok_or_else(|| "no Spotify view".to_owned());
    let _ = tx.try_send(v);
}

/// The request our page asked for, as the web player would make it: its bearer and the headers
/// it sends, from its own origin. Page headers other than these three are dropped.
pub fn fetch(
    tx: Reply<Value>,
    url: String,
    method: String,
    body: Option<String>,
    headers: BTreeMap<String, String>,
) {
    let r = with(|h| {
        let token = h.seen.token.clone()?;
        let mut hd = serde_json::Map::new();
        for (k, v) in headers {
            let k = k.to_ascii_lowercase();
            if ["content-type", "accept", "app-platform"].contains(&k.as_str()) {
                hd.insert(k, v.into());
            }
        }
        for (k, v) in &h.seen.headers {
            hd.entry(k.to_string()).or_insert_with(|| v.clone().into());
        }
        hd.insert("authorization".into(), format!("Bearer {token}").into());
        let init = json!({ "method": method, "headers": hd, "body": body });
        Some((
            h.core.clone(),
            format!(
                "(async () => {{ const i = {init}; i.signal = AbortSignal.timeout(30000); \
             const r = await fetch({}, i); \
             return {{ status: r.status, text: await r.text(), retryAfter: r.headers.get('Retry-After') }}; }})()",
                json!(url)
            ),
        ))
    });
    match r {
        None => {
            let _ = tx.try_send(Err("no Spotify view".into()));
        }
        Some(None) => {
            let _ = tx.try_send(Ok(json!({ "status": 0, "text": "", "retryAfter": null })));
        }
        Some(Some((core, js))) => evaluate(&core, js, move |r| {
            let _ = tx.try_send(r);
        }),
    }
}

pub fn route(tx: Reply<()>, path: String) {
    let Some(core) = with(|h| h.core.clone()) else {
        let _ = tx.try_send(Err("no Spotify view".into()));
        return;
    };
    let js = format!(
        "history.pushState(history.state, '', {}); \
         dispatchEvent(new PopStateEvent('popstate', {{ state: history.state }})); true",
        json!(path)
    );
    log::info!("spotify: route {path}");
    evaluate(&core, js, move |r| {
        let _ = tx.try_send(r.map(|_| ()));
    });
}

pub fn cookie(tx: Reply<String>, name: String) {
    let Some(core) = with(|h| h.core.clone()) else {
        let _ = tx.try_send(Err("no Spotify view".into()));
        return;
    };
    cdp(
        &core,
        "Network.getCookies",
        json!({ "urls": [HOME] }),
        move |r| {
            let v = r.map(|v| {
                v["cookies"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .find(|c| c["name"] == name.as_str())
                    .and_then(|c| c["value"].as_str())
                    .unwrap_or("")
                    .to_owned()
            });
            let _ = tx.try_send(v);
        },
    );
}

pub fn logout(tx: Reply<()>) {
    let r = with(|h| {
        log::info!("spotify: log out");
        h.seen.token = None;
        h.seen.logged_in = Some(false);
        let a = h.seen.auth();
        (h.emit)("sp:auth", a);
        h.login_at = Some(Instant::now()); // lands on the login page itself
        let r = h.view.load_url(LOGOUT).map_err(|e| e.to_string());
        h.fit();
        r
    });
    let _ = tx.try_send(r.unwrap_or_else(|| Err("no Spotify view".into())));
}

/// Debug builds: `ALCHEMY_SPOTIFY_PROBE=<url of a GET the web player makes>` keeps the web view
/// hidden and on the web player even when logged out, and 15 s in (then every
/// `ALCHEMY_SPOTIFY_PROBE_EVERY` seconds) makes that GET the way `sp_request` does, and reads what
/// the isolated world sees: visibility, autoplay, and how often a 1 s timer fires in 20 s.
#[cfg(debug_assertions)]
fn probe_thread<R: Runtime>(w: WebviewWindow<R>) {
    let Ok(url) = std::env::var("ALCHEMY_SPOTIFY_PROBE") else {
        return;
    };
    let every: u64 = std::env::var("ALCHEMY_SPOTIFY_PROBE_EVERY")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    std::thread::spawn(move || {
        let mut wait = 15;
        loop {
            std::thread::sleep(Duration::from_secs(wait));
            let u = url.clone();
            if w.run_on_main_thread(move || probe(u)).is_err() || every == 0 {
                return;
            }
            wait = every;
        }
    });
}

#[cfg(debug_assertions)]
fn probe(url: String) {
    // a second of silence, unmuted: whether media may start without a click in the page
    const JS: &str = "(async () => { const c = new AudioContext(), ac = c.state; c.close();
      const k = 800, b = new Uint8Array(44 + k), d = new DataView(b.buffer), s = (o, t) => [...t].forEach((x, i) => { b[o + i] = x.charCodeAt(0); });
      s(0, 'RIFF'); d.setUint32(4, 36 + k, true); s(8, 'WAVEfmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
      d.setUint32(24, 8000, true); d.setUint32(28, 8000, true); d.setUint16(32, 1, true); d.setUint16(34, 8, true); s(36, 'data'); d.setUint32(40, k, true); b.fill(128, 44);
      const media = await Promise.race([new Audio(URL.createObjectURL(new Blob([b], { type: 'audio/wav' }))).play().then(() => 'played', (e) => e.name),
        new Promise((ok) => setTimeout(ok, 5000, 'still pending after 5 s'))]);
      let n = 0; const t0 = performance.now();
      await new Promise((ok) => { const tick = () => { n++; performance.now() - t0 < 20000 ? setTimeout(tick, 1000) : ok(); }; setTimeout(tick, 1000); });
      return { visibility: document.visibilityState, audioContext: ac, media,
               autoplayPolicy: navigator.getAutoplayPolicy ? navigator.getAutoplayPolicy('mediaelement') : 'n/a',
               timerTicksIn20s: n }; })()";
    let Some((core, names)) = with(|h| {
        (
            h.core.clone(),
            h.seen
                .headers
                .keys()
                .copied()
                .collect::<Vec<_>>()
                .join(", "),
        )
    }) else {
        return;
    };
    let (tx, mut rx) = tauri::async_runtime::channel(1);
    if seen::api_host(&url) {
        fetch(tx, url.clone(), "GET".into(), None, BTreeMap::new());
    }
    tauri::async_runtime::spawn(async move {
        match rx.recv().await {
            Some(Ok(v)) => log::info!(
                "spotify: probe GET {} with bearer + [{names}] -> {} ({} bytes)",
                seen::short(&url),
                v["status"],
                v["text"].as_str().map_or(0, str::len)
            ),
            Some(Err(e)) => log::info!("spotify: probe GET failed: {e}"),
            None => log::info!("spotify: probe GET: none made"),
        }
    });
    evaluate(&core, JS.into(), |r| match r {
        Ok(v) => log::info!("spotify: probe page {v}"),
        Err(e) => log::info!("spotify: probe page failed: {e}"),
    });
}
