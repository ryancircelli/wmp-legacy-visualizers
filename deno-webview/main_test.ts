import { assertEquals } from "@std/assert";
import {
  allowedUrl,
  appIdOf,
  devOf,
  iconPath,
  modeOf,
  planSecond,
  SPOTIFY_LOGOUT,
  UNPACK,
  winPath,
} from "./main.ts";
import { claim, fits, ncTop } from "./win32.ts";
import { frameAligner, lines, relay } from "./audio.ts";
import { closest, parseLrc } from "./lyrics.ts";
import { devChange, SPOTIFY_LOGIN, spotifyScript } from "./spotify.ts";

// Every argument form that was actually observed coming from Windows 11 (see the doc comment on
// modeOf). The /S case is the one that matters most: it is what the shell's own .scr verb passes,
// and lower-casing it is the difference between running the saver and opening the config window.
Deno.test("modeOf covers the argument forms Windows uses", () => {
  assertEquals(modeOf(["/S"]), "s");
  assertEquals(modeOf(["/s"]), "s");
  assertEquals(modeOf(["-s"]), "s");
  assertEquals(modeOf(["/p", "12345"]), "p");
  assertEquals(modeOf(["/p:12345"]), "p");
  assertEquals(modeOf(["/c"]), "c");
  assertEquals(modeOf(["/c:98765"]), "c");
  assertEquals(modeOf([]), "c", "double-clicked: configure");
  assertEquals(modeOf(["--allow-ffi", "/S"]), "s", "skips anything that is not the flag");
});

// WmpSpotify.exe is the same module with one argument baked in by `deno compile`. Baked arguments
// come first, which is what makes its mode unspoofable: no /S on the command line can turn it into
// a screensaver. (--mode=app, the retired system-audio application, is no longer a mode: /c.)
Deno.test("--mode=spotify wins over anything else on the command line", () => {
  assertEquals(modeOf(["--mode=spotify", "/S"]), "spotify");
  assertEquals(modeOf(["--mode=spotify", "/p", "123"]), "spotify");
  assertEquals(modeOf(["--mode=app"]), "c");
});

// A window box is remembered across launches, so it can name a monitor that is no longer there.
// Restoring one nobody can reach is worse than forgetting it.
Deno.test("fits rejects a remembered box that is off-screen or too small", () => {
  const screen = { x: 0, y: 0, w: 1920, h: 1080 };
  assertEquals(fits({ x: 100, y: 100, w: 1100, h: 720, max: false }, screen), true);
  assertEquals(
    fits({ x: -1100, y: 100, w: 1100, h: 720, max: false }, screen),
    false,
    "left of it",
  );
  assertEquals(
    fits({ x: 2400, y: 100, w: 1100, h: 720, max: false }, screen),
    false,
    "2nd monitor",
  );
  assertEquals(fits({ x: 100, y: 1075, w: 1100, h: 720, max: false }, screen), false, "below");
  assertEquals(fits({ x: 100, y: 100, w: 8, h: 8, max: false }, screen), false, "degenerate");
  // A box hanging off the right edge but still grabbable is kept.
  assertEquals(fits({ x: 1800, y: 100, w: 1100, h: 720, max: false }, screen), true);
});

// The PE patch is two bytes in the middle of an 80 MB file; a wrong offset silently produces an
// executable Windows refuses to start. This builds the smallest header that carries the field.
function fakePe(subsystem: number): Uint8Array {
  const b = new Uint8Array(0x400);
  const dv = new DataView(b.buffer);
  const peAt = 0x80;
  dv.setUint16(0, 0x5a4d, true); // MZ
  dv.setUint32(0x3c, peAt, true);
  dv.setUint32(peAt, 0x00004550, true); // PE\0\0
  dv.setUint16(peAt + 24, 0x20b, true); // PE32+ optional header magic
  dv.setUint16(peAt + 24 + 68, subsystem, true);
  return b;
}

async function patch(bytes: Uint8Array): Promise<Uint8Array> {
  const f = await Deno.makeTempFile();
  try {
    await Deno.writeFile(f, bytes);
    const cmd = new Deno.Command(Deno.execPath(), {
      args: ["run", "--allow-read", "--allow-write", "gui_subsystem.ts", f],
      cwd: import.meta.dirname,
    });
    const { success, stderr } = await cmd.output();
    if (!success) throw new Error(new TextDecoder().decode(stderr));
    return await Deno.readFile(f);
  } finally {
    await Deno.remove(f);
  }
}

Deno.test("gui_subsystem flips console to GUI and nothing else", async () => {
  const before = fakePe(3);
  const after = await patch(before);
  const at = 0x80 + 24 + 68;
  assertEquals(new DataView(after.buffer).getUint16(at, true), 2);
  // Byte-for-byte identical outside the two patched bytes.
  const a = Uint8Array.from(before), b = Uint8Array.from(after);
  a[at] = b[at] = 0;
  a[at + 1] = b[at + 1] = 0;
  assertEquals(a, b);
});

Deno.test("gui_subsystem is idempotent and refuses anything unexpected", async () => {
  assertEquals(new DataView((await patch(fakePe(2))).buffer).getUint16(0x80 + 24 + 68, true), 2);
  await patch(fakePe(9)).then(
    () => {
      throw new Error("should have refused subsystem 9");
    },
    () => {},
  );
});

// The audio relay hands the page whole stereo frames out of a pipe that splits wherever it likes,
// and the sample rate is four bytes that can be split too. Both are silent failures if wrong: a
// misaligned Float32Array turns music into noise.
Deno.test("frameAligner only ever emits whole 8-byte frames", () => {
  const align = frameAligner();
  assertEquals(align(new Uint8Array([1, 2, 3])).byteLength, 0, "less than a frame: nothing yet");
  assertEquals(align(new Uint8Array([4, 5, 6, 7, 8, 9])), new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
  assertEquals(align(new Uint8Array(0)).byteLength, 0);
  assertEquals(
    align(new Uint8Array([10, 11, 12, 13, 14, 15, 16])),
    new Uint8Array([9, 10, 11, 12, 13, 14, 15, 16]),
  );
});

Deno.test("relay sends the rate first, then frames, and returns when the helper stops", async () => {
  const sent: (string | Uint8Array)[] = [];
  const sink = { send: (d: string | Uint8Array) => void sent.push(d), bufferedAmount: 0 };
  const rate = new Uint8Array(4);
  new DataView(rate.buffer).setUint32(0, 48000, true);
  // Chunked the awkward way: the rate split in two, then a frame and a half, then the rest.
  const chunks = [
    rate.subarray(0, 2),
    rate.subarray(2),
    new Uint8Array(12).fill(7),
    new Uint8Array(4).fill(9),
  ];
  await relay(sink, ReadableStream.from(chunks));
  assertEquals(sent[0], JSON.stringify({ rate: 48000 }));
  const pcm = sent.slice(1) as Uint8Array[];
  assertEquals(pcm.map((c) => c.byteLength), [8, 8], "frames must arrive 8 bytes at a time");
  assertEquals(pcm[1], new Uint8Array([7, 7, 7, 7, 9, 9, 9, 9]));
});

Deno.test("relay refuses a helper that dies before saying anything", async () => {
  const sink = { send: () => {}, bufferedAmount: 0 };
  await relay(sink, ReadableStream.from([])).then(
    () => {
      throw new Error("should have thrown");
    },
    (e) => assertEquals(e.message.includes("sample rate"), true),
  );
});

Deno.test("lines splits the helper's stderr wherever the pipe cut it", async () => {
  const enc = new TextEncoder();
  const got = await Array.fromAsync(
    lines(ReadableStream.from(['{"a":', "1}\n{}\nbye"].map((s) => enc.encode(s)))),
  );
  assertEquals(got, ['{"a":1}', "{}", "bye"]);
});

Deno.test("parseLrc reads every stamp, skips tags, and sorts", () => {
  assertEquals(parseLrc("[ar:Queen]\n[00:12.50] Is this\r\n[01:02.00][00:05]Mama\n[00:20.00]"), [
    { t: 5, text: "Mama" },
    { t: 12.5, text: "Is this" },
    { t: 20, text: "" },
    { t: 62, text: "Mama" },
  ]);
});

Deno.test("parseLrc keeps enhanced-LRC word stamps", () => {
  assertEquals(parseLrc("[00:10.00]<00:10.00>Is <00:10.40>this<00:11.00> the\n[00:12.00]plain"), [
    {
      t: 10,
      text: "Is this the",
      words: [{ t: 10, text: "Is" }, { t: 10.4, text: "this" }, { t: 11, text: "the" }],
    },
    { t: 12, text: "plain" },
  ]);
});

Deno.test("closest picks the nearest length, or the first synced with none", () => {
  const hits = [{ duration: 200 }, { duration: 356, syncedLyrics: "x" }, { duration: 340 }];
  assertEquals(closest(hits, 354), hits[1]);
  assertEquals(closest(hits, 0), hits[1]);
});

// The helper is spawned by the GUI-subsystem screensaver: a console-subsystem child gets a console
// allocated for it and flashes a black window on screen at every launch. `deno task audio` builds
// it, and CI builds it before running these tests, so the check is real there; a checkout without a
// Rust toolchain has no binary to look at.
const helper = `${import.meta.dirname}/native/alchemy-audio.exe`;
Deno.test({
  name: "the audio helper owns no console",
  ignore: !(await Deno.stat(helper).then(() => true, () => false)),
  fn: async () => {
    const b = await Deno.readFile(helper);
    const dv = new DataView(b.buffer);
    const pe = dv.getUint32(0x3c, true);
    assertEquals(dv.getUint16(pe + 24, true), 0x20b, "PE32+ optional header");
    assertEquals(dv.getUint16(pe + 24 + 68, true), 2, "subsystem must be 2 (GUI), not 3 (console)");
  },
});

// The whole fix is this one rule, applied inside the WM_NCCALCSIZE hook: take the window's own top
// edge when the window is restored (those rows are the page's XP title bar), and leave Windows'
// inset alone when it is maximized, where the inset is what keeps the page off the taskbar.
Deno.test("ncTop reclaims the sizing border, except while maximized", () => {
  assertEquals(ncTop(260, 270, false), 260, "restored: the client starts at the window top");
  assertEquals(ncTop(-10, 0, true), 0, "maximized: whatever Windows computed");
});

// The pale strip the hook removes was ten physical pixels of non-client area, so the only check
// that would have caught it is one that looks at the top of the *window*, not the page. Runs
// wherever a Windows PowerShell can be reached — a WSL checkout included — and is skipped on CI,
// which has no Windows and no compiled exe.
//
// The probe has to be DPI-aware. Without SetThreadDpiAwarenessContext, GetWindowRect and
// PrintWindow come back divided by the scale factor and the boundary between the frame and the
// title bar smears across three rows, which is how the strip was misread as part of the page.
// The page's origin no longer depends on this number — a virtual host serves it (main.ts) — so all
// two instances need is a port each and a working /audio on both. What used to be here checked
// that the *second* instance survived the first holding port 47821; the machine this shipped to
// could not bind 47821 with anything, which is how the port came to decide nothing at all.
Deno.test("every instance gets its own free port, and serves on it", async () => {
  const start = () => {
    const w = new Worker(import.meta.resolve("./server.ts"), { type: "module" });
    return [w, new Promise<string>((ok) => (w.onmessage = (e) => ok(String(e.data))))] as const;
  };
  const [w1, p1] = start();
  const first = await p1;
  const [w2, p2] = start();
  const second = await p2;
  try {
    assertEquals(Number(first) > 0, true, `first server: ${first}`);
    assertEquals(Number(second) > 0 && second !== first, true, `second server: ${second}`);
    for (const port of [first, second]) {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      await res.body?.cancel();
      assertEquals(res.status, 200, `port ${port} serves`);
    }
  } finally {
    w1.terminate();
    w2.terminate();
  }
});

// Which instance gets the shared WebView2 profile, and so which instance keeps the user's
// settings. The claim has to be exclusive against a live holder and *gone* the moment that holder
// stops existing — a lock that outlives its owner is what a `createNew` file would be, and it would
// send every later launch to a throwaway profile for ever. Windows only: it is one CreateFileW.
Deno.test({
  name: "a profile claim is exclusive while it is held and leaves nothing behind",
  ignore: Deno.build.os !== "windows",
  // The claim *is* an open handle held for the life of the process, and kernel32 stays loaded for
  // the same reason: both are what the test is checking, not a leak it should fail on.
  sanitizeResources: false,
  fn: () => {
    const path = `${Deno.env.get("TEMP")}\\alchemy-claim-test.lock`;
    try {
      Deno.removeSync(path);
    } catch { /* not there, which is the normal case */ }
    assertEquals(claim(path), true, "nobody holds it");
    // The share mode is per handle, not per process: this is the same refusal a second instance
    // gets, without needing a second instance to prove it.
    assertEquals(claim(path), false, "held, so the next asker is secondary");
    // FILE_FLAG_DELETE_ON_CLOSE: the file exists only while somebody is inside it, which is why
    // there is no stale lock to recognise.
    assertEquals(Deno.statSync(path).isFile, true, "the lock file is there while it is held");
  },
});

// The player window is the screensaver's /c config window (the same frameless window WmpSpotify.exe
// shows); the retired WmpVisualizers.exe used to be the exe under test.
const APP_EXE = `${import.meta.dirname}/dist/Alchemy.exe`;
const TOP_ROWS = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System; using System.Text; using System.Runtime.InteropServices;
public class Q {
  public delegate bool E(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(E cb, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref Pt p);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L, T, Rt, B; }
  [StructLayout(LayoutKind.Sequential)] public struct Pt { public int X, Y; }
}
'@
[Q]::SetThreadDpiAwarenessContext([IntPtr](-4)) | Out-Null
# Run from somewhere Windows can name: started from a WSL checkout this process inherits a
# \\wsl.localhost working directory, and Start-Process fails on one. -WindowStyle is gone with it:
# it routes the launch through ShellExecute, which fails the same way, and it hides nothing here —
# the exe is a GUI-subsystem binary with no console of its own.
Set-Location $env:TEMP
$proc = Start-Process -FilePath $exePath -ArgumentList '/c' -PassThru
# Every visible top-level window this process has, sampled from launch. The first sample that finds
# anything is the window's first appearance, and it is measured on the spot. There should be exactly
# one, it should be ours, and it should turn up within a few hundred milliseconds: the window is
# created hidden only for as long as it takes to style and place it, and is shown before WebView2 is
# started rather than after the page has painted.
$look = {
  $script:vis = @(); $script:ours = [IntPtr]::Zero
  $cb = [Q+E]{ param($w, $p)
    $q = 0; [Q]::GetWindowThreadProcessId($w, [ref]$q) | Out-Null
    if ($q -eq $proc.Id) {
      $c = New-Object Text.StringBuilder 64; [Q]::GetClassNameW($w, $c, 64) | Out-Null
      if ($c.ToString() -eq 'AlchemyHost') { $script:ours = $w }
      if ([Q]::IsWindowVisible($w)) { $script:vis += $c.ToString() }
    }
    return $true }
  [Q]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
}
$rows = { param($h, $tag)
  $r = New-Object Q+R; [Q]::GetWindowRect($h, [ref]$r) | Out-Null
  $o = New-Object Q+Pt; [Q]::ClientToScreen($h, [ref]$o) | Out-Null
  $b = New-Object Drawing.Bitmap ($r.Rt - $r.L), ($r.B - $r.T)
  $g = [Drawing.Graphics]::FromImage($b); $dc = $g.GetHdc()
  [Q]::PrintWindow($h, $dc, 2) | Out-Null; $g.ReleaseHdc($dc); $g.Dispose()
  Write-Output ($tag + ' ncTop ' + ($o.Y - $r.T) + ' zoomed ' + [int][Q]::IsZoomed($h) +
                ' box ' + $r.L + ',' + $r.T + ',' + ($r.Rt - $r.L) + 'x' + ($r.B - $r.T))
  foreach ($y in 0..3) { foreach ($x in 100, 300, 600) {
    $p = $b.GetPixel($x + $o.X - $r.L, $y + $o.Y - $r.T)
    Write-Output ($tag + ' px ' + $y + ' ' + $x + ' ' + $p.R + ' ' + $p.G + ' ' + $p.B) } }
  $b.Dispose()
}
$h = [IntPtr]::Zero
try {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt 40 -and $script:vis.Count -eq 0) {
    & $look
    if ($script:vis.Count -eq 0) { Start-Sleep -Milliseconds 50 }
  }
  $h = $script:ours
  Write-Output ('firstvisible ' + [int]$sw.Elapsed.TotalMilliseconds + ' windows ' +
                $script:vis.Count + ' [' + ($script:vis -join ' ') + ']')
  if ($h -eq [IntPtr]::Zero) { throw 'the player window never appeared' }
  # Measured twice from the same window: as it appears, and once it has been up for three seconds.
  # The two have to agree — a window that is restyled or moved after it is on screen is the defect
  # this is here to catch.
  & $rows $h 'first'
  Start-Sleep -Seconds 3
  & $rows $h 'settled'
} finally {
  if ($h -ne [IntPtr]::Zero) { [Q]::PostMessageW($h, 0x10, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null }
  Start-Sleep -Milliseconds 2500
  Get-Process -Id $proc.Id -ErrorAction SilentlyContinue | Stop-Process -Force
}
# Explicit, because -Command takes its exit code from the last statement's $? — and a Get-Process
# for a window that has already closed itself leaves that false.
exit 0
`;

const text = (b: Uint8Array) => new TextDecoder().decode(b).trim();

/** Where windowsExe() put the staged copy, so the test can delete 80 MB of %TEMP% afterwards. */
let STAGED = "";

/** A path PowerShell can launch, or null when there is nothing here to check. Windows refuses to
 * execute from the \\wsl.localhost share, so a checkout that lives there stages a copy under
 * %TEMP% — which is the case for a Linux deno *and* for a Windows deno.exe run from WSL, hence the
 * UNC test rather than the platform. */
async function windowsExe(): Promise<string | null> {
  if (!await Deno.stat(APP_EXE).then(() => true, () => false)) return null;
  if (Deno.build.os === "windows" && !APP_EXE.startsWith("\\\\")) return APP_EXE;
  const tmp = await new Deno.Command("powershell.exe", {
    args: ["-NoProfile", "-NonInteractive", "-Command", "$env:TEMP"],
  }).output().catch(() => null);
  if (!tmp?.success) return null; // plain Linux: no Windows to check against
  const win = text(tmp.stdout);
  STAGED = `${win}\\alchemy-toprow.exe`;
  if (Deno.build.os !== "windows") {
    const unix = await new Deno.Command("wslpath", { args: ["-u", win] }).output();
    STAGED = `${text(unix.stdout)}/alchemy-toprow.exe`;
  }
  await Deno.copyFile(APP_EXE, STAGED);
  return `${win}\\alchemy-toprow.exe`;
}

const exe = await windowsExe();
Deno.test({
  name: "the player window appears once, finished, with the page in it",
  ignore: !exe,
  fn: async () => {
    // The path goes in as a statement, not an environment variable: WSL hands a Windows process
    // only the variables WSLENV names, and everything else arrives empty.
    const script = `$exePath = '${exe!.replaceAll("'", "''")}'\n${TOP_ROWS}`;
    const { success, stdout, stderr } = await new Deno.Command("powershell.exe", {
      args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    }).output();
    await Deno.remove(STAGED).catch(() => {});
    const out = new TextDecoder().decode(stdout);
    assertEquals(success, true, out + new TextDecoder().decode(stderr));

    // One window, ours, the first time anything of this process is visible at all. Sampled every
    // 50 ms from launch, so "the first visible window" is exactly what the user sees first: before
    // this the library showed its own default-styled WS_OVERLAPPEDWINDOW for the seconds the
    // WebView2 embed takes.
    const [, firstMs, windows, classes] =
      out.match(/firstvisible (\d+) windows (\d+) \[([^\]]*)\]/) ?? [];
    assertEquals(windows, "1", out);
    assertEquals(classes, "AlchemyHost", out);
    // And it is there almost at once. This is the whole startup policy in one number: everything
    // slow — unpacking, the audio server, and above all webview_create, which starts a Chromium
    // browser and was measured at 4 to 9 seconds on this machine — happens behind a window that is
    // already on screen. Three seconds is a loose bound for a loaded machine around a measured
    // 0.3 s; it is here to fail if anything ever puts the window back behind the page again.
    assertEquals(+firstMs < 3000, true, `window took ${firstMs} ms to appear\n${out}`);

    for (const tag of ["first", "settled"]) {
      const [, ncTopPx, zoomed] = out.match(new RegExp(`${tag} ncTop (-?\\d+) zoomed (\\d)`)) ?? [];
      // Restored, there is no non-client area left above the client: that is the fix. Maximized,
      // Windows keeps its inset and puts it off the top of the screen, so the rows below are still
      // the first rows the user sees.
      if (zoomed === "0") assertEquals(ncTopPx, "0", out);
      const px = [...out.matchAll(new RegExp(`${tag} px (\\d+) (\\d+) (\\d+) (\\d+) (\\d+)`, "g"))];
      assertEquals(px.length, 12, out);
      for (const [, y, x, r, g, b] of px) {
        const where = `${tag} row ${y} at x=${x}: rgb(${r},${g},${b})`;
        // The skin's blue, not a frame Windows painted and not the white of an unpainted
        // WebView2 — whichever of the three sources happens to be painting it at the moment of
        // the sample. That is the point: the window's class brush, the WebView2 control's
        // default background and the page's own title bar are all set to the same Luna blue, so
        // the answer is the same at 0.3 s (brush), at 3 s (control) and once the page has painted,
        // and there is no instant in between where something else shows through. The test is
        // deliberately about that difference and not about a particular colour: the native frame
        // measured #EEF5F9, which is eleven points of blue away from neutral, while every blue the
        // skin has put at the top of the window — #1463EB when this was written, #84C4FA after the
        // next skin pass — is more than a hundred. Pinning the title-bar gradient itself would make
        // this fail every time template.html is retouched, which is not what it is guarding.
        assertEquals(+b > 180 && +b - +r >= 60, true, `${where} is not the page`);
      }
    }
    // Already finished when it appeared: the box it was shown at is the box it still has three
    // seconds later. A window that is styled, sized or moved after it is on screen is two windows
    // as far as anyone watching is concerned, which is the whole complaint.
    const boxes = [...out.matchAll(/(first|settled) ncTop .* box (\S+)/g)].map((m) => m[2]);
    assertEquals(boxes.length, 2, out);
    assertEquals(boxes[0], boxes[1], out);
  },
});

// WmpSpotify.exe is the same module with --mode=spotify baked in (CONTRACT.md v6).
Deno.test("--mode=spotify is its own mode", () => {
  assertEquals(modeOf(["--mode=spotify"]), "spotify");
  assertEquals(modeOf(["--mode=spotify", "/S"]), "spotify");
});

// The injected script runs on every document, the login page included, and under Spotify's CSP:
// it must be a no-op off open.spotify.com and must never lean on a <script> element.
Deno.test("spotifyScript guards on the hostname and never builds a <script>", () => {
  const s = spotifyScript({
    html: "<div id=chrome></div>",
    css: "#chrome{color:red}",
    js: "window.x=1;",
  });
  assertEquals(s.includes(`location.hostname !== "open.spotify.com"`), true);
  assertEquals(/<script/i.test(s), false);
  assertEquals(s.includes("eval("), false);
  new Function(s); // parses
});

// A bundler's IIFE may end in a `//# sourceMappingURL=` line comment: the wrapper must not be
// swallowed by it. And the bundle runs after alchemyEngine/alchemyRoot are set, in the shadow root.
Deno.test("spotifyScript runs the bundle after the root is mounted, even behind a line comment", () => {
  const s = spotifyScript({
    html: '<div id="wmp-mount"></div>',
    css: "",
    js:
      "(function(){window.seen=[window.alchemyEngine,!!window.alchemyRoot.getElementById('wmp-mount')]})();\n//# sourceMappingURL=x.map",
  });
  const win: Record<string, unknown> = { alchemyLog() {}, fetch() {}, WebSocket: function () {} };
  win.top = win;
  let root: {
    innerHTML: string;
    adoptedStyleSheets?: unknown[];
    getElementById(id: string): unknown;
  };
  const doc = {
    readyState: "complete",
    getElementById: () => null,
    createElement: () => ({
      style: {},
      attachShadow: () =>
        root = {
          innerHTML: "",
          getElementById: (id: string) => root.innerHTML.includes(`id="${id}"`),
        },
    }),
    body: { appendChild() {} },
  };
  class Sheet {
    replaceSync() {}
  }
  new Function(
    "window",
    "location",
    "document",
    "CSSStyleSheet",
    "performance",
    "XMLHttpRequest",
    s,
  )(win, { hostname: "open.spotify.com" }, doc, Sheet, {}, class {});
  assertEquals(win.seen, ["spotify", true]);
});

// The real bundle (skipped until `npm run build` has made it): a classic script, as the
// document-created script can only be. Also prints what injecting it costs.
const INJECT = new URL("../dist/spotify-inject.js", import.meta.url);
Deno.test({
  name: "dist/spotify-inject.js is {html, css, js} with a classic-script js",
  ignore: !(await Deno.stat(INJECT).then(() => true, () => false)),
  fn: async () => {
    const b = JSON.parse(await Deno.readTextFile(INJECT));
    assertEquals(Object.keys(b).sort(), ["css", "html", "js"]);
    for (const k of ["html", "css", "js"]) assertEquals(typeof b[k], "string", k);
    assertEquals(/<script/i.test(b.html), false, "html is markup only");
    assertEquals(/\bimport\.meta\b|^\s*(import|export)\b/m.test(b.js), false, "no module syntax");
    assertEquals(
      /document\.currentScript/.test(b.js),
      false,
      "no currentScript: an init script has none",
    );
    const s = spotifyScript(b);
    const t0 = performance.now();
    new Function(s); // parses as a classic script
    console.log(
      `  inject: script ${(s.length / 1024).toFixed(0)} KiB (js ${
        (b.js.length / 1024).toFixed(0)
      }, ` +
        `css ${(b.css.length / 1024).toFixed(0)}), V8 parse ${
          (performance.now() - t0).toFixed(1)
        } ms`,
    );
  },
});

// The observers, run in a fake open.spotify.com window: the page's own /api/token and connect-state
// device PUT (answered with the cluster, as measured in spike 2) must fill window.__wmpSpotify.
Deno.test("spotifyScript observers: auth boolean, spclient, full device id before the state event", async () => {
  const full = "c5d86ab70e71b84d5ef8bfdf709ac4e085d80bfd";
  const ps = { track: { uri: "spotify:track:x" }, is_paused: false };
  const cluster = { active_device_id: "f48d", devices: { [full]: {}, f48d: {} }, player_state: ps };
  const events: [string, unknown, string | null][] = [];
  const win: Record<string, unknown> = {};
  win.top = win;
  win.dispatchEvent = (e: CustomEvent) => {
    events.push([e.type, e.detail, (win.__wmpSpotify as { deviceId: string | null }).deviceId]);
  };
  win.fetch = (u: string) =>
    Promise.resolve(
      new Response(
        JSON.stringify(
          u.includes("/api/token") ? { isAnonymous: false, accessToken: "t" } : cluster,
        ),
      ),
    );
  win.WebSocket = function () {};
  const doc = { readyState: "loading", addEventListener() {} };
  class XHR {}
  const s = spotifyScript({ html: "", css: "", js: "" });
  let buffer = 0;
  const perf = { setResourceTimingBufferSize: (n: number) => (buffer = n) };
  new Function("window", "location", "document", "XMLHttpRequest", "WebSocket", "performance", s)(
    win,
    { hostname: "open.spotify.com" },
    doc,
    XHR,
    win.WebSocket,
    perf,
  );
  assertEquals(buffer > 250, true, "resource timing buffer raised past Chromium's 250");
  const f = win.fetch as (u: string, i?: unknown) => Promise<Response>;
  await f("https://open.spotify.com/api/token?reason=init");
  await f(`https://gue1-spclient.spotify.com/connect-state/v1/devices/hobs_${full.slice(0, 35)}`, {
    method: "PUT",
    headers: { authorization: "Bearer t" },
  });
  await new Promise((r) => setTimeout(r, 10));
  const W = win.__wmpSpotify as Record<string, unknown>;
  const auth = events.find((e) => e[0] === "wmp-spotify-auth")!;
  assertEquals(auth[1], { loggedIn: true });
  assertEquals(W.spclient, "gue1-spclient.spotify.com");
  assertEquals(W.deviceId, full);
  assertEquals(W.activeDeviceId, "f48d");
  const st = events.find((e) => e[0] === "wmp-spotify-state")!;
  assertEquals(st[2], full, "full id already set when the state event fires");
  assertEquals(st[1] === W.state, true, "event detail is W.state itself");
  assertEquals(W.state, ps, "the bare player_state");
});

// Logged out: an anonymous /api/token answer replaces the page with the login page, once a minute at
// most (sessionStorage survives the round trip through accounts.spotify.com); logged in never does.
Deno.test("spotifyScript: an anonymous token goes to the login page, once a minute at most", async () => {
  const run = (anonymous: boolean, store: Map<string, string>) => {
    const went: string[] = [];
    const win: Record<string, unknown> = {
      dispatchEvent() {},
      WebSocket: function () {},
      sessionStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
      fetch: () =>
        Promise.resolve(new Response(JSON.stringify({ isAnonymous: anonymous, accessToken: "t" }))),
    };
    win.top = win;
    new Function(
      "window",
      "location",
      "document",
      "XMLHttpRequest",
      "WebSocket",
      "performance",
      spotifyScript({ html: "", css: "", js: "" }),
    )(
      win,
      { hostname: "open.spotify.com", replace: (u: string) => void went.push(u) },
      { readyState: "loading", addEventListener() {} },
      class {},
      win.WebSocket,
      {},
    );
    return (win.fetch as (u: string) => Promise<Response>)(
      "https://open.spotify.com/api/token?reason=init",
    )
      .then(() => new Promise((r) => setTimeout(r, 10))).then(() => went);
  };
  const store = new Map<string, string>();
  assertEquals(await run(true, store), [SPOTIFY_LOGIN]);
  assertEquals(await run(true, store), [], "back again inside the minute: stays");
  store.set("wmp-login-redirect", String(Date.now() - 61000));
  assertEquals(await run(true, store), [SPOTIFY_LOGIN], "a minute later: goes again");
  assertEquals(await run(false, new Map()), [], "logged in: never");
  const u = new URL(SPOTIFY_LOGIN);
  assertEquals(u.origin + u.pathname, "https://accounts.spotify.com/login");
  assertEquals(u.searchParams.get("continue"), "https://open.spotify.com/");
});

// Idle: the cluster comes without active_device_id (field absent, as measured), and a stale id from
// an earlier cluster must not survive it; the state event still fires.
Deno.test("spotifyScript: a cluster without active_device_id clears W.activeDeviceId", async () => {
  const full = "c5d86ab70e71b84d5ef8bfdf709ac4e085d80bfd";
  const events: string[] = [];
  const win: Record<string, unknown> = {};
  win.top = win;
  win.dispatchEvent = (e: CustomEvent) => void events.push(e.type);
  win.WebSocket = function () {};
  let body: unknown = null;
  win.fetch = () => Promise.resolve(new Response(JSON.stringify(body)));
  new Function(
    "window",
    "location",
    "document",
    "XMLHttpRequest",
    "WebSocket",
    "performance",
    spotifyScript({ html: "", css: "", js: "" }),
  )(
    win,
    { hostname: "open.spotify.com" },
    { readyState: "loading", addEventListener() {} },
    class {},
    function () {},
    {},
  );
  const f = win.fetch as (u: string, i?: unknown) => Promise<Response>;
  const put = `https://gue1-spclient.spotify.com/connect-state/v1/devices/hobs_${
    full.slice(0, 35)
  }`;
  const W = win.__wmpSpotify as Record<string, unknown>;
  assertEquals(W.activeDeviceId, "");
  body = { active_device_id: "f48d", devices: { [full]: {} }, player_state: { is_paused: false } };
  await f(put, { method: "PUT" });
  await new Promise((r) => setTimeout(r, 10));
  assertEquals(W.activeDeviceId, "f48d");
  body = { devices: { [full]: {} }, player_state: { is_paused: false } };
  await f(put, { method: "PUT" });
  await new Promise((r) => setTimeout(r, 10));
  assertEquals(W.activeDeviceId, "", "absent field -> empty string, not the stale id");
  assertEquals(events.filter((e) => e === "wmp-spotify-state").length, 2);
  assertEquals(W.devices, [{
    id: full,
    name: full,
    type: "",
    active: false,
    volume: null,
    offline: false,
  }]);
  assertEquals(events.filter((e) => e === "wmp-spotify-devices").length, 2);
  body = { devices: { [full]: { name: "Web Player", device_type: "COMPUTER" } }, player_state: {} };
  await f(put, { method: "PUT" });
  await new Promise((r) => setTimeout(r, 10));
  body = {
    active_device_id: full,
    devices: { [full]: { name: full, volume: 65535 } },
    player_state: {},
  };
  await f(put, { method: "PUT" });
  await new Promise((r) => setTimeout(r, 10));
  assertEquals(W.devices, [{
    id: full,
    name: "Web Player",
    type: "",
    active: true,
    volume: 65535,
    offline: false,
  }]);
});

// Log out is one navigation: accounts.spotify.com/logout clears the session cookies and redirects to
// `continue`, which must be the login page returning to the web player.
Deno.test("SPOTIFY_LOGOUT ends on the login page, then open.spotify.com", () => {
  const u = new URL(SPOTIFY_LOGOUT);
  assertEquals(u.origin + u.pathname, "https://accounts.spotify.com/logout");
  const next = new URL(u.searchParams.get("continue")!);
  assertEquals(next.origin + next.pathname, "https://accounts.spotify.com/login");
  assertEquals(next.searchParams.get("continue"), "https://open.spotify.com/");
});

// A fresh Windows has no Visual C++ runtime (MSVCP140, VCRUNTIME140*): a webview.dll that imports
// it fails to load there, and the window flashes and is gone. native/build-webview.sh links it in.
Deno.test("native/webview.dll needs nothing Windows does not ship", async () => {
  const pe = new TextDecoder("latin1").decode(
    await Deno.readFile(new URL("./native/webview.dll", import.meta.url)),
  );
  assertEquals(pe.match(/(vcruntime|msvcp)\d+[_\w]*\.dll/gi), null);
  assertEquals(pe.includes("webview_create"), true);
});

// Bindings are callable by any script in the window (open.spotify.com's included): the browser
// opens only the project's own pages.
Deno.test("allowedUrl: the project's downloads, repo and site only", () => {
  for (
    const u of [
      "https://github.com/ryancircelli/wmp-legacy-visualizers",
      "https://github.com/ryancircelli/wmp-legacy-visualizers/releases/download/spotify-latest/WmpSpotify-win64.zip",
      "https://wmp.ryancircelli.com/",
    ]
  ) assertEquals(allowedUrl(u), true, u);
  for (
    const u of [
      "http://wmp.ryancircelli.com/",
      "https://github.com/ryancircelli/wmp-legacy-visualizers-re",
      "https://github.com/someone/else",
      "https://evil.example/?https://wmp.ryancircelli.com/",
      "file:///C:/Windows/System32/calc.exe",
      "not a url",
    ]
  ) assertEquals(allowedUrl(u), false, u);
});

// A second WmpSpotify must not open a throwaway (logged-out) profile when it can help it.
Deno.test("planSecond: same program -> front; another WmpSpotify copy -> take over; else throwaway", () => {
  const w = (pid: number, exe: string) => ({ hwnd: null, pid, exe });
  const self = "C:\\Users\\u\\Downloads\\WmpSpotify-app (1)\\WmpSpotify.exe";
  const old = w(1, "C:\\Users\\u\\Downloads\\WmpSpotify-app\\WmpSpotify.exe");
  const dev = w(2, "C:\\Users\\u\\.deno\\bin\\deno.exe");
  assertEquals(planSecond([w(3, self.toUpperCase())], self), {
    kind: "focus",
    window: w(3, self.toUpperCase()),
  });
  assertEquals(planSecond([old], self), { kind: "takeover", windows: [old] });
  assertEquals(planSecond([dev, old], self), { kind: "takeover", windows: [old] });
  assertEquals(planSecond([dev], self), { kind: "throwaway" });
  assertEquals(
    planSecond([w(4, "")], self),
    { kind: "throwaway" },
    "unreadable process: leave it alone",
  );
  assertEquals(
    planSecond([w(5, "C:\\WmpSpotify\\other.exe")], self),
    { kind: "throwaway" },
    "a folder name is not the app",
  );
});

// Dev mode is an argument, never baked.
Deno.test("devOf: --dev only", () => {
  assertEquals(devOf(["--mode=spotify"]), false);
  assertEquals(devOf(["--mode=spotify", "--dev"]), true);
  assertEquals(modeOf(["--mode=spotify", "--dev"]), "spotify");
});

// The watcher's decision: CSS alone swaps in place, anything else reloads.
Deno.test("devChange: css only -> css, js or html -> reload, same -> none", () => {
  const a = { html: "<div></div>", css: "a{}", js: "x()" };
  assertEquals(devChange(a, { ...a }), "none");
  assertEquals(devChange(a, { ...a, css: "a{color:red}" }), "css");
  assertEquals(devChange(a, { ...a, js: "y()" }), "reload");
  assertEquals(devChange(a, { ...a, html: "<p></p>", css: "b{}" }), "reload");
  assertEquals(devChange(null, a), "reload");
});

// The dev bootstrap: the bundle comes from the worker, and the dev socket's devCss replaces the
// adopted sheet's text in place (suffix kept); devReload reloads the document.
Deno.test("spotifyScript dev: fetched bundle, devCss swaps the sheet, devReload reloads", async () => {
  const sheets: string[] = [];
  let sock: { onmessage?: (e: { data: string }) => void } = {};
  let reloaded = 0;
  const win: Record<string, unknown> = {
    alchemyLog() {},
    fetch: (u: string) =>
      Promise.resolve(
        u.endsWith("/dev/inject")
          ? new Response(
            JSON.stringify({ html: "<i></i>", css: "a{}", js: "globalThis.__devRan = 1;" }),
          )
          : new Response("{}"),
      ),
    WebSocket: function () {
      return sock = {};
    },
  };
  win.top = win;
  let root: { innerHTML: string; adoptedStyleSheets?: unknown[] } = { innerHTML: "" };
  const doc = {
    readyState: "complete",
    getElementById: () => null,
    createElement: () => ({ style: {}, attachShadow: () => root = { innerHTML: "" } }),
    body: { appendChild() {} },
  };
  class Sheet {
    replaceSync(t: string) {
      sheets.push(t);
    }
  }
  const s = spotifyScript({ html: "", css: "", js: "" }, "", {
    bundle: "http://127.0.0.1:1/dev/inject",
    socket: "ws://127.0.0.1:1/dev",
    cssSuffix: "|sfx",
  });
  new Function(
    "window",
    "location",
    "document",
    "CSSStyleSheet",
    "performance",
    "XMLHttpRequest",
    "WebSocket",
    s,
  )(
    win,
    { hostname: "open.spotify.com", reload: () => reloaded++ },
    doc,
    Sheet,
    {},
    class {},
    win.WebSocket,
  );
  await new Promise((r) => setTimeout(r, 20));
  assertEquals(root.innerHTML, "<i></i>");
  assertEquals((globalThis as Record<string, unknown>).__devRan, 1);
  sock.onmessage!({ data: JSON.stringify({ type: "devCss", css: "b{}" }) });
  assertEquals(sheets, ["a{}|sfx", "b{}|sfx"]);
  sock.onmessage!({ data: JSON.stringify({ type: "devReload" }) });
  assertEquals(reloaded, 1);
});

// Spotify Connect shows this window as "WMP Spotify": the page's device registrations (connect-state
// PUT with device.device_info.name, track-playback POST with device.name) are renamed on the way
// out; other requests and bodies without the name pass untouched.
Deno.test("spotifyScript renames the Connect device registration to WMP Spotify", async () => {
  const sent: [string, unknown][] = [];
  const win: Record<string, unknown> = { alchemyLog() {}, WebSocket: function () {} };
  win.top = win;
  win.fetch = (u: string, init?: { body?: string }) => {
    sent.push([u, init?.body]);
    return Promise.resolve(new Response("{}"));
  };
  new Function(
    "window",
    "location",
    "document",
    "XMLHttpRequest",
    "WebSocket",
    "performance",
    spotifyScript({ html: "", css: "", js: "" }),
  )(
    win,
    { hostname: "open.spotify.com" },
    { readyState: "loading", addEventListener() {} },
    class {},
    win.WebSocket,
    {},
  );
  const f = win.fetch as (u: string, i?: unknown) => Promise<Response>;
  const put =
    "https://gue1-spclient.spotify.com/connect-state/v1/devices/hobs_0123456789abcdef0123456789abcdef012";
  const reg = {
    member_type: "CONNECT_STATE",
    device: {
      device_info: {
        name: "Web Player (Microsoft Edge)",
        device_type: "computer",
        capabilities: { x: 1 },
      },
    },
  };
  await f(put, { method: "PUT", body: JSON.stringify(reg), headers: { a: "b" } });
  const tp = {
    device: { device_id: "abc", device_type: "computer", name: "Web Player (Microsoft Edge)" },
    volume: 1,
  };
  await f("https://gue1-spclient.spotify.com/track-playback/v1/devices", {
    method: "POST",
    body: JSON.stringify(tp),
  });
  await f(put, { method: "PUT", body: '{"member_type":"CONNECT_STATE"}' });
  await f(put, { method: "PUT", body: "not json" });
  await f("https://api-partner.spotify.com/pathfinder/v2/query", {
    method: "POST",
    body: JSON.stringify(tp),
  });
  const body = (i: number) => sent[i][1] as string;
  assertEquals(JSON.parse(body(0)), {
    ...reg,
    device: { device_info: { ...reg.device.device_info, name: "WMP Spotify" } },
  });
  assertEquals(JSON.parse(body(1)), { ...tp, device: { ...tp.device, name: "WMP Spotify" } });
  assertEquals(body(2), '{"member_type":"CONNECT_STATE"}', "no name path: untouched");
  assertEquals(body(3), "not json", "unparsable: untouched");
  assertEquals(body(4), JSON.stringify(tp), "other endpoints: untouched");
});

// An Alexa speaker and its "Everywhere" group share one id: the registration answer keys them
// "<id>_amzn_1" / "<id>_amzn_2" with real names, dealer pushes key both by the bare "<id>" named by
// the id. Both stay in W.devices, under Spotify's full keys, with their own names.
Deno.test("spotifyScript devices: a speaker and its group sharing a bare id stay two named entries", async () => {
  const id = "434c35da-d88a-4837-8dbc-9efbd66340ee",
    web = "c5d86ab70e71b84d5ef8bfdf709ac4e085d80bfd";
  const win: Record<string, unknown> = {
    alchemyLog() {},
    dispatchEvent() {},
    WebSocket: function () {},
  };
  win.top = win;
  let body: unknown = null;
  win.fetch = () => Promise.resolve(new Response(JSON.stringify(body)));
  new Function(
    "window",
    "location",
    "document",
    "XMLHttpRequest",
    "WebSocket",
    "performance",
    spotifyScript({ html: "", css: "", js: "" }),
  )(
    win,
    { hostname: "open.spotify.com" },
    { readyState: "loading", addEventListener() {} },
    class {},
    win.WebSocket,
    {},
  );
  const f = win.fetch as (u: string, i?: unknown) => Promise<Response>;
  const put = `https://gue1-spclient.spotify.com/connect-state/v1/devices/hobs_${web.slice(0, 35)}`;
  const W = win.__wmpSpotify as { devices: { id: string; name: string; offline: boolean }[] };
  const names = () => W.devices.map((d) => `${d.id}=${d.name}`).sort();
  body = { // the registration answer
    devices: {
      [web]: { name: "WMP Spotify", device_type: "COMPUTER" },
      [id + "_amzn_1"]: { name: "Sam's Kitchen Echo Dot", device_type: "SPEAKER" },
      [id + "_amzn_2"]: { name: "Everywhere", device_type: "SPEAKER", is_group: true },
    },
    player_state: {},
  };
  await f(put, { method: "PUT" });
  await new Promise((r) => setTimeout(r, 10));
  assertEquals(
    names(),
    [`${id}_amzn_1=Sam's Kitchen Echo Dot`, `${id}_amzn_2=Everywhere`, `${web}=WMP Spotify`]
      .sort(),
  );
  body = { // a dealer-style cluster: bare id, named by the id
    devices: { [web]: { name: web }, [id]: { name: id, device_type: "SPEAKER", is_offline: true } },
    player_state: {},
  };
  await f(put, { method: "PUT" });
  await new Promise((r) => setTimeout(r, 10));
  assertEquals(
    names(),
    [`${id}_amzn_1=Sam's Kitchen Echo Dot`, `${id}_amzn_2=Everywhere`, `${web}=WMP Spotify`]
      .sort(),
  );
  assertEquals(W.devices.filter((d) => d.id.startsWith(id)).every((d) => d.offline), true);
});

// The window's icon comes from an .ico file, not the exe (in dev the exe is deno.exe): both icons
// are unpacked with the DLLs, and dev mode loads them straight from assets/ on the share.
Deno.test("window icons: unpacked with the DLLs; dev loads assets/ from the share", () => {
  const icons = UNPACK.filter(([n]) => n.endsWith(".ico"));
  assertEquals(icons, [["icon.ico", "assets"], ["icon-spotify.ico", "assets"]]);
  const share = "file://wsl.localhost/Ubuntu-22.04/home/r/repo/deno-webview/main.ts";
  assertEquals(
    iconPath("spotify", true, "C:\\N", share),
    "\\\\wsl.localhost\\Ubuntu-22.04\\home\\r\\repo\\deno-webview\\assets\\icon-spotify.ico",
  );
  assertEquals(iconPath("spotify", false, "C:\\N", share), "C:\\N\\icon-spotify.ico");
  assertEquals(iconPath("s", false, "C:\\N", share), "C:\\N\\icon.ico");
  assertEquals(iconPath("c", true, "C:\\N", share).endsWith("\\assets\\icon.ico"), true);
  assertEquals(
    winPath(new URL("file:///C:/Users/r/My%20App/main.ts")),
    "C:\\Users\\r\\My App\\main.ts",
  );
});

Deno.test("AppUserModelID: WmpSpotify gets its own taskbar identity, the saver keeps the exe's", () => {
  assertEquals(appIdOf("spotify"), "RyanCircelli.WmpSpotify");
  assertEquals(appIdOf("s"), undefined);
  assertEquals(appIdOf("c"), undefined);
});
