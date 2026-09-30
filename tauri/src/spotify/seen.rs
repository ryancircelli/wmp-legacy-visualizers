//! What the host learns by watching the web player's own traffic (CONTRACT.md v8), as plain
//! functions of what the DevTools Protocol reported, so they are tested without a web view. The
//! rules are the Deno host's injected observers' (deno-webview/spotify.ts), moved out of the page.

use base64::Engine;
use regex::Regex;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::io::Read;
use std::sync::LazyLock;

/// Events for our page: (name, payload).
pub type Out = Vec<(&'static str, Value)>;

/// The request headers of the web player's own API calls that ours repeat (besides the bearer).
const COPIED: [&str; 3] = ["client-token", "app-platform", "spotify-app-version"];

#[derive(Default)]
pub struct Seen {
    /// The web player's bearer. Host memory only: never logged, never sent to our page.
    pub token: Option<String>,
    pub headers: BTreeMap<&'static str, String>,
    pub logged_in: Option<bool>,
    pub expires_at: u64,
    /// This web player's full 40-hex Connect id (track-playback's registration body).
    pub device_id: Option<String>,
    /// The first hex digits of it that connect-state's URL carries, and that spclient host.
    pub hobs: Option<String>,
    pub spclient: Option<String>,
    /// Persisted-query hashes: sent by the web player, and declared in the scripts it loaded.
    pub hashes: BTreeMap<String, String>,
    pub scanned: BTreeMap<String, String>,
    pub cluster: Option<Value>,
}

/// The web player's API hosts, and the only ones `sp_request` reaches: api-partner (pathfinder)
/// and the spclients. Not api.spotify.com: the Web API answers the web player's token with 429.
pub fn api_host(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    let Some(sub) = host.strip_suffix(".spotify.com") else {
        return false;
    };
    let label = sub.split('.').next().unwrap_or("");
    sub == "api-partner"
        || (label.contains("spclient")
            && sub
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'.'))
}

/// `host/path` of a URL, without the query: what the log may say about a request.
pub fn short(url: &str) -> &str {
    let u = url.split_once("://").map_or(url, |(_, r)| r);
    u.split(['?', '#']).next().unwrap_or(u)
}

impl Seen {
    pub fn auth(&self) -> Value {
        json!({ "loggedIn": self.logged_in, "hasToken": self.token.is_some() })
    }
    fn device(&self) -> Value {
        json!({ "deviceId": self.device_id, "hobs": self.hobs, "spclient": self.spclient })
    }
    /// Everything so far, for a page that starts after the observers did (`sp_snapshot`).
    pub fn snapshot(&self) -> Value {
        json!({
            "loggedIn": self.logged_in, "hasToken": self.token.is_some(), "expiresAt": self.expires_at,
            "deviceId": self.device_id, "hobs": self.hobs, "spclient": self.spclient,
            "hashes": self.hashes, "scanned": self.scanned, "cluster": self.cluster,
        })
    }

    /// Network.requestWillBeSent: the headers and body of one of the web player's requests.
    pub fn request(&mut self, url: &str, headers: &Value, body: Option<&str>) -> Out {
        let mut out = Out::new();
        if !api_host(url) {
            return out;
        }
        for (k, v) in headers.as_object().into_iter().flatten() {
            let (k, Some(v)) = (k.to_ascii_lowercase(), v.as_str()) else {
                continue;
            };
            if k == "authorization" {
                let t = v.strip_prefix("Bearer ").unwrap_or("").trim();
                if !t.is_empty() && self.token.as_deref() != Some(t) {
                    let first = self.token.is_none();
                    self.token = Some(t.to_owned());
                    if first {
                        out.push(("sp:auth", self.auth()));
                    }
                }
            } else if let Some(n) = COPIED.iter().find(|n| **n == k) {
                self.headers.insert(n, v.to_owned());
            }
        }
        if let Some((op, sha)) = pathfinder_hash(url, body)
            && self.hashes.get(&op) != Some(&sha)
        {
            out.push(("sp:hash", json!({ "op": op, "sha": sha, "scanned": false })));
            self.hashes.insert(op, sha);
        }
        let mut dev = false;
        if url.ends_with("/track-playback/v1/devices")
            && let Some(id) = body.and_then(registered_id)
            && self.device_id.as_deref() != Some(&id)
        {
            self.device_id = Some(id);
            dev = true;
        }
        if let Some((host, prefix)) = hobs(url)
            && self.hobs.as_deref() != Some(&prefix)
        {
            // A new registration (every page load makes one) drops an id that does not match it.
            if self
                .device_id
                .as_ref()
                .is_some_and(|d| !d.starts_with(&prefix))
            {
                self.device_id = None;
            }
            (self.hobs, self.spclient, dev) = (Some(prefix), Some(host), true);
        }
        if dev {
            out.push(("sp:device", self.device()));
        }
        out
    }

    /// open.spotify.com/api/token's answer. Returns the events and, for the log, whether this token
    /// is anonymous and how long it lives (the token itself is never returned).
    pub fn token_reply(&mut self, body: &str) -> (Out, Option<bool>, i64) {
        let Ok(j) = serde_json::from_str::<Value>(body) else {
            return (Out::new(), None, 0);
        };
        let first = self.token.is_none();
        if let Some(t) = j["accessToken"].as_str().filter(|t| !t.is_empty()) {
            self.token = Some(t.to_owned());
        }
        self.expires_at = j["accessTokenExpirationTimestampMs"].as_u64().unwrap_or(0);
        let anon = j["isAnonymous"].as_bool();
        let li = anon.map(|a| !a);
        let mut out = Out::new();
        if li != self.logged_in || (first && self.token.is_some()) {
            self.logged_in = li.or(self.logged_in);
            out.push(("sp:auth", self.auth()));
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_millis() as i64);
        (out, anon, (self.expires_at as i64 - now) / 1000)
    }

    /// A script the web player loaded: the operations it declares.
    pub fn script(&mut self, body: &str) -> Out {
        let mut out = Out::new();
        for (op, sha) in scan(body) {
            if self.scanned.get(&op) != Some(&sha) {
                out.push(("sp:hash", json!({ "op": op, "sha": sha, "scanned": true })));
                self.scanned.insert(op, sha);
            }
        }
        out
    }

    /// A connect-state cluster (the devices PUT's answer, or a dealer push).
    pub fn cluster(&mut self, c: Value) -> Out {
        if !c.is_object() {
            return Out::new();
        }
        self.cluster = Some(c.clone());
        vec![("sp:cluster", c)]
    }

    /// A text frame from the dealer socket.
    pub fn dealer(&mut self, frame: &str) -> Out {
        dealer_cluster(frame).map_or_else(Out::new, |c| self.cluster(c))
    }
}

/// A pathfinder request's operation and persisted-query hash: from the URL (GET, v1) or the body
/// (POST, v2).
pub fn pathfinder_hash(url: &str, body: Option<&str>) -> Option<(String, String)> {
    if !url.contains("/pathfinder/v") {
        return None;
    }
    let from_url = tauri::Url::parse(url).ok().and_then(|u| {
        let q: BTreeMap<_, _> = u.query_pairs().collect();
        let ext: Value = serde_json::from_str(q.get("extensions")?).ok()?;
        Some(json!({ "operationName": q.get("operationName")?, "extensions": ext }))
    });
    let j = from_url.or_else(|| serde_json::from_str(body?).ok())?;
    let op = j["operationName"].as_str()?;
    let sha = j["extensions"]["persistedQuery"]["sha256Hash"].as_str()?;
    (!op.is_empty() && is_hex(sha, 64)).then(|| (op.to_owned(), sha.to_owned()))
}

fn is_hex(s: &str, n: usize) -> bool {
    s.len() == n
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// track-playback's registration body: `{"device":{"device_id":"<40 hex>",...}}`.
fn registered_id(body: &str) -> Option<String> {
    let j: Value = serde_json::from_str(body).ok()?;
    let id = j["device"]["device_id"].as_str()?;
    is_hex(id, 40).then(|| id.to_owned())
}

/// `https://<spclient>/connect-state/v1/devices/hobs_<hex>`: (spclient host, hex).
pub fn hobs(url: &str) -> Option<(String, String)> {
    let rest = url.strip_prefix("https://")?;
    let (host, path) = rest.split_once('/')?;
    let hex = path.strip_prefix("connect-state/v1/devices/hobs_")?;
    let hex: String = hex.chars().take_while(char::is_ascii_hexdigit).collect();
    (host.contains("spclient") && host.ends_with(".spotify.com") && !hex.is_empty())
        .then(|| (host.to_owned(), hex))
}

static OP: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#""([A-Za-z0-9_]+)"\s*,\s*"(?:query|mutation)"\s*,\s*"([0-9a-f]{64})""#).unwrap()
});

/// How the bundles declare an operation: `"<name>","query"|"mutation","<sha256>"`.
pub fn scan(script: &str) -> Vec<(String, String)> {
    OP.captures_iter(script)
        .map(|c| (c[1].to_owned(), c[2].to_owned()))
        .collect()
}

/// A dealer message pushing `hm://connect-state/v1/cluster`: its cluster. The payload is JSON, or
/// base64 of JSON, gzipped when the message's headers say so.
pub fn dealer_cluster(frame: &str) -> Option<Value> {
    let m: Value = serde_json::from_str(frame).ok()?;
    if m["type"] != "message"
        || !m["uri"]
            .as_str()?
            .starts_with("hm://connect-state/v1/cluster")
    {
        return None;
    }
    let p = &m["payloads"][0];
    let j: Value = if p.is_object() {
        p.clone()
    } else {
        let bin = base64::engine::general_purpose::STANDARD
            .decode(p.as_str()?)
            .ok()?;
        let gz = m["headers"]["Transfer-Encoding"]
            .as_str()
            .is_some_and(|t| t.to_ascii_lowercase().contains("gzip"));
        let mut s = String::new();
        if gz {
            flate2::read::GzDecoder::new(&bin[..])
                .read_to_string(&mut s)
                .ok()?;
        } else {
            s = String::from_utf8(bin).ok()?;
        }
        serde_json::from_str(&s).ok()?
    };
    Some(if j["cluster"].is_object() {
        j["cluster"].clone()
    } else {
        j
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn observations() {
        // hosts sp_request may reach
        for (u, ok) in [
            ("https://api-partner.spotify.com/pathfinder/v2/query", true),
            ("https://gue1-spclient.spotify.com/connect-state/v1/x", true),
            (
                "https://spclient.wg.spotify.com/color-lyrics/v2/track/1",
                true,
            ),
            ("https://api.spotify.com/v1/me", false),
            ("https://open.spotify.com/api/token", false),
            ("http://api-partner.spotify.com/", false),
            ("https://api-partner.spotify.com.evil.com/", false),
            ("https://evilspclient.com/", false),
        ] {
            assert_eq!(api_host(u), ok, "{u}");
        }
        assert_eq!(
            short("https://a.spotify.com/p/q?operationName=x&v=secret"),
            "a.spotify.com/p/q"
        );

        let mut s = Seen::default();
        // the bearer and copied headers, from any-case header names; the token is never echoed
        let out = s.request(
            "https://api-partner.spotify.com/pathfinder/v2/query",
            &json!({ "Authorization": "Bearer TOK", "client-token": "CT", "App-Platform": "WebPlayer" }),
            Some(r#"{"operationName":"home","extensions":{"persistedQuery":{"version":1,"sha256Hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}}"#),
        );
        assert_eq!(s.token.as_deref(), Some("TOK"));
        assert_eq!(s.headers["client-token"], "CT");
        assert_eq!(s.headers["app-platform"], "WebPlayer");
        assert_eq!(
            out[0],
            ("sp:auth", json!({ "loggedIn": null, "hasToken": true }))
        );
        assert_eq!(out[1].0, "sp:hash");
        assert_eq!(s.hashes["home"], "a".repeat(64));
        assert!(!format!("{out:?}{}", s.snapshot()).contains("TOK"));
        // GET pathfinder v1 (the hash in the URL)
        let u = "https://api-partner.spotify.com/pathfinder/v1/query?operationName=getAlbum&extensions=%7B%22persistedQuery%22%3A%7B%22version%22%3A1%2C%22sha256Hash%22%3A%22bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb%22%7D%7D";
        assert_eq!(
            pathfinder_hash(u, None),
            Some(("getAlbum".into(), "b".repeat(64)))
        );

        // /api/token
        let (out, anon, _) = s.token_reply(
            r#"{"accessToken":"T2","accessTokenExpirationTimestampMs":1,"isAnonymous":true}"#,
        );
        assert_eq!((anon, s.logged_in), (Some(true), Some(false)));
        assert_eq!(
            out,
            vec![("sp:auth", json!({ "loggedIn": false, "hasToken": true }))]
        );
        assert!(
            s.token_reply(r#"{"accessToken":"T2","isAnonymous":true}"#)
                .0
                .is_empty()
        );

        // our device: the registration's full id, then connect-state's prefix
        let id = "0123456789abcdef0123456789abcdef01234567";
        s.request(
            "https://gue1-spclient.spotify.com/track-playback/v1/devices",
            &json!({}),
            Some(&format!(r#"{{"device":{{"device_id":"{id}"}}}}"#)),
        );
        let out = s.request(
            "https://gue1-spclient.spotify.com/connect-state/v1/devices/hobs_0123456789abcdef0123456789abcdef012",
            &json!({}),
            None,
        );
        assert_eq!(s.device_id.as_deref(), Some(id));
        assert_eq!(
            out,
            vec![(
                "sp:device",
                json!({ "deviceId": id, "hobs": "0123456789abcdef0123456789abcdef012", "spclient": "gue1-spclient.spotify.com" })
            )]
        );

        // hashes declared in a script
        let js = r#"x("fetchPlaylist","query","cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"),y("addToLibrary", "mutation" ,"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd")"#;
        assert_eq!(s.script(js).len(), 2);
        assert!(s.script(js).is_empty());
        assert_eq!(s.scanned["addToLibrary"], "d".repeat(64));

        // a gzipped, base64 dealer push
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        gz.write_all(br#"{"cluster":{"active_device_id":"x","player_state":{"is_paused":true}}}"#)
            .unwrap();
        let b64 = base64::engine::general_purpose::STANDARD.encode(gz.finish().unwrap());
        let frame = json!({ "type": "message", "uri": "hm://connect-state/v1/cluster",
            "headers": { "Transfer-Encoding": "gzip" }, "payloads": [b64] })
        .to_string();
        let out = s.dealer(&frame);
        assert_eq!(out[0].0, "sp:cluster");
        assert_eq!(out[0].1["active_device_id"], "x");
        assert!(s.dealer(r#"{"type":"pong"}"#).is_empty());
    }
}
