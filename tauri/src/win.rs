//! Windows only.

use std::cell::RefCell;
use std::path::PathBuf;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Dwm::{
    DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR, DWMWA_CLOAKED, DWMWA_COLOR_NONE,
    DWMWA_EXTENDED_FRAME_BOUNDS, DWMWA_TRANSITIONS_FORCEDISABLED, DWMWA_WINDOW_CORNER_PREFERENCE,
    DWMWCP_ROUND, DwmGetWindowAttribute, DwmSetWindowAttribute,
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
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    CBT_CREATEWNDW, CREATESTRUCTW, CallNextHookEx, FindWindowExW, GW_HWNDPREV, GWL_EXSTYLE,
    GetClassNameW, GetWindow, GetWindowLongPtrW, GetWindowRect, GetWindowThreadProcessId,
    HCBT_CREATEWND, HHOOK, IsIconic, IsWindow, IsWindowVisible, IsZoomed, MB_ICONERROR, MB_OK,
    MessageBoxW, PostMessageW, SW_HIDE, SWP_NOACTIVATE, SWP_NOZORDER, SWP_SHOWWINDOW, SetWindowPos,
    SetWindowsHookExW, ShowWindow, UnhookWindowsHookEx, WH_CBT, WINDOWPOS, WM_CLOSE, WM_CREATE,
    WM_KEYDOWN, WM_LBUTTONDOWN, WM_MBUTTONDOWN, WM_NCDESTROY, WM_RBUTTONDOWN, WM_SYSKEYDOWN,
    WM_WINDOWPOSCHANGING, WS_EX_LAYERED, WS_EX_TRANSPARENT,
};
use windows::core::{BOOL, HSTRING};

/// Everything the host keeps on Windows: the WebView2 profile, the window box, the log.
///
/// Beside the Deno host's files, in `%LOCALAPPDATA%\WmpLegacyVisualizers`, and read from the
/// environment as that host always did rather than through Tauri's path resolver, which asks the
/// shell for the known folder and ignores the variable: a test points `LOCALAPPDATA` at a scratch
/// folder and nothing lands in the real one.
///
/// In a `tauri` folder of its own, because one WebView2 profile cannot be open in two programs at
/// once and a Deno screensaver or WmpSpotify.exe may still run beside this host. The user's settings
/// and Spotify login are copied over from the Deno host's profiles once (`carry.rs`). The folder
/// stays where it is after that host is gone: the Spotify login lives in it, and moving it would
/// log every user out.
///
/// A dev build (`tauri dev`, anything built without Tauri's `custom-protocol` feature) keeps its
/// own, `tauri-dev`, so it never shares a profile, a window box or a log with the installed apps.
pub fn data_root() -> Option<PathBuf> {
    let leaf = if tauri::is_dev() {
        "tauri-dev"
    } else {
        "tauri"
    };
    std::env::var_os("LOCALAPPDATA")
        .map(|d| PathBuf::from(d).join("WmpLegacyVisualizers").join(leaf))
}

fn hwnd(h: isize) -> HWND {
    HWND(h as _)
}

pub fn alive(h: isize) -> bool {
    unsafe { IsWindow(Some(hwnd(h))) }.as_bool()
}

/// Windows 11's frame round the frameless window, in the skin's colours: its rounded corner kept
/// (anti-aliased against whatever is behind it; the page squares its own chrome in this host,
/// host.js, so there is no second curve to leave white crescents — docs/history/deno-webview.md "The
/// player window"), no 1 px border (`DWMWA_COLOR_NONE`: transparent), and the caption colour Luna
/// blue. The caption is the top frame a frameless Tauri window keeps on Windows 11, `dpi / 96` rows
/// (tao `calculate_insets_for_dpi`): measured `#EDF5F9`, two rows at 150 %, a pale line over the
/// XP title bar — the strip the Deno host removed by hand in `WM_NCCALCSIZE`. Painted the title
/// bar's own top colour it is part of the title bar. Windows 10 refuses all three and keeps the
/// square window it always had.
///
/// `top` (0xRRGGBB) instead of the Luna blue while the page draws its own window (host.rs
/// `win_chrome`): the rows are then above the page's own top row, and painted its colour they are
/// part of that.
pub fn chrome(h: isize, top: Option<u32>) {
    let set = |attr, v: u32| unsafe {
        let _ = DwmSetWindowAttribute(hwnd(h), attr, &v as *const u32 as _, 4);
    };
    set(DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND.0 as u32);
    set(DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE);
    // COLORREF is 0x00BBGGRR
    let caption = top.map_or(0x00EB_6314, |c| {
        ((c & 0xFF) << 16) | (c & 0xFF00) | ((c >> 16) & 0xFF)
    });
    set(DWMWA_CAPTION_COLOR, caption);
}

/// `chrome` for this process's window of `class` the moment it exists. The main thread is inside
/// the window builder until WebView2 is up, half a second after the window is on screen, and
/// until then the frame would show Windows' own grey caption rows; this thread is not.
pub fn chrome_when_created(class: &'static str, top: Option<u32>) {
    std::thread::spawn(move || {
        let (pid, class) = (std::process::id(), HSTRING::from(class));
        for _ in 0..2000 {
            let mut after = None;
            while let Ok(h) = unsafe { FindWindowExW(None, after, &class, None) } {
                let mut owner = 0;
                unsafe { GetWindowThreadProcessId(h, Some(&mut owner)) };
                if owner == pid {
                    return chrome(h.0 as isize, top);
                }
                after = Some(h);
            }
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
    });
}

pub fn class_is(h: HWND, name: &str) -> bool {
    let mut buf = [0u16; 64];
    let n = unsafe { GetClassNameW(h, &mut buf) } as usize;
    String::from_utf16_lossy(&buf[..n]) == name
}

/// What `on_create` does to each window of a class.
type Made = (&'static str, Box<dyn Fn(HWND, &mut CREATESTRUCTW)>);

thread_local! {
    static ON_CREATE: RefCell<Option<Made>> = const { RefCell::new(None) };
}

/// While it lives, `f` is given every top-level window of `class` this thread creates, with the box
/// it is about to be created at (its `CREATESTRUCT`, which `f` may change), before the window's
/// first message: a thread-local CBT hook, which is how MFC subclasses its windows. Put round a
/// window builder, which does not return until WebView2 is up, half a second after the window is on
/// screen, so anything done after it is done to a window the user has been looking at. One at a
/// time on a thread.
pub struct OnCreate(HHOOK);

pub fn on_create(
    class: &'static str,
    f: impl Fn(HWND, &mut CREATESTRUCTW) + 'static,
) -> Option<OnCreate> {
    let hook = unsafe { SetWindowsHookExW(WH_CBT, Some(cbt), None, GetCurrentThreadId()) }
        .map_err(|e| log::error!("no window creation hook: {e}"))
        .ok()?;
    ON_CREATE.set(Some((class, Box::new(f))));
    Some(OnCreate(hook))
}

impl Drop for OnCreate {
    fn drop(&mut self) {
        let _ = unsafe { UnhookWindowsHookEx(self.0) };
        ON_CREATE.set(None);
    }
}

unsafe extern "system" fn cbt(code: i32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    if code == HCBT_CREATEWND as i32 {
        let h = HWND(wp.0 as _);
        let cs = unsafe { &mut *(*(lp.0 as *const CBT_CREATEWNDW)).lpcs };
        ON_CREATE.with_borrow(|on| {
            if let Some((class, f)) = on
                && cs.hwndParent.is_invalid()
                && class_is(h, class)
            {
                f(h, cs);
            }
        });
    }
    unsafe { CallNextHookEx(None, code, wp, lp) }
}

/// This module's subclasses: a window being created maximized, and the screensaver.
const HOLD: usize = 0x4d58;
const SAVER: usize = 0x5356;

/// A window being created maximized (from `on_create`) comes up maximized. tao shows a new window
/// at its restored box and maximizes it after, which DWM animated: the restored box first, then a
/// 200 ms zoom to the whole screen. It is kept from showing until it is maximized, and the maximize
/// shows it, over the whole screen from its first frame, and without DWM's opening fade and zoom
/// either (`animate` puts DWM's animations back once it is up); the restored box stays the one it
/// was created at, where the restore button takes it.
pub fn maximized(h: HWND) {
    let _ = unsafe { SetWindowSubclass(h, Some(hold), HOLD, 0) };
}

/// DWM's animations for the window (opening, minimize, maximize), back on after `maximized`.
pub fn animate(h: isize) {
    set_animations(hwnd(h), true);
}

fn set_animations(h: HWND, on: bool) {
    let off = BOOL::from(!on);
    let _ = unsafe {
        DwmSetWindowAttribute(
            h,
            DWMWA_TRANSITIONS_FORCEDISABLED,
            &off as *const BOOL as _,
            4,
        )
    };
}

unsafe extern "system" fn hold(
    h: HWND,
    msg: u32,
    wp: WPARAM,
    lp: LPARAM,
    _: usize,
    _: usize,
) -> LRESULT {
    let done = match msg {
        WM_CREATE => {
            set_animations(h, false); // before tao's handler shows the window
            false
        }
        WM_WINDOWPOSCHANGING => {
            let pos = unsafe { &mut *(lp.0 as *mut WINDOWPOS) };
            let show = pos.flags.contains(SWP_SHOWWINDOW);
            if show && !unsafe { IsZoomed(h) }.as_bool() {
                pos.flags &= !SWP_SHOWWINDOW;
            }
            show && unsafe { IsZoomed(h) }.as_bool()
        }
        WM_NCDESTROY => true,
        _ => false,
    };
    if done {
        let _ = unsafe { RemoveWindowSubclass(h, Some(hold), HOLD) };
    }
    unsafe { DefSubclassProc(h, msg, wp, lp) }
}

/// Round the screensaver's window builder (its window of `class`). The window is created over `bx`
/// (x, y, width, height: the virtual screen in physical pixels), exactly, whatever the monitors'
/// scales: tao creates a window at a position only when it is on some monitor, and the virtual
/// screen's corner is on none when the monitors' tops or lefts do not line up, so it came up at
/// tao's default box on the primary monitor until WebView2 was up. And from its first moment a key
/// or a click ends it (`saver_input`).
pub fn saver(class: &'static str, bx: (i32, i32, u32, u32)) -> Option<OnCreate> {
    on_create(class, move |h, cs| {
        (cs.x, cs.y, cs.cx, cs.cy) = (bx.0, bx.1, bx.2 as i32, bx.3 as i32);
        let _ = unsafe { SetWindowSubclass(h, Some(saver_input), SAVER, 0) };
    })
}

/// In front of tao's window procedure on the screensaver (the Deno host's win32.ts hostProc). Until
/// WebView2 has the focus a key or a click comes here and not to the page, whose own handlers
/// (host.js) do not exist for the first half second; without this the saver ignored the user for as
/// long as that took. Once WebView2 has the focus these stop arriving and the page's handlers take
/// over, mouse travel (which needs the page's grace period) included.
///
/// The window is hidden at once and closed the ordinary way, `WM_CLOSE`: Tauri closes it once the
/// builder has returned, and the process ends with its last window, exit 0, as when the page ends
/// it. `gone` from then on, so Tauri's own show after the builder cannot bring it back.
unsafe extern "system" fn saver_input(
    h: HWND,
    msg: u32,
    wp: WPARAM,
    lp: LPARAM,
    _: usize,
    gone: usize,
) -> LRESULT {
    match msg {
        WM_KEYDOWN | WM_SYSKEYDOWN | WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN => {
            if gone == 0 {
                let what = if matches!(msg, WM_KEYDOWN | WM_SYSKEYDOWN) {
                    "key"
                } else {
                    "click"
                };
                log::info!("saver: exit: {what} before the page");
                unsafe {
                    let _ = SetWindowSubclass(h, Some(saver_input), SAVER, 1);
                    let _ = ShowWindow(h, SW_HIDE);
                    let _ = PostMessageW(Some(h), WM_CLOSE, WPARAM(0), LPARAM(0));
                }
            }
            return LRESULT(0);
        }
        WM_WINDOWPOSCHANGING if gone != 0 => {
            unsafe { (*(lp.0 as *mut WINDOWPOS)).flags &= !SWP_SHOWWINDOW };
        }
        WM_NCDESTROY => {
            let _ = unsafe { RemoveWindowSubclass(h, Some(saver_input), SAVER) };
        }
        _ => {}
    }
    unsafe { DefSubclassProc(h, msg, wp, lp) }
}

/// Move and size in one step, in physical pixels (`host.rs` full).
pub fn place(h: isize, x: i32, y: i32, w: u32, ht: u32) {
    let _ = unsafe {
        SetWindowPos(
            hwnd(h),
            None,
            x,
            y,
            w as i32,
            ht as i32,
            SWP_NOZORDER | SWP_NOACTIVATE,
        )
    };
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

/// Whether nothing of the window can be seen (the Deno host's win32.ts `occluded`): minimized, on
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
