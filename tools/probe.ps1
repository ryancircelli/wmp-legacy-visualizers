$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int left, top, right, bottom; }
[ComImport, Guid("D3984C13-C3CB-48e2-8BE5-5168340B4F35"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
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
public static class P {
  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  public delegate int CreateFn(IntPtr outer, ref Guid iid, out IntPtr ppv);
  [DllImport("kernel32", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr LoadLibraryW(string s);
  [DllImport("ole32")] static extern int OleInitialize(IntPtr r);
  public static void Go() {
    Console.WriteLine("apartment: " + System.Threading.Thread.CurrentThread.GetApartmentState());
    int hr = OleInitialize(IntPtr.Zero); Console.WriteLine("OleInitialize hr=0x{0:X8}", hr);
    IntPtr b = LoadLibraryW(@"C:\Windows\System32\wmp.dll");
    Console.WriteLine("LoadLibrary wmp.dll = 0x{0:X} err={1}", b.ToInt64(), Marshal.GetLastWin32Error());
    if (b == IntPtr.Zero) return;
    Guid iid = new Guid("D3984C13-C3CB-48e2-8BE5-5168340B4F35");
    foreach (var t in new[]{ new object[]{"Bars", 0x41cdb0}, new object[]{"Battery", 0x40ba20} }) {
      string nm = (string)t[0]; int rva = (int)t[1];
      var fn = (CreateFn)Marshal.GetDelegateForFunctionPointer(IntPtr.Add(b, rva), typeof(CreateFn));
      IntPtr pv;
      int h2 = fn(IntPtr.Zero, ref iid, out pv);
      Console.WriteLine("{0} create hr=0x{1:X8} pv=0x{2:X}", nm, h2, pv.ToInt64());
      if (h2 != 0 || pv == IntPtr.Zero) continue;
      var fx = (IWMPEffects)Marshal.GetTypedObjectForIUnknown(pv, typeof(IWMPEffects));
      string s; int n, cur; uint caps;
      Console.WriteLine("  GetTitle hr=0x{0:X8} '{1}'", fx.GetTitle(out s), s);
      Console.WriteLine("  GetCaps  hr=0x{0:X8} 0x{1:X}", fx.GetCapabilities(out caps), caps);
      Console.WriteLine("  Count    hr=0x{0:X8} {1}", fx.GetPresetCount(out n), n);
      Console.WriteLine("  Current  hr=0x{0:X8} {1}", fx.GetCurrentPreset(out cur), cur);
      for (int i=0;i<n;i++){ string pt; int h3=fx.GetPresetTitle(i, out pt); Console.WriteLine("  [{0,2}] hr=0x{1:X8} '{2}'", i, h3, pt); }
    }
  }
}
'@
[P]::Go()
