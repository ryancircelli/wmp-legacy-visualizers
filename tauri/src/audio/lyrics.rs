//! Synced lyrics for the track the media session reports (CONTRACT.md, "v5 — Synced lyrics"), from
//! LRCLIB, cached on disk per track. deno-webview/lyrics.ts, ported; the cache files are the same
//! (`<sha1 of title\0artist\0album\0seconds>.json`, holding the frame).

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha1::{Digest, Sha1};
use std::path::Path;
use std::sync::LazyLock;
use std::time::Duration;

#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct Track {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: f64,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct Line {
    t: f64,
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    words: Option<Vec<Word>>,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct Word {
    t: f64,
    text: String,
}

#[derive(Deserialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Hit {
    duration: Option<f64>,
    synced_lyrics: Option<String>,
    plain_lyrics: Option<String>,
}

const API: &str = "https://lrclib.net/api";
const UA: &str = "WmpLegacyVisualizers/1.0 (github.com/ryancircelli/wmp-legacy-visualizers)";

fn secs(m: &str, s: &str) -> f64 {
    let v = m.parse::<f64>().unwrap_or(0.0) * 60.0 + s.parse::<f64>().unwrap_or(0.0);
    (v * 100.0).round() / 100.0
}

/// Every `<open>mm:ss(.xx)<close>` in `s`, as (start, end, seconds): lyrics.ts's
/// `/\[(\d+):(\d+(?:\.\d+)?)\]/g` (and its `<...>` twin) without a regex engine in the exe.
fn stamps(s: &str, open: u8, close: u8) -> Vec<(usize, usize, f64)> {
    let b = s.as_bytes();
    let digits = |from: usize| {
        let n = b[from.min(b.len())..]
            .iter()
            .take_while(|c| c.is_ascii_digit())
            .count();
        (n > 0).then_some(from + n)
    };
    let (mut out, mut i) = (Vec::new(), 0);
    while let Some(o) = b[i..].iter().position(|&c| c == open).map(|o| o + i) {
        i = o + 1;
        let Some(m) = digits(o + 1).filter(|&m| b.get(m) == Some(&b':')) else {
            continue;
        };
        let Some(mut e) = digits(m + 1) else { continue };
        if b.get(e) == Some(&b'.') {
            e = digits(e + 1).unwrap_or(e);
        }
        if b.get(e) == Some(&close) {
            out.push((o, e + 1, secs(&s[o + 1..m], &s[m + 1..e])));
            i = e + 1;
        }
    }
    out
}

/// `[mm:ss.xx]text`, with any number of stamps per line; tag lines like `[ar:...]` never match.
/// Enhanced LRC word stamps (`<mm:ss.xx>word`) become `words` so the page can highlight karaoke-style.
pub fn parse_lrc(lrc: &str) -> Vec<Line> {
    let mut out = Vec::new();
    for line in lrc.lines() {
        let at = stamps(line, b'[', b']');
        let Some(&(_, end, _)) = at.last() else {
            continue;
        };
        let rest = &line[end..];
        let tags = stamps(rest, b'<', b'>');
        let mut text = String::new();
        let mut from = 0;
        for &(s, e, _) in &tags {
            text += &rest[from..s];
            from = e;
        }
        text += &rest[from..];
        let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
        let words: Vec<Word> = tags
            .iter()
            .enumerate()
            .map(|(i, &(_, e, t))| Word {
                t,
                text: rest[e..tags.get(i + 1).map_or(rest.len(), |n| n.0)]
                    .trim()
                    .into(),
            })
            .filter(|w| !w.text.is_empty())
            .collect();
        for &(_, _, t) in &at {
            out.push(Line {
                t,
                text: text.clone(),
                words: (!words.is_empty()).then(|| words.clone()),
            });
        }
    }
    out.sort_by(|a, b| a.t.total_cmp(&b.t));
    out
}

/// The search result nearest in length; with no length to go on, the first one that is synced.
fn closest(hits: Vec<Hit>, duration: f64) -> Option<Hit> {
    if duration == 0.0 {
        let i = hits
            .iter()
            .position(|h| h.synced_lyrics.is_some())
            .unwrap_or(0);
        return hits.into_iter().nth(i);
    }
    let off = |h: &Hit| (h.duration.unwrap_or(0.0) - duration).abs();
    hits.into_iter().min_by(|a, b| off(a).total_cmp(&off(b)))
}

fn frame(status: &str, lines: Option<Vec<Line>>, plain: Option<String>, track: Value) -> String {
    json!({"type": "lyrics", "status": status, "source": "lrclib", "lines": lines, "plain": plain, "track": track})
        .to_string()
}

/// The frame for no lyrics at all (none found, or the page turned fetching off).
pub fn none(t: Option<&Track>) -> String {
    let empty = json!({"title": "", "artist": "", "album": "", "duration": 0});
    frame("none", None, None, t.map_or(empty, |t| json!(t)))
}

fn to_frame(hit: Option<Hit>, t: &Track) -> (String, String) {
    let hit = hit.unwrap_or_default();
    let lines = hit
        .synced_lyrics
        .as_deref()
        .map(parse_lrc)
        .unwrap_or_default();
    let plain = hit.plain_lyrics.filter(|p| !p.is_empty());
    let (status, n) = match (lines.len(), &plain) {
        (0, Some(_)) => ("plain", String::new()),
        (0, None) => ("none", String::new()),
        (n, _) => ("synced", format!(" ({n} lines)")),
    };
    let lines = (!lines.is_empty()).then_some(lines);
    (
        status.to_string() + &n,
        frame(status, lines, plain, json!(t)),
    )
}

static AGENT: LazyLock<ureq::Agent> = LazyLock::new(|| {
    use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
    ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(5)))
        .http_status_as_error(false)
        .user_agent(UA)
        // The system's own TLS and roots (SChannel here, Security.framework on a Mac).
        .tls_config(
            TlsConfig::builder()
                .provider(TlsProvider::NativeTls)
                .root_certs(RootCerts::PlatformVerifier)
                .build(),
        )
        .build()
        .into()
});

/// Exact match first (LRCLIB wants all four fields, duration within ~2 s), then a search.
fn lookup(t: &Track) -> Result<Option<Hit>, Box<dyn std::error::Error>> {
    if t.duration > 0.0 {
        let mut r = AGENT
            .get(format!("{API}/get"))
            .query("track_name", &t.title)
            .query("artist_name", &t.artist)
            .query("album_name", &t.album)
            .query("duration", t.duration.round().to_string())
            .call()?;
        match r.status().as_u16() {
            200 => return Ok(Some(r.body_mut().read_json()?)),
            404 => {}
            s => return Err(format!("lrclib get {s}").into()),
        }
    }
    let mut r = AGENT
        .get(format!("{API}/search"))
        .query("track_name", &t.title)
        .query("artist_name", &t.artist)
        .call()?;
    if r.status() != 200 {
        return Err(format!("lrclib search {}", r.status()).into());
    }
    Ok(closest(r.body_mut().read_json()?, t.duration))
}

fn cache_name(t: &Track) -> String {
    let key = [
        &t.title,
        &t.artist,
        &t.album,
        &t.duration.round().to_string(),
    ]
    .map(|s| s.as_str())
    .join("\0");
    let h = Sha1::digest(key.as_bytes());
    h.iter().map(|b| format!("{b:02x}")).collect::<String>() + ".json"
}

/// Cached lyrics for `t`, else LRCLIB's (cached unless the fetch failed), as (what happened, the
/// frame). Never fails; blocks for up to the 5 s timeout.
pub fn lyrics_for(t: &Track, dir: Option<&Path>) -> (String, String) {
    let file = dir.map(|d| d.join(cache_name(t)));
    if let Some(Ok(s)) = file.as_ref().map(std::fs::read_to_string) {
        // Only a whole lyrics frame: the page takes any other text frame for the audio's first one.
        let v: Value = serde_json::from_str(&s).unwrap_or_default();
        if v["type"] == "lyrics" {
            return (
                format!("{} (cached)", v["status"].as_str().unwrap_or("?")),
                s,
            );
        }
    }
    match lookup(t) {
        Ok(hit) => {
            let (status, f) = to_frame(hit, t);
            if let (Some(file), Some(dir)) = (&file, dir) {
                let _ = std::fs::create_dir_all(dir);
                let _ = std::fs::write(file, &f);
            }
            (status, f)
        }
        // ponytail: errors are not cached, so a track retries on its next play; no backoff beyond that.
        Err(e) => (format!("error ({e})"), frame("error", None, None, json!(t))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn l(t: f64, text: &str) -> Line {
        Line {
            t,
            text: text.into(),
            words: None,
        }
    }

    #[test]
    fn parse_lrc_reads_every_stamp_skips_tags_and_sorts() {
        let got = parse_lrc("[ar:Queen]\n[00:12.50] Is this\r\n[01:02.00][00:05]Mama\n[00:20.00]");
        assert_eq!(
            got,
            [
                l(5.0, "Mama"),
                l(12.5, "Is this"),
                l(20.0, ""),
                l(62.0, "Mama")
            ]
        );
    }

    #[test]
    fn parse_lrc_keeps_enhanced_word_stamps() {
        let got = parse_lrc("[00:10.00]<00:10.00>Is <00:10.40>this<00:11.00> the\n[00:12.00]plain");
        let w = |t, text: &str| Word {
            t,
            text: text.into(),
        };
        let mut first = l(10.0, "Is this the");
        first.words = Some(vec![w(10.0, "Is"), w(10.4, "this"), w(11.0, "the")]);
        assert_eq!(got, [first, l(12.0, "plain")]);
    }

    #[test]
    fn stamps_match_like_the_regex() {
        let got =
            parse_lrc("[1:2.5x]a\n[00:03.]b\n x [00:04]c <0:4.5>d <9>e\n[ti:x][00:05.25]<00:06>");
        let mut c = l(4.0, "c d <9>e"); // node: lyrics.ts gives exactly this
        c.words = Some(vec![Word {
            t: 4.5,
            text: "d <9>e".into(),
        }]);
        assert_eq!(got, [c, l(5.25, "")]);
    }

    #[test]
    fn closest_picks_the_nearest_length_or_the_first_synced() {
        let hits = || {
            vec![
                Hit {
                    duration: Some(200.0),
                    ..Default::default()
                },
                Hit {
                    duration: Some(356.0),
                    synced_lyrics: Some("x".into()),
                    ..Default::default()
                },
                Hit {
                    duration: Some(340.0),
                    ..Default::default()
                },
            ]
        };
        assert_eq!(closest(hits(), 354.0).unwrap().duration, Some(356.0));
        assert_eq!(closest(hits(), 0.0).unwrap().duration, Some(356.0));
    }

    #[test]
    fn https_is_an_error_never_a_panic() {
        // ureq 3.4 panics on https unless its `native-tls` feature (not just the provider) is on,
        // and a panic here is the whole app (panic = "abort").
        assert!(AGENT.get("https://127.0.0.1:1/").call().is_err());
    }

    #[test]
    fn frames_keep_the_deno_shape() {
        let t = Track {
            title: "T".into(),
            artist: "A".into(),
            album: "".into(),
            duration: 61.0,
        };
        let hit = Hit {
            synced_lyrics: Some("[00:01.00]hi".into()),
            ..Default::default()
        };
        let (status, f) = to_frame(Some(hit), &t);
        assert_eq!(status, "synced (1 lines)");
        let v: Value = serde_json::from_str(&f).unwrap();
        assert_eq!(v["lines"], json!([{"t": 1.0, "text": "hi"}]));
        assert_eq!(v["plain"], Value::Null);
        assert_eq!(v["track"]["duration"], json!(61.0));
        assert_eq!(
            serde_json::from_str::<Value>(&none(None)).unwrap()["track"]["title"],
            ""
        );
        // the name lyrics.ts gives the same track (node: sha1 of ["T","A","","61"].join("\0"))
        assert_eq!(
            cache_name(&t),
            "191b0801814a3e19960cd249774976ad0c29af21.json"
        );
    }
}
