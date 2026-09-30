//! The XP title bar of the player and Spotify windows, drawn by the host (Windows only): a strip
//! across the top of the window's own client area, painted from the window's first frame, with the
//! web view kept below it. It is the page's `#titlebar` (src/skins/wmp9/components/Chrome.tsx) to
//! the pixel where it can be: the same gradients (read from the skin's stylesheet), the same SVGs
//! (the files the page draws, rasterised by resvg), Tahoma Bold through DirectWrite the way Chromium
//! draws it, and the same layout rounded to device pixels the way Chromium rounds it. The page hides
//! its own title bar under this host (`alchemyNativeTitle`, host.js).
//!
//! **Why the client area.** tao keeps `WS_CAPTION` on a frameless window and gives the whole window
//! to the client in `WM_NCCALCSIZE` (bar a DPI-scaled row or two at the top on Windows 11, which DWM
//! paints in `DWMWA_CAPTION_COLOR`, win.rs). DWM composes the non-client area itself, so nothing an
//! application paints there is shown (and `DWMNCRP_DISABLED` brings back Windows 95's sizing frame,
//! deno-webview/README.md). A caption in the client area, answered for in `WM_NCHITTEST`, is
//! Microsoft's own custom-frame recipe, and it keeps what `WS_CAPTION` gives: `HTCAPTION` drags with
//! Aero Snap, double-clicks maximize, right-click and Alt+Space open the system menu, and
//! `HTMAXBUTTON` opens Windows 11's Snap Layouts.
//!
//! **Why the window's own procedure and no child window.** The top-level window has to answer the
//! hit test anyway, and painting its own client area needs no z-order: nothing is drawn over the
//! strip but what is kept out of it. Every web view's container (wry's `WRY_WEBVIEW` child) is
//! clamped below the strip as it is moved (`WM_WINDOWPOSCHANGING`), so no web view covers it even
//! for the moment between wry's resize and ours, and its WebView2 controller is fitted to what is
//! left (`adopt`). A live resize repaints the strip inside the resize (`RDW_UPDATENOW`).
//!
//! **Why a hook.** The builder does not return until WebView2 is up, half a second after the window
//! is on screen, and it pumps messages meanwhile. So the subclass goes on as the window is created —
//! a thread-local CBT hook around the builder (`hook`, win.rs `on_create`), which is how MFC
//! subclasses its windows — and the first `WM_PAINT` is already the title bar.
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
    let v = u32::from_str_radix(s.trim_start_matches('#'), 16).expect(s);
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

// ---- the window --------------------------------------------------------------------------------

#[derive(Default)]
struct Strip {
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
/// (`WS_OVERLAPPEDWINDOW`) that a frameless window otherwise keeps.
fn height(h: HWND) -> i32 {
    let style = unsafe { GetWindowLongW(h, GWL_STYLE) } as u32;
    if style & WS_CAPTION.0 != WS_CAPTION.0 {
        return 0;
    }
    bar_height(dpi(h) as f32 / 96.0)
}

fn client(h: HWND) -> RECT {
    let mut r = RECT::default();
    let _ = unsafe { GetClientRect(h, &mut r) };
    r
}

/// While it lives, every `CLASS` window this thread makes has the strip from its creation on: put
/// it round the window builder. `max`: the window is being created maximized (win.rs `maximized`).
pub fn hook(max: bool) -> Option<crate::win::OnCreate> {
    warm();
    crate::win::on_create(CLASS, move |h, _| {
        STRIPS.with(|s| s.borrow_mut().push((h.0 as isize, RefCell::default())));
        let _ = unsafe { SetWindowSubclass(h, Some(window), ID, 0) };
        if max {
            crate::win::maximized(h);
        }
    })
}

/// A WebView2 controller whose container lies in `h`: fitted below the strip from now on.
pub fn adopt(h: isize, controller: ICoreWebView2Controller) {
    let h = HWND(h as _);
    let mut container = HWND::default();
    let _ = unsafe { controller.ParentWindow(&mut container) };
    if with(h, |st| st.views.push(controller)).is_some() {
        fit(container);
    }
}

/// Move a container to where it already is: the clamp and the controller's fit follow.
fn fit(container: HWND) {
    unsafe {
        let mut r = RECT::default();
        if GetWindowRect(container, &mut r).is_ok() {
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
            MapWindowPoints(None, GetParent(container).ok(), &mut pts);
            let _ = SetWindowPos(
                container,
                None,
                pts[0].x,
                pts[0].y,
                pts[1].x - pts[0].x,
                pts[1].y - pts[0].y,
                SWP_NOZORDER | SWP_NOACTIVATE,
            );
        }
    }
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

fn repaint(h: HWND) {
    let r = RECT {
        left: 0,
        top: 0,
        right: client(h).right,
        bottom: height(h),
    };
    let _ = unsafe { RedrawWindow(Some(h), Some(&r), None, RDW_INVALIDATE | RDW_UPDATENOW) };
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

/// Paint the strip into `dc` from the cache, re-rendering what changed.
fn blit(h: HWND, dc: HDC) {
    let (w, top, d) = (client(h).right, height(h), dpi(h));
    if top == 0 || w <= 0 {
        return;
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
        let bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -top, // top-down
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
                0,
                0,
                w as u32,
                top as u32,
                0,
                0,
                0,
                top as u32,
                bits.as_ptr() as _,
                &bmi,
                DIB_RGB_COLORS,
            );
        }
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
            if top == 0 || p.y < 0 || p.y >= top || p.x < 0 || p.x >= client(h).right {
                return def();
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
            // tao fills the client area with the window's colour; not the strip's rows
            let dc = HDC(wp.0 as _);
            unsafe {
                SaveDC(dc);
                ExcludeClipRect(dc, 0, 0, client(h).right, height(h));
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
            repaint(h); // inside the live resize, not a frame after it
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

/// A web view's container: never over the strip, and its controller the container's size.
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
            let top = height(parent);
            // only what would show in the strip (Spotify's view parks at -1,-1, 1x1: left there)
            if p.flags.0 & SWP_NOMOVE.0 == 0 && p.y < top && p.y + p.cy > 0 {
                let d = top - p.y;
                p.y = top;
                if p.flags.0 & SWP_NOSIZE.0 == 0 {
                    p.cy = (p.cy - d).max(1);
                }
            }
        }
        WM_WINDOWPOSCHANGED => {
            let r = client(h);
            with(parent, |st| {
                for c in &st.views {
                    let mut owner = HWND::default();
                    if unsafe { c.ParentWindow(&mut owner) }.is_ok() && owner == h {
                        let _ = unsafe { c.SetBounds(r) };
                    }
                }
            });
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
