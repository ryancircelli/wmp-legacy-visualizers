// Direct FFI to the `webview` C library (webview_deno 0.9.0 build artifacts, vendored in
// native/). The jsr:@webview/webview wrapper is NOT used: its loader downloads both DLLs from
// GitHub on first run and copies WebView2Loader.dll into the *current working directory* —
// which for a screensaver launched by Windows is C:\Windows\System32, and is not writable.
// The symbol table below is the same one that module declares; everything else here is ours.
const SYMBOLS = {
  webview_create: { parameters: ["i32", "pointer"], result: "pointer" },
  webview_destroy: { parameters: ["pointer"], result: "void" },
  webview_run: { parameters: ["pointer"], result: "void" },
  webview_terminate: { parameters: ["pointer"], result: "void" },
  webview_get_window: { parameters: ["pointer"], result: "pointer" },
  webview_get_native_handle: { parameters: ["pointer", "i32"], result: "pointer" },
  webview_navigate: { parameters: ["pointer", "buffer"], result: "void" },
  webview_init: { parameters: ["pointer", "buffer"], result: "void" },
  webview_eval: { parameters: ["pointer", "buffer"], result: "void" },
  webview_bind: { parameters: ["pointer", "buffer", "function", "pointer"], result: "void" },
} as const;

const cstr = (s: string) => new TextEncoder().encode(s + "\0");

const WEBVIEW_NATIVE_HANDLE_BROWSER_CONTROLLER = 2;

/** A GUID as COM lays one out in memory: the first three fields little-endian, the last eight
 * bytes in order. */
function guid(s: string): Uint8Array {
  const [a, b, c, d, e] = s.split("-");
  const hex = (h: string) => h.match(/../g)!.map((x) => parseInt(x, 16));
  return new Uint8Array([
    ...hex(a).reverse(),
    ...hex(b).reverse(),
    ...hex(c).reverse(),
    ...hex(d),
    ...hex(e),
  ]);
}

const IID_CONTROLLER2 = guid("c979903e-d4ca-4228-92eb-47ee3fa96eab");
const IID_WEBVIEW2_3 = guid("A0D6DF20-3B92-416D-AA0C-437A9C727857");

/** UTF-16LE, NUL-terminated: what every `W` entry point and COM string parameter takes. */
function wstr(s: string): Uint8Array {
  const b = new Uint8Array(s.length * 2 + 2);
  const dv = new DataView(b.buffer);
  for (let i = 0; i < s.length; i++) dv.setUint16(i * 2, s.charCodeAt(i), true);
  return b;
}

const QI = { parameters: ["pointer", "buffer", "buffer"], result: "i32" } as const;
const RELEASE = { parameters: ["pointer"], result: "u32" } as const;

/** The `slot`-th method of a COM object's vtable, ready to call — slot 0 is `QueryInterface`,
 * 2 is `Release`, and everything above 2 is the interface's own, in declaration order. */
function com<const T extends Deno.ForeignFunction>(
  obj: Deno.PointerValue,
  slot: number,
  def: T,
): Deno.UnsafeFnPointer<T> {
  const vt = new Deno.UnsafePointerView(obj!).getPointer(0)!;
  const fn = new Deno.UnsafePointerView(vt).getPointer(slot * 8) as Deno.PointerObject<T>;
  return new Deno.UnsafeFnPointer(fn, def);
}

export class Webview {
  #h: Deno.PointerValue;
  #lib: Deno.DynamicLibrary<typeof SYMBOLS>;
  #cbs: unknown[] = []; // kept only so the callbacks are not collected while the window lives

  /**
   * `window` is the host window to embed into (win32.ts `createHost`), and passing one is what
   * keeps the library from creating and showing a `WS_OVERLAPPEDWINDOW` of its own while it spends
   * the next few seconds starting WebView2. It goes in as the HWND itself, not as a pointer to one:
   * the 0.12.0 constructor probes the argument with `IsWindow` and only dereferences it when that
   * says no. Null still means "make your own window", which nothing here does any more.
   */
  constructor(dllPath: string, debug = false, window: Deno.PointerValue = null) {
    this.#lib = Deno.dlopen(dllPath, SYMBOLS);
    this.#h = this.#lib.symbols.webview_create(debug ? 1 : 0, window);
    if (!this.#h) throw new Error("webview_create failed (is the WebView2 runtime installed?)");
  }

  /** The window the library is embedded in: the one it was handed, so this is how the caller
   * checks that it really did embed rather than create one of its own. */
  get hwnd(): Deno.PointerValue {
    return this.#lib.symbols.webview_get_window(this.#h);
  }

  /** The `ICoreWebView2Controller` the C library embedded, which is the way in to everything
   * WebView2 can do that the C API does not expose. */
  #controller(): Deno.PointerValue {
    return this.#lib.symbols.webview_get_native_handle(
      this.#h,
      WEBVIEW_NATIVE_HANDLE_BROWSER_CONTROLLER,
    );
  }

  /**
   * Set WebView2's own background colour, so a page that paints nothing in a pixel shows this
   * rather than the control's default white.
   *
   * The C library exposes no such setting, but it does hand out the `ICoreWebView2Controller` it
   * embedded, and `DefaultBackgroundColor` lives one interface up from it. That is three vtable
   * calls by hand — `QueryInterface` for `ICoreWebView2Controller2`, `put_DefaultBackgroundColor`
   * (slot 27, the second of the two methods the interface adds), `Release` — and a
   * `COREWEBVIEW2_COLOR` is four bytes, which x64 passes in a register like the `u32` it is — and
   * the struct's declaration order is `{A,R,G,B}`, so little-endian puts the alpha in the *low*
   * byte: `a | r << 8 | g << 16 | b << 24`. Packed the other way round the runtime sees a partial
   * alpha, refuses it (`put_DefaultBackgroundColor` takes only 0 or 255 — measured: `E_INVALIDARG`,
   * and the control keeps its default opaque white), which is the fringe this was meant to remove.
   *
   * `a = 0` is the one other value it accepts: a fully transparent WebView2 hands the pixels the
   * page did not paint to the host window's own surface. Neither window uses it any more (the
   * per-pixel glass it served was removed); both pass an opaque colour (main.ts).
   *
   * Returns false on a runtime older than 1.0.774.44, which has no `ICoreWebView2Controller2`.
   */
  background(r: number, g: number, b: number, a = 255): boolean {
    const c = this.#controller();
    if (!c) return false;
    const out = new BigUint64Array(1);
    if (com(c, 0, QI).call(c, IID_CONTROLLER2, new Uint8Array(out.buffer)) !== 0) return false;
    const c2 = Deno.UnsafePointer.create(out[0]);
    const put = com(c2, 27, { parameters: ["pointer", "u32"], result: "i32" } as const);
    const hr = put.call(c2, (a | r << 8 | g << 16 | b << 24) >>> 0); // COREWEBVIEW2_COLOR
    com(c2, 2, RELEASE).call(c2);
    return hr === 0;
  }

  /**
   * Hand keyboard focus to the WebView2, which is the only way the page ever sees a key.
   *
   * `ICoreWebView2Controller::MoveFocus` (vtable slot 12, counting from the three IUnknown ones)
   * with `COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC`. This is exactly what the C library's own
   * window proc does on `WM_ACTIVATE`, and since the host window's class is ours that proc never
   * runs: without it the top-level window keeps the focus, and the screensaver cannot be dismissed
   * with a key.
   */
  focus(): boolean {
    const c = this.#controller();
    if (!c) return false;
    return com(c, 12, { parameters: ["pointer", "i32"], result: "i32" } as const).call(c, 0) === 0;
  }

  /**
   * Serve `folder` to this WebView as `https://<host>/`, so the page has an origin that does not
   * move when the loopback port does.
   *
   * This is what keeps the user's settings. The page keeps them in `localStorage`, which is keyed
   * by origin, and the origin used to be `http://127.0.0.1:<the port the server got>` — so a
   * machine where the preferred port cannot be bound (WSL mirrored networking holds 47821 on this
   * one, with nothing in `netstat` to show for it) started every launch on a new origin and every
   * launch from factory settings. A virtual host is a name WebView2 resolves inside the browser,
   * with no socket and no port, so it is the same origin every time on every machine.
   *
   * `SetVirtualHostNameToFolderMapping` is `ICoreWebView2_3`, two QueryInterfaces away: the C
   * library hands out the *controller*, `get_CoreWebView2` (slot 25, the last method
   * `ICoreWebView2Controller` declares) hands out the core object, and `ICoreWebView2_3` is a
   * QueryInterface on that. Slot 71 is the fourth of the five methods `_3` adds, counting from
   * `ICoreWebView2`'s own 58 and `ICoreWebView2_2`'s 7. The access kind is
   * `COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW` (1): the page is ours, and it needs to be able
   * to fetch itself.
   *
   * Virtual hosts are served as `https://`, so the origin is a secure context — which is what the
   * Web Audio and capture APIs need, and was the reason the page was on a loopback port in the
   * first place. The audio WebSocket still goes to `ws://127.0.0.1:<port>`, which Chromium treats
   * as potentially trustworthy and so does not block as mixed content.
   *
   * Returns false on any runtime without `ICoreWebView2_3` (that is, before 1.0.992.28), where the
   * caller keeps the loopback origin it would have had.
   */
  virtualHost(host: string, folder: string): boolean {
    const c = this.#controller();
    if (!c) return false;
    const core = new BigUint64Array(1);
    const get = com(c, 25, { parameters: ["pointer", "buffer"], result: "i32" } as const);
    if (get.call(c, new Uint8Array(core.buffer)) !== 0) return false;
    const w2 = Deno.UnsafePointer.create(core[0]);
    const out = new BigUint64Array(1);
    const ok = com(w2, 0, QI).call(w2, IID_WEBVIEW2_3, new Uint8Array(out.buffer)) === 0;
    let hr = -1;
    if (ok) {
      const w3 = Deno.UnsafePointer.create(out[0]);
      const set = com(
        w3,
        71,
        {
          parameters: ["pointer", "buffer", "buffer", "i32"],
          result: "i32",
        } as const,
      );
      hr = set.call(w3, wstr(host), wstr(folder), 1);
      com(w3, 2, RELEASE).call(w3);
    }
    com(w2, 2, RELEASE).call(w2); // get_CoreWebView2 hands out a reference of its own
    return hr === 0;
  }

  /** Script run before any page script, on every navigation. */
  init(js: string) {
    this.#lib.symbols.webview_init(this.#h, cstr(js));
  }

  navigate(url: string) {
    this.#lib.symbols.webview_navigate(this.#h, cstr(url));
  }

  eval(js: string) {
    this.#lib.symbols.webview_eval(this.#h, cstr(js));
  }

  /** Exposes `window[name](...args)` to the page. Return values are not plumbed back. */
  bind(name: string, fn: (args: unknown[]) => void) {
    const cb = new Deno.UnsafeCallback(
      { parameters: ["pointer", "pointer", "pointer"], result: "void" } as const,
      (_seq: Deno.PointerValue, req: Deno.PointerValue) => {
        let args: unknown[] = [];
        try {
          if (req) args = JSON.parse(new Deno.UnsafePointerView(req).getCString());
        } catch { /* malformed call from the page: ignore */ }
        fn(args);
      },
    );
    this.#cbs.push(cb);
    this.#lib.symbols.webview_bind(this.#h, cstr(name), cb.pointer, null);
  }

  /** Blocks this thread on the Win32 message pump until terminate() is called. */
  run() {
    this.#lib.symbols.webview_run(this.#h);
  }

  terminate() {
    this.#lib.symbols.webview_terminate(this.#h);
  }
}
