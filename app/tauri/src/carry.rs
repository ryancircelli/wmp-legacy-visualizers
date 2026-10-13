//! The first launch after the Deno host: the user's settings and Spotify login, carried over once
//! from that host's WebView2 profiles (its main.ts `profileDir`) into this host's
//! (`win.rs` `data_root`). Windows only; this host's own data folder never moves again, so it is the
//! only carry-over there will be.
//!
//! Copied, not shared: the Deno host can still be running beside this one (an old WmpSpotify.exe, an
//! Alchemy.scr still set as the screensaver), and a WebView2 profile is open in one program at a time.
//! Its folders are left as they were, so going back to it loses nothing either.
//!
//! Once per item, recorded by a file in the data folder (`carried-settings`, `carried-login`, which say
//! what was done). A launch that finds a profile in use leaves the item for the next launch; once it
//! is done, nothing the user changes here is overwritten again.

use std::fs;
use std::path::Path;

/// `%LOCALAPPDATA%\WmpLegacyVisualizers`: the Deno host's folder, and `root`'s parent.
pub fn deno_dir(root: &Path) -> Option<&Path> {
    root.parent()
}

pub fn done(root: &Path, what: &str) -> bool {
    root.join(format!("carried-{what}")).exists()
}

pub fn mark(root: &Path, what: &str, how: &str) {
    log::info!("carry: {what}: {how}");
    let _ = fs::create_dir_all(root);
    let _ = fs::write(root.join(format!("carried-{what}")), how);
}

/// Whether a WebView2 browser has the user-data folder `udf` open: its `EBWebView\lockfile` cannot
/// be opened exclusively (the Deno host's win32.ts `fileBusy`, measured there).
pub fn busy(udf: &Path) -> bool {
    use std::os::windows::fs::OpenOptionsExt;
    let f = udf.join(r"EBWebView\lockfile");
    f.exists()
        && fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&f)
            .is_err()
}

/// The settings are `localStorage` for `https://wmp.localhost`, the origin both hosts serve the page
/// at (main.rs `page`). The Deno host's `WebView2` profile keeps it in `Local Storage`, a LevelDB
/// folder that is neither encrypted nor tied to its profile, so the folder copied into this profile
/// before WebView2 starts is the same settings under the same origin. It replaces what is there: a
/// profile made by a test build, or by a launch while the Deno host held its own.
pub fn settings(root: &Path) {
    const LS: &str = r"EBWebView\Default\Local Storage";
    if done(root, "settings") {
        return;
    }
    let Some(deno) = deno_dir(root) else { return };
    let (from_udf, to_udf) = (deno.join("WebView2"), root.join("WebView2"));
    let (from, to) = (from_udf.join(LS), to_udf.join(LS));
    if !from.is_dir() {
        return mark(root, "settings", "no Deno profile, nothing to carry");
    }
    if busy(&from_udf) || busy(&to_udf) {
        return log::info!("carry: settings: a profile is in use; left for the next launch");
    }
    let _ = fs::remove_dir_all(&to);
    match copy_dir(&from, &to) {
        Ok(n) => mark(
            root,
            "settings",
            &format!("{n} files from {}", from.display()),
        ),
        Err(e) => {
            let _ = fs::remove_dir_all(&to); // no half a database: defaults, and the next launch tries again
            log::warn!("carry: settings: {e}");
        }
    }
}

/// `from` into `to`, recursively, except LevelDB's `LOCK`: that is the lock of whoever opens it.
fn copy_dir(from: &Path, to: &Path) -> std::io::Result<usize> {
    fs::create_dir_all(to)?;
    let mut n = 0;
    for e in fs::read_dir(from)? {
        let e = e?;
        let (src, dst) = (e.path(), to.join(e.file_name()));
        if e.file_type()?.is_dir() {
            n += copy_dir(&src, &dst)?;
        } else if e.file_name() != "LOCK" {
            fs::copy(&src, &dst)?;
            n += 1;
        }
    }
    Ok(n)
}
