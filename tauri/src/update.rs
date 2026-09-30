//! Page updates without a new download: deno-webview/update.ts in Rust, the same contract
//! (CONTRACT.md v7). Every deploy publishes `update.json` beside `index.html`, signed in CI
//! (tools/sign-update.js) with a key only GitHub holds; the public half is below. A copy of the
//! page is used only when its manifest verifies, its file matches the manifest's hash, it is newer
//! than the page built into this exe, and it needs no more of the host than this exe has
//! (`host_api`). Anything else — offline, a bad signature, a page for a newer host — leaves the
//! built-in page.
//!
//! The newest good copy is cached (in the host's data folder, `update\`), so an update fetched too
//! late for this launch, or while offline, serves the next one. The latest verified manifest is
//! cached too: when it names a different host build, the exe itself is out of date, and the page
//! offers the download (`window.alchemyHostUpdate`).

use base64::{Engine, engine::general_purpose::STANDARD as B64};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;
use tokio::sync::watch;

pub const UPDATE_ORIGIN: &str = "https://wmp.ryancircelli.com/";
/// Ed25519, raw, base64: verifies what tools/sign-update.js signed with UPDATE_SIGNING_KEY.
pub const PUBLIC_KEY: &str = "PtAmxNOZGD1FK8HvZQylQDQ69z0RDM+m0TYEylxQ6vA=";

/// The contract version this host implements, shared with the Deno host while both exist.
pub fn host_api() -> i64 {
    static API: LazyLock<i64> = LazyLock::new(|| {
        serde_json::from_str::<serde_json::Value>(include_str!("../../deno-webview/host-api.json"))
            .ok()
            .and_then(|v| v["hostApi"].as_i64())
            .unwrap_or(0)
    });
    *API
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Manifest {
    pub version: String,
    /// the commit's time, seconds: newer wins
    pub built: i64,
    /// the host API the page needs
    pub needs: i64,
    /// hash of the host's own sources: another value means another exe
    pub host: String,
    /// sha256 (hex) of each published page file
    pub files: HashMap<String, String>,
}

pub struct Page {
    pub bytes: Vec<u8>,
    pub manifest: Manifest,
}

pub fn sha256hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// The manifest these bytes hold, if `sig` (base64) is the key's signature of exactly them.
pub fn verify(bytes: &[u8], sig: &str, key: &str) -> Option<Manifest> {
    let key: [u8; 32] = B64.decode(key).ok()?.try_into().ok()?;
    let sig: [u8; 64] = B64.decode(sig.trim()).ok()?.try_into().ok()?;
    VerifyingKey::from_bytes(&key)
        .ok()?
        .verify_strict(bytes, &Signature::from_bytes(&sig))
        .ok()?;
    serde_json::from_slice(bytes).ok() // signed but not a manifest is not an update either
}

/// Whether a verified manifest's copy of `name` may replace the page this exe has (`own`).
pub fn usable(m: &Manifest, own: &Manifest, name: &str) -> bool {
    m.needs <= host_api() && m.built > own.built && m.files.contains_key(name)
}

/// Whether the site's latest build is a newer exe than this one.
pub fn host_outdated(latest: &Manifest, own: &Manifest) -> bool {
    latest.host != own.host && latest.built > own.built
}

#[derive(Clone)]
pub struct Opts {
    /// where the cache lives (created on demand)
    pub dir: PathBuf,
    /// the page file this exe runs
    pub name: String,
    /// the exe's own manifest (dist/update.json, embedded)
    pub own: Manifest,
    pub key: String,
    pub origin: String,
}

impl Opts {
    pub fn new(dir: PathBuf, name: &str, own: Manifest) -> Self {
        Self {
            dir,
            name: name.into(),
            own,
            key: PUBLIC_KEY.into(),
            origin: UPDATE_ORIGIN.into(),
        }
    }
    fn at(&self, file: &str) -> PathBuf {
        self.dir.join(file)
    }
}

/// A cached page file, re-verified: its manifest's signature and its own hash.
fn cached_page(o: &Opts) -> Option<Page> {
    let bytes = fs::read(o.at(&o.name)).ok()?;
    let mb = fs::read(o.at(&format!("{}.manifest.json", o.name))).ok()?;
    let sig = fs::read_to_string(o.at(&format!("{}.manifest.sig", o.name))).ok()?;
    let m = verify(&mb, &sig, &o.key)?;
    (usable(&m, &o.own, &o.name) && sha256hex(&bytes) == m.files[&o.name])
        .then_some(Page { bytes, manifest: m })
}

/// The latest verified manifest seen, from the cache.
fn cached_latest(o: &Opts) -> Option<Manifest> {
    let mb = fs::read(o.at("latest.json")).ok()?;
    verify(&mb, &fs::read_to_string(o.at("latest.sig")).ok()?, &o.key)
}

/// What the cache offers now: a newer page (or none), and whether the exe is known to be old.
/// (`Updates` asks the two halves separately; the tests ask both.)
#[cfg(test)]
pub fn cached(o: &Opts) -> (Option<Page>, bool) {
    let old = cached_latest(o).is_some_and(|l| host_outdated(&l, &o.own));
    (cached_page(o), old)
}

pub const ERR_SIGNATURE: &str = "The update's signature does not verify.";
pub const ERR_MISMATCH: &str = "The update does not match its manifest.";
pub const ERR_OFFLINE: &str = "The update site could not be reached.";

#[derive(Default)]
pub struct Refresh {
    /// the newer page, if one arrived (or was already cached at least as new)
    pub page: Option<Page>,
    /// the site's build is a newer exe
    pub host_update: bool,
    /// why the site could not be asked or believed
    pub error: Option<&'static str>,
}

/// Asks the site for its manifest; caches it when it verifies, and fetches and caches the page
/// file when it is usable here. Never fails: a failure is `error`. `get` is the HTTP GET (a fake
/// site in the tests).
pub async fn refresh<F, Fut>(o: &Opts, get: F) -> Refresh
where
    F: Fn(String) -> Fut,
    Fut: Future<Output = Result<Vec<u8>, String>>,
{
    let run = async {
        let mb = get(format!("{}update.json", o.origin)).await?;
        let sig = String::from_utf8_lossy(&get(format!("{}update.json.sig", o.origin)).await?)
            .into_owned();
        let Some(m) = verify(&mb, &sig, &o.key) else {
            log::info!("update: the site's manifest does not verify; ignored");
            return Ok(Refresh {
                error: Some(ERR_SIGNATURE),
                ..Default::default()
            });
        };
        let io = |e: std::io::Error| e.to_string();
        fs::create_dir_all(&o.dir).map_err(io)?;
        fs::write(o.at("latest.json"), &mb).map_err(io)?;
        fs::write(o.at("latest.sig"), &sig).map_err(io)?;
        let host_update = host_outdated(&m, &o.own);
        if !usable(&m, &o.own, &o.name) {
            log::info!(
                "update: site {} (needs host {}, have {}) not newer or not for this exe{}",
                short(&m.version),
                m.needs,
                host_api(),
                if host_update {
                    "; a new exe is out"
                } else {
                    ""
                }
            );
            return Ok(Refresh {
                host_update,
                ..Default::default()
            });
        }
        // never backwards: a replayed older (still signed) manifest does not replace a newer cache
        if let Some(have) = cached_page(o).filter(|h| h.manifest.built >= m.built) {
            return Ok(Refresh {
                page: Some(have),
                host_update,
                error: None,
            });
        }
        let file = if o.name == "index.html" { "" } else { &o.name };
        let bytes = get(format!("{}{file}", o.origin)).await?;
        if sha256hex(&bytes) != m.files[&o.name] {
            log::info!("update: {} does not match the manifest; ignored", o.name);
            return Ok(Refresh {
                host_update,
                error: Some(ERR_MISMATCH),
                ..Default::default()
            });
        }
        // the file first, its manifest last: an interrupted write leaves nothing that verifies
        fs::write(o.at(&o.name), &bytes).map_err(io)?;
        fs::write(o.at(&format!("{}.manifest.json", o.name)), &mb).map_err(io)?;
        fs::write(o.at(&format!("{}.manifest.sig", o.name)), &sig).map_err(io)?;
        log::info!("update: cached {} {}", o.name, short(&m.version));
        Ok::<_, String>(Refresh {
            page: Some(Page { bytes, manifest: m }),
            host_update,
            error: None,
        })
    };
    run.await.unwrap_or_else(|e| {
        log::info!("update: {e}");
        Refresh {
            error: Some(ERR_OFFLINE),
            ..Default::default()
        }
    })
}

/// Help > Check for Player Updates: what the page is told. `ready`: a newer page than the one
/// running is cached, for the next launch; `hostUpdate`: a newer exe is out.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub running: String,
    pub ready: Option<String>,
    pub host_update: bool,
    pub error: Option<String>,
}

pub async fn check<F, Fut>(o: &Opts, running: &str, get: F) -> CheckResult
where
    F: Fn(String) -> Fut,
    Fut: Future<Output = Result<Vec<u8>, String>>,
{
    let r = refresh(o, get).await;
    let v = r.page.map(|p| p.manifest.version);
    CheckResult {
        running: running.into(),
        ready: v.filter(|v| v != running),
        host_update: r.host_update,
        error: r.error.map(Into::into),
    }
}

fn short(v: &str) -> &str {
    &v[..v.len().min(7)]
}

/// The one HTTP GET the updates make.
pub async fn http_get(url: String) -> Result<Vec<u8>, String> {
    let r = crate::HTTP
        .get(&url)
        .header("cache-control", "no-cache")
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !r.status().is_success() {
        return Err(format!("{url}: HTTP {}", r.status().as_u16()));
    }
    Ok(r.bytes().await.map_err(|e| e.to_string())?.to_vec())
}

/// This launch's updates (managed state): the site is asked as the app starts, while WebView2
/// comes up, and the page request waits at most half a second more for the answer.
pub struct Updates {
    opts: Opts,
    fresh: watch::Receiver<Option<Arc<Refresh>>>,
    /// the version of the page this launch serves, for the on-demand check
    running: Mutex<String>,
}

impl Updates {
    pub fn start(dir: PathBuf, own: Manifest) -> Self {
        let running = Mutex::new(own.version.clone());
        let opts = Opts::new(dir, "index.html", own);
        let (tx, fresh) = watch::channel(None);
        let o = opts.clone();
        tauri::async_runtime::spawn(async move {
            let r = refresh(&o, http_get).await;
            log::info!(
                "update: checked; {}{}",
                r.page.as_ref().map_or("no newer page".into(), |p| format!(
                    "page {}",
                    short(&p.manifest.version)
                )),
                if r.host_update {
                    ", a newer exe is out"
                } else {
                    ""
                }
            );
            let _ = tx.send(Some(Arc::new(r)));
        });
        Self {
            opts,
            fresh,
            running,
        }
    }

    /// Whether the cache already knows of a newer exe (read as the window is made; the page is
    /// told in its init script). A newer exe the site reports during this launch is the next
    /// launch's news, or Help > Check for Player Updates'.
    pub fn host_update(&self) -> bool {
        cached_latest(&self.opts).is_some_and(|l| host_outdated(&l, &self.opts.own))
    }

    /// The newest page this launch can have: what the site answered by now (half a second more at
    /// most), else the cache's, else none (the one built in).
    pub async fn page(&self) -> Option<Vec<u8>> {
        let mut rx = self.fresh.clone();
        let got = tokio::time::timeout(Duration::from_millis(500), rx.wait_for(Option::is_some))
            .await
            .ok()
            .and_then(|r| r.ok().and_then(|v| v.clone()));
        let (page, how) = match got.as_ref().and_then(|r| r.page.as_ref()) {
            Some(p) => (
                Some((p.bytes.clone(), p.manifest.version.clone())),
                "fetched",
            ),
            None => (
                cached_page(&self.opts).map(|p| (p.bytes, p.manifest.version)),
                "cached",
            ),
        };
        let Some((bytes, version)) = page else {
            crate::mark("page: built in");
            return None;
        };
        crate::mark(&format!("page: update {} ({how})", short(&version)));
        *self.running.lock().unwrap() = version;
        Some(bytes)
    }

    /// Help > Check for Player Updates: the same check, on demand.
    pub async fn check(&self) -> CheckResult {
        let running = self.running.lock().unwrap().clone();
        check(&self.opts, &running, http_get).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use std::sync::Mutex;

    /// A throwaway key pair: the tests sign what the site would publish.
    fn pair() -> (SigningKey, String) {
        let k = SigningKey::from_bytes(&[7; 32]);
        let public = B64.encode(k.verifying_key().to_bytes());
        (k, public)
    }
    // sign-update.js writes the base64 signature and a newline
    fn sign(bytes: &[u8]) -> String {
        B64.encode(pair().0.sign(bytes).to_bytes()) + "\n"
    }
    const PAGE: &[u8] = b"<!doctype html><title>newer</title>";

    fn own() -> Manifest {
        Manifest {
            version: "a".repeat(40),
            built: 100,
            needs: host_api(),
            host: "h1".into(),
            files: HashMap::new(),
        }
    }
    fn manifest() -> Manifest {
        Manifest {
            version: "b".repeat(40),
            built: 200,
            files: HashMap::from([("index.html".into(), sha256hex(PAGE))]),
            ..own()
        }
    }

    /// What the site serves: a manifest, its signature, the page file; and what was asked for.
    struct Site {
        mb: Vec<u8>,
        sig: String,
        file: Vec<u8>,
        hits: Mutex<Vec<String>>,
        offline: bool,
    }
    impl Site {
        fn new(m: Manifest) -> Self {
            let mb = serde_json::to_vec(&m).unwrap();
            Self {
                sig: sign(&mb),
                mb,
                file: PAGE.into(),
                hits: Mutex::default(),
                offline: false,
            }
        }
        fn get(&self) -> impl Fn(String) -> std::future::Ready<Result<Vec<u8>, String>> + '_ {
            |url| {
                let path = url.trim_start_matches("https://site.test/").to_string();
                self.hits.lock().unwrap().push(path.clone());
                std::future::ready(match path.as_str() {
                    _ if self.offline => Err("offline".into()),
                    "update.json" => Ok(self.mb.clone()),
                    "update.json.sig" => Ok(self.sig.clone().into_bytes()),
                    "" => Ok(self.file.clone()),
                    _ => Err(format!("{url}: HTTP 404")),
                })
            }
        }
        fn page_fetches(&self) -> usize {
            self.hits
                .lock()
                .unwrap()
                .iter()
                .filter(|h| h.is_empty())
                .count()
        }
    }

    struct Dir(PathBuf);
    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn dir(name: &str) -> Dir {
        let d = std::env::temp_dir().join(format!("wmp-update-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        Dir(d)
    }
    fn opts(d: &Dir) -> Opts {
        Opts {
            key: pair().1,
            origin: "https://site.test/".into(),
            ..Opts::new(d.0.clone(), "index.html", own())
        }
    }
    fn run<T>(f: impl Future<Output = T>) -> T {
        tauri::async_runtime::block_on(f)
    }

    #[test]
    fn verify_the_keys_signature_of_exactly_these_bytes() {
        let key = pair().1;
        let mb = serde_json::to_vec(&manifest()).unwrap();
        let sig = sign(&mb);
        assert_eq!(verify(&mb, &sig, &key).map(|m| m.built), Some(200));
        let other = serde_json::to_vec(&Manifest {
            built: 201,
            ..manifest()
        })
        .unwrap();
        assert!(verify(&other, &sig, &key).is_none(), "other bytes");
        let other_key = B64.encode(SigningKey::from_bytes(&[8; 32]).verifying_key().to_bytes());
        assert!(verify(&mb, &sig, &other_key).is_none(), "other key");
        assert!(
            verify(&mb, "not base64!", &key).is_none(),
            "garbage signature"
        );
        let shapeless = br#"{"version":"v"}"#;
        assert!(
            verify(shapeless, &sign(shapeless), &key).is_none(),
            "signed but not a manifest"
        );
    }

    #[test]
    fn a_newer_page_is_fetched_checked_cached_and_the_next_launch_reads_it() {
        let (d, s) = (dir("newer"), Site::new(manifest()));
        let r = run(refresh(&opts(&d), s.get()));
        let p = r.page.unwrap();
        assert_eq!(
            (p.manifest.built, p.bytes.as_slice(), r.host_update),
            (200, PAGE, false)
        );
        let (page, old) = cached(&opts(&d));
        assert_eq!((page.map(|p| p.manifest.built), old), (Some(200), false));
        // the same version again: the cached copy, the file not fetched twice
        run(refresh(&opts(&d), s.get()));
        assert_eq!(s.page_fetches(), 1);
    }

    #[test]
    fn not_newer_or_for_a_newer_host_keeps_the_built_in_page() {
        let d = dir("older");
        let old = Site::new(Manifest {
            built: 50,
            ..manifest()
        });
        let r = run(refresh(&opts(&d), old.get()));
        assert_eq!(
            (r.page.is_none(), r.host_update, r.error),
            (true, false, None)
        );
        let newer = Site::new(Manifest {
            needs: host_api() + 1,
            host: "h2".into(),
            ..manifest()
        });
        let r = run(refresh(&opts(&d), newer.get()));
        assert_eq!(
            (r.page.is_none(), r.host_update, r.error),
            (true, true, None)
        );
        assert_eq!(newer.page_fetches(), 0, "the page is never fetched");
        // remembered: the next launch knows without the network
        assert!(cached(&opts(&d)).1);
    }

    #[test]
    fn a_bad_signature_a_file_that_does_not_match_or_no_network_change_nothing() {
        let d = dir("bad");
        let mut forged = Site::new(manifest());
        forged.sig = sign(b"something else");
        let r = run(refresh(&opts(&d), forged.get()));
        assert_eq!(
            (r.page.is_none(), r.host_update, r.error),
            (true, false, Some(ERR_SIGNATURE))
        );
        let mut swapped = Site::new(manifest());
        swapped.file = b"evil".to_vec();
        let r = run(refresh(&opts(&d), swapped.get()));
        assert_eq!((r.page.is_none(), r.error), (true, Some(ERR_MISMATCH)));
        assert!(cached(&opts(&d)).0.is_none(), "nothing cached");
        let mut offline = Site::new(manifest());
        offline.offline = true;
        let r = run(refresh(&opts(&d), offline.get()));
        assert_eq!(
            (r.page.is_none(), r.host_update, r.error),
            (true, false, Some(ERR_OFFLINE))
        );
    }

    #[test]
    fn an_older_signed_manifest_a_replay_does_not_replace_a_newer_cache() {
        let d = dir("replay");
        run(refresh(
            &opts(&d),
            Site::new(Manifest {
                built: 300,
                ..manifest()
            })
            .get(),
        ));
        let replay = Site::new(Manifest {
            built: 200,
            version: "d".repeat(40),
            ..manifest()
        });
        let r = run(refresh(&opts(&d), replay.get()));
        assert_eq!(r.page.map(|p| p.manifest.built), Some(300));
        assert_eq!(cached(&opts(&d)).0.map(|p| p.manifest.built), Some(300));
    }

    #[test]
    fn check_is_ready_when_a_newer_page_than_the_running_one_is_cached() {
        let (d, s) = (dir("check"), Site::new(manifest()));
        let running = "a".repeat(40);
        assert_eq!(
            run(check(&opts(&d), &running, s.get())),
            CheckResult {
                running: running.clone(),
                ready: Some("b".repeat(40)),
                host_update: false,
                error: None
            }
        );
        // already running that page (a launch that took it): the latest
        assert_eq!(run(check(&opts(&d), &"b".repeat(40), s.get())).ready, None);
        let mut offline = Site::new(manifest());
        offline.offline = true;
        assert_eq!(
            run(check(&opts(&d), &running, offline.get()))
                .error
                .as_deref(),
            Some(ERR_OFFLINE)
        );
        // what the page is handed (src/adapters/host/index.ts checkForUpdates)
        let json = serde_json::to_string(&CheckResult {
            running: "r".into(),
            ready: None,
            host_update: true,
            error: None,
        });
        assert_eq!(
            json.unwrap(),
            r#"{"running":"r","ready":null,"hostUpdate":true,"error":null}"#
        );
    }

    #[test]
    fn a_cached_file_changed_on_disk_no_longer_counts() {
        let (d, s) = (dir("tamper"), Site::new(manifest()));
        run(refresh(&opts(&d), s.get()));
        fs::write(d.0.join("index.html"), "tampered").unwrap();
        assert!(cached(&opts(&d)).0.is_none());
    }

    /// tools/sign-update.js (CI's signer, Node's Ed25519 over a PKCS#8 key) signs what this
    /// verifies: its output for the test key's seed, as it wrote it, trailing newline and all.
    #[test]
    fn what_tools_sign_update_js_signs_verifies() {
        let mb = br#"{"version":"cccccccccccccccccccccccccccccccccccccccc","built":1,"needs":1,"host":"h","files":{}}"#;
        let sig = "rbUaXahp4+mGamDBhdwyCfit5CSWgkg4mLCGrRqv3bXIuDzR4EJGoqHvPMLr6lKYlX94FLCkwWisFxjXJSejBQ==\n";
        assert_eq!(verify(mb, sig, &pair().1).map(|m| m.built), Some(1));
    }

    /// The manifest this exe embeds must describe the page beside it and need no more than this host.
    #[test]
    fn dist_update_json_describes_dist_and_fits_this_host() {
        let m: Manifest = serde_json::from_str(include_str!("../../dist/update.json")).unwrap();
        assert_eq!(m.needs, host_api());
        assert_eq!(
            m.files["index.html"],
            sha256hex(include_bytes!("../../dist/index.html"))
        );
    }

    /// A TLS handshake with a server that does not speak TLS: an error, never a panic, which would
    /// be the whole app (panic = "abort"). ureq 3.4, the lyrics' client before, panicked on https
    /// without the right feature; this is the one client both use.
    #[test]
    fn https_is_an_error_never_a_panic() {
        use std::io::Write;
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("https://{}/", l.local_addr().unwrap());
        std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let _ = s.write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 0\r\n\r\n");
        });
        assert!(run(http_get(url)).is_err());
    }

    /// The real key decodes to a verifying key (a typo in it would silently disable every update).
    #[test]
    fn the_public_key_is_a_key() {
        let k: [u8; 32] = B64.decode(PUBLIC_KEY).unwrap().try_into().unwrap();
        assert!(VerifyingKey::from_bytes(&k).is_ok());
    }
}
