//! The speaker's sound settings (wmp_ls_command "eq:", "quality:", "normalise:", "cache:";
//! wmp_librespot.h): parsed here, and kept in sound.json in the receiver's cache dir so the next launch
//! starts with them. What each needs to take effect is lib.rs's (`rebuild`) and eq.rs's.

use librespot_playback::config::{Bitrate, PlayerConfig};
use serde_json::{Value, json};

#[derive(Clone, Copy, PartialEq, Debug)]
pub struct Sound {
    pub eq: [f32; 10], // dB per band (eq.rs's BANDS), -12..12; all 0 is off
    pub quality: u16,  // kbps: 96, 160 or 320
    pub normalise: bool,
    pub cache: bool, // the audio files kept on disk
}

impl Default for Sound {
    fn default() -> Self {
        Sound { eq: [0.0; 10], quality: 160, normalise: true, cache: true }
    }
}

/// Ten numbers, each clamped to -12..12 dB.
fn gains(v: &Value) -> Option<[f32; 10]> {
    let a = v.as_array().filter(|a| a.len() == 10)?;
    let mut g = [0.0; 10];
    for (g, x) in g.iter_mut().zip(a) {
        *g = x.as_f64()?.clamp(-12.0, 12.0) as f32;
    }
    Some(g)
}

fn quality(n: u64) -> Option<u16> {
    matches!(n, 96 | 160 | 320).then_some(n as u16)
}

fn flag(s: &str) -> Option<bool> {
    match s {
        "0" => Some(false),
        "1" => Some(true),
        _ => None,
    }
}

fn file(dir: &str) -> String {
    format!("{dir}/sound.json")
}

impl Sound {
    /// These settings with a sound command applied: None when `cmd` is not one, Some(None) when its value
    /// is bad (the command is ignored).
    pub fn with(mut self, cmd: &str) -> Option<Option<Sound>> {
        let (k, v) = cmd.split_once(':')?;
        let v = v.trim();
        let ok = match k {
            "eq" => (if v == "off" { Some([0.0; 10]) } else { serde_json::from_str(v).ok().as_ref().and_then(gains) })
                .map(|g| self.eq = g),
            "quality" => v.parse().ok().and_then(quality).map(|q| self.quality = q),
            "normalise" => flag(v).map(|n| self.normalise = n),
            "cache" => flag(v).map(|c| self.cache = c),
            _ => return None,
        };
        Some(ok.map(|_| self))
    }

    /// The kept ones; a missing or unreadable file, or a field in it, the default.
    pub fn load(dir: &str) -> Sound {
        let d = Sound::default();
        let v: Value = std::fs::read_to_string(file(dir)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        Sound {
            eq: gains(&v["eq"]).unwrap_or(d.eq),
            quality: v["quality"].as_u64().and_then(quality).unwrap_or(d.quality),
            normalise: v["normalise"].as_bool().unwrap_or(d.normalise),
            cache: v["cache"].as_bool().unwrap_or(d.cache),
        }
    }

    /// Kept for the next launch (written aside and renamed over, so a crash leaves the old file whole).
    pub fn save(&self, dir: &str) -> std::io::Result<()> {
        let tmp = format!("{dir}/sound.json.tmp");
        let v = json!({"eq": self.eq, "quality": self.quality, "normalise": self.normalise, "cache": self.cache});
        std::fs::write(&tmp, v.to_string())?;
        std::fs::rename(tmp, file(dir))
    }

    /// librespot's own player settings for these: the bitrate, and its normalisation (its defaults
    /// otherwise: by album or track as Spirc says, with its limiter).
    pub fn player_config(&self) -> PlayerConfig {
        PlayerConfig {
            bitrate: match self.quality {
                96 => Bitrate::Bitrate96,
                320 => Bitrate::Bitrate320,
                _ => Bitrate::Bitrate160,
            },
            normalisation: self.normalise,
            ..PlayerConfig::default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_commands_parse_clamp_and_ignore_bad_input() {
        let d = Sound::default();
        let eq = d.with("eq:[1, -2.5, 30, -99, 0, 0, 0, 0, 0, 12]").unwrap().unwrap().eq;
        assert_eq!(eq, [1.0, -2.5, 12.0, -12.0, 0.0, 0.0, 0.0, 0.0, 0.0, 12.0]);
        let on = Sound { eq, ..d };
        assert_eq!(on.with("eq:off"), Some(Some(d)));
        assert_eq!(on.with("eq:[0,0,0,0,0,0,0,0,0,0]"), Some(Some(d)));
        for bad in ["eq:[1,2,3]", "eq:[1,2,3,4,5,6,7,8,9,\"x\"]", "eq:nope", "eq:", "quality:128", "quality:x", "normalise:2", "normalise:yes", "cache:"] {
            assert_eq!(d.with(bad), Some(None), "{bad}");
        }
        assert_eq!(d.with("quality:320").unwrap().unwrap().quality, 320);
        assert_eq!(d.with("quality: 96").unwrap().unwrap().quality, 96);
        assert!(d.with("normalise:1").unwrap().unwrap().normalise);
        assert!(!d.with("cache:0").unwrap().unwrap().cache);
        assert_eq!(d.with("quality:160"), Some(Some(d))); // the same: nothing changes
        for other in ["play", "seek:100", "crossfade:3", "load:{}", "equalizer:1"] {
            assert_eq!(d.with(other), None, "{other}");
        }
    }

    #[test]
    fn the_file_round_trips_and_a_bad_one_is_the_defaults() {
        let dir = std::env::temp_dir().join(format!("wmp-sound-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let dir = dir.to_str().unwrap();
        assert_eq!(Sound::load(dir), Sound::default()); // none yet
        let s = Sound { eq: [0.3, -12.0, 1.5, 0.0, 0.0, 0.0, 0.0, 0.0, 7.25, -0.1], quality: 320, normalise: true, cache: false };
        s.save(dir).unwrap();
        assert_eq!(Sound::load(dir), s);
        std::fs::write(file(dir), "{not json").unwrap();
        assert_eq!(Sound::load(dir), Sound::default());
        // a bad field alone falls back
        std::fs::write(file(dir), r#"{"eq":[1],"quality":128,"normalise":true,"cache":"x"}"#).unwrap();
        assert_eq!(Sound::load(dir), Sound { normalise: true, ..Sound::default() });
        std::fs::remove_dir_all(dir).unwrap();
    }
}
