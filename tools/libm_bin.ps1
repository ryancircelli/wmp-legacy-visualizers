# libm_bin.ps1 -Fn sin|cos|atan2 -In args.bin -> args.bin.<fn>: ucrtbase.dll evaluated over raw little-endian
# doubles (atan2: (y,x) pairs), millions per second. Produced the ucrtbase answers behind tests/trig-ucrt.bin.
param([string]$Fn,[string]$In)
Add-Type -TypeDefinition @'
using System; using System.IO; using System.Runtime.InteropServices;
public static class O {
  [DllImport("ucrtbase.dll", CallingConvention=CallingConvention.Cdecl)] static extern double sin(double x);
  [DllImport("ucrtbase.dll", CallingConvention=CallingConvention.Cdecl)] static extern double cos(double x);
  [DllImport("ucrtbase.dll", CallingConvention=CallingConvention.Cdecl)] static extern double atan2(double y, double x);
  [DllImport("ucrtbase.dll", CallingConvention=CallingConvention.Cdecl)] public static extern int _get_FMA3_enable();
  public static void Run(string fn, string path) {
    byte[] b = File.ReadAllBytes(path); int n = b.Length / 8; double[] a = new double[n];
    Buffer.BlockCopy(b, 0, a, 0, b.Length);
    double[] r;
    if (fn == "atan2") { r = new double[n/2]; for (int i = 0; i < n/2; i++) r[i] = atan2(a[2*i], a[2*i+1]); }
    else { r = new double[n]; if (fn == "sin") for (int i = 0; i < n; i++) r[i] = sin(a[i]); else for (int i = 0; i < n; i++) r[i] = cos(a[i]); }
    byte[] o = new byte[r.Length * 8]; Buffer.BlockCopy(r, 0, o, 0, o.Length);
    File.WriteAllBytes(path + "." + fn, o);
  }
}
'@
[O]::Run($Fn, $In)
Write-Host ("orc: fma3={0} {1} {2}" -f [O]::_get_FMA3_enable(), $Fn, $In)
