# Runs loopback-rec.exe (beside this script) hidden, prints its JSON line, stderr and exit code.
# From WSL: powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File <dir>\run.ps1 -ToolArgs "--out <dir>\x.wav --seconds 3"
param([Parameter(Mandatory)][string]$ToolArgs, [int]$TimeoutSec = 60)

function Start-Tool([string]$a) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = Join-Path $PSScriptRoot 'loopback-rec.exe'
  $psi.Arguments = $a
  $psi.WorkingDirectory = $PSScriptRoot
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  [System.Diagnostics.Process]::Start($psi)
}

$p = Start-Tool $ToolArgs
$out = $p.StandardOutput.ReadToEndAsync()
$err = $p.StandardError.ReadToEndAsync()
if (-not $p.WaitForExit($TimeoutSec * 1000)) {
  # only the tree we started, by PID
  & taskkill.exe /F /T /PID $p.Id | Out-Null
  Write-Output "TIMEOUT: killed PID $($p.Id)"
  # a hard kill skips the tool's own restore; a zero-length run applies the state it saved
  $r = Start-Tool '--out NUL --seconds 0'
  $r.WaitForExit(10000) | Out-Null
  Write-Output ("restore run: " + $r.StandardError.ReadToEnd().Trim())
}
$p.WaitForExit()
Write-Output $out.Result.TrimEnd()
if ($err.Result) { Write-Output ("stderr: " + $err.Result.TrimEnd()) }
Write-Output "exit $($p.ExitCode)"
