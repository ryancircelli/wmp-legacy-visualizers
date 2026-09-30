//! Windows only.

use std::path::PathBuf;
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Dwm::{
    DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR, DWMWA_CLOAKED, DWMWA_COLOR_NONE,
    DWMWA_EXTENDED_FRAME_BOUNDS, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
    DwmGetWindowAttribute, DwmSetWindowAttribute,
};
use windows::Win32::Graphics::Gdi::{
    CombineRgn, CreateRectRgn, DeleteObject, MONITOR_DEFAULTTONULL, MonitorFromWindow, NULLREGION,
    RGN_DIFF,
};
use windows::Win32::System::Power::{
    ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED, SetThreadExecutionState,
};
use windows::Win32::System::StationsAndDesktops::{
    CloseDesktop, DESKTOP_CONTROL_FLAGS, DESKTOP_SWITCHDESKTOP, OpenInputDesktop,
};
use windows::Win32::UI::WindowsAndMessaging::{
    FindWindowExW, GW_HWNDPREV, GWL_EXSTYLE, GetWindow, GetWindowLongPtrW, GetWindowRect,
    GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, MB_ICONERROR, MB_OK,
    MessageBoxW, WS_EX_LAYERED, WS_EX_TRANSPARENT,
};
use windows::core::HSTRING;

/// Everything the host keeps on Windows: the WebView2 profile, the window box, the log.
///
/// Beside the Deno host's files, in `%LOCALAPPDATA%\WmpLegacyVisualizers`, and read from the
/// environment as that host always did rather than through Tauri's path resolver, which asks the
/// shell for the known folder and ignores the variable: a test points `LOCALAPPDATA` at a scratch
/// folder and nothing lands in the real one.
///
/// In a `tauri` folder of its own while both hosts exist, because one WebView2 profile cannot be
/// open in two programs at once. The page's origin is already the Deno host's (`main.rs` `page`),
/// so once that host is retired, dropping `tauri` here is the whole settings carry-over: the Deno
/// host's `WebView2` profile holds the user's settings under that same origin.
pub fn data_root() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA")
        .map(|d| PathBuf::from(d).join("WmpLegacyVisualizers").join("tauri"))
}

fn hwnd(h: isize) -> HWND {
    HWND(h as _)
}

pub fn alive(h: isize) -> bool {
    unsafe { IsWindow(Some(hwnd(h))) }.as_bool()
}

/// Windows 11's frame round the frameless window, in the skin's colours: its rounded corner kept
/// (anti-aliased against whatever is behind it; the page squares its own chrome in this host,
/// host.js, so there is no second curve to leave white crescents — deno-webview/README.md "The
/// player window"), no 1 px border (`DWMWA_COLOR_NONE`: transparent), and the caption colour Luna
/// blue. The caption is the top frame a frameless Tauri window keeps on Windows 11, `dpi / 96` rows
/// (tao `calculate_insets_for_dpi`): measured `#EDF5F9`, two rows at 150 %, a pale line over the
/// XP title bar — the strip the Deno host removed by hand in `WM_NCCALCSIZE`. Painted the title
/// bar's own top colour it is part of the title bar. Windows 10 refuses all three and keeps the
/// square window it always had.
pub fn chrome(h: isize) {
    let set = |attr, v: u32| unsafe {
        let _ = DwmSetWindowAttribute(hwnd(h), attr, &v as *const u32 as _, 4);
    };
    set(DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND.0 as u32);
    set(DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE);
    set(DWMWA_CAPTION_COLOR, 0x00EB_6314); // COLORREF 0x00BBGGRR: #1463EB
}

/// `chrome` for this process's window of `class` the moment it exists. The main thread is inside
/// the window builder until WebView2 is up, half a second after the window is on screen, and
/// until then the frame would show Windows' own grey caption rows; this thread is not.
pub fn chrome_when_created(class: &'static str) {
    std::thread::spawn(move || {
        let (pid, class) = (std::process::id(), HSTRING::from(class));
        for _ in 0..2000 {
            let mut after = None;
            while let Ok(h) = unsafe { FindWindowExW(None, after, &class, None) } {
                let mut owner = 0;
                unsafe { GetWindowThreadProcessId(h, Some(&mut owner)) };
                if owner == pid {
                    return chrome(h.0 as isize);
                }
                after = Some(h);
            }
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
    });
}

/// Full-screen visuals keep the machine and the display awake; off hands power back to the plan.
/// Per thread: called from the main thread, which lives as long as the app. Returns the state it
/// replaced (for the log: `0x80000003` there means the display was being kept on).
pub fn keep_awake(on: bool) -> u32 {
    let flags = if on {
        ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED
    } else {
        ES_CONTINUOUS
    };
    unsafe { SetThreadExecutionState(flags) }.0
}

/// A fatal error, where the user can see it (the log has the rest).
pub fn error_box(text: &str, title: &str) {
    unsafe {
        MessageBoxW(
            None,
            &HSTRING::from(text),
            &HSTRING::from(title),
            MB_OK | MB_ICONERROR,
        )
    };
}

fn cloaked(h: HWND) -> bool {
    let mut v = 0u32;
    unsafe { DwmGetWindowAttribute(h, DWMWA_CLOAKED, &mut v as *mut _ as _, 4) }.is_ok() && v != 0
}

/// What of a window is drawn on screen: DWM's frame, without the invisible resize borders that
/// `GetWindowRect` counts (7 px a side on Windows 11, and transparent).
fn frame_bounds(h: HWND) -> Option<RECT> {
    let mut r = RECT::default();
    let size = size_of::<RECT>() as u32;
    unsafe {
        if DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, &mut r as *mut _ as _, size)
            .is_ok()
            || GetWindowRect(h, &mut r).is_ok()
        {
            return Some(r);
        }
    }
    None
}

/// Whether nothing of the window can be seen (deno-webview/win32.ts `occluded`): minimized, on
/// another virtual desktop (cloaked), on no monitor, behind the lock screen (the input desktop is
/// Winlogon's, which we may not open), or every pixel of it under windows above it in the z-order.
/// WebView2 tracks none of this for a window it is embedded in: the page runs its frame loops at
/// full speed for a window nobody can see.
///
/// A window above counts only if it is visible, not minimized or cloaked, and neither layered nor
/// click-through: those can be see-through (the GeForce and Game Bar overlays are full-screen,
/// topmost and transparent), so they are never taken for a cover. Rectangles only: the few corner
/// pixels a rounded window above leaves uncovered are not worth drawing 60 frames a second for.
pub fn occluded(h: isize) -> bool {
    let h = hwnd(h);
    unsafe {
        if IsIconic(h).as_bool()
            || cloaked(h)
            || MonitorFromWindow(h, MONITOR_DEFAULTTONULL).is_invalid()
        {
            return true;
        }
        match OpenInputDesktop(DESKTOP_CONTROL_FLAGS(0), false, DESKTOP_SWITCHDESKTOP) {
            Ok(d) => {
                let _ = CloseDesktop(d);
            }
            Err(_) => return true,
        }
        let Some(own) = frame_bounds(h) else {
            return false;
        };
        let left = CreateRectRgn(own.left, own.top, own.right, own.bottom);
        let mut gone = false;
        let mut w = GetWindow(h, GW_HWNDPREV);
        while let Ok(above) = w {
            if gone || above.is_invalid() {
                break;
            }
            let see_through = GetWindowLongPtrW(above, GWL_EXSTYLE) as u32
                & (WS_EX_LAYERED.0 | WS_EX_TRANSPARENT.0)
                != 0;
            if IsWindowVisible(above).as_bool()
                && !IsIconic(above).as_bool()
                && !cloaked(above)
                && !see_through
            {
                if let Some(r) = frame_bounds(above) {
                    let cover = CreateRectRgn(r.left, r.top, r.right, r.bottom);
                    gone = CombineRgn(Some(left), Some(left), Some(cover), RGN_DIFF) == NULLREGION;
                    let _ = DeleteObject(cover.into());
                }
            }
            w = GetWindow(above, GW_HWNDPREV);
        }
        let _ = DeleteObject(left.into());
        gone
    }
}
