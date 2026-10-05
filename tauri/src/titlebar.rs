//! The XP window of the player and Spotify windows, drawn by the host (Windows only): a strip
//! across the top of the window's own client area and the Luna frame down both sides and along the
//! bottom, painted from the window's first frame, with the web view kept inside them. The strip is
//! the page's `#titlebar` (src/skins/wmp9/components/Chrome.tsx) to the pixel where it can be: the
//! same gradients (read from the skin's stylesheet), the same SVGs (the files the page draws,
//! rasterised by resvg), Tahoma Bold through DirectWrite the way Chromium draws it, and the same
//! layout rounded to device pixels the way Chromium rounds it. The frame is the page's (Root.tsx):
//! `#chrome`'s blue past `#framebody`'s margin, and `#framebody`'s separator line. The page draws
//! neither under this host (`alchemyNativeTitle`, host.js).
//!
//! **Why the client area.** tao keeps `WS_CAPTION` on a frameless window and gives the whole window
//! to the client in `WM_NCCALCSIZE` (bar a DPI-scaled row or two at the top on Windows 11, which DWM
//! paints in `DWMWA_CAPTION_COLOR`, win.rs). DWM composes the non-client area itself, so nothing an
//! application paints there is shown (and `DWMNCRP_DISABLED` brings back Windows 95's sizing frame,
//! docs/history/deno-webview.md). A caption in the client area, answered for in `WM_NCHITTEST`, is
//! Microsoft's own custom-frame recipe, and it keeps what `WS_CAPTION` gives: `HTCAPTION` drags with
//! Aero Snap, double-clicks maximize, right-click and Alt+Space open the system menu, and
//! `HTMAXBUTTON` opens Windows 11's Snap Layouts.
//!
//! **Why the window's own procedure and no child window.** The top-level window has to answer the
//! hit test anyway, and painting its own client area needs no z-order: nothing is drawn over the
//! strip but what is kept out of it. Every web view's container (wry's `WRY_WEBVIEW` child) is put
//! inside the frame whenever anything moves it (`WM_WINDOWPOSCHANGING`), whatever was asked for,
//! and its WebView2 controller is fitted to it there and then: wry sizes the controller to the
//! whole window first, and a move that changes nothing is never followed by `WM_WINDOWPOSCHANGED`
//! (a web view as tall as the window in a container shorter by the strip, its bottom cut off). A
//! live resize repaints the chrome inside the resize (`RDW_UPDATENOW`).
//!
//! **Why a hook.** The builder does not return until WebView2 is up, half a second after the window
//! is on screen, and it pumps messages meanwhile. So the subclass goes on as the window is created —
//! a thread-local CBT hook around the builder (`hook`, win.rs `on_create`), which is how MFC
//! subclasses its windows — and the first `WM_PAINT` is already the title bar.
//!
//! **Why it can step aside.** A skin that is not WMP 9 may draw a window of its own (iTunes 10, its
//! menu row the caption and its own caption buttons: src/skins/itunes/desktop/Chrome.tsx), and the
//! XP strip and frame round it would be two windows in one. `native` takes them away while that
//! skin is up (host.rs `win_chrome`): the strip's height becomes 0, as in full screen, so the same
//! `inner`, `place` and hit test that full screen already goes through give the web view the whole
//! client area and leave every hit to tao. Nothing is lost by it: the sides and the bottom of a
//! frameless window with a shadow are real non-client borders (tao's `WM_NCCALCSIZE` insets, the
//! invisible resize band DWM keeps outside the visible edge), the top rows resize through tao's
//! `HTTOP` and Tauri's own drag-resize child above the web view, and the page's caption drags
//! (`startDragging`, the system's move loop, Aero Snap with it) and maximizes on a double-click.
//! What the page's caption cannot have is what only `WM_NCHITTEST` gives: Snap Layouts on its
//! maximize button and the system menu on a right-click (Alt+Space still opens it).
//!
//! **macOS** has none of this yet: the page draws its title bar there (host.js sets the flag on
//! Windows only). The equivalent is an `NSView` of the same height pinned to the top of the content
//! view (drawn with Core Graphics and Core Text, the SVGs through resvg into a `CGImage`) with the
//! WKWebView's frame below it, and dragging by `-[NSWindow performWindowDragWithEvent:]`, or
//! Tauri's `TitleBarStyle::Overlay` with the traffic lights kept and the strip drawn under them.
//! Snap Layouts, the system menu and `WM_NCHITTEST` have no Mac counterpart.

use resvg::tiny_skia as sk;
use resvg::usvg;
use std::cell::RefCell;
use std::sync::OnceLock;
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::DirectWrite::*;
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::UI::HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    TME_LEAVE, TME_NONCLIENT, TRACKMOUSEEVENT, TrackMouseEvent,
};
use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::*;
use windows::core::w;

/// The window class the strip goes on (main.rs names the player's and the Spotify window's so).
const CLASS: &str = "AlchemyHost";
/// This module's subclass, on the window and on each web view container.
const ID: usize = 0x7442;

// ---- the look: the skin's own sources ----------------------------------------------------------

const SKIN_CSS: &str = include_str!("../../src/skins/wmp9/wmp9.module.css");
const THEME_CSS: &str = include_str!("../../src/ui/theme.css");
const ICON: &str = include_str!("../../src/skins/wmp9/assets/caption-icon.svg");
const GLYPHS: [&str; 3] = [
    include_str!("../../src/skins/wmp9/assets/caption-min.svg"),
    include_str!("../../src/skins/wmp9/assets/caption-max.svg"),
    include_str!("../../src/skins/wmp9/assets/caption-close.svg"),
];
const TITLE: &str = "Windows Media Player";

type Stops = Vec<sk::GradientStop>;

fn hex(s: &str) -> sk::Color {
    let v = u32::from_str_radix(s.trim().trim_start_matches('#'), 16).expect(s);
    sk::Color::from_rgba8((v >> 16) as u8, (v >> 8) as u8, v as u8, 255)
}

/// The stops of the `linear-gradient(180deg, ...)` in the skin's rule for `sel` (wmp9.module.css).
/// A stop without a position is the first (0 %) or the last (100 %), which is all the skin writes.
fn gradient(sel: &str) -> Stops {
    let rule = SKIN_CSS.split_once(&format!("\n{sel} {{")).expect(sel).1;
    let body = rule.split_once("linear-gradient(180deg,").expect(sel).1;
    let items: Vec<&str> = body.split_once(')').expect(sel).0.split(',').collect();
    items
        .iter()
        .enumerate()
        .map(|(i, item)| {
            let mut it = item.split_whitespace();
            let color = hex(it.next().expect(sel));
            let at = it.next().map_or(if i == 0 { 0.0 } else { 1.0 }, |p| {
                p.trim_end_matches('%').parse::<f32>().expect(sel) / 100.0
            });
            sk::GradientStop::new(at, color)
        })
        .collect()
}

/// `--color-<name>` from the skin's tokens (src/ui/theme.css).
fn token(name: &str) -> sk::Color {
    let v = THEME_CSS
        .split_once(&format!("--color-{name}:"))
        .expect(name)
        .1;
    hex(&v.trim_start()[..7])
}

/// `--background-image-<name>` (src/ui/theme.css): a vertical gradient of two colours, top to bottom.
fn two_stops(name: &str) -> [sk::Color; 2] {
    let v = THEME_CSS
        .split_once(&format!(
            "--background-image-{name}: linear-gradient(180deg,"
        ))
        .expect(name)
        .1;
    let c: Vec<sk::Color> = v
        .split_once(')')
        .expect(name)
        .0
        .split(',')
        .map(hex)
        .collect();
    [c[0], c[1]]
}

/// A caption button: minimize, maximize, close, left to right.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Btn {
    Min,
    Max,
    Close,
}
const BTNS: [Btn; 3] = [Btn::Min, Btn::Max, Btn::Close];

struct Look {
    caption: Stops,
    /// per button kind (blue, red) and state (normal, hover)
    face: [[Stops; 2]; 2],
    rim: [sk::Color; 2],
    /// the frame: `#chrome`'s two colours, top and bottom, and `#framebody`'s border
    luna: [sk::Color; 2],
    sep: sk::Color,
    icon: usvg::Tree,
    glyphs: [usvg::Tree; 3],
    text: Option<Text>,
}

// Safety: built once and only read after; the DirectWrite objects are the shared factory's, which
// is free-threaded (DWRITE_FACTORY_TYPE_SHARED), and the trees are plain data.
unsafe impl Send for Look {}
unsafe impl Sync for Look {}

fn look() -> &'static Look {
    static LOOK: OnceLock<Look> = OnceLock::new();
    LOOK.get_or_init(|| {
        let svg = |s: &str| usvg::Tree::from_str(s, &usvg::Options::default()).expect("svg");
        Look {
            caption: gradient(".titlebar"),
            face: [
                [gradient(".wbtn"), gradient(".wbtn:hover")],
                [gradient(".wbtn.x"), gradient(".wbtn.x:hover")],
            ],
            rim: [token("caption-edge"), token("close-edge")],
            luna: two_stops("luna-window"),
            sep: token("luna-sep"),
            icon: svg(ICON),
            glyphs: GLYPHS.map(svg),
            text: Text::new()
                .map_err(|e| log::error!("title bar: no DirectWrite: {e}"))
                .ok(),
        }
    })
}

/// Build the look off the main thread while the window is being made (the first paint then only
/// draws): DirectWrite, the font and the SVGs are a few milliseconds.
fn warm() {
    std::thread::spawn(look);
}

// ---- layout: Chrome.tsx's, in device pixels, rounded as Chromium rounds ------------------------
//
// #titlebar: h-30 pt-0 pr-3 pb-2 pl-7, items centred in the 28 px left above pb-2, gap-6; the icon
// 16x16, the title 13 px Tahoma Bold (leading 1), each button w-21 h-21 with a 1 px rim, rounded-sm
// (3 px), and its 11x11 glyph centred. Chromium lays out in device pixels (the page's lengths times
// the scale) and snaps each painted box's edges to the nearest pixel.

/// Chromium's `LayoutUnit::Round`: to the nearest pixel, halves up.
fn px(v: f32) -> i32 {
    (v + 0.5).floor() as i32
}

/// The strip's height at `s` (the scale, dpi / 96).
fn bar_height(s: f32) -> i32 {
    px(30.0 * s)
}

/// The frame at `s`: the blue (`#framebody`'s 4 px margin, rounded) and the separator inside it (its
/// 1 px border, which Blink snaps down to whole device pixels).
fn frame_widths(s: f32) -> (i32, i32) {
    (px(4.0 * s), s.floor().max(1.0) as i32)
}

/// Each button's box (left, top, right, bottom), snapped, and its unsnapped left edge.
fn buttons(w: i32, s: f32) -> [(i32, i32, i32, i32, f32); 3] {
    let (top, bottom) = (px(3.5 * s), px(24.5 * s));
    let mut right = w as f32 - 3.0 * s;
    let mut out = [(0, 0, 0, 0, 0.0); 3];
    for i in (0..3).rev() {
        let left = right - 21.0 * s;
        out[i] = (px(left), top, px(right), bottom, left);
        right = left - 6.0 * s;
    }
    out
}

// ---- the title: DirectWrite, as Skia uses it inside Chromium -----------------------------------

struct Text {
    factory: IDWriteFactory2,
    face: IDWriteFontFace,
    glyphs: Vec<u16>,
    /// design units
    advances: Vec<f32>,
    metrics: DWRITE_FONT_METRICS,
}

impl Text {
    /// Tahoma Bold, else the rest of the skin's stack (`--font-xp`).
    fn new() -> windows::core::Result<Self> {
        unsafe {
            let factory: IDWriteFactory2 = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED)?;
            let mut fonts = None;
            factory.GetSystemFontCollection(&mut fonts, false)?;
            let fonts = fonts.ok_or_else(windows::core::Error::empty)?;
            let mut family = None;
            for name in [w!("Tahoma"), w!("Segoe UI"), w!("Verdana")] {
                let (mut i, mut found) = (0, Default::default());
                fonts.FindFamilyName(name, &mut i, &mut found)?;
                if found.as_bool() {
                    family = Some(fonts.GetFontFamily(i)?);
                    break;
                }
            }
            let family = family.ok_or_else(windows::core::Error::empty)?;
            let font = family.GetFirstMatchingFont(
                DWRITE_FONT_WEIGHT_BOLD,
                DWRITE_FONT_STRETCH_NORMAL,
                DWRITE_FONT_STYLE_NORMAL,
            )?;
            let face = font.CreateFontFace()?;
            let points: Vec<u32> = TITLE.chars().map(u32::from).collect();
            let mut glyphs = vec![0u16; points.len()];
            face.GetGlyphIndices(points.as_ptr(), points.len() as u32, glyphs.as_mut_ptr())?;
            let mut gm = vec![DWRITE_GLYPH_METRICS::default(); glyphs.len()];
            face.GetDesignGlyphMetrics(
                glyphs.as_ptr(),
                glyphs.len() as u32,
                gm.as_mut_ptr(),
                false,
            )?;
            let mut metrics = DWRITE_FONT_METRICS::default();
            face.GetMetrics(&mut metrics);
            // The title has no kerning pairs in Tahoma Bold (HarfBuzz, as Chromium shapes it, gives
            // the plain advances), so the advances are the font's own.
            let advances = gm.iter().map(|m| m.advanceWidth as f32).collect();
            Ok(Self {
                factory,
                face,
                glyphs,
                advances,
                metrics,
            })
        }
    }

    /// The glyphs' coverage with the baseline at (x, y): per pixel R, G, B (ClearType) or one value
    /// (grayscale), and where it lies.
    fn coverage(&self, size: f32, xs: &[f32], y: f32, clear: bool) -> Option<(RECT, Vec<u8>)> {
        let advances: Vec<f32> = xs.windows(2).map(|p| p[1] - p[0]).chain([0.0]).collect();
        let run = DWRITE_GLYPH_RUN {
            fontFace: std::mem::ManuallyDrop::new(Some(self.face.clone())),
            fontEmSize: size,
            glyphCount: self.glyphs.len() as u32,
            glyphIndices: self.glyphs.as_ptr(),
            glyphAdvances: advances.as_ptr(),
            ..Default::default()
        };
        // Skia's choice for a font with a version 1 gasp table: symmetric smoothing where the table
        // asks for it, which Tahoma's does above 16 px, else natural.
        let mode = if size.round() > 16.0 {
            DWRITE_RENDERING_MODE_NATURAL_SYMMETRIC
        } else {
            DWRITE_RENDERING_MODE_NATURAL
        };
        let (aa, kind, bpp) = if clear {
            (
                DWRITE_TEXT_ANTIALIAS_MODE_CLEARTYPE,
                DWRITE_TEXTURE_CLEARTYPE_3x1,
                3,
            )
        } else {
            (
                DWRITE_TEXT_ANTIALIAS_MODE_GRAYSCALE,
                DWRITE_TEXTURE_ALIASED_1x1,
                1,
            )
        };
        let r = unsafe {
            let a = self.factory.CreateGlyphRunAnalysis(
                &run,
                None,
                mode,
                DWRITE_MEASURING_MODE_NATURAL,
                DWRITE_GRID_FIT_MODE_ENABLED,
                aa,
                xs[0],
                y,
            );
            std::mem::ManuallyDrop::into_inner(run.fontFace);
            let a = a.ok()?;
            let r = a.GetAlphaTextureBounds(kind).ok()?;
            let n = ((r.right - r.left) * (r.bottom - r.top)) as usize * bpp;
            let mut buf = vec![0u8; n];
            if n > 0 {
                a.CreateAlphaTexture(kind, &r, &mut buf).ok()?;
            }
            (r, buf)
        };
        Some(r)
    }

    /// The title and its shadow (`text-shadow: 1px 1px 1px rgba(0,0,0,.45)`) onto `pm` at scale `s`.
    fn draw(&self, pm: &mut sk::Pixmap, s: f32) {
        let m = &self.metrics;
        let size = 13.0 * s;
        let em = size / m.designUnitsPerEm as f32;
        // The span's line box is 13 px tall (leading 1), centred in the 28 px: its top at 7.5 px.
        // Blink rounds the font's ascent and descent and, with subpixel text positioning (on at
        // every scale here), takes a pixel from the ascent when the descent rounded down
        // (FontMetrics::AscentDescentWithHacks); the leading splits what is left, halved toward
        // zero; the baseline lands on a whole row from the line box's floored top. Glyph origins
        // are a quarter pixel apart. (Each rule measured against Edge at 100 to 200 %.)
        let (mut asc, mut desc) = (
            (m.ascent as f32 * em).round(),
            (m.descent as f32 * em).round(),
        );
        if desc < m.descent as f32 * em && asc >= 1.0 {
            (asc, desc) = (asc - 1.0, desc + 1.0);
        }
        let lead = ((size - asc - desc) * 32.0).trunc() / 64.0;
        let baseline = ((7.5 * s).floor() + lead + asc).round();
        let mut x = 29.0 * s;
        let xs: Vec<f32> = self
            .advances
            .iter()
            .map(|a| {
                let at = (x * 4.0).round() / 4.0;
                x += a * em;
                at
            })
            .collect();

        // The span clips its text (`truncate` is overflow: hidden): the descender of the y and the
        // shadow stop at the line box's bottom.
        let rows = px(7.5 * s)..px(20.5 * s);

        // The shadow: grayscale coverage one CSS pixel right and (to the whole row) down, blurred
        // (Blink's sigma is half the blur radius), 45 % black.
        let off: Vec<f32> = xs.iter().map(|x| x + s).collect();
        if let Some((r, cov)) = self.coverage(size, &off, (baseline + s).round(), false) {
            let (mask, mr) = blur(&cov, r, 0.5 * s);
            composite(pm, mr, rows.clone(), |i, _| mask[i] * 0.45, |_| 0.0);
        }
        // The title: ClearType, white.
        if let Some((r, cov)) = self.coverage(size, &xs, baseline, true) {
            composite(pm, r, rows, |i, c| lut(cov[i * 3 + c]), |_| 1.0);
        }
    }
}

/// Coverage as Skia's gamma tables give it for white text with its default (sRGB) luminance: the
/// linear coverage, sRGB-encoded. (Measured against Edge: closer than any power law, 1.2 to 3.5,
/// and than the system's DirectWrite gamma, 1.8 here.)
fn lut(c: u8) -> f32 {
    let v = c as f32 / 255.0;
    if v <= 0.003_130_8 {
        12.92 * v
    } else {
        1.055 * v.powf(1.0 / 2.4) - 0.055
    }
}

/// `cov` (one byte a pixel over `r`) blurred by a Gaussian of `sigma`: coverage 0..1 and its box.
fn blur(cov: &[u8], r: RECT, sigma: f32) -> (Vec<f32>, RECT) {
    let pad = (3.0 * sigma).ceil() as usize;
    let (w, h) = ((r.right - r.left) as usize, (r.bottom - r.top) as usize);
    let (bw, bh) = (w + 2 * pad, h + 2 * pad);
    let k: Vec<f32> = (0..=2 * pad)
        .map(|i| (-((i as f32 - pad as f32).powi(2)) / (2.0 * sigma * sigma)).exp())
        .collect();
    let sum: f32 = k.iter().sum();
    let mut a = vec![0f32; bw * bh];
    for y in 0..h {
        for x in 0..w {
            a[(y + pad) * bw + x + pad] = cov[y * w + x] as f32 / 255.0;
        }
    }
    // separable: along rows into b, then along columns back into a
    let mut b = vec![0f32; bw * bh];
    for y in 0..bh {
        for x in pad..bw - pad {
            b[y * bw + x] = (0..=2 * pad)
                .map(|i| k[i] * a[y * bw + x + i - pad])
                .sum::<f32>()
                / sum;
        }
    }
    for y in pad..bh - pad {
        for x in 0..bw {
            a[y * bw + x] = (0..=2 * pad)
                .map(|i| k[i] * b[(y + i - pad) * bw + x])
                .sum::<f32>()
                / sum;
        }
    }
    let p = pad as i32;
    (
        a,
        RECT {
            left: r.left - p,
            top: r.top - p,
            right: r.right + p,
            bottom: r.bottom + p,
        },
    )
}

/// Blend a colour onto `pm` over `r` (within `rows`): per pixel `i` (row-major over `r`) and
/// channel `c`, the coverage `a(i, c)` of the colour `v(c)` (0..1).
fn composite(
    pm: &mut sk::Pixmap,
    r: RECT,
    rows: std::ops::Range<i32>,
    a: impl Fn(usize, usize) -> f32,
    v: impl Fn(usize) -> f32,
) {
    let (pw, ph) = (pm.width() as i32, pm.height() as i32);
    let w = r.right - r.left;
    let data = pm.data_mut();
    for y in r.top.max(rows.start).max(0)..r.bottom.min(rows.end).min(ph) {
        for x in r.left.max(0)..r.right.min(pw) {
            let i = ((y - r.top) * w + (x - r.left)) as usize;
            let p = ((y * pw + x) * 4) as usize;
            for c in 0..3 {
                let (d, k) = (data[p + c] as f32, a(i, c));
                data[p + c] = (d + (v(c) * 255.0 - d) * k).round().clamp(0.0, 255.0) as u8;
            }
        }
    }
}

// ---- painting ----------------------------------------------------------------------------------

/// A rounded rectangle (Skia's circular corners, as cubics).
fn rrect(l: f32, t: f32, r: f32, b: f32, rad: f32) -> Option<sk::Path> {
    let c = rad * (1.0 - 0.552_284_8);
    let mut p = sk::PathBuilder::new();
    p.move_to(l + rad, t);
    p.line_to(r - rad, t);
    p.cubic_to(r - c, t, r, t + c, r, t + rad);
    p.line_to(r, b - rad);
    p.cubic_to(r, b - c, r - c, b, r - rad, b);
    p.line_to(l + rad, b);
    p.cubic_to(l + c, b, l, b - c, l, b - rad);
    p.line_to(l, t + rad);
    p.cubic_to(l, t + c, l + c, t, l + rad, t);
    p.close();
    p.finish()
}

/// A vertical gradient from `t` to `b`, as a paint.
fn vertical(stops: &Stops, t: f32, b: f32) -> sk::Paint<'static> {
    let shader = sk::LinearGradient::new(
        sk::Point::from_xy(0.0, t),
        sk::Point::from_xy(0.0, b),
        stops.clone(),
        sk::SpreadMode::Pad,
        sk::Transform::identity(),
    );
    sk::Paint {
        shader: shader.unwrap_or(sk::Shader::SolidColor(sk::Color::BLACK)),
        anti_alias: true,
        ..Default::default()
    }
}

fn solid(c: sk::Color) -> sk::Paint<'static> {
    let mut p = sk::Paint::default();
    p.set_color(c);
    p.anti_alias = true;
    p
}

fn svg(pm: &mut sk::Pixmap, tree: &usvg::Tree, x: f32, y: f32, scale: f32) {
    let t = sk::Transform::from_row(scale, 0.0, 0.0, scale, x, y);
    resvg::render(tree, t, &mut pm.as_mut());
}

/// A button's state: normal, hover, or pressed (the page has no pressed look; XP's caption buttons
/// darken, so this is the normal face at 85 % brightness, as `filter: brightness(.85)` would give).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum State {
    Normal,
    Hot,
    Down,
}

fn button(
    pm: &mut sk::Pixmap,
    look: &Look,
    k: usize,
    b: (i32, i32, i32, i32, f32),
    s: f32,
    st: State,
) {
    let (l, t, r, bot) = (b.0 as f32, b.1 as f32, b.2 as f32, b.3 as f32);
    let red = (k == 2) as usize;
    let bw = s.floor().max(1.0); // Blink snaps border widths down to whole device pixels
    let rad = 3.0 * s;
    let (Some(outer), Some(inner)) = (
        rrect(l, t, r, bot, rad),
        rrect(l + bw, t + bw, r - bw, bot - bw, (rad - bw).max(0.0)),
    ) else {
        return;
    };
    let id = sk::Transform::identity();
    // the face, its gradient over the padding box (background-origin), painted to the rim
    let face = &look.face[red][(st == State::Hot) as usize];
    pm.fill_path(
        &outer,
        &vertical(face, t + bw, bot - bw),
        sk::FillRule::Winding,
        id,
        None,
    );
    if st == State::Down {
        pm.fill_path(
            &outer,
            &solid(sk::Color::from_rgba8(0, 0, 0, 38)),
            sk::FillRule::Winding,
            id,
            None,
        );
    }
    // the inset highlights: inset 1px 1px 0 rgba(255,255,255,.55), inset -1px -1px 0 rgba(0,0,0,.22),
    // each the padding box less itself moved by the offset
    let Some(mut clip) = sk::Mask::new(pm.width(), pm.height()) else {
        return;
    };
    clip.fill_path(&inner, sk::FillRule::Winding, true, id);
    for (d, c) in [
        (s, sk::Color::from_rgba8(255, 255, 255, 140)),
        (-s, sk::Color::from_rgba8(0, 0, 0, 56)),
    ] {
        let mut pb = sk::PathBuilder::new();
        pb.push_path(&inner);
        if let Some(hole) = rrect(
            l + bw + d,
            t + bw + d,
            r - bw + d,
            bot - bw + d,
            (rad - bw).max(0.0),
        ) {
            pb.push_path(&hole);
        }
        if let Some(band) = pb.finish() {
            pm.fill_path(&band, &solid(c), sk::FillRule::EvenOdd, id, Some(&clip));
        }
    }
    // the rim
    let mut pb = sk::PathBuilder::new();
    pb.push_path(&outer);
    pb.push_path(&inner);
    if let Some(ring) = pb.finish() {
        pm.fill_path(
            &ring,
            &solid(look.rim[red]),
            sk::FillRule::EvenOdd,
            id,
            None,
        );
    }
    // the glyph, centred: 5 px in from the (unsnapped) box on both axes
    svg(
        pm,
        &look.glyphs[k],
        px(b.4 + 5.0 * s) as f32,
        px(8.5 * s) as f32,
        s,
    );
}

/// The strip, `w` device pixels wide at `dpi`, as RGBA (opaque).
fn paint(w: i32, dpi: u32, hot: Option<Btn>, down: Option<Btn>) -> Option<sk::Pixmap> {
    let look = look();
    let s = dpi as f32 / 96.0;
    let h = bar_height(s);
    let mut pm = sk::Pixmap::new(w.max(1) as u32, h.max(1) as u32)?;
    let all = sk::Rect::from_xywh(0.0, 0.0, w as f32, h as f32)?;
    pm.fill_rect(
        all,
        &vertical(&look.caption, 0.0, h as f32),
        sk::Transform::identity(),
        None,
    );
    svg(
        &mut pm,
        &look.icon,
        px(7.0 * s) as f32,
        px(6.0 * s) as f32,
        s,
    );
    if let Some(t) = &look.text {
        t.draw(&mut pm, s);
    }
    for (k, b) in buttons(w, s).into_iter().enumerate() {
        let st = match (hot == Some(BTNS[k]), down == Some(BTNS[k])) {
            (true, true) => State::Down,
            (true, false) => State::Hot,
            _ => State::Normal,
        };
        button(&mut pm, look, k, b, s, st);
    }
    Some(pm)
}

/// The strip as the tests (and an offline renderer) see it: RGBA, `w` wide.
#[cfg_attr(not(test), allow(dead_code))]
pub fn render(
    w: i32,
    dpi: u32,
    hot: Option<Btn>,
    down: Option<Btn>,
) -> Option<(u32, u32, Vec<u8>)> {
    paint(w, dpi, hot, down).map(|p| (p.width(), p.height(), p.data().to_vec()))
}

/// The frame's three bands in a client `w` x `h` under a strip `top` tall: left, right, bottom.
fn bands(w: i32, h: i32, top: i32, s: f32) -> [RECT; 3] {
    let (e, l) = frame_widths(s);
    let side = e + l;
    let r = |left, top, right, bottom| RECT {
        left,
        top,
        right,
        bottom,
    };
    [
        r(0, top, side, h),
        r(w - side, top, w, h),
        r(side, h - side, w - side, h),
    ]
}

/// A pixel of the frame at (x, y), as a DIB's 0x00RRGGBB: `#framebody`'s border where it is, else
/// `#chrome`'s gradient, which spans the whole client height as `#chrome` does (Root.tsx). Rounded
/// to 8 bits as Skia rounds; Chromium's dither of the gradient (a level either way) is not copied.
fn frame_px(look: &Look, w: i32, h: i32, s: f32, x: i32, y: i32) -> u32 {
    let (edge, line) = frame_widths(s);
    let side = edge + line;
    let sep = if y >= h - side {
        y < h - edge && (edge..w - edge).contains(&x)
    } else {
        (edge..side).contains(&x) || (w - side..w - edge).contains(&x)
    };
    let [a, b] = if sep { [look.sep; 2] } else { look.luna };
    let t = (y as f32 + 0.5) / h as f32;
    let ch = |p: f32, q: f32| ((p + (q - p) * t) * 255.0 + 0.5).floor() as u32;
    ch(a.red(), b.red()) << 16 | ch(a.green(), b.green()) << 8 | ch(a.blue(), b.blue())
}

// ---- the window --------------------------------------------------------------------------------

#[derive(Default)]
struct Strip {
    /// the page draws the window itself (`native`): no strip and no frame
    off: bool,
    hot: Option<Btn>,
    down: Option<Btn>,
    tracking: bool,
    /// the WebView2 controllers in this window, fitted to their containers (`adopt`)
    views: Vec<ICoreWebView2Controller>,
    /// the last strip painted: (width, dpi, hot, down) and its pixels as BGRA
    cache: Option<((i32, u32, Option<Btn>, Option<Btn>), Vec<u8>)>,
}

thread_local! {
    /// The windows with a strip, by HWND.
    static STRIPS: RefCell<Vec<(isize, RefCell<Strip>)>> = const { RefCell::new(Vec::new()) };
}

fn with<T>(h: HWND, f: impl FnOnce(&mut Strip) -> T) -> Option<T> {
    STRIPS.with(|s| {
        let s = s.borrow();
        let (_, st) = s.iter().find(|(k, _)| *k == h.0 as isize)?;
        let mut st = st.try_borrow_mut().ok()?;
        Some(f(&mut st))
    })
}

fn dpi(h: HWND) -> u32 {
    match unsafe { GetDpiForWindow(h) } {
        0 => 96,
        d => d,
    }
}

/// The strip's height in `h` now: none in full screen, where tao drops the frame styles
/// (`WS_OVERLAPPEDWINDOW`) that a frameless window otherwise keeps, and none while the page draws
/// the window (`native`).
fn height(h: HWND) -> i32 {
    let style = unsafe { GetWindowLongW(h, GWL_STYLE) } as u32;
    if style & WS_CAPTION.0 != WS_CAPTION.0 || with(h, |st| st.off) == Some(true) {
        return 0;
    }
    bar_height(dpi(h) as f32 / 96.0)
}

fn client(h: HWND) -> RECT {
    let mut r = RECT::default();
    let _ = unsafe { GetClientRect(h, &mut r) };
    r
}

/// Where the web views go: the client area inside the strip and the frame (all of it in full screen).
fn inner(h: HWND) -> RECT {
    let (c, top) = (client(h), height(h));
    let side = match top {
        0 => 0,
        _ => {
            let (e, l) = frame_widths(dpi(h) as f32 / 96.0);
            e + l
        }
    };
    RECT {
        left: side,
        top,
        right: (c.right - side).max(side + 1),
        bottom: (c.bottom - side).max(top + 1),
    }
}

/// While it lives, every `CLASS` window this thread makes has the strip from its creation on: put
/// it round the window builder. `max`: the window is being created maximized (win.rs `maximized`).
/// `native`: false when its page last drew the window itself (host.rs `own_chrome`), so a window
/// whose skin is iTunes opens without a frame of XP strip before the page takes it away.
pub fn hook(max: bool, native: bool) -> Option<crate::win::OnCreate> {
    warm();
    crate::win::on_create(CLASS, move |h, _| {
        let st = Strip {
            off: !native,
            ..Default::default()
        };
        STRIPS.with(|s| s.borrow_mut().push((h.0 as isize, RefCell::new(st))));
        let _ = unsafe { SetWindowSubclass(h, Some(window), ID, 0) };
        if max {
            crate::win::maximized(h);
        }
    })
}

/// A WebView2 controller whose container lies in `h`: fitted inside the chrome from now on.
pub fn adopt(h: isize, controller: ICoreWebView2Controller) {
    let h = HWND(h as _);
    let mut container = HWND::default();
    let _ = unsafe { controller.ParentWindow(&mut container) };
    if with(h, |st| st.views.push(controller)).is_some() {
        fit(container);
    }
}

/// The XP window round the page in `h`, or none while the page draws its own (host.rs
/// `win_chrome`): the web views refitted to what they now go inside, and the strip and frame
/// painted when they come back. On the main thread, where the strips are.
pub fn native(h: isize, on: bool) {
    let h = HWND(h as _);
    if with(h, |st| std::mem::replace(&mut st.off, !on) == on) == Some(true) {
        place(h);
        repaint(h);
    }
}

/// The WebView2 controllers in `h` (a copy: fitting one sends messages that look them up again).
fn views(h: HWND) -> Vec<ICoreWebView2Controller> {
    with(h, |st| st.views.clone()).unwrap_or_default()
}

/// Every web view in `h` to its place, after what it goes inside changed (size, DPI, full screen).
fn place(h: HWND) {
    for c in views(h) {
        let mut container = HWND::default();
        if unsafe { c.ParentWindow(&mut container) }.is_ok() {
            fit(container);
        }
    }
}

/// A child's box in its parent's client coordinates.
fn placed(child: HWND) -> RECT {
    let mut r = RECT::default();
    unsafe {
        let _ = GetWindowRect(child, &mut r);
        let mut pts = [
            POINT {
                x: r.left,
                y: r.top,
            },
            POINT {
                x: r.right,
                y: r.bottom,
            },
        ];
        MapWindowPoints(None, GetParent(child).ok(), &mut pts);
        RECT {
            left: pts[0].x,
            top: pts[0].y,
            right: pts[1].x,
            bottom: pts[1].y,
        }
    }
}

/// Move a container to where it already is: `container` puts it in its place and fits its view.
fn fit(container: HWND) {
    let r = placed(container);
    let _ = unsafe {
        SetWindowPos(
            container,
            None,
            r.left,
            r.top,
            r.right - r.left,
            r.bottom - r.top,
            SWP_NOZORDER | SWP_NOACTIVATE,
        )
    };
}

fn hit_button(h: HWND, x: i32) -> Option<Btn> {
    let w = client(h).right;
    let s = dpi(h) as f32 / 96.0;
    buttons(w, s)
        .iter()
        .zip(BTNS)
        .find(|(b, _)| (b.0..b.2).contains(&x))
        .map(|(_, k)| k)
}

fn code(b: Btn) -> u32 {
    match b {
        Btn::Min => HTMINBUTTON,
        Btn::Max => HTMAXBUTTON,
        Btn::Close => HTCLOSE,
    }
}

fn from_code(c: usize) -> Option<Btn> {
    BTNS.into_iter().find(|b| code(*b) as usize == c)
}

/// Paint the chrome (everything outside `inner`) now.
fn repaint(h: HWND) {
    let (c, i) = (client(h), inner(h));
    unsafe {
        let all = CreateRectRgn(0, 0, c.right, c.bottom);
        let hole = CreateRectRgn(i.left, i.top, i.right, i.bottom);
        CombineRgn(Some(all), Some(all), Some(hole), RGN_DIFF);
        let _ = RedrawWindow(Some(h), None, Some(all), RDW_INVALIDATE | RDW_UPDATENOW);
        let _ = DeleteObject(hole.into());
        let _ = DeleteObject(all.into());
    }
}

fn set_state(h: HWND, hot: Option<Btn>, down: Option<Btn>) {
    let changed = with(h, |st| {
        let c = (st.hot, st.down) != (hot, down);
        (st.hot, st.down) = (hot, down);
        c
    });
    if changed == Some(true) {
        repaint(h);
    }
}

/// The system menu at the cursor, which a right-click on a native caption gives (DefWindowProc
/// does not for one in the client area; Alt+Space it does), its items as the window's state allows.
fn system_menu(h: HWND, lp: LPARAM) {
    unsafe {
        let m = GetSystemMenu(h, false);
        let zoomed = IsZoomed(h).as_bool();
        for (cmd, on) in [
            (SC_RESTORE, zoomed),
            (SC_MOVE, !zoomed),
            (SC_SIZE, !zoomed),
            (SC_MINIMIZE, true),
            (SC_MAXIMIZE, !zoomed),
            (SC_CLOSE, true),
        ] {
            let _ = EnableMenuItem(
                m,
                cmd,
                MF_BYCOMMAND | if on { MF_ENABLED } else { MF_GRAYED },
            );
        }
        let (x, y) = (
            (lp.0 & 0xFFFF) as i16 as i32,
            ((lp.0 >> 16) & 0xFFFF) as i16 as i32,
        );
        let cmd = TrackPopupMenu(m, TPM_RETURNCMD | TPM_RIGHTBUTTON, x, y, None, h, None);
        if cmd.0 != 0 {
            let _ = PostMessageW(Some(h), WM_SYSCOMMAND, WPARAM(cmd.0 as usize), LPARAM(0));
        }
    }
}

/// 32-bit top-down pixels (BGRA) onto `dc` at (x, y).
fn put(dc: HDC, x: i32, y: i32, w: i32, h: i32, bits: *const std::ffi::c_void) {
    let bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: w,
            biHeight: -h, // top-down
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    unsafe {
        SetDIBitsToDevice(
            dc,
            x,
            y,
            w as u32,
            h as u32,
            0,
            0,
            0,
            h as u32,
            bits,
            &bmi,
            DIB_RGB_COLORS,
        );
    }
}

/// Paint the chrome into `dc`: the strip from the cache (re-rendering what changed), and the frame.
fn blit(h: HWND, dc: HDC) {
    let (c, top, d) = (client(h), height(h), dpi(h));
    let w = c.right;
    if top == 0 || w <= 0 {
        return;
    }
    let (s, lk) = (d as f32 / 96.0, look());
    for r in bands(w, c.bottom, top, s) {
        let px: Vec<u32> = (r.top..r.bottom)
            .flat_map(|y| (r.left..r.right).map(move |x| frame_px(lk, w, c.bottom, s, x, y)))
            .collect();
        if !px.is_empty() {
            put(
                dc,
                r.left,
                r.top,
                r.right - r.left,
                r.bottom - r.top,
                px.as_ptr() as _,
            );
        }
    }
    with(h, |st| {
        let key = (w, d, st.hot, st.down);
        if st.cache.as_ref().is_none_or(|(k, _)| *k != key) {
            let Some(pm) = paint(w, d, st.hot, st.down) else {
                return;
            };
            let mut bgra = pm.take();
            for p in bgra.chunks_exact_mut(4) {
                p.swap(0, 2);
            }
            st.cache = Some((key, bgra));
        }
        let bits = &st.cache.as_ref().expect("cache").1;
        put(dc, 0, 0, w, top, bits.as_ptr() as _);
    });
}

unsafe extern "system" fn window(
    h: HWND,
    msg: u32,
    wp: WPARAM,
    lp: LPARAM,
    _: usize,
    _: usize,
) -> LRESULT {
    let def = || unsafe { DefSubclassProc(h, msg, wp, lp) };
    match msg {
        WM_NCHITTEST => {
            let top = height(h);
            let mut p = POINT {
                x: (lp.0 & 0xFFFF) as i16 as i32,
                y: ((lp.0 >> 16) & 0xFFFF) as i16 as i32,
            };
            let _ = unsafe { ScreenToClient(h, &mut p) };
            let c = client(h);
            if top == 0 || p.y < 0 || p.y >= c.bottom || p.x < 0 || p.x >= c.right {
                return def();
            }
            if p.y >= top {
                // the frame sizes the window, as XP's did (not maximized, nor when it cannot)
                let i = inner(h);
                let (l, r, b) = (p.x < i.left, p.x >= i.right, p.y >= i.bottom);
                let style = unsafe { GetWindowLongW(h, GWL_STYLE) } as u32;
                if !(l || r || b)
                    || style & WS_THICKFRAME.0 == 0
                    || unsafe { IsZoomed(h) }.as_bool()
                {
                    return def();
                }
                let ht = match (l, r, b) {
                    (true, _, true) => HTBOTTOMLEFT,
                    (_, true, true) => HTBOTTOMRIGHT,
                    (true, _, _) => HTLEFT,
                    (_, true, _) => HTRIGHT,
                    _ => HTBOTTOM,
                };
                return LRESULT(ht as isize);
            }
            // the top edge resizes (tao answers HTTOP there) unless maximized
            let edge = unsafe { GetSystemMetricsForDpi(SM_CYFRAME, dpi(h)) };
            if p.y < edge && !unsafe { IsZoomed(h) }.as_bool() {
                return def();
            }
            let ht = hit_button(h, p.x).map_or(HTCAPTION, code);
            LRESULT(ht as isize)
        }
        WM_NCMOUSEMOVE => {
            let hot = from_code(wp.0);
            if with(h, |st| std::mem::replace(&mut st.tracking, true)) == Some(false) {
                let mut t = TRACKMOUSEEVENT {
                    cbSize: size_of::<TRACKMOUSEEVENT>() as u32,
                    dwFlags: TME_LEAVE | TME_NONCLIENT,
                    hwndTrack: h,
                    dwHoverTime: 0,
                };
                let _ = unsafe { TrackMouseEvent(&mut t) };
            }
            let down = with(h, |st| st.down).flatten();
            set_state(h, hot, down);
            def() // Snap Layouts watches the maximize button's hover
        }
        WM_NCMOUSELEAVE => {
            with(h, |st| st.tracking = false);
            set_state(h, None, None);
            def()
        }
        WM_NCLBUTTONDOWN | WM_NCLBUTTONDBLCLK if from_code(wp.0).is_some() => {
            set_state(h, from_code(wp.0), from_code(wp.0));
            LRESULT(0)
        }
        WM_NCLBUTTONUP => {
            // a button acts when released on the one pressed; released anywhere, none is pressed
            let b = from_code(wp.0);
            let pressed = with(h, |st| st.down).flatten();
            set_state(h, b, None);
            let Some(b) = b else { return def() };
            if pressed == Some(b) {
                let cmd = match b {
                    Btn::Min => SC_MINIMIZE,
                    Btn::Max if unsafe { IsZoomed(h) }.as_bool() => SC_RESTORE,
                    Btn::Max => SC_MAXIMIZE,
                    Btn::Close => SC_CLOSE,
                };
                let _ = unsafe {
                    PostMessageW(Some(h), WM_SYSCOMMAND, WPARAM(cmd as usize), LPARAM(0))
                };
            }
            LRESULT(0)
        }
        WM_NCRBUTTONUP if wp.0 == HTCAPTION as usize => {
            system_menu(h, lp);
            LRESULT(0)
        }
        WM_ERASEBKGND => {
            // tao fills the client area with the window's colour; only inside the chrome
            let dc = HDC(wp.0 as _);
            let i = inner(h);
            unsafe {
                SaveDC(dc);
                IntersectClipRect(dc, i.left, i.top, i.right, i.bottom);
                let r = def();
                let _ = RestoreDC(dc, -1);
                r
            }
        }
        WM_PAINT => {
            let mut ps = PAINTSTRUCT::default();
            let dc = unsafe { BeginPaint(h, &mut ps) };
            blit(h, dc);
            let _ = unsafe { EndPaint(h, &ps) };
            def() // tao's RedrawRequested; nothing is left to paint
        }
        WM_SIZE => {
            let r = def();
            if wp.0 != SIZE_MINIMIZED as usize {
                place(h);
            }
            repaint(h); // inside the live resize, not a frame after it
            r
        }
        // what the web views go inside can change with no WM_SIZE: the strip's height, the frame
        WM_DPICHANGED | WM_STYLECHANGED => {
            let r = def();
            place(h);
            r
        }
        WM_PARENTNOTIFY if (wp.0 & 0xFFFF) as u32 == WM_CREATE => {
            let child = HWND(lp.0 as _);
            // wry's container for each web view (its window class, wry webview2/mod.rs)
            if crate::win::class_is(child, "WRY_WEBVIEW")
                && unsafe { GetParent(child) }.ok() == Some(h)
            {
                let _ = unsafe { SetWindowSubclass(child, Some(container), ID, h.0 as usize) };
                fit(child);
            }
            def()
        }
        WM_NCDESTROY => {
            let _ = unsafe { RemoveWindowSubclass(h, Some(window), ID) };
            let gone = STRIPS.with(|s| {
                let mut s = s.borrow_mut();
                s.iter()
                    .position(|(k, _)| *k == h.0 as isize)
                    .map(|i| s.remove(i))
            });
            drop(gone);
            def()
        }
        _ => def(),
    }
}

/// A web view's container: exactly inside the chrome whatever it is asked, and its controller the
/// container's size.
unsafe extern "system" fn container(
    h: HWND,
    msg: u32,
    wp: WPARAM,
    lp: LPARAM,
    _: usize,
    parent: usize,
) -> LRESULT {
    let parent = HWND(parent as _);
    match msg {
        WM_WINDOWPOSCHANGING => {
            let p = unsafe { &mut *(lp.0 as *mut WINDOWPOS) };
            let now = placed(h);
            let (x, y) = match p.flags.0 & SWP_NOMOVE.0 {
                0 => (p.x, p.y),
                _ => (now.left, now.top),
            };
            let (cx, cy) = match p.flags.0 & SWP_NOSIZE.0 {
                0 => (p.cx, p.cy),
                _ => (now.right - now.left, now.bottom - now.top),
            };
            // Spotify's view parks 1x1 at -1,-1, out of the window: left there. Minimized, the
            // window has no inside.
            if x + cx > 0 && y + cy > 0 && !unsafe { IsIconic(parent) }.as_bool() {
                let r = inner(parent);
                let size = RECT {
                    left: 0,
                    top: 0,
                    right: r.right - r.left,
                    bottom: r.bottom - r.top,
                };
                (p.x, p.y, p.cx, p.cy) = (r.left, r.top, size.right, size.bottom);
                p.flags = SET_WINDOW_POS_FLAGS(p.flags.0 & !(SWP_NOMOVE.0 | SWP_NOSIZE.0));
                // now: wry has just sized the controller to the whole window, and a move that
                // changes nothing brings no WM_WINDOWPOSCHANGED
                for c in views(parent) {
                    let mut owner = HWND::default();
                    if unsafe { c.ParentWindow(&mut owner) }.is_ok() && owner == h {
                        let _ = unsafe { c.SetBounds(size) };
                    }
                }
            }
        }
        WM_NCDESTROY => {
            let _ = unsafe { RemoveWindowSubclass(h, Some(container), ID) };
        }
        _ => {}
    }
    unsafe { DefSubclassProc(h, msg, wp, lp) }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The skin's rules and the SVGs parse, and the geometry this module copies from Chrome.tsx is
    /// still what Chrome.tsx says: change the page's title bar and this fails until the strip follows.
    #[test]
    fn follows_the_page() {
        for sel in [
            ".titlebar",
            ".wbtn",
            ".wbtn:hover",
            ".wbtn.x",
            ".wbtn.x:hover",
        ] {
            let g = gradient(sel);
            assert!(g.len() >= 2, "{sel}");
        }
        assert_eq!(token("caption-edge"), hex("#0A3E9E"));
        for s in [ICON].iter().chain(GLYPHS.iter()) {
            usvg::Tree::from_str(s, &usvg::Options::default()).unwrap();
        }
        let tsx = include_str!("../../src/skins/wmp9/components/Chrome.tsx");
        for class in [
            "h-30 flex items-center gap-6 pt-0 pr-3 pb-2 pl-7",
            "font-xp font-bold text-13 leading-[1] [text-shadow:1px_1px_1px_rgba(0,0,0,.45)]",
            "w-21 h-21 flex-none p-0 rounded-sm border leading-[0] shadow-[inset_1px_1px_0_rgba(255,255,255,.55),inset_-1px_-1px_0_rgba(0,0,0,.22)]",
            ">Windows Media Player<",
            "border-caption-edge",
            "border-close-edge",
            "caption-icon.svg",
        ] {
            assert!(tsx.contains(class), "Chrome.tsx no longer has {class}");
        }
        assert!(THEME_CSS.contains("--radius-sm: 3px;"));
    }

    /// The frame is still Root.tsx's `#framebody` inside `#chrome`, in theme.css's colours; the
    /// page leaves it to this host (nativetitle), as it leaves the title bar.
    #[test]
    fn frame() {
        let root = include_str!("../../src/skins/wmp9/Root.tsx");
        for class in [
            "absolute inset-0 flex flex-col overflow-hidden rounded-t-win bg-luna-window",
            "mt-0 mx-4 mb-4 border border-t-0 border-luna-sep",
            "nativetitle:m-0 nativetitle:border-0",
        ] {
            assert!(root.contains(class), "Root.tsx no longer has {class}");
        }
        assert!(THEME_CSS.contains(
            "--background-image-luna-window: linear-gradient(180deg, #0058EE, #0046D5);"
        ));
        assert_eq!(two_stops("luna-window"), [hex("#0058EE"), hex("#0046D5")]);
        assert_eq!(token("luna-sep"), hex("#7F90B5"));
        assert_eq!(
            [1.0, 1.25, 1.5, 1.75, 2.0].map(frame_widths),
            [(4, 1), (5, 1), (6, 1), (7, 1), (8, 2)]
        );
        let b = bands(1000, 600, 45, 1.5).map(|r| (r.left, r.top, r.right, r.bottom));
        assert_eq!(
            b,
            [(0, 45, 7, 600), (993, 45, 1000, 600), (7, 593, 993, 600)]
        );
        let at = |x, y| frame_px(look(), 1000, 600, 1.5, x, y);
        // the separator on three sides, square at the bottom corners, none along the top
        for (x, y) in [
            (6, 45),
            (6, 593),
            (993, 300),
            (7, 593),
            (500, 593),
            (992, 593),
        ] {
            assert_eq!(at(x, y), 0x7F90B5, "separator at {x},{y}");
        }
        for (x, y) in [(5, 300), (994, 300), (500, 594), (6, 594), (993, 599)] {
            assert_ne!(at(x, y), 0x7F90B5, "blue at {x},{y}");
        }
        // the gradient over the whole client: its first and last rows are the two stops
        assert_eq!((at(0, 0), at(0, 599)), (0x0058EE, 0x0046D5));
        assert_eq!(at(0, 300), at(999, 300));
    }

    /// Chromium's rounding of the layout at the scales Windows offers.
    #[test]
    fn layout() {
        assert_eq!(
            [1.0, 1.25, 1.5, 1.75, 2.0].map(bar_height),
            [30, 38, 45, 53, 60]
        );
        let b = buttons(1500, 1.5);
        assert_eq!((b[2].0, b[2].1, b[2].2, b[2].3), (1464, 5, 1496, 37));
        assert_eq!((b[1].0, b[1].2), (1424, 1455));
    }

    /// The strip renders at every scale: the caption's blue, the title's white, the close rim.
    #[test]
    fn renders() {
        for dpi in [96, 120, 144, 168, 192] {
            let s = dpi as f32 / 96.0;
            let (w, h, px) = render(1000, dpi, None, None).unwrap();
            assert_eq!((w, h), (1000, bar_height(s) as u32));
            let at = |x: f32, y: f32| {
                let i = ((y * s) as usize * w as usize + (x * s) as usize) * 4;
                (px[i], px[i + 1], px[i + 2])
            };
            let (r, _, b) = at(500.0, 15.0);
            assert!(r < 20 && b > 200, "{dpi}: caption {:?}", at(500.0, 15.0));
            let bright = (0..h as usize * w as usize)
                .filter(|i| ((29.0 * s) as usize..(175.0 * s) as usize).contains(&(i % w as usize)))
                .filter(|i| px[i * 4] > 240 && px[i * 4 + 1] > 240 && px[i * 4 + 2] > 240)
                .count();
            assert!(bright > 100, "{dpi}: no title ({bright} white pixels)");
            let c = buttons(1000, s)[2];
            let i = (((c.1 + c.3) / 2) as usize * w as usize + c.0 as usize) * 4;
            assert_eq!(
                (px[i], px[i + 1], px[i + 2]),
                (0xA3, 0x2A, 0x06),
                "{dpi}: close rim"
            );
        }
    }
}
