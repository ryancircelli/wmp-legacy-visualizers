// The webview C library has no fullscreen/frameless/topmost API, but it does hand out the
// HWND — so the screensaver window is shaped with four user32 calls instead.
// Opened on first use, not at import: this module is imported by the tests (and type-checked on
// Linux), where there is no user32.dll to open.
let lib: Deno.DynamicLibrary<typeof SYMBOLS> | null = null;
const user32 = () => (lib ??= Deno.dlopen("user32.dll", SYMBOLS)).symbols;

let dwmlib: Deno.DynamicLibrary<typeof DWM_SYMBOLS> | null = null;
const dwmapi = () => (dwmlib ??= Deno.dlopen("dwmapi.dll", DWM_SYMBOLS)).symbols;

let gdilib: Deno.DynamicLibrary<typeof GDI_SYMBOLS> | null = null;
const gdi32 = () => (gdilib ??= Deno.dlopen("gdi32.dll", GDI_SYMBOLS)).symbols;

let shelllib: Deno.DynamicLibrary<typeof SHELL_SYMBOLS> | null = null;
const shell32 = () => (shelllib ??= Deno.dlopen("shell32.dll", SHELL_SYMBOLS)).symbols;

let kernellib: Deno.DynamicLibrary<typeof KERNEL_SYMBOLS> | null = null;
const kernel32 = () => (kernellib ??= Deno.dlopen("kernel32.dll", KERNEL_SYMBOLS)).symbols;

let olelib: Deno.DynamicLibrary<typeof OLE_SYMBOLS> | null = null;
const ole32 = () => (olelib ??= Deno.dlopen("ole32.dll", OLE_SYMBOLS)).symbols;

const OLE_SYMBOLS = {
  CoInitializeEx: { parameters: ["pointer", "u32"], result: "i32" },
} as const;

const KERNEL_SYMBOLS = {
  CreateFileW: {
    parameters: ["buffer", "u32", "u32", "pointer", "u32", "u32", "pointer"],
    result: "pointer",
  },
  GetModuleHandleW: { parameters: ["pointer"], result: "pointer" },
  SetThreadExecutionState: { parameters: ["u32"], result: "u32" },
  OpenProcess: { parameters: ["u32", "i32", "u32"], result: "pointer" },
  QueryFullProcessImageNameW: { parameters: ["pointer", "u32", "buffer", "buffer"], result: "i32" },
  CloseHandle: { parameters: ["pointer"], result: "i32" },
} as const;

const DWM_SYMBOLS = {
  DwmSetWindowAttribute: { parameters: ["pointer", "u32", "buffer", "u32"], result: "i32" },
  DwmGetWindowAttribute: { parameters: ["pointer", "u32", "buffer", "u32"], result: "i32" },
} as const;

const GDI_SYMBOLS = {
  CreateSolidBrush: { parameters: ["u32"], result: "pointer" },
  CreateRectRgn: { parameters: ["i32", "i32", "i32", "i32"], result: "pointer" },
  CombineRgn: { parameters: ["pointer", "pointer", "pointer", "i32"], result: "i32" },
  DeleteObject: { parameters: ["pointer"], result: "i32" },
} as const;

const SYMBOLS = {
  MessageBoxW: { parameters: ["pointer", "buffer", "buffer", "u32"], result: "i32" },
  RegisterClassExW: { parameters: ["buffer"], result: "u32" },
  CreateWindowExW: {
    parameters: [
      "u32", // dwExStyle
      "buffer", // lpClassName
      "buffer", // lpWindowName
      "u32", // dwStyle
      "i32", // X
      "i32", // Y
      "i32", // nWidth
      "i32", // nHeight
      "pointer", // hWndParent
      "pointer", // hMenu
      "pointer", // hInstance
      "pointer", // lpParam
    ],
    result: "pointer",
  },
  DefWindowProcW: { parameters: ["pointer", "u32", "usize", "pointer"], result: "isize" },
  LoadCursorW: { parameters: ["pointer", "usize"], result: "pointer" },
  GetClientRect: { parameters: ["pointer", "buffer"], result: "i32" },
  GetWindow: { parameters: ["pointer", "u32"], result: "pointer" },
  PostQuitMessage: { parameters: ["i32"], result: "void" },
  // The context the library sets for itself inside webview_create; ours has to be set before the
  // window is created, which is now earlier than that.
  SetProcessDpiAwarenessContext: { parameters: ["isize"], result: "i32" },
  SetWindowPos: {
    parameters: ["pointer", "isize", "i32", "i32", "i32", "i32", "u32"],
    result: "i32",
  },
  GetSystemMetrics: { parameters: ["i32"], result: "i32" },
  LoadImageW: {
    parameters: ["pointer", "buffer", "u32", "i32", "i32", "u32"],
    result: "pointer",
  },
  SetForegroundWindow: { parameters: ["pointer"], result: "i32" },
  FindWindowExW: { parameters: ["pointer", "pointer", "buffer", "buffer"], result: "pointer" },
  GetWindowThreadProcessId: { parameters: ["pointer", "buffer"], result: "u32" },
  PostMessageW: { parameters: ["pointer", "u32", "usize", "isize"], result: "i32" },
  IsIconic: { parameters: ["pointer"], result: "i32" },
  ReleaseCapture: { parameters: [], result: "i32" },
  SendMessageW: { parameters: ["pointer", "u32", "usize", "isize"], result: "isize" },
  ShowWindow: { parameters: ["pointer", "i32"], result: "i32" },
  // WM_PAINT sent, not posted: the thread goes straight from showing the window into a second of
  // file I/O and then into webview_create, and posted messages wait for a pump that is not running.
  UpdateWindow: { parameters: ["pointer"], result: "i32" },
  IsZoomed: { parameters: ["pointer"], result: "i32" },
  GetDpiForWindow: { parameters: ["pointer"], result: "u32" },
  GetWindowPlacement: { parameters: ["pointer", "buffer"], result: "i32" },
  GetWindowRect: { parameters: ["pointer", "buffer"], result: "i32" },
  ClientToScreen: { parameters: ["pointer", "buffer"], result: "i32" },
  IsWindowVisible: { parameters: ["pointer"], result: "i32" },
  GetWindowLongPtrW: { parameters: ["pointer", "i32"], result: "isize" },
  MonitorFromWindow: { parameters: ["pointer", "u32"], result: "pointer" },
  OpenInputDesktop: { parameters: ["u32", "i32", "u32"], result: "pointer" },
  CloseDesktop: { parameters: ["pointer"], result: "i32" },
  SetTimer: { parameters: ["pointer", "usize", "u32", "pointer"], result: "usize" },
} as const;

const SHELL_SYMBOLS = {
  SetCurrentProcessExplicitAppUserModelID: { parameters: ["buffer"], result: "i32" },
  SHGetPropertyStoreForWindow: { parameters: ["pointer", "buffer", "buffer"], result: "i32" },
  ExtractIconExW: {
    parameters: ["buffer", "i32", "buffer", "buffer", "u32"],
    result: "u32",
  },
  ShellExecuteW: {
    parameters: ["pointer", "buffer", "buffer", "pointer", "pointer", "i32"],
    result: "pointer",
  },
} as const;

const WS_POPUP = 0x80000000, WS_CLIPCHILDREN = 0x2000000;
const WS_THICKFRAME = 0x40000, WS_MINIMIZEBOX = 0x20000, WS_MAXIMIZEBOX = 0x10000;
const WS_SYSMENU = 0x80000;
const WS_EX_TOPMOST = 0x8, WS_EX_TOOLWINDOW = 0x80; // TOOLWINDOW keeps it off the taskbar
const WS_EX_APPWINDOW = 0x40000; // ... and APPWINDOW keeps a caption-less popup on it
const CS_VREDRAW = 0x1, CS_HREDRAW = 0x2;
const COINIT_APARTMENTTHREADED = 2;
const IDC_ARROW = 32512n;
const HWND_TOPMOST = -1n, HWND_NOTOPMOST = -2n, HWND_TOP = 0n;
const SWP_FRAMECHANGED = 0x20, SWP_NOZORDER = 0x4, SWP_NOACTIVATE = 0x10;
const GW_CHILD = 5;
/** DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, which is a handle and not an enum: (HANDLE)-4. */
const DPI_PER_MONITOR_V2 = -4n;
const SM = { X: 76, Y: 77, CX: 78, CY: 79 }; // SM_*VIRTUALSCREEN
const SM_CXSCREEN = 0, SM_CYSCREEN = 1;
const WM_NCLBUTTONDOWN = 0xA1, HTCAPTION = 2n, HTBOTTOMRIGHT = 17n;
const WM_NCCALCSIZE = 0x83, WM_SIZE = 0x05, WM_DPICHANGED = 0x02E0;
const WM_GETMINMAXINFO = 0x24, WM_CLOSE = 0x10, WM_DESTROY = 0x02;
const WM_ACTIVATE = 0x06, WA_INACTIVE = 0, WM_TIMER = 0x113;
const WM_KEYDOWN = 0x100, WM_SYSKEYDOWN = 0x104;
const WM_LBUTTONDOWN = 0x201, WM_RBUTTONDOWN = 0x204, WM_MBUTTONDOWN = 0x207;
const SIZE_RESTORED = 0, SIZE_MINIMIZED = 1, SIZE_MAXIMIZED = 2;
const WM_SETICON = 0x80, ICON_BIG = 1n, ICON_SMALL = 0n;
const DWMWA_WINDOW_CORNER_PREFERENCE = 33, DWMWA_BORDER_COLOR = 34;
const DWMWCP_ROUND = 2, DWMWA_COLOR_NONE = 0xFFFFFFFE;
const WM_WINDOWPOSCHANGED = 0x47, WM_SHOWWINDOW = 0x18;
const GENERIC_WRITE = 0x40000000, CREATE_ALWAYS = 2, FILE_FLAG_DELETE_ON_CLOSE = 0x04000000;
const INVALID_HANDLE = 0xFFFFFFFFFFFFFFFFn;
const SW_SHOW = 5, SW_MAXIMIZE = 3, SW_MINIMIZE = 6, SW_RESTORE = 9;

/** UTF-16LE and NUL-terminated: what every `W` entry point takes. */
function wstr(s: string): Uint8Array {
  const b = new Uint8Array(s.length * 2 + 2);
  const dv = new DataView(b.buffer);
  for (let i = 0; i < s.length; i++) dv.setUint16(i * 2, s.charCodeAt(i), true);
  return b;
}

/** Another instance's window: our class and this title, with the program its process runs. */
export type HostWindow = { hwnd: Deno.PointerValue; pid: number; exe: string };

/** The program a process runs, as QueryFullProcessImageNameW spells it (compare like with like:
 * Deno.execPath() spelled the same file differently when run from a \\wsl.localhost share). */
export function imagePath(pid: number): string {
  const k = kernel32(), hp = k.OpenProcess(0x1000, 0, pid); // PROCESS_QUERY_LIMITED_INFORMATION
  if (!hp) return "";
  const buf = new Uint16Array(1024), len = new Uint32Array([1024]);
  const ok = k.QueryFullProcessImageNameW(hp, 0, buf, len);
  k.CloseHandle(hp);
  return ok ? String.fromCharCode(...buf.subarray(0, len[0])) : "";
}

/** The other processes' top-level host windows titled `title`. */
export function hostWindows(title: string): HostWindow[] {
  const u = user32(), out: HostWindow[] = [], name = wstr(title), pid = new Uint32Array(1);
  let h: Deno.PointerValue = null;
  while ((h = u.FindWindowExW(null, h, CLASS, name))) {
    u.GetWindowThreadProcessId(h, pid);
    if (pid[0] !== Deno.pid) out.push({ hwnd: h, pid: pid[0]!, exe: imagePath(pid[0]!) });
  }
  return out;
}

/** Asks a window to close, as its own close button would. */
export function closeWindow(hwnd: Deno.PointerValue) {
  user32().PostMessageW(hwnd, 0x0010, 0n, 0n); // WM_CLOSE
}

/** Restores (if minimized) and activates a window. */
export function bringToFront(hwnd: Deno.PointerValue) {
  const u = user32();
  if (u.IsIconic(hwnd)) u.ShowWindow(hwnd, SW_RESTORE);
  u.SetForegroundWindow(hwnd);
}

/** Whether a file is held open without sharing (WebView2's EBWebView\lockfile while its browser
 * runs). A missing file is not busy. */
export function fileBusy(path: string): boolean {
  const k = kernel32(), h = k.CreateFileW(wstr(path), 0x80000000, 0, null, 3, 0, null); // GENERIC_READ, OPEN_EXISTING
  if (h && Deno.UnsafePointer.value(h) !== INVALID_HANDLE) {
    k.CloseHandle(h);
    return false;
  }
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Opens a URL in the user's default browser. */
export function openInBrowser(url: string) {
  shell32().ShellExecuteW(null, wstr("open"), wstr(url), null, null, 1); // SW_SHOWNORMAL
}

/** A modal error box on top of everything: the only way a GUI-subsystem exe can say why it is
 * about to exit, since it has no console for the error to go to. */
export function errorBox(text: string, title: string) {
  user32().MessageBoxW(null, wstr(text), wstr(title), 0x10 | 0x40000); // MB_ICONERROR | MB_TOPMOST
}

/** A handle as a struct field: WNDCLASSEXW holds pointers, not `Deno.PointerValue`s. */
const addr = (p: Deno.PointerValue) => BigInt(Deno.UnsafePointer.value(p));

/** A remembered window box, in real pixels, plus whether it was maximized. */
export type Geom = { x: number; y: number; w: number; h: number; max: boolean };

/** The rectangle covering every monitor, in virtual-screen coordinates. */
export function virtualScreen(): { x: number; y: number; w: number; h: number } {
  const g = user32().GetSystemMetrics;
  return { x: g(SM.X), y: g(SM.Y), w: g(SM.CX), h: g(SM.CY) };
}

/**
 * Frameless, always-on-top, covering the whole virtual screen.
 *
 * One window spanning every monitor rather than one window per monitor: the webview library
 * runs a blocking message pump per instance, so N windows would mean N processes, N WebView2
 * user-data folders and no shared localStorage. A spanning window gets every monitor covered
 * with one process — the visualizer stretches across the desktop instead of repeating.
 * ponytail: spanning window; go to one child process per display only if per-monitor framing
 * is actually wanted.
 */
export function fullscreen(hwnd: Deno.PointerValue) {
  const { x, y, w, h } = virtualScreen();
  // Style and ex-style came from `createHost` — a topmost popup, off the taskbar — so this only
  // places the window, and deliberately does not show it: `showHost()` does that once the page has
  // painted something to show.
  user32().SetWindowPos(hwnd, HWND_TOPMOST, x, y, w, h, SWP_FRAMECHANGED | SWP_NOACTIVATE);
  return { x, y, w, h };
}

/**
 * Stop DWM drawing anything of its own around the window.
 *
 * What is left once `WM_NCCALCSIZE` has given the client the top of the frame is not painted by the
 * window at all — DWM composites it outside the window's own surface, which is why `PrintWindow`
 * cannot see it and only a screen capture can. Two attributes turn it off: square corners instead
 * of Windows 11's rounded ones, which were clipping the page's own top corners away, and no 1 px
 * border, which was a grey line across the top row. DWM's corner is the wrong corner — a different
 * radius, and on all four corners — so the rounding the skin does want is drawn by the page itself
 * and shown through the glass `glass()` makes of the client area.
 *
 * `DWMWA_NCRENDERING_POLICY = DWMNCRP_DISABLED` is deliberately *not* set, though it is the obvious
 * third call. Measured: it makes DWM stop compositing the non-client area, and Windows falls back to
 * painting the sizing border the classic way — #FFFFFF/#E3E3E3/#B4B4B4/#696969, the Windows 95 3D
 * bevel, 10 px of it down the left, right and bottom. It replaces an invisible margin with a visible
 * grey frame, which is the opposite of the point.
 *
 * The left, right and bottom sizing margins stay. DWM composites them away to nothing once the
 * border is gone, they are the only part of the window Windows will still hit-test — the WebView2
 * child covers everything else — and they are what keeps the window resizable by its edges.
 *
 * Both attributes are Windows 11; on anything older `DwmSetWindowAttribute` returns `E_INVALIDARG`
 * and the window keeps the border it would have had anyway, so the result is ignored.
 */
export function noDwmChrome(hwnd: Deno.PointerValue): string {
  const d = dwmapi();
  const buf = new Uint8Array(4);
  const view = new DataView(buf.buffer);
  const back: string[] = [];
  for (
    const [attr, value] of [
      [DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND],
      [DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE],
    ] as const
  ) {
    view.setUint32(0, value, true);
    d.DwmSetWindowAttribute(hwnd, attr, buf, 4);
    // Read it straight back off the live window rather than trusting the setter's HRESULT: a
    // rounded corner with a border on it is what the user reported, and the only way to tell an
    // attribute that was refused from one DWM later put back is to look.
    view.setUint32(0, 0xDEADBEEF, true);
    const hr = d.DwmGetWindowAttribute(hwnd, attr, buf, 4);
    back.push(`${attr}=${hr === 0 ? "0x" + view.getUint32(0, true).toString(16) : "hr" + hr}`);
  }
  return back.join(" ");
}

/**
 * Take `path` for as long as this process lives, or report that somebody else has it.
 *
 * `CreateFileW` with a share mode of 0 is the one exclusive claim Windows makes on the process
 * rather than on a file's contents: while the handle is open no other process can open the same
 * path at all, and when the process exits — cleanly, killed or crashed — the kernel closes the
 * handle and the claim is gone with it. `FILE_FLAG_DELETE_ON_CLOSE` takes the file with it, so
 * there is no such thing as a stale lock to detect or clean up, which is the whole reason this is
 * not `Deno.open({ createNew: true })`: that leaves a file behind on a crash and every later
 * launch then reads it as "somebody else is running".
 *
 * The handle is deliberately never closed and never wrapped: holding it *is* the lock.
 */
const claims: Deno.PointerValue[] = [];
export function claim(path: string): boolean {
  const h = kernel32().CreateFileW(
    wstr(path),
    GENERIC_WRITE,
    0, // no sharing: this is the lock
    null,
    CREATE_ALWAYS,
    FILE_FLAG_DELETE_ON_CLOSE,
    null,
  );
  if (!h || Deno.UnsafePointer.value(h) === INVALID_HANDLE) return false;
  claims.push(h);
  return true;
}

/**
 * Where `WM_NCCALCSIZE` should leave the top of the client rect.
 *
 * `proposed` is the top of the window rect Windows hands in; `computed` is the top of the client
 * rect it would normally hand back, which sits a sizing border below. Restored, the answer is the
 * window's own top edge — those rows belong to the page. Maximized, it is whatever Windows said:
 * a maximized window deliberately overhangs the work area by the border thickness, and that inset
 * is the only thing keeping the page off the taskbar.
 */
export function ncTop(proposed: number, computed: number, maximized: boolean): number {
  return maximized ? computed : proposed;
}

/** Kept for the life of the process. Windows holds a raw pointer to this callback for as long as
 * the window class lives, and a collected `UnsafeCallback` is a crash on the next message. */
const wndProcs: unknown[] = [];

/** The one host window this process has. Module state because there is exactly one: the library
 * runs a blocking message pump per instance, so a second window would be a second process. */
let host: {
  hwnd: Deno.PointerValue;
  shown: boolean;
  /** Open maximized when it is finally shown, because that is how it was left. */
  max: boolean;
  onMaximize?: (maximized: boolean) => void;
} | null = null;

const CLASS = wstr("AlchemyHost");

export type HostOpts = {
  /** An .ico file for the window's icon (Alt+Tab, the taskbar); the exe's own icon when absent or
   * unreadable. Needed whenever the exe is not ours: in dev mode it is deno.exe (a dinosaur). */
  icon?: string;
  /** The process's AppUserModelID: its own taskbar identity and group, instead of the exe's. */
  appId?: string;
  /** What the taskbar and Alt+Tab show: neither window has a native caption to put it in. */
  title: string;
  /** The screensaver window — a topmost popup, off the taskbar, with no sizing border — rather than
   * the player window, which has one and is on the taskbar. */
  saver: boolean;
  /** The smallest client box, in DIPs: what `WEBVIEW_HINT_MIN` used to ask the library for. */
  min: [number, number];
  /** The window was asked to close (its close button, Alt+F4, the taskbar). */
  onClose: () => void;
  /** The window was activated, and has to hand keyboard focus to the WebView2 child. */
  onActivate: () => void;
  /** The window went to or came back from maximized; the page squares its own corners to match. */
  onMaximize?: (maximized: boolean) => void;
  /** The window stopped or started being seen at all (`occluded`); asked four times a second. */
  onOccluded?: (hidden: boolean) => void;
};

/**
 * The single-threaded apartment WebView2 has to be created from, which the C library enters for
 * itself — but only when it owns the window: `CoInitializeEx` sits inside the same
 * `if (owns_window)` as the `CreateWindowExW` it skips for us, on the assumption that a host with
 * its own window is a Win32 application that has already done this. Deno has not, and without it
 * `webview_create` fails by returning null: the environment never comes up. `S_FALSE` (already in
 * one) is as good as `S_OK`, and the apartment is never left — it lives as long as the pump.
 *
 * Its own function rather than a line inside `createHost` only so startup can time it separately;
 * it costs well under a millisecond, and calling it twice is harmless.
 */
export function coInit() {
  const hr = ole32().CoInitializeEx(null, COINIT_APARTMENTTHREADED);
  if (hr < 0) throw new Error(`CoInitializeEx failed: 0x${(hr >>> 0).toString(16)}`);
}

/**
 * Our own window, hidden, already wearing the style it will have a moment later when `showHost()`
 * puts it on screen.
 *
 * This is what removes the white window. `webview_create(debug, window)` takes a window to embed
 * into, and given one the library creates no top-level window of its own — and, the part that
 * actually matters, does not show ours either. Read off the vendored DLL (webview 0.12.0) rather
 * than taken on trust: the constructor stores `window == nullptr` in an `owns_window` byte, and both
 * the `CreateWindowExW` for its own `WS_OVERLAPPEDWINDOW` and the
 * `ShowWindow(SW_SHOW)`/`UpdateWindow`/`SetFocus` that followed it sit behind `if (owns_window)`.
 * The argument is also not the `HWND *` the header's cast implies: the constructor calls
 * `IsWindow(window)` first and only dereferences it when that fails, so a plain HWND is taken as is.
 *
 * Owning the creation is what lets the window be *finished* before it is shown: hidden while it is
 * styled, sized and placed, then shown once, at its final box, by `showHost()` — which main.ts calls
 * as soon as the placement is done and no longer waits for the page for. That replaces
 * `createOffscreen()`, a `WH_CBT` hook that rewrote the library window's `CREATESTRUCT` to park it
 * at -32000,-32000: it moved the white window rather than not creating one, and a window off the
 * side of the screen has still been created, shown and focused before it had anything to show.
 *
 * Owning the class means owning the message handling the library's own window proc used to do for us.
 * Its proc does five things and this one does the same five (`WM_SIZE` -> resize the child widget,
 * `WM_ACTIVATE` -> `MoveFocus` into the WebView2, `WM_CLOSE`, `WM_DESTROY`, `WM_GETMINMAXINFO` ->
 * the minimum size) plus the two it never did: `WM_NCCALCSIZE`, which used to need a subclass
 * (`noTopFrame`), and the DWM re-apply.
 */
export function createHost(o: HostOpts): Deno.PointerValue {
  const u = user32();
  // Per-monitor v2, which webview_create sets for itself — but the window is created before that
  // call now, and a window created while the process is DPI-unaware stays virtualised: every rect
  // comes back divided by the scale factor and `frameless()` sizes it two thirds too small. A
  // context that is already set makes this fail, which is not a failure.
  u.SetProcessDpiAwarenessContext(DPI_PER_MONITOR_V2);
  coInit(); // idempotent: main.ts calls it first so it can be timed on its own
  // Before the window exists: the taskbar reads the identity when the button is created.
  if (o.appId) shell32().SetCurrentProcessExplicitAppUserModelID(wstr(o.appId));
  const proc = hostProc(o);
  wndProcs.push(proc);
  const hInstance = kernel32().GetModuleHandleW(null);
  const cls = new Uint8Array(80); // WNDCLASSEXW, x64
  const dv = new DataView(cls.buffer);
  dv.setUint32(0, 80, true); // cbSize
  dv.setUint32(4, CS_HREDRAW | CS_VREDRAW, true);
  dv.setBigUint64(8, addr(proc.pointer), true); // lpfnWndProc
  dv.setBigUint64(24, addr(hInstance), true);
  // Without a class cursor the window never answers WM_SETCURSOR and the pointer keeps whatever
  // shape it had when it crossed the sizing border.
  dv.setBigUint64(40, addr(u.LoadCursorW(null, IDC_ARROW)), true);
  // The class brush is what DefWindowProc erases with, and `RegisterClass`'s default is white. It
  // reaches the screen wherever the WebView2 child has not painted yet — the first WM_ERASEBKGND
  // after a resize — and white there was the fringe in the page's rounded corners. The page's own
  // colour instead: the title bar's Luna blue in the player, black behind the screensaver's canvas,
  // so an erase the page has not caught up with is the skin rather than a flash of white.
  const bg = o.saver ? 0 : (235 << 16) | (99 << 8) | 20; // COLORREF 0x00BBGGRR
  dv.setBigUint64(48, addr(gdi32().CreateSolidBrush(bg)), true);
  dv.setBigUint64(64, addr(Deno.UnsafePointer.of(CLASS)), true); // lpszClassName
  if (!u.RegisterClassExW(cls)) throw new Error("RegisterClassExW failed");
  const hwnd = u.CreateWindowExW(
    o.saver ? WS_EX_TOPMOST | WS_EX_TOOLWINDOW : WS_EX_APPWINDOW,
    CLASS,
    wstr(o.title),
    // No WS_VISIBLE: the window is created hidden and stays hidden until showHost().
    (o.saver ? WS_POPUP : WS_POPUP | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU |
      WS_CLIPCHILDREN) >>> 0,
    0,
    0,
    10,
    10, // placed by fullscreen()/frameless(), before anything is embedded in it
    null,
    null,
    hInstance,
    null,
  );
  if (!hwnd) throw new Error("CreateWindowExW failed");
  if (o.onOccluded) u.SetTimer(hwnd, BigInt(OCCLUSION_TIMER), 250, null);
  host = { hwnd, shown: false, max: false, onMaximize: o.onMaximize };
  noDwmChrome(hwnd);
  appIcon(hwnd, o.icon);
  if (o.appId) windowIdentity(hwnd, o.appId, o.title, o.icon);
  return hwnd;
}

/**
 * Hand the top of the non-client area to the page, and do the four other things the library's own
 * window proc did.
 *
 * `WS_THICKFRAME` without `WS_CAPTION` still reserves a sizing border, and Windows 11 treats the
 * four edges differently: the left, right and bottom margins are invisible — DWM puts them outside
 * the frame it paints — while the top one is painted in the light-theme frame colour. Measured on
 * the 144 DPI display: `GetClientRect` 10 px below `GetWindowRect`, `DWMWA_EXTENDED_FRAME_BOUNDS`
 * flush with the window top, and `#EEF5F9` across those ten rows of a `PrintWindow` capture. That
 * was the pale strip above the page's XP title bar, and no amount of `SWP_FRAMECHANGED` removes it:
 * the rows are not stale, they are reserved. `WM_NCCALCSIZE` is what un-reserves them — let Windows
 * compute the frame as usual, then put `rgrc[0].top` back where it came in.
 *
 * The cost is the top sizing border, which is now inside the client area and behind the WebView2
 * child, so Windows never hit-tests it: the top edge no longer resizes. The other three edges do,
 * the status-bar grip still drives `HTBOTTOMRIGHT`, and the page's title bar — which is what
 * covers those ten rows — drags and maximizes, which is what a title bar should do anyway.
 *
 * `onMaximize` is told every time `WM_SIZE` reports the window went to or came back from maximized —
 * XP squares the window's own corners at that point, and the page has to square `#chrome`'s CSS
 * radius to match, since nothing else tells it the host just did that.
 */
function hostProc(o: HostOpts) {
  const u = user32();
  // Nothing in here may throw: it runs on the message-pump thread, through an FFI trampoline with
  // nowhere to put an exception.
  const safe = (f: () => void) => {
    try {
      f();
    } catch { /* one failed callback is not worth the window */ }
  };
  let hidden = false;
  const seen = (h: Deno.PointerValue) => {
    if (!o.onOccluded) return;
    const now = occluded(h);
    if (now !== hidden) safe(() => o.onOccluded!(hidden = now));
  };
  return new Deno.UnsafeCallback(
    { parameters: ["pointer", "u32", "usize", "pointer"], result: "isize" } as const,
    (h, msg, wp, lp) => {
      switch (msg) {
        case WM_NCCALCSIZE: {
          if (!wp || !lp) break;
          // NCCALCSIZE_PARAMS.rgrc[0]: the proposed window rect on the way in, the new client rect
          // on the way out. getArrayBuffer aliases that memory rather than copying it, so the write
          // lands.
          const rgrc = new Int32Array(Deno.UnsafePointerView.getArrayBuffer(lp, 16));
          const proposed = rgrc[1];
          const r = u.DefWindowProcW(h, msg, wp, lp);
          rgrc[1] = ncTop(proposed, rgrc[1], !!u.IsZoomed(h));
          return r;
        }
        case WM_GETMINMAXINFO: {
          if (!lp) break;
          const r = u.DefWindowProcW(h, msg, wp, lp);
          // MINMAXINFO: ptReserved, ptMaxSize, ptMaxPosition, ptMinTrackSize, ptMaxTrackSize — so
          // the minimum is the fourth POINT, at offset 24. In real pixels, like every other rect.
          const mmi = new Int32Array(Deno.UnsafePointerView.getArrayBuffer(lp, 40));
          const scale = (u.GetDpiForWindow(h) || 96) / 96;
          mmi[6] = Math.round(o.min[0] * scale);
          mmi[7] = Math.round(o.min[1] * scale);
          return r;
        }
        case WM_SIZE: {
          resizeWebview(h);
          const sz = Number(wp);
          if (o.onMaximize && (sz === SIZE_MAXIMIZED || sz === SIZE_RESTORED)) {
            safe(() => o.onMaximize!(sz === SIZE_MAXIMIZED));
          }
          return 0n;
        }
        // A key or a click in the seconds before the page exists, which for the screensaver means
        // the seconds it is a black rectangle covering every monitor. The page's own handlers
        // (main.ts initScript) end the saver on input, but they do not exist until the page has
        // loaded, and WebView2 takes several seconds to start: without this the saver ignores the
        // user for as long as that takes, which is the one thing a screensaver must never do. Once
        // the WebView2 child has the focus these stop arriving here and the page's handlers take
        // over — mouse travel, which needs the 10 px grace, was always theirs.
        case WM_KEYDOWN:
        case WM_SYSKEYDOWN:
        case WM_LBUTTONDOWN:
        case WM_RBUTTONDOWN:
        case WM_MBUTTONDOWN:
          if (o.saver) safe(o.onClose);
          return 0n;
        // The one thing about this window WebView2 cannot do for itself. Focus lands on the
        // top-level window, the page is in a child of it, and a key goes to whatever has the focus:
        // without this the screensaver cannot be dismissed with the keyboard.
        case WM_ACTIVATE:
          if (Number(wp) !== WA_INACTIVE) {
            safe(o.onActivate);
            safe(() => seen(h)); // brought to the front: resume now, not at the next tick
          }
          return 0n;
        case WM_TIMER:
          if (Number(wp) === OCCLUSION_TIMER) safe(() => seen(h));
          return 0n;
        case WM_DPICHANGED: {
          // Per-monitor v2 hands over the box the window should take on the new monitor and expects
          // the window to move itself there; nothing else will.
          if (lp) {
            const r = new Int32Array(Deno.UnsafePointerView.getArrayBuffer(lp, 16));
            u.SetWindowPos(
              h,
              HWND_TOP,
              r[0],
              r[1],
              r[2] - r[0],
              r[3] - r[1],
              SWP_NOZORDER | SWP_NOACTIVATE,
            );
          }
          noDwmChrome(h);
          return 0n;
        }
        case WM_CLOSE:
          // Not DestroyWindow: the caller saves the window box, terminates the pump and exits, and
          // a window that is still there is a window that can still be measured on the way out.
          safe(o.onClose);
          return 0n;
        case WM_DESTROY:
          u.PostQuitMessage(0);
          return 0n;
      }
      const r = u.DefWindowProcW(h, msg, wp, lp);
      // Neither the square corners, the missing border nor the extended frame survives on its own:
      // DWM recomputes the frame whenever the window is shown, moved, resized or changes DPI, and a
      // default it puts back is a rounded corner with a light border drawn round it — which is what
      // the user photographed on a build that set both attributes exactly once, before the window
      // was ever shown. Setting them again on each of those messages is what makes them stick.
      // ponytail: unconditional re-apply, three kernel calls per message; read the attribute first
      // and skip the write if a drag ever shows up in a profile.
      if (msg === WM_WINDOWPOSCHANGED || msg === WM_SHOWWINDOW) noDwmChrome(h);
      return r;
    },
  );
}

/**
 * Put the window on screen, finished, at its final size and position — and long before there is a
 * page to put in it.
 *
 * This used to wait for the page's first painted frame, which meant waiting for `webview_create` to
 * start a Chromium browser and for that browser to load 330 KB: two to fourteen seconds of nothing
 * on screen at all. What the user is given instead is what a native application gives him — a
 * window, straight away, in the right place, painted in the application's own colour, which fills in
 * a moment later. That colour is the class brush `createHost` registered (the title bar's Luna blue,
 * or black behind the screensaver's canvas), so there is no white anywhere at any point.
 *
 * `UpdateWindow` is what makes that true rather than nearly true. `ShowWindow` only *posts*
 * `WM_PAINT`, and the next thing this thread does is a second of file I/O followed by
 * `webview_create`; nothing pumps messages in between, so a posted paint would sit in the queue and
 * the window would be on screen with nothing drawn in it — which on a composited desktop is whatever
 * was behind it. `UpdateWindow` sends `WM_PAINT` directly, and `DefWindowProc` erases with the class
 * brush before it returns.
 */
export function showHost(): boolean {
  if (!host || host.shown) return false;
  host.shown = true;
  const u = user32();
  u.ShowWindow(host.hwnd, host.max ? SW_MAXIMIZE : SW_SHOW);
  u.UpdateWindow(host.hwnd);
  u.SetForegroundWindow(host.hwnd);
  // Whether it came up maximized is something only the page can act on, and it has never been told.
  if (host.onMaximize) host.onMaximize(!!u.IsZoomed(host.hwnd));
  return true;
}

/**
 * Keep the library's child window the size of our client area.
 *
 * `webview_create` puts a `webview_widget` child window in the host window and embeds the WebView2
 * controller in *that*: the controller's bounds are the widget's client rect, and the widget's own
 * window proc resets them whenever it is resized. For its own window the library does this from its
 * own `WM_SIZE`; for ours there is nobody but us. One `SetWindowPos` on the only child there is.
 */
export function resizeWebview(hwnd: Deno.PointerValue) {
  const u = user32();
  const widget = u.GetWindow(hwnd, GW_CHILD);
  if (!widget) return; // before webview_create, which is where that child comes from
  const b = new Uint8Array(16);
  if (!u.GetClientRect(hwnd, b)) return;
  const r = new Int32Array(b.buffer);
  u.SetWindowPos(widget, HWND_TOP, 0, 0, r[2] - r[0], r[3] - r[1], SWP_NOZORDER | SWP_NOACTIVATE);
}

/**
 * Where the /c window goes: its remembered box, or the middle of the primary display.
 *
 * The window is still hidden here — `showHost()` is what puts it on screen — so this is only the
 * size, the position and the `SWP_FRAMECHANGED` that makes Windows ask `WM_NCCALCSIZE` for the
 * frame without a top border. The style it already has, from `createHost`: `WS_POPUP` with
 * `WS_THICKFRAME` and no caption, because the page draws a Windows XP title bar (template.html
 * #titlebar) and next to the real unthemed one that made two. The page drives dragging, minimize,
 * maximize and close through `caption()` below.
 */
export function frameless(
  hwnd: Deno.PointerValue,
  w: number,
  h: number,
  saved?: Geom | null,
) {
  const u = user32();
  // The default box is in DIPs; SetWindowPos takes real pixels. Without this the window comes up
  // two thirds of its size on a 150% display, which is most of them.
  const dpi = u.GetDpiForWindow(hwnd) || 96;
  w = Math.round(w * dpi / 96);
  h = Math.round(h * dpi / 96);
  let x = Math.max(0, (u.GetSystemMetrics(SM_CXSCREEN) - w) >> 1);
  let y = Math.max(0, (u.GetSystemMetrics(SM_CYSCREEN) - h) >> 1);
  // A remembered box is already in real pixels, so it is not DPI-scaled — but a monitor that has
  // since been unplugged would put the window where nobody can reach it, so it has to still land
  // somewhere visible.
  if (saved && fits(saved, virtualScreen())) {
    ({ x, y, w, h } = saved);
    if (host) host.max = saved.max; // ... and showHost() opens it maximized, as it was left
  }
  u.SetWindowPos(hwnd, HWND_TOP, x, y, w, h, SWP_FRAMECHANGED | SWP_NOZORDER | SWP_NOACTIVATE);
  return { x, y, w, h, dwm: noDwmChrome(hwnd) };
}

/**
 * Give the window the executable's own icon, for Alt+Tab and the taskbar.
 *
 * `assets/icon.ico` is baked into the exe by `deno compile --icon`, and the shell already falls
 * back to that resource for the taskbar button — measured: the orb is on the button with nothing
 * set on the window. This makes it the *window's* icon as well, which is what `WM_GETICON` answers
 * and what Alt+Tab and the window's own Aero thumbnail ask for: a caption-less `WS_POPUP` has no
 * icon of its own, so without this it has none to give.
 *
 * `ExtractIconExW` on the exe's own path rather than `LoadImage` on a resource id: `deno compile`
 * does not promise which id it writes the group under, and icon index 0 is "the first icon group
 * in this file" whatever it is called. Measured: by id 1 it loaded nothing at all. A build with no
 * icon extracts none and the window keeps the placeholder it had before.
 */
export function appIcon(hwnd: Deno.PointerValue, file?: string) {
  const u = user32();
  if (file) {
    // LR_LOADFROMFILE picks the best image in the .ico for each size; the sizes are the system's
    // (SM_CXICON / SM_CXSMICON: 32 and 16 at 100 %, more at higher DPI).
    const IMAGE_ICON = 1, LR_LOADFROMFILE = 0x10;
    const load = (sm: number) => {
      const n = u.GetSystemMetrics(sm);
      return u.LoadImageW(null, wstr(file), IMAGE_ICON, n, n, LR_LOADFROMFILE);
    };
    const big = load(11), small = load(49); // SM_CXICON, SM_CXSMICON
    if (big && small) {
      u.SendMessageW(hwnd, WM_SETICON, ICON_BIG, BigInt(Deno.UnsafePointer.value(big)));
      u.SendMessageW(hwnd, WM_SETICON, ICON_SMALL, BigInt(Deno.UnsafePointer.value(small)));
      return;
    }
  }
  const big = new BigUint64Array(1), small = new BigUint64Array(1);
  if (shell32().ExtractIconExW(wstr(Deno.execPath()), 0, big, small, 1) < 1) return;
  for (const [which, h] of [[ICON_BIG, big[0]], [ICON_SMALL, small[0]]] as const) {
    if (h) u.SendMessageW(hwnd, WM_SETICON, which, BigInt(h));
  }
}

/** A COM GUID as laid out in memory. */
function guid(g: string): Uint8Array {
  const [a, b, c, d, e] = g.split("-");
  const hex = (h: string) => h.match(/../g)!.map((x) => parseInt(x, 16));
  return new Uint8Array([
    ...hex(a).reverse(),
    ...hex(b).reverse(),
    ...hex(c).reverse(),
    ...hex(d),
    ...hex(e),
  ]);
}

/**
 * The taskbar identity of this window: its AppUserModelID plus the relaunch properties, which are
 * what the taskbar shows for an ID no shortcut declares. Measured in dev mode (the exe is deno.exe):
 * with the process ID alone the window got its own button, but with a generic window glyph and
 * deno.exe's file description as its name — the taskbar resolved both from the exe. With
 * RelaunchIconResource / RelaunchDisplayNameResource (which it only honours alongside
 * RelaunchCommand) it shows our .ico and our title.
 */
export function windowIdentity(
  hwnd: Deno.PointerValue,
  appId: string,
  name: string,
  icon?: string,
) {
  const out = new BigUint64Array(1);
  const iid = guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"); // IID_IPropertyStore
  if (shell32().SHGetPropertyStoreForWindow(hwnd, iid, new Uint8Array(out.buffer)) !== 0) return;
  const ps = Deno.UnsafePointer.create(out[0])!;
  const vt = new Deno.UnsafePointerView(new Deno.UnsafePointerView(ps).getPointer(0)!);
  const fn = <T extends Deno.ForeignFunction>(slot: number, def: T) =>
    new Deno.UnsafeFnPointer(vt.getPointer(slot * 8) as Deno.PointerObject<T>, def);
  const setValue = fn(6, { parameters: ["pointer", "buffer", "buffer"], result: "i32" } as const);
  const keep: Uint8Array[] = []; // the strings must outlive Commit
  const set = (pid: number, value: string) => {
    const key = new Uint8Array(20);
    key.set(guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3")); // PKEY_AppUserModel_*
    new DataView(key.buffer).setUint32(16, pid, true);
    const str = wstr(value);
    keep.push(str);
    const pv = new Uint8Array(24); // PROPVARIANT { vt = VT_LPWSTR (31), pwszVal }
    const dv = new DataView(pv.buffer);
    dv.setUint16(0, 31, true);
    dv.setBigUint64(8, BigInt(Deno.UnsafePointer.value(Deno.UnsafePointer.of(str))), true);
    setValue.call(ps, key, pv);
  };
  const args = Deno.args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ");
  set(2, `"${Deno.execPath()}" ${args}`.trim()); // RelaunchCommand
  let file = Deno.execPath(); // the exe's icon when the .ico is not there (a first run's unpack)
  try {
    if (icon && Deno.statSync(icon).isFile) file = icon;
  } catch { /* absent */ }
  set(3, `${file},0`); // RelaunchIconResource
  set(4, name); // RelaunchDisplayNameResource
  set(5, appId); // ID
  fn(7, { parameters: ["pointer"], result: "i32" } as const).call(ps); // Commit
  fn(2, { parameters: ["pointer"], result: "u32" } as const).call(ps); // Release
  keep.length = 0;
}

/** Where the window is now, as `frameless` would restore it: the *restored* box even when
 * maximized or minimized, which is why this reads WINDOWPLACEMENT rather than GetWindowRect. */
export function placement(hwnd: Deno.PointerValue): Geom | null {
  const b = new Uint8Array(44); // length, flags, showCmd, ptMin, ptMax, rcNormalPosition
  new DataView(b.buffer).setUint32(0, 44, true);
  if (!user32().GetWindowPlacement(hwnd, b)) return null;
  const dv = new DataView(b.buffer);
  const [l, t, r, bo] = [28, 32, 36, 40].map((o) => dv.getInt32(o, true));
  return { x: l, y: t, w: r - l, h: bo - t, max: dv.getUint32(8, true) === SW_MAXIMIZE };
}

/** Does a remembered box still land on the desktop, and is it big enough to grab? */
export function fits(g: Geom, screen: { x: number; y: number; w: number; h: number }): boolean {
  return g.w >= 200 && g.h >= 150 &&
    // at least 80x40 of the window overlaps the virtual screen, so there is something to drag
    Math.min(g.x + g.w, screen.x + screen.w) - Math.max(g.x, screen.x) >= 80 &&
    Math.min(g.y + g.h, screen.y + screen.h) - Math.max(g.y, screen.y) >= 40;
}

/**
 * What the page's title bar asks the window to do.
 *
 * "drag" is the standard caption trick: release the mouse capture the page's own mousedown took,
 * then tell the window it was clicked on its (non-existent) caption, which runs Windows' own modal
 * move loop — so snapping, Aero snap zones and monitor edges all behave as they should. It blocks
 * until the drag ends, which is fine: this runs on the message-pump thread, which is exactly where
 * a modal move loop belongs.
 *
 * "sizese" is the same handoff aimed at the bottom-right sizing corner, which is what the skin's
 * status-bar grip drags: the grip sits inside the client area, where the WS_THICKFRAME border
 * Windows itself resizes with is not.
 */
export function caption(hwnd: Deno.PointerValue, what: "drag" | "min" | "maxtoggle" | "sizese") {
  const u = user32();
  if (what === "drag" || what === "sizese") {
    u.ReleaseCapture();
    u.SendMessageW(hwnd, WM_NCLBUTTONDOWN, what === "drag" ? HTCAPTION : HTBOTTOMRIGHT, 0n);
  } else if (what === "min") {
    u.ShowWindow(hwnd, SW_MINIMIZE);
  } else {
    u.ShowWindow(hwnd, u.IsZoomed(hwnd) ? SW_RESTORE : SW_MAXIMIZE);
  }
}

/** Full-screen visuals keep the machine and display awake (ES_CONTINUOUS | ES_SYSTEM_REQUIRED |
 *  ES_DISPLAY_REQUIRED); off hands power back to the plan. Per thread, and Deno has one. */
export function keepAwake(on: boolean) {
  kernel32().SetThreadExecutionState(on ? 0x80000003 : 0x80000000);
}

let fullSaved: Geom | null = null;
/** The box to remember while the F-key full screen is up: the one it will come back to. */
export const fullBox = () => fullSaved;

/** How far the page (client area) sits inside the window rect on each side. Measured 10 px
 *  left/right/bottom, 0 top (the `WM_NCCALCSIZE` subclass gives the client the top). Not DWM's
 *  extended frame bounds: those stop 2 px short of the client on this machine. */
function frameInset(hwnd: Deno.PointerValue) {
  const u = user32();
  const wr = new Int32Array(4), cr = new Int32Array(4), pt = new Int32Array(2);
  u.GetWindowRect(hwnd, new Uint8Array(wr.buffer));
  u.GetClientRect(hwnd, new Uint8Array(cr.buffer));
  u.ClientToScreen(hwnd, new Uint8Array(pt.buffer));
  return {
    l: pt[0] - wr[0],
    t: pt[1] - wr[1],
    r: wr[2] - (pt[0] + cr[2]),
    b: wr[3] - (pt[1] + cr[3]),
  };
}

/** The app's F key: on, the window covers the whole desktop (topmost, every monitor) with the
 *  frame it had, its sizing border pushed off screen; off, it goes back to the box it left,
 *  maximized again if it was. */
export function fullToggle(hwnd: Deno.PointerValue, on: boolean) {
  const u = user32();
  if (on && !fullSaved) {
    fullSaved = placement(hwnd);
    if (u.IsZoomed(hwnd)) u.ShowWindow(hwnd, SW_RESTORE);
    const { x, y, w, h } = virtualScreen();
    const i = frameInset(hwnd);
    u.SetWindowPos(
      hwnd,
      HWND_TOPMOST,
      x - i.l,
      y - i.t,
      w + i.l + i.r,
      h + i.t + i.b,
      SWP_FRAMECHANGED,
    );
  } else if (!on && fullSaved) {
    const g = fullSaved;
    fullSaved = null;
    u.SetWindowPos(hwnd, HWND_NOTOPMOST, g.x, g.y, g.w, g.h, SWP_FRAMECHANGED);
    if (g.max) u.ShowWindow(hwnd, SW_MAXIMIZE);
  }
}

const OCCLUSION_TIMER = 0x0cc1;
const GWL_EXSTYLE = -20, WS_EX_LAYERED = 0x80000, WS_EX_TRANSPARENT = 0x20;
const GW_HWNDPREV = 3, DWMWA_EXTENDED_FRAME_BOUNDS = 9, DWMWA_CLOAKED = 14;
const DESKTOP_SWITCHDESKTOP = 0x100, RGN_DIFF = 4, NULLREGION = 1;

const cloaked = (h: Deno.PointerValue) => {
  const v = new Uint32Array(1);
  return dwmapi().DwmGetWindowAttribute(h, DWMWA_CLOAKED, new Uint8Array(v.buffer), 4) === 0 &&
    v[0] !== 0;
};

/** What of a window is drawn on screen: DWM's frame, without the invisible resize borders that
 * `GetWindowRect` counts (7 px a side on Windows 11, and transparent). */
function frameBounds(h: Deno.PointerValue): Int32Array | null {
  const r = new Int32Array(4), b = new Uint8Array(r.buffer);
  if (dwmapi().DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, b, 16) === 0) return r;
  return user32().GetWindowRect(h, b) ? r : null;
}

/**
 * Whether nothing of the window can be seen: minimized, on another virtual desktop (cloaked), on no
 * monitor, behind the lock screen (the input desktop is Winlogon's, which we may not open), or every
 * pixel of it under windows above it in the z-order. WebView2 tracks none of this for a window it is
 * embedded in — measured 2026-09-29: a window under an opaque one drew at 60 fps, 27 % of a core.
 *
 * A window above counts only if it is visible, not minimized or cloaked, and neither layered nor
 * click-through: those can be see-through (the GeForce and Game Bar overlays are full-screen,
 * topmost and transparent), so they are never taken for a cover. Rectangles only: the few corner
 * pixels a rounded window above leaves uncovered are not worth drawing 60 frames a second for.
 */
export function occluded(hwnd: Deno.PointerValue): boolean {
  const u = user32(), g = gdi32();
  if (u.IsIconic(hwnd) || cloaked(hwnd) || !u.MonitorFromWindow(hwnd, 0)) return true;
  const desk = u.OpenInputDesktop(0, 0, DESKTOP_SWITCHDESKTOP);
  if (!desk) return true;
  u.CloseDesktop(desk);
  const own = frameBounds(hwnd);
  if (!own) return false;
  const left = g.CreateRectRgn(own[0], own[1], own[2], own[3]);
  let gone = false;
  try {
    for (let w = u.GetWindow(hwnd, GW_HWNDPREV); w && !gone; w = u.GetWindow(w, GW_HWNDPREV)) {
      if (!u.IsWindowVisible(w) || u.IsIconic(w) || cloaked(w)) continue;
      if (Number(u.GetWindowLongPtrW(w, GWL_EXSTYLE)) & (WS_EX_LAYERED | WS_EX_TRANSPARENT)) {
        continue;
      }
      const r = frameBounds(w);
      if (!r) continue;
      const cover = g.CreateRectRgn(r[0], r[1], r[2], r[3]);
      gone = g.CombineRgn(left, left, cover, RGN_DIFF) === NULLREGION;
      g.DeleteObject(cover);
    }
  } finally {
    g.DeleteObject(left);
  }
  return gone;
}
