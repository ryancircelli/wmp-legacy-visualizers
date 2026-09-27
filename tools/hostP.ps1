# hostP.ps1 -- instrumented ground-truth host.  host2.ps1 plus IAT hooks on the CRT imports:
#   _time64  (api-ms-win-crt-time-l1-1-0.dll)   -> pinned constant, so srand(time(NULL)) is fixed
#   _o_srand (api-ms-win-crt-private-l1-1-0.dll)-> sets OUR LCG state
#   _o_rand  (api-ms-win-crt-private-l1-1-0.dll)-> OUR MSVC LCG + a per-call caller log
# The rand hook is reached through a 20-byte RWX stub that stores [rsp] (the DLL's return address)
# into a global before jumping to the managed delegate, so every draw is attributed to a call site
# without a debugger and without stack walking.
#   powershell -NoProfile -ExecutionPolicy Bypass -File hostP.ps1 [-Vis alchemy|bars|battery]
#     [-Frames f.bin] [-Out out] [-Preset -1] [-Width 640] [-Height 480] [-Max 0] [-PngEvery 0]
#     [-PinTime 1700000000] [-NoHook] [-RandLog] [-Pal] [-Hash] [-RawEvery 0] [-RawIndex] [-Info]
# -RawIndex (battery): dump the 8-bit FRONT surface (frame_NNNN.idx) and BACK, i.e. the pre-blur
#   image (frame_NNNN.bidx), instead of the palette-expanded DIB, and put the Prepare() probe frame
#   in frame_-001.*.  The `ihash` column of stats.csv is an FNV-1a of that FRONT surface every frame,
#   which is the palette-independent A/B signal.  -Pal additionally writes live.csv (LIVE per frame).
param(
  [ValidateSet('alchemy','bars','battery')][string]$Vis = 'alchemy',
  [string]$Frames = "$PSScriptRoot\frames_K_tone300.bin",
  [string]$Out    = "$PSScriptRoot\outP",
  [int]$Width     = 640,
  [int]$Height    = 480,
  [int]$Max       = 0,
  [int]$PngEvery  = 0,
  [int]$Preset    = -1,
  [int]$LatePreset = -1,        # SetCurrentPreset at frame 1 instead of before the first Render
  [long]$PinTime  = 1700000000,   # the second _time64 reports; 0 = do not pin
  [switch]$NoHook,
  [switch]$RandLog,               # per-frame per-callsite rand histogram + full sequence
  [switch]$Pal,                   # battery: dump the palette control block every frame
  [switch]$Hash,                  # per-frame FNV-1a of the whole surface (determinism proof)
  [int]$RawEvery  = 0,
  [switch]$RawIndex,              # battery: dump the 8-bit FRONT surface indices instead of the DIB
  [switch]$Info,
  [int]$Channels  = 0             # >0: MediaInfo(Channels, 44100, "") before Prepare, as WMP does
)
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

[StructLayout(LayoutKind.Sequential)]
public struct RECT { public int left, top, right, bottom; }

[ComImport, Guid("D3984C13-C3CB-48e2-8BE5-5168340B4F35"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IWMPEffects {
  [PreserveSig] int Render(IntPtr pLevels, IntPtr hdc, ref RECT prc);
  [PreserveSig] int MediaInfo(int ch, int rate, [MarshalAs(UnmanagedType.BStr)] string title);
  [PreserveSig] int GetCapabilities(out uint caps);
  [PreserveSig] int GetTitle([MarshalAs(UnmanagedType.BStr)] out string t);
  [PreserveSig] int GetPresetTitle(int n, [MarshalAs(UnmanagedType.BStr)] out string t);
  [PreserveSig] int GetPresetCount(out int n);
  [PreserveSig] int SetCurrentPreset(int n);
  [PreserveSig] int GetCurrentPreset(out int n);
  [PreserveSig] int DisplayPropertyPage(IntPtr hwnd);
  [PreserveSig] int GoFullscreen(int full);
  [PreserveSig] int RenderFullScreen(IntPtr pLevels);
}

[ComImport, Guid("695386EC-AA3C-4618-A5E1-DD9A8B987632"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IWMPEffects2 {
  [PreserveSig] int Render(IntPtr pLevels, IntPtr hdc, ref RECT prc);
  [PreserveSig] int MediaInfo(int ch, int rate, [MarshalAs(UnmanagedType.BStr)] string title);
  [PreserveSig] int GetCapabilities(out uint caps);
  [PreserveSig] int GetTitle([MarshalAs(UnmanagedType.BStr)] out string t);
  [PreserveSig] int GetPresetTitle(int n, [MarshalAs(UnmanagedType.BStr)] out string t);
  [PreserveSig] int GetPresetCount(out int n);
  [PreserveSig] int SetCurrentPreset(int n);
  [PreserveSig] int GetCurrentPreset(out int n);
  [PreserveSig] int DisplayPropertyPage(IntPtr hwnd);
  [PreserveSig] int GoFullscreen(int full);
  [PreserveSig] int RenderFullScreen(IntPtr pLevels);
  [PreserveSig] int SetCore(IntPtr core);
  [PreserveSig] int Create(IntPtr hwndParent);
  [PreserveSig] int Destroy();
  [PreserveSig] int NotifyNewMedia(IntPtr media);
  [PreserveSig] int OnWindowMessage(uint msg, IntPtr wp, IntPtr lp, out IntPtr res);
  [PreserveSig] int RenderWindowed(IntPtr pData, int fRequiredRender);
}

// ---------------------------------------------------------------- IAT hooking
public static class Iat {
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool VirtualProtect(IntPtr a, IntPtr n, uint p, out uint old);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern IntPtr VirtualAlloc(IntPtr a, IntPtr n, uint t, uint p);
  const uint PAGE_READWRITE = 4, PAGE_EXECUTE_READWRITE = 0x40;

  static int I32(IntPtr p, int o) { return Marshal.ReadInt32(p, o); }
  static short I16(IntPtr p, int o) { return Marshal.ReadInt16(p, o); }
  static string Cstr(IntPtr b, int rva) { return Marshal.PtrToStringAnsi(IntPtr.Add(b, rva)); }

  // Returns the address of the IAT slot for dll!fn in the *loaded* image at mod, or IntPtr.Zero.
  public static IntPtr FindSlot(IntPtr mod, string dll, string fn, out string foundDll) {
    foundDll = null;
    int e_lfanew = I32(mod, 0x3c);
    int oh = e_lfanew + 24;
    bool pe32p = I16(mod, oh) == 0x20b;
    int dd = oh + (pe32p ? 112 : 96);
    int impRva = I32(mod, dd + 8);
    if (impRva == 0) return IntPtr.Zero;
    for (int d = impRva; ; d += 20) {
      int nameRva = I32(mod, d + 12), fta = I32(mod, d + 16), oft = I32(mod, d);
      if (nameRva == 0 && fta == 0) break;
      string dn = Cstr(mod, nameRva);
      if (dll != null && dn.IndexOf(dll, StringComparison.OrdinalIgnoreCase) < 0) continue;
      int lookup = oft != 0 ? oft : fta;
      for (int i = 0; ; i++) {
        long v = pe32p ? Marshal.ReadInt64(mod, lookup + i * 8) : (uint)I32(mod, lookup + i * 4);
        if (v == 0) break;
        bool byOrd = pe32p ? (v < 0) : ((v & 0x80000000L) != 0);
        if (!byOrd) {
          string nm = Cstr(mod, (int)(v & 0x7fffffff) + 2);
          if (nm == fn) { foundDll = dn; return IntPtr.Add(mod, fta + i * (pe32p ? 8 : 4)); }
        }
      }
    }
    return IntPtr.Zero;
  }

  public static IntPtr Patch(IntPtr slot, IntPtr newFn) {
    uint old;
    if (!VirtualProtect(slot, (IntPtr)8, PAGE_READWRITE, out old))
      throw new Exception("VirtualProtect failed " + Marshal.GetLastWin32Error());
    IntPtr prev = Marshal.ReadIntPtr(slot);
    Marshal.WriteIntPtr(slot, newFn);
    VirtualProtect(slot, (IntPtr)8, old, out old);
    return prev;
  }

  // 20-byte x64 stub:  mov rax,[rsp] ; mov [callerVar],rax ; jmp [target]
  // Leaves rcx/rdx/r8/r9 and the stack untouched, so it is transparent for any callee.
  public static IntPtr MakeCallerStub(IntPtr target, out IntPtr callerVar) {
    IntPtr pg = VirtualAlloc(IntPtr.Zero, (IntPtr)64, 0x3000 /*COMMIT|RESERVE*/, PAGE_EXECUTE_READWRITE);
    if (pg == IntPtr.Zero) throw new Exception("VirtualAlloc failed");
    callerVar = IntPtr.Add(pg, 32);
    IntPtr tgtSlot = IntPtr.Add(pg, 24);
    Marshal.WriteIntPtr(tgtSlot, target);
    byte[] code = new byte[20];
    int o = 0;
    code[o++] = 0x48; code[o++] = 0x8B; code[o++] = 0x04; code[o++] = 0x24;       // mov rax,[rsp]
    code[o++] = 0x48; code[o++] = 0xA3;                                            // mov [imm64],rax
    BitConverter.GetBytes(callerVar.ToInt64()).CopyTo(code, o); o += 8;
    code[o++] = 0xFF; code[o++] = 0x25;                                            // jmp [rip+rel32]
    BitConverter.GetBytes(24 - (o + 4)).CopyTo(code, o); o += 4;                   // -> tgtSlot
    Marshal.Copy(code, 0, pg, code.Length);
    return pg;
  }
}

public static class AlcHost {
  static int W = 640, H = 480;
  [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr h);
  [DllImport("gdi32.dll")] static extern IntPtr CreateDIBSection(IntPtr hdc, byte[] bmi, uint usage,
      out IntPtr bits, IntPtr sect, uint off);
  [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
  [DllImport("gdi32.dll")] static extern bool GdiFlush();
  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern IntPtr CreateWindowExW(int ex, string cls, string name, int style,
      int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr inst, IntPtr p);
  [DllImport("ole32.dll")] static extern int CoCreateInstance(ref Guid clsid, IntPtr unk,
      uint ctx, ref Guid iid, out IntPtr o);
  [DllImport("ole32.dll")] static extern int OleInitialize(IntPtr r);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern IntPtr LoadLibraryW(string s);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)]
  static extern IntPtr GetModuleHandleW(string s);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  delegate int CreateFn(IntPtr outer, ref Guid iid, out IntPtr ppv);

  // ---- hooks -------------------------------------------------------------
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate long Time64Fn(IntPtr t);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int RandFn();
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate void SrandFn(uint s);
  static Time64Fn hTime; static RandFn hRand; static SrandFn hSrand;   // keep alive
  static IntPtr CallerVar;
  public static long PinnedTime = 0;
  public static uint  Hold = 1;               // the CRT's _holdrand, ours now
  public static IntPtr ModBase = IntPtr.Zero;
  public static bool   LogRand = false;
  public static int    Frame = -1;            // -1 = ctor/probe phase
  public static long   SrandSeen = -1;
  // rand log: parallel arrays, callsite RVA + returned value, with per-frame start offsets
  static int[] lgRva = new int[1 << 22]; static short[] lgVal = new short[1 << 22];
  static int lgN = 0;
  static List<int> frameStart = new List<int>();
  public static int TotalRand = 0;

  static long Time64Hook(IntPtr t) {
    if (t != IntPtr.Zero) Marshal.WriteInt64(t, PinnedTime);
    return PinnedTime;
  }
  static void SrandHook(uint s) { Hold = s; SrandSeen = s; }
  static int RandHook() {
    Hold = Hold * 214013u + 2531011u;
    int r = (int)((Hold >> 16) & 0x7fff);
    TotalRand++;
    if (LogRand && lgN < lgRva.Length) {
      long ra = Marshal.ReadInt64(CallerVar);
      lgRva[lgN] = (int)(ra - ModBase.ToInt64());
      lgVal[lgN] = (short)r; lgN++;
    }
    return r;
  }
  public static void MarkFrame() { frameStart.Add(lgN); }

  public static void InstallHooks(IntPtr mod, long pin, bool logRand) {
    ModBase = mod; PinnedTime = pin; LogRand = logRand;
    hTime = Time64Hook; hRand = RandHook; hSrand = SrandHook;
    string d;
    if (pin != 0) {
      IntPtr s = Iat.FindSlot(mod, "crt-time", "_time64", out d);
      if (s == IntPtr.Zero) s = Iat.FindSlot(mod, null, "_time64", out d);
      if (s == IntPtr.Zero) { P("HOOK time64 NOT FOUND"); }
      else P("hook _time64   <- {0}  slot=0x{1:X} old=0x{2:X} pinned={3}", d, s.ToInt64(),
             Iat.Patch(s, Marshal.GetFunctionPointerForDelegate(hTime)).ToInt64(), pin);
    }
    IntPtr ss = Iat.FindSlot(mod, null, "_o_srand", out d);
    if (ss == IntPtr.Zero) ss = Iat.FindSlot(mod, null, "srand", out d);
    if (ss == IntPtr.Zero) P("HOOK srand NOT FOUND");
    else P("hook srand    <- {0}  slot=0x{1:X} old=0x{2:X}", d, ss.ToInt64(),
           Iat.Patch(ss, Marshal.GetFunctionPointerForDelegate(hSrand)).ToInt64());
    IntPtr rs = Iat.FindSlot(mod, null, "_o_rand", out d);
    if (rs == IntPtr.Zero) rs = Iat.FindSlot(mod, null, "rand", out d);
    if (rs == IntPtr.Zero) P("HOOK rand NOT FOUND");
    else {
      IntPtr stub = Iat.MakeCallerStub(Marshal.GetFunctionPointerForDelegate(hRand), out CallerVar);
      P("hook rand     <- {0}  slot=0x{1:X} old=0x{2:X} stub=0x{3:X} callerVar=0x{4:X}", d,
        rs.ToInt64(), Iat.Patch(rs, stub).ToInt64(), stub.ToInt64(), CallerVar.ToInt64());
    }
  }

  public static void WriteRandLog(string dir) {
    if (!LogRand) return;
    // per-frame per-callsite histogram
    var sb = new StringBuilder("frame,callsite,count\n");
    var tot = new StringBuilder("frame,calls\n");
    for (int f = 0; f < frameStart.Count; f++) {
      int a = frameStart[f], b = (f + 1 < frameStart.Count) ? frameStart[f + 1] : lgN;
      var h = new Dictionary<int, int>();
      for (int i = a; i < b; i++) { int k = lgRva[i]; h[k] = h.ContainsKey(k) ? h[k] + 1 : 1; }
      foreach (var kv in h) sb.Append(f - 1).Append(",0x").Append(kv.Key.ToString("x")).Append(',').Append(kv.Value).Append('\n');
      tot.Append(f - 1).Append(',').Append(b - a).Append('\n');
    }
    File.WriteAllText(Path.Combine(dir, "rand_hist.csv"), sb.ToString());
    File.WriteAllText(Path.Combine(dir, "rand_total.csv"), tot.ToString());
    // full sequence: callsite rva + value, one line each (frame boundaries as '#')
    var seq = new StringBuilder();
    int fi = 0;
    for (int i = 0; i < lgN; i++) {
      while (fi < frameStart.Count && frameStart[fi] == i) { seq.Append("# frame ").Append(fi - 1).Append('\n'); fi++; }
      seq.Append("0x").Append(lgRva[i].ToString("x")).Append(' ').Append(lgVal[i]).Append('\n');
    }
    File.WriteAllText(Path.Combine(dir, "rand_seq.txt"), seq.ToString());
    P("rand log: {0} calls, {1} frames marked", lgN, frameStart.Count);
  }

  static IntPtr Hdc, Bits, Hbm, Hwnd, Obj = IntPtr.Zero;
  static int PalOff = -1;          // offset of LIVE inside the allocation, once located
  static IWMPEffects Fx;
  static IWMPEffects2 Fx2;
  const int TL_SIZE = 4096 + 8 + 8;
  static IntPtr Tl = ZeroAlloc(TL_SIZE);
  static IntPtr ZeroAlloc(int n) { IntPtr p = Marshal.AllocHGlobal(n);
    for (int i = 0; i < n; i++) Marshal.WriteByte(p, i, 0); return p; }
  static int[] px;
  public static StringBuilder Log = new StringBuilder();
  static void P(string f, params object[] a) { string s = string.Format(f, a); Log.AppendLine(s); Console.WriteLine(s); }

  public static void Create(string vis, int w, int h, long pin, bool hook, bool logRand) {
    W = w; H = h; px = new int[W * H];
    Guid iid = new Guid("D3984C13-C3CB-48e2-8BE5-5168340B4F35");
    IntPtr p; int hr;
    P("vis={0} dib={1}x{2}", vis, W, H);
    if (vis == "alchemy") {
      IntPtr mod = LoadLibraryW(@"C:\Program Files\Windows Media Player\mpvis.dll");
      P("LoadLibraryW(mpvis.dll) = 0x{0:X} err={1}", mod.ToInt64(), Marshal.GetLastWin32Error());
      if (hook) InstallHooks(mod, pin, logRand);
      Guid clsid = new Guid("0AA02E8D-F851-4CB0-9F64-BBA9BE7A983D");
      hr = CoCreateInstance(ref clsid, IntPtr.Zero, 1, ref iid, out p);
      P("CoCreateInstance(CLSID_AlchemyVis) hr=0x{0:X8}  mpvis handle now 0x{1:X}",
        hr, GetModuleHandleW("mpvis.dll").ToInt64());
    } else {
      P("OleInitialize hr=0x{0:X8}", OleInitialize(IntPtr.Zero));
      IntPtr mod = LoadLibraryW(@"C:\Windows\System32\wmp.dll");
      P("LoadLibraryW(wmp.dll) = 0x{0:X} err={1}", mod.ToInt64(), Marshal.GetLastWin32Error());
      if (mod == IntPtr.Zero) throw new Exception("LoadLibrary wmp.dll failed");
      if (hook) InstallHooks(mod, pin, logRand);
      int rva = vis == "bars" ? 0x41cdb0 : 0x40ba20;
      var fn = (CreateFn)Marshal.GetDelegateForFunctionPointer(IntPtr.Add(mod, rva), typeof(CreateFn));
      hr = fn(IntPtr.Zero, ref iid, out p);
      P("wmp.dll objmap CreateInstance(+0x{0:X}) hr=0x{1:X8} pv=0x{2:X}", rva, hr, p.ToInt64());
      if (vis == "battery") { Obj = IntPtr.Subtract(p, 0xd90); LocatePalette();
        P("pal after CreateInstance: {0}", PalRow()); }
    }
    P("ctor rand draws={0}  srand(seed)={1}", TotalRand, SrandSeen);
    if (hr != 0) throw new COMException("CreateInstance", hr);
    Fx = (IWMPEffects)Marshal.GetTypedObjectForIUnknown(p, typeof(IWMPEffects));
    Marshal.Release(p);
    try { Fx2 = (IWMPEffects2)Fx; } catch (Exception e) { Fx2 = null; P("QI IWMPEffects2 failed: {0}", e.Message); }
  }

  // Find LIVE by its ctor signature: peBlue[i] == i for i = 0..255 (0x18040b4b0's blue ramp).
  static void LocatePalette() {
    for (int off = 0; off < 0xf00; off += 4) {
      bool ok = true;
      for (int i = 0; i < 256 && ok; i++)
        if (Marshal.ReadByte(Obj, off + 4 * i + 2) != (byte)i) ok = false;
      if (ok) { PalOff = off; break; }
    }
    P("CBattery obj=0x{0:X}  LIVE at obj+0x{1:x} (spec says 0x4e4){2}", Obj.ToInt64(), PalOff,
      PalOff == 0x4e4 ? " OK" : " *** MISMATCH ***");
  }

  static string PalRow() {
    int c = PalOff - 0x414;                 // control block: 0xd0 when LIVE is at 0x4e4
    int live = PalOff, from = PalOff - 0x400, to = PalOff + 0x400;
    return string.Format("{0},{1},{2},{3},{4},{5},{6},{7},{8:x8},{9:x8},{10:x8}",
      Marshal.ReadByte(Obj, c),        // bPalettePaused  +0xd0
      Marshal.ReadByte(Obj, c + 1),    // bPaletteAutoCycle +0xd1
      Marshal.ReadInt32(Obj, c + 4),   // paletteChangeCountdown +0xd4
      Marshal.ReadByte(Obj, c + 8),    // bPaletteChangeRequested +0xd8
      Marshal.ReadByte(Obj, c + 9),    // bPaletteFading +0xd9
      Marshal.ReadByte(Obj, c + 10),   // bPaletteDirty +0xda
      Marshal.ReadInt32(Obj, c + 12),  // paletteFadeLen +0xdc
      Marshal.ReadInt32(Obj, c + 16),  // paletteFadeCtr +0xe0
      Fnv(from, 1024), Fnv(live, 1024), Fnv(to, 1024));
  }
  static uint Fnv(int off, int n) {
    uint h = 2166136261;
    for (int i = 0; i < n; i++) { h ^= Marshal.ReadByte(Obj, off + i); h *= 16777619; }
    return h;
  }
  public static string PalDump() {         // full LIVE/TO as hex, for the drift analysis
    var sb = new StringBuilder();
    for (int i = 0; i < 256; i++)
      sb.Append(Marshal.ReadByte(Obj, PalOff + 4 * i)).Append(',')
        .Append(Marshal.ReadByte(Obj, PalOff + 4 * i + 1)).Append(',')
        .Append(Marshal.ReadByte(Obj, PalOff + 4 * i + 2)).Append(' ');
    return sb.ToString();
  }

  public static void Info() {
    string t; uint caps; int n, cur;
    P("GetTitle          hr=0x{0:X8}  '{1}'", Fx.GetTitle(out t), t);
    P("GetCapabilities   hr=0x{0:X8}  0x{1:X}", Fx.GetCapabilities(out caps), caps);
    P("GetPresetCount    hr=0x{0:X8}  {1}", Fx.GetPresetCount(out n), n);
    P("GetCurrentPreset  hr=0x{0:X8}  {1}", Fx.GetCurrentPreset(out cur), cur);
  }
  public static void MediaInfo(int ch) {
    P("MediaInfo({0},44100) hr=0x{1:X8}", ch, Fx.MediaInfo(ch, 44100, ""));
  }
  public static void SetPreset(int i) {
    P("SetCurrentPreset({0}) hr=0x{1:X8}  rand so far={2}", i, Fx.SetCurrentPreset(i), TotalRand);
    if (PalOff >= 0) P("pal after SetPreset:       {0}", PalRow());
  }

  static void MakeSurface() {
    byte[] bmi = new byte[40];
    BitConverter.GetBytes(40).CopyTo(bmi, 0);
    BitConverter.GetBytes(W).CopyTo(bmi, 4);
    BitConverter.GetBytes(-H).CopyTo(bmi, 8);
    BitConverter.GetBytes((short)1).CopyTo(bmi, 12);
    BitConverter.GetBytes((short)32).CopyTo(bmi, 14);
    Hdc = CreateCompatibleDC(IntPtr.Zero);
    Hbm = CreateDIBSection(Hdc, bmi, 0, out Bits, IntPtr.Zero, 0);
    if (Hbm == IntPtr.Zero) throw new Exception("CreateDIBSection failed");
    SelectObject(Hdc, Hbm);
  }
  static IntPtr MakeWindow() {
    Hwnd = CreateWindowExW(0x80, "STATIC", "wmpvis", unchecked((int)0x80000000),
        -4000, -4000, W, H, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
    if (Hwnd == IntPtr.Zero) throw new Exception("CreateWindowEx failed " + Marshal.GetLastWin32Error());
    return Hwnd;
  }

  public static string ProbeDir = null;     // when set, the Prepare() probe frame is dumped too
  public static void Prepare() {
    MakeSurface();
    RECT rc = new RECT(); rc.right = W; rc.bottom = H;
    Marshal.WriteInt32(Tl, 4096, 2);
    MarkFrame();
    int hr = Fx.Render(Tl, Hdc, ref rc);
    P("probe Render hr=0x{0:X8}  rand so far={1}", hr, TotalRand);
    if (ProbeDir != null && Obj != IntPtr.Zero) {
      Directory.CreateDirectory(ProbeDir); SaveIdx(Path.Combine(ProbeDir, "frame_-001.idx"));
    }
    if (PalOff >= 0) P("pal after probe Render:    {0}", PalRow());
    if (hr < 0 && Fx2 != null) {
      P("IWMPEffects2::Create(hwnd) hr=0x{0:X8}", Fx2.Create(MakeWindow()));
      hr = Fx.Render(Tl, Hdc, ref rc);
      P("probe Render (after Create) hr=0x{0:X8}", hr);
    }
    if (hr < 0) throw new COMException("Render", hr);
  }

  public static void Run(string framesPath, string outDir, int max, int pngEvery, bool pal, bool hash, int rawEvery, int latePreset, bool rawIndex) {
    byte[] b = File.ReadAllBytes(framesPath);
    const int per = 4100;
    int n = b.Length / per;
    if (max > 0 && max < n) n = max;
    Directory.CreateDirectory(outDir);
    P("frames={0} out={1}", n, outDir);
    RECT rc = new RECT(); rc.right = W; rc.bottom = H;
    StringBuilder csv = new StringBuilder("frame,state,hr,rand,ihash,hash,mean_lum,black_frac,p90_lum,mean_sat,lit_sat,lit_lum,mean_r,mean_g,mean_b,edge\n");
    StringBuilder pcsv = new StringBuilder("frame,paused,autocycle,countdown,req,fading,dirty,fadeLen,fadeCtr,hFROM,hLIVE,hTO\n");
    StringBuilder lcsv = new StringBuilder();     // the whole LIVE table, per frame
    var sw = System.Diagnostics.Stopwatch.StartNew();
    for (int f = 0; f < n; f++) {
      int off = f * per;
      Marshal.Copy(b, off, Tl, 4096);
      int state = BitConverter.ToInt32(b, off + 4096);
      Marshal.WriteInt32(Tl, 4096, state);
      Marshal.WriteInt64(Tl, 4104, (long)f * 166667);
      if (f == 1 && latePreset >= 0) SetPreset(latePreset);
      Frame = f; MarkFrame();
      int r0 = TotalRand;
      int hr = Fx.Render(Tl, Hdc, ref rc);
      GdiFlush();
      csv.Append(f).Append(',').Append(state).Append(',').Append(hr == 0 ? "0" : hr.ToString("X8"))
         .Append(',').Append(TotalRand - r0)
         .Append(',').Append(Obj != IntPtr.Zero ? IdxHash().ToString("x8") : "")
         .Append(',').Append(hash ? SurfHash().ToString("x8") : "")
         .Append(',').Append(Stats()).Append('\n');
      if (pal && PalOff >= 0) { pcsv.Append(f).Append(',').Append(PalRow()).Append('\n');
        lcsv.Append(f).Append(',').Append(PalDump()).Append('\n'); }
      if (pngEvery > 0 && (f % pngEvery) == 0) SavePng(Path.Combine(outDir, string.Format("frame_{0:0000}.png", f)));
      if (rawEvery > 0 && (f % rawEvery) == 0) {
        if (rawIndex) SaveIdx(Path.Combine(outDir, string.Format("frame_{0:0000}.idx", f)));
        else          SaveRaw(Path.Combine(outDir, string.Format("frame_{0:0000}.raw", f)));
      }
      if ((f % 300) == 0) P("  f={0} {1:F1}s rand={2}", f, sw.Elapsed.TotalSeconds, TotalRand);
    }
    File.WriteAllText(Path.Combine(outDir, "stats.csv"), csv.ToString());
    if (pal && PalOff >= 0) {
      File.WriteAllText(Path.Combine(outDir, "pal.csv"), pcsv.ToString());
      File.WriteAllText(Path.Combine(outDir, "pal_final.txt"), PalDump());
      File.WriteAllText(Path.Combine(outDir, "live.csv"), lcsv.ToString());
    }
    WriteRandLog(outDir);
    P("done {0} frames in {1:F1}s rand={2}", n, sw.Elapsed.TotalSeconds, TotalRand);
    File.WriteAllText(Path.Combine(outDir, "host.log"), Log.ToString());
  }

  static uint SurfHash() {
    Marshal.Copy(Bits, px, 0, px.Length);
    uint h = 2166136261;
    for (int i = 0; i < px.Length; i++) {
      int v = px[i];
      h ^= (uint)(v & 255); h *= 16777619;
      h ^= (uint)((v >> 8) & 255); h *= 16777619;
      h ^= (uint)((v >> 16) & 255); h *= 16777619;
    }
    return h;
  }

  static string Stats() {
    Marshal.Copy(Bits, px, 0, px.Length);
    double lsum = 0, ssum = 0, litsat = 0, litlum = 0, rs = 0, gs = 0, bs = 0;
    int black = 0, lit = 0;
    int[] hist = new int[256];
    for (int i = 0; i < px.Length; i++) {
      int v = px[i], r = (v >> 16) & 255, g = (v >> 8) & 255, b2 = v & 255;
      int lum = (int)(0.299 * r + 0.587 * g + 0.114 * b2 + 0.5);
      lsum += lum; hist[lum]++; rs += r; gs += g; bs += b2;
      int mx = r > g ? (r > b2 ? r : b2) : (g > b2 ? g : b2);
      int mn = r < g ? (r < b2 ? r : b2) : (g < b2 ? g : b2);
      double sat = mx > 0 ? (double)(mx - mn) / mx : 0;
      ssum += sat;
      if (mx < 8) black++; else { lit++; litsat += sat; litlum += lum; }
    }
    int need = (int)(0.90 * px.Length), acc = 0, p90 = 0;
    for (int i = 0; i < 256; i++) { acc += hist[i]; if (acc >= need) { p90 = i; break; } }
    double esum = 0; int ecnt = 0;
    for (int y = 0; y < H; y++) {
      int row = y * W, prev = -1;
      for (int x = 0; x < W; x++) {
        int v = px[row + x];
        int l = (int)(0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255) + 0.5);
        if (x > 0) { esum += Math.Abs(l - prev); ecnt++; }
        prev = l;
      }
    }
    double np = px.Length;
    return string.Format("{0:F5},{1:F6},{2},{3:F6},{4:F6},{5:F4},{6:F4},{7:F4},{8:F4},{9:F4}",
      lsum / np, black / np, p90, ssum / np, lit > 0 ? litsat / lit : 0, lit > 0 ? litlum / lit : 0,
      rs / np, gs / np, bs / np, esum / ecnt);
  }

  public static void SavePng(string path) {
    using (Bitmap bm = new Bitmap(W, H, W * 4, PixelFormat.Format32bppRgb, Bits)) bm.Save(path, ImageFormat.Png);
  }
  // The 8-bit palettised FRONT surface itself: obj+0xc0 -> CSurface{+0x08 w, +0x0c h, +0x20 bits}
  // (spec 10 section 2.1).  This is what the effects wrote, before StretchBlt's palette expansion.
  public static byte[] FrontIdx() { return Idx(0xc0); }
  public static byte[] BackIdx()  { return Idx(0xc8); }   // == the pre-blur image at end of frame
  static byte[] Idx(int slot) {
    IntPtr surf = Marshal.ReadIntPtr(Obj, slot);
    int w = Marshal.ReadInt32(surf, 8), h = Marshal.ReadInt32(surf, 0xc);
    IntPtr bits = Marshal.ReadIntPtr(surf, 0x20);
    byte[] o = new byte[w * h];
    Marshal.Copy(bits, o, 0, o.Length);
    return o;
  }
  public static void SaveIdx(string path) {
    File.WriteAllBytes(path, FrontIdx());
    File.WriteAllBytes(Path.ChangeExtension(path, ".bidx"), BackIdx());
  }
  public static uint IdxHash() {
    byte[] o = FrontIdx();
    uint h = 2166136261;
    for (int i = 0; i < o.Length; i++) { h ^= o[i]; h *= 16777619; }
    return h;
  }
  public static void SaveRaw(string path) {
    Marshal.Copy(Bits, px, 0, px.Length);
    byte[] o = new byte[px.Length * 4]; Buffer.BlockCopy(px, 0, o, 0, o.Length);
    File.WriteAllBytes(path, o);
  }
}
'@ -ReferencedAssemblies System.Drawing

[AlcHost]::Create($Vis, $Width, $Height, $PinTime, -not $NoHook, [bool]$RandLog)
[AlcHost]::Info()
if ($Info) { return }
if ($Channels -gt 0) { [AlcHost]::MediaInfo($Channels) }
if ($Preset -ge 0) { [AlcHost]::SetPreset($Preset) }
if ($RawIndex -and $RawEvery -gt 0) { [AlcHost]::ProbeDir = $Out }
[AlcHost]::Prepare()
[AlcHost]::Run($Frames, $Out, $Max, $PngEvery, [bool]$Pal, [bool]$Hash, $RawEvery, $LatePreset, [bool]$RawIndex)
