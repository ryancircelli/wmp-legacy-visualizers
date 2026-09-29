//! Windows only.

use std::path::PathBuf;

/// Everything the host keeps on Windows: the WebView2 profile, the window box, the log.
///
/// Beside the Deno host's files, in `%LOCALAPPDATA%\WmpLegacyVisualizers`, and read from the
/// environment as that host always did rather than through Tauri's path resolver, which asks the
/// shell for the known folder and ignores the variable: a test points `LOCALAPPDATA` at a scratch
/// folder and nothing lands in the real one.
///
/// In a `tauri` folder of its own while both hosts exist, because one WebView2 profile cannot be
/// open in two programs at once. The page's origin is already the Deno host's (`main.rs` `page`),
/// so once that host is retired, dropping `tauri` here is the whole settings carry-over: its
/// `WebView2` profile holds the user's settings under the same origin.
pub fn data_root() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join("WmpLegacyVisualizers").join("tauri"))
}
