# libm.ps1 -In list.txt : each line "fn hexbits[,hexbits]" -> "fn args -> resulthexbits"
# Evaluates ucrtbase.dll's math functions, i.e. exactly the ones wmp.dll imports
# (0x1807f5198 sin, 0x1807f50c8 cos, 0x1807f50a0 atan2, 0x1807f51a0 sqrt).
param([string]$In)
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class M {
  [DllImport("ucrtbase.dll", CallingConvention=CallingConvention.Cdecl)] public static extern double sin(double x);
  [DllImport("ucrtbase.dll", CallingConvention=CallingConvention.Cdecl)] public static extern double cos(double x);
  [DllImport("ucrtbase.dll", CallingConvention=CallingConvention.Cdecl)] public static extern double sqrt(double x);
  [DllImport("ucrtbase.dll", CallingConvention=CallingConvention.Cdecl)] public static extern double tan(double x);
  [DllImport("ucrtbase.dll", CallingConvention=CallingConvention.Cdecl)] public static extern double atan2(double y, double x);
  [DllImport("ucrtbase.dll", CallingConvention=CallingConvention.Cdecl)] public static extern double pow(double x, double y);
  [DllImport("ucrtbase.dll", CallingConvention=CallingConvention.Cdecl)] public static extern double exp(double x);
  [DllImport("ucrtbase.dll", CallingConvention=CallingConvention.Cdecl)] public static extern double log(double x);
}
'@
function D([string]$h) { [BitConverter]::ToDouble([BitConverter]::GetBytes([Convert]::ToUInt64($h,16)),0) }
$out = New-Object System.Text.StringBuilder
$n = 0
foreach ($line in [IO.File]::ReadAllLines($In)) {
  if ($line -eq '') { continue }
  $t = $line.Split(' ')
  $fn = $t[0]; $p = $t[1].Split(',')
  $x = D $p[0]
  if ($p.Count -gt 1) { $y = D $p[1]; $r = [M]::$fn($x,$y) }
  else { $r = [M]::$fn($x) }
  $n++
  [void]$out.AppendLine(("{0} {1} -> {2}" -f $fn, $t[1], [BitConverter]::ToUInt64([BitConverter]::GetBytes($r),0).ToString("x16")))
}
[IO.File]::WriteAllText("$In.out", $out.ToString())
# No Write-Host of the result: these batches run to millions of lines.
Write-Host ("libm.ps1: {0} evaluations -> {1}.out" -f $n, $In)
