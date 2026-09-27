# Ground-truth host for WMP's Alchemy visualizer: hosts CLSID {0AA02E8D-...} directly (no WMP UI),
# renders scripted TimedLevel frames into a 640x480 memory DIB, dumps PNGs + a stats CSV.
#   powershell -NoProfile -ExecutionPolicy Bypass -File host.ps1 [-Frames frames.bin] [-Out out]
#             [-Max 0] [-PngEvery 1] [-Preset -1] [-Info]
# All COM work happens inside the C# class on this (STA) thread; PowerShell only passes args,
# because PS 5.1 late-binds __ComObject through IDispatch and Alchemy has none.
param(
  [string]$Frames = "$PSScriptRoot\frames.bin",
  [string]$ProbeRaw = "",
  [string]$Out    = "$PSScriptRoot\out",
  [int]$Max       = 0,          # 0 = all frames in the file
  [int]$PngEvery  = 1,          # write a PNG every Nth frame (0 = none)
  [int]$Preset    = -1,         # -1 = leave whatever the object defaults to
  [switch]$Info,                # only print GetTitle/GetPresetCount/GetPresetTitle/GetCapabilities
  [int]$RawEvery = 0,
  [int]$LumaEvery = 0           # append a 640x480 8-bit luma plane to luma.bin every Nth frame
)
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
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

public static class AlcHost {
  const int W = 640, H = 480;
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

  static IntPtr Hdc, Bits, Hbm, Hwnd;
  static IWMPEffects Fx;
  static IWMPEffects2 Fx2;
  const int TL_SIZE = 4096 + 8 + 8;   // freq[2][1024] wave[2][1024] int state; __int64 ts (8-aligned)
  static IntPtr Tl = Marshal.AllocHGlobal(TL_SIZE);
  static int[] px = new int[W * H];
  public static StringBuilder Log = new StringBuilder();
  static void P(string f, params object[] a) { string s = string.Format(f, a); Log.AppendLine(s); Console.WriteLine(s); }

  public static void Create() {
    Guid clsid = new Guid("0AA02E8D-F851-4CB0-9F64-BBA9BE7A983D");
    Guid iid = new Guid("D3984C13-C3CB-48e2-8BE5-5168340B4F35");
    IntPtr p;
    int hr = CoCreateInstance(ref clsid, IntPtr.Zero, 1 /*CLSCTX_INPROC_SERVER*/, ref iid, out p);
    P("CoCreateInstance(CLSID_AlchemyVis, IID_IWMPEffects) hr=0x{0:X8}", hr);
    if (hr != 0) throw new COMException("CoCreateInstance", hr);
    Fx = (IWMPEffects)Marshal.GetTypedObjectForIUnknown(p, typeof(IWMPEffects));
    Marshal.Release(p);
    try { Fx2 = (IWMPEffects2)Fx; } catch (Exception e) { Fx2 = null; P("QI IWMPEffects2 failed: {0}", e.Message); }
    P("IWMPEffects2: {0}", Fx2 != null ? "yes" : "no");
  }

  public static void Info() {
    string t; uint caps; int n, cur;
    P("GetTitle          hr=0x{0:X8}  '{1}'", Fx.GetTitle(out t), t);
    P("GetCapabilities   hr=0x{0:X8}  0x{1:X}", Fx.GetCapabilities(out caps), caps);
    P("GetPresetCount    hr=0x{0:X8}  {1}", Fx.GetPresetCount(out n), n);
    P("GetCurrentPreset  hr=0x{0:X8}  {1}", Fx.GetCurrentPreset(out cur), cur);
    for (int i = 0; i < n; i++) { string pt; int hr = Fx.GetPresetTitle(i, out pt);
      P("  preset[{0}] hr=0x{1:X8}  '{2}'", i, hr, pt); }
  }

  public static void SetPreset(int i) { P("SetCurrentPreset({0}) hr=0x{1:X8}", i, Fx.SetCurrentPreset(i)); }

  static void MakeSurface() {                 // 640x480 top-down 32bpp DIB in a memory DC
    byte[] bmi = new byte[40];
    BitConverter.GetBytes(40).CopyTo(bmi, 0);
    BitConverter.GetBytes(W).CopyTo(bmi, 4);
    BitConverter.GetBytes(-H).CopyTo(bmi, 8);       // negative height => top-down rows
    BitConverter.GetBytes((short)1).CopyTo(bmi, 12);
    BitConverter.GetBytes((short)32).CopyTo(bmi, 14);
    Hdc = CreateCompatibleDC(IntPtr.Zero);
    Hbm = CreateDIBSection(Hdc, bmi, 0, out Bits, IntPtr.Zero, 0);
    if (Hbm == IntPtr.Zero) throw new Exception("CreateDIBSection failed");
    SelectObject(Hdc, Hbm);
  }

  static IntPtr MakeWindow() {                // hidden off-screen popup; never shown
    Hwnd = CreateWindowExW(0x80 /*WS_EX_TOOLWINDOW*/, "STATIC", "alcvis",
        unchecked((int)0x80000000) /*WS_POPUP*/, -4000, -4000, W, H,
        IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
    if (Hwnd == IntPtr.Zero) throw new Exception("CreateWindowEx failed " + Marshal.GetLastWin32Error());
    return Hwnd;
  }

  public static void Prepare() {               // surface + whatever Render turns out to need
    MakeSurface();
    RECT rc = new RECT(); rc.right = W; rc.bottom = H;
    byte[] sil = new byte[TL_SIZE];            // deterministic silent probe frame
    for (int i = 2048; i < 4096; i++) sil[i] = 128;
    Marshal.Copy(sil, 0, Tl, TL_SIZE);
    Marshal.WriteInt32(Tl, 4096, 2);           // play_state
    int hr = Fx.Render(Tl, Hdc, ref rc);
    P("probe Render (no Create) hr=0x{0:X8}", hr);
    if (ProbeRaw != null) { Directory.CreateDirectory(Path.GetDirectoryName(ProbeRaw)); SaveRaw(ProbeRaw); }
    if (hr != 0 && Fx2 != null) {
      P("IWMPEffects2::Create(hwnd) hr=0x{0:X8}", Fx2.Create(MakeWindow()));
      hr = Fx.Render(Tl, Hdc, ref rc);
      P("probe Render (after Create) hr=0x{0:X8}", hr);
    }
    if (hr != 0) throw new COMException("Render", hr);
  }

  public static int LumaEvery = 0;
  public static int RawEvery = 0;
  public static string ProbeRaw = null;
  public static void Run(string framesPath, string outDir, int max, int pngEvery) {
    byte[] b = File.ReadAllBytes(framesPath);
    const int per = 4100;                      // 4096 payload + int32 state
    int n = b.Length / per;
    if (max > 0 && max < n) n = max;
    Directory.CreateDirectory(outDir);
    P("frames={0} ({1} in file) out={2}", n, b.Length / per, outDir);
    RECT rc = new RECT(); rc.right = W; rc.bottom = H;
    StringBuilder csv = new StringBuilder("frame,state,hr,mean_lum,black_frac,p90_lum,mean_sat,lit_sat,lit_lum,mean_r,mean_g,mean_b,edge\n");
    var sw = System.Diagnostics.Stopwatch.StartNew();
    for (int f = 0; f < n; f++) {
      int off = f * per;
      Marshal.Copy(b, off, Tl, 4096);
      int state = BitConverter.ToInt32(b, off + 4096);
      Marshal.WriteInt32(Tl, 4096, state);
      Marshal.WriteInt64(Tl, 4104, (long)f * 166667);    // 1/60 s in 100ns ticks
      int hr = Fx.Render(Tl, Hdc, ref rc);
      csv.Append(f).Append(',').Append(state).Append(',').Append(hr == 0 ? "0" : hr.ToString("X8"))
         .Append(',').Append(Stats()).Append('\n');
      if (LumaEvery > 0 && (f % LumaEvery) == 0) WriteLuma();
      if (RawEvery > 0 && (f % RawEvery) == 0) SaveRaw(Path.Combine(outDir, string.Format("raw_{0:0000}.bin", f)));
      if (pngEvery > 0 && (f % pngEvery) == 0) SavePng(Path.Combine(outDir, string.Format("frame_{0:0000}.png", f)));
      if ((f % 300) == 0) P("  f={0} {1:F1}s", f, sw.Elapsed.TotalSeconds);
    }
    CloseLuma();
    File.WriteAllText(Path.Combine(outDir, "stats.csv"), csv.ToString());
    P("done {0} frames in {1:F1}s -> {2}", n, sw.Elapsed.TotalSeconds, Path.Combine(outDir, "stats.csv"));
    File.WriteAllText(Path.Combine(outDir, "host.log"), Log.ToString());
  }

  static string Stats() {
    GdiFlush();
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
    // edge energy: mean |d(luma)/dx| over the frame, the crisp-vs-smeared discriminator
    double esum = 0; int ecnt = 0;
    for (int y = 0; y < 480; y++) {
      int row = y * 640, prev = -1;
      for (int x = 0; x < 640; x++) {
        int v = px[row + x];
        int l = (int)(0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255) + 0.5);
        if (x > 0) { esum += Math.Abs(l - prev); ecnt++; }
        prev = l;
      }
    }
    double n = px.Length;
    return string.Format("{0:F5},{1:F6},{2},{3:F6},{4:F6},{5:F4},{6:F4},{7:F4},{8:F4},{9:F4}",
      lsum / n, black / n, p90, ssum / n, lit > 0 ? litsat / lit : 0, lit > 0 ? litlum / lit : 0,
      rs / n, gs / n, bs / n, esum / ecnt);
  }

  static FileStream Luma;
  static byte[] LumaBuf = new byte[W * H];
  public static void OpenLuma(string path) { Luma = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 20); }
  public static void WriteLuma() {
    GdiFlush(); Marshal.Copy(Bits, px, 0, px.Length);
    for (int i = 0; i < px.Length; i++) {
      int v = px[i];
      LumaBuf[i] = (byte)(int)(0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255) + 0.5);
    }
    Luma.Write(LumaBuf, 0, LumaBuf.Length);
  }
  public static void CloseLuma() { if (Luma != null) { Luma.Flush(); Luma.Close(); Luma = null; } }
  public static void SavePng(string path) {
    using (Bitmap bm = new Bitmap(W, H, W * 4, PixelFormat.Format32bppRgb, Bits)) bm.Save(path, ImageFormat.Png);
  }
  // raw 640x480 BGRX dump, for pixel-level drilldowns
  public static void SaveRaw(string path) {
    GdiFlush(); Marshal.Copy(Bits, px, 0, px.Length);
    byte[] o = new byte[px.Length * 4]; Buffer.BlockCopy(px, 0, o, 0, o.Length);
    File.WriteAllBytes(path, o);
  }
}
'@ -ReferencedAssemblies System.Drawing

if ($ProbeRaw -ne "") { [AlcHost]::ProbeRaw = $ProbeRaw }
Write-Host ("EPOCH_BEFORE=" + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
[AlcHost]::Create()
Write-Host ("EPOCH_AFTER=" + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
[AlcHost]::Info()
if ($Info) { return }
if ($Preset -ge 0) { [AlcHost]::SetPreset($Preset) }
[AlcHost]::Prepare()
if ($LumaEvery -gt 0) {
  New-Item -ItemType Directory -Force -Path $Out | Out-Null
  [AlcHost]::LumaEvery = $LumaEvery
  [AlcHost]::OpenLuma((Join-Path $Out 'luma.bin'))
}
if ($RawEvery -gt 0) { New-Item -ItemType Directory -Force -Path $Out | Out-Null; [AlcHost]::RawEvery = $RawEvery }
[AlcHost]::Run($Frames, $Out, $Max, $PngEvery)
