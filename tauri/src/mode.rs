//! Which window Windows is asking for, read before Tauri starts (deno-webview/main.ts `modeOf`).
//!
//! Observed forms on Windows 11: `/S` (the shell's own .scr verb, upper case), `/s`, `/p 12345`,
//! `/p:12345`, `/c`, `/c:98765`, and nothing at all when the file is double-clicked, which means
//! configure. The first argument that looks like one of them wins.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// `/s`: the screensaver, over every monitor.
    Saver,
    /// `/c`, `/c:<hwnd>` or nothing: the player window, where the visualizer is chosen.
    Config,
    /// `/p <hwnd>`: the preview pane in the Screen Saver Settings dialog. Nothing is drawn in it.
    Preview,
    /// `--mode=spotify`: the Spotify player (the flag WmpSpotify.exe gives itself, main.rs, CONTRACT.md v6).
    Spotify,
}

/// `args` without the program name.
pub fn parse<I: IntoIterator<Item = S>, S: AsRef<str>>(args: I) -> Mode {
    given(args).unwrap_or(Mode::Config)
}

/// The mode `args` name, if any (none: a double-click).
pub fn given<I: IntoIterator<Item = S>, S: AsRef<str>>(args: I) -> Option<Mode> {
    for a in args {
        if a.as_ref() == "--mode=spotify" {
            return Some(Mode::Spotify);
        }
        let b = a.as_ref().as_bytes();
        if b.len() >= 2 && (b[0] == b'/' || b[0] == b'-') {
            match b[1].to_ascii_lowercase() {
                b's' => return Some(Mode::Saver),
                b'c' => return Some(Mode::Config),
                b'p' => return Some(Mode::Preview),
                _ => {}
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{Mode::*, parse};

    #[test]
    fn windows_forms() {
        let none: [&str; 0] = [];
        assert_eq!(parse(none), Config);
        for (args, want) in [
            (&["/S"][..], Saver),
            (&["/s"], Saver),
            (&["-s"], Saver),
            (&["/c"], Config),
            (&["/c:98765"], Config),
            (&["/p", "12345"], Preview),
            (&["/p:12345"], Preview),
            (&["--restart", "/s"], Saver),
            (&["12345"], Config),
            (&["--mode=spotify"], Spotify),
        ] {
            assert_eq!(parse(args), want, "{args:?}");
        }
        // what WmpSpotify.exe completes with --mode=spotify (main.rs)
        assert_eq!(super::given(none), None);
        assert_eq!(super::given(["--restart"]), None);
    }
}
