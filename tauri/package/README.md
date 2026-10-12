# WMP Legacy Visualizers for Windows

The Windows Media Player 9 visualizers (Alchemy, Bars and Waves, Battery), ported 1:1 from the
original DLLs, in the WMP 9 skin. Source, and the other download:
https://github.com/ryancircelli/wmp-legacy-visualizers

- **AlchemyScreensaver-win64.zip**: `Alchemy.scr`, the screensaver, and the player window it opens
  when run on its own (where the visualizer, preset, frame rate and scale are chosen).
- **WmpSpotify-win64.zip**: `WmpSpotify.exe`, the same player as a Spotify client. Spotify's own web
  player runs inside it; log in once (File > Log out to switch accounts).

Each is one self-contained file: no installer, nothing has to stay next to it. They need the
WebView2 runtime, which ships with Windows 11 and current Windows 10.

## The screensaver

Right-click `Alchemy.scr` > **Install**, or run

    powershell -ExecutionPolicy Bypass -File .\install.ps1              # 10 minutes idle
    powershell -ExecutionPolicy Bypass -File .\install.ps1 -Timeout 300 # 5 minutes

No admin rights are needed. `install.ps1` saves the previous screensaver settings first, and
`uninstall.ps1` puts them back. Screen Saver Settings > Settings opens the player window, where
the choice is made.

## What it keeps, and where

`%LOCALAPPDATA%\WmpLegacyVisualizers\tauri\`: the settings, the Spotify login, the window's position,
page updates and `alchemy.log`. Settings and the login survive new downloads. The first launch of
this version copies the settings and the Spotify login over from the previous version's folders
beside it (which are left as they were); close the previous version first, or it is done the next
time.

The visualizers follow whatever the speakers play, with no permission prompt. Fixes to the page
arrive by themselves at the next launch; when a new download is needed, the app says so (Help >
Download the New Version).

**SmartScreen:** the files are unsigned, so the first run shows "Windows protected your PC": click
*More info* > *Run anyway*.

A `settings.json` beside the exe, or in that `tauri` folder, can set `browserArgs`: the WebView2
browser arguments, in place of the built-in ones.
