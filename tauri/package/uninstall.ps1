<#
  Restores whatever screensaver settings were in place before install.ps1 ran.
  Values with no previous setting are removed rather than blanked.

  It leaves %LOCALAPPDATA%\WmpLegacyVisualizers alone: its tauri\ folder holds the saved visualizer
  settings, the Spotify login, the window position and the log (the rest is an earlier version's).
  Delete it by hand to remove every trace.
#>
$ErrorActionPreference = 'Stop'

$key = 'HKCU:\Control Panel\Desktop'
$backup = Join-Path $env:LOCALAPPDATA 'WmpLegacyVisualizers\screensaver-backup.json'
if (-not (Test-Path $backup)) { throw "no backup at $backup - nothing to restore" }

$old = Get-Content -Path $backup -Raw | ConvertFrom-Json
foreach ($name in 'SCRNSAVE.EXE', 'ScreenSaveActive', 'ScreenSaveTimeOut') {
  $v = $old.$name
  if ([string]::IsNullOrEmpty($v)) {
    Remove-ItemProperty -Path $key -Name $name -ErrorAction SilentlyContinue
    Write-Host "removed $name"
  } else {
    Set-ItemProperty -Path $key -Name $name -Value $v
    Write-Host "restored $name = $v"
  }
}
Remove-Item -Path $backup
rundll32.exe user32.dll,UpdatePerUserSystemParameters 1, True
Write-Host 'done'
