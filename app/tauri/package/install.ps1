<#
  Installs Alchemy.scr as the current user's screensaver. No admin rights needed:
  everything lives under HKCU\Control Panel\Desktop.

    .\install.ps1                # Alchemy.scr next to this script, 10 minute timeout
    .\install.ps1 -Timeout 300   # 5 minutes

  The previous SCRNSAVE.EXE / ScreenSaveActive / ScreenSaveTimeOut are saved to
  %LOCALAPPDATA%\WmpLegacyVisualizers\screensaver-backup.json first; uninstall.ps1 puts them back.
  Installing over an earlier version keeps the backup it made, so uninstall still restores what was
  there before any of them.
#>
param(
  [string]$Scr = (Join-Path $PSScriptRoot 'Alchemy.scr'),
  [int]$Timeout = 600
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Scr)) { throw "not found: $Scr" }
$Scr = (Resolve-Path $Scr).Path

$key = 'HKCU:\Control Panel\Desktop'
$backupDir = Join-Path $env:LOCALAPPDATA 'WmpLegacyVisualizers'
$backup = Join-Path $backupDir 'screensaver-backup.json'

# Save the old values once. Re-running install must not overwrite the real originals
# with Alchemy's own settings.
if (-not (Test-Path $backup)) {
  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
  $p = Get-ItemProperty -Path $key
  [pscustomobject]@{
    'SCRNSAVE.EXE'      = $p.'SCRNSAVE.EXE'
    'ScreenSaveActive'  = $p.'ScreenSaveActive'
    'ScreenSaveTimeOut' = $p.'ScreenSaveTimeOut'
  } | ConvertTo-Json | Set-Content -Path $backup -Encoding UTF8
  Write-Host "saved previous settings -> $backup"
}

Set-ItemProperty -Path $key -Name 'SCRNSAVE.EXE'      -Value $Scr
Set-ItemProperty -Path $key -Name 'ScreenSaveActive'  -Value '1'
Set-ItemProperty -Path $key -Name 'ScreenSaveTimeOut' -Value "$Timeout"

# Make the session pick it up without a logout.
rundll32.exe user32.dll,UpdatePerUserSystemParameters 1, True

Write-Host "screensaver = $Scr  (after $Timeout s idle)"
Write-Host "check it with: Screen Saver Settings (control desk.cpl,,@screensaver)"
