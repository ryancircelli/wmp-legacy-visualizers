# WMP Spotify for iPhone

`WmpSpotify.exe`'s player as an iPhone app. The app is one WKWebView on https://open.spotify.com/, opened
with a desktop user agent so Spotify serves its full web player. Our page is injected over it as an
overlay, as CONTRACT.md v6.1 describes: `WmpSpotify/observer.js` runs at document start, reads the web
player's token, state and query hashes from its own traffic, and mounts the skin in a shadow root on
top. Spotify's page is never driven through its DOM.

The page is not built into the app. Each launch fetches `spotify-inject.js` from wmp.ryancircelli.com
(what deploy.yml publishes) and caches it, so a fix to the player reaches the phone without a new build.
Playback is meant to carry on with the phone locked (the audio background mode).

The visualizers hear a broadcast upload extension (`WmpSpotifyBroadcast/`), the system-level capture a
screen recording uses. It receives the system's mix of every app's audio, so it has Spotify wherever it
plays: a system screen recording of the app carries the music (checked 2026-09-30), where ReplayKit's
in-app capture delivered only zeros from the web view (build 7; WebKit's audio comes out of a process
in-app capture does not hear). The extension sends its audio to the app over a Unix socket,
`audio.sock` in the App Group container group.com.rcircelli.wmpspotify (`AudioServer` in App.swift):
loopback TCP from the extension to the app never connected (build 9). Each frame is the body's length
(4 bytes, little-endian), a type byte and the body: type 0 `{"rate":n}` first, then type 1 with each
buffer as interleaved stereo int16 LE. The app cannot pass it to the page over a socket, since WebKit
refuses ws:// from Spotify's https page (build 6), so it runs `__wmpAudio.pcm(<base64>, n)` in the
page by evaluateJavaScript, batched every 100 ms, and `observer.js` hands that to the page as its
audio socket. There is no microphone
anywhere: the app's audio session is plain playback, and the picker has no microphone button.

To start it: about 2 s after launch the app opens iOS's broadcast sheet by itself (the button at the
right end of the band opens it too). Tap Start Broadcast; after a 3 s countdown the red indicator in
the status bar stays for as long as it runs. Stop it from that indicator or from Control Center. When
the app closes, the extension keeps the broadcast and tries its socket again every second, so the
app opened again resumes the visualizers on the same broadcast; 5 min without the app ends it with
"WMP Spotify is not running (<the connection's last state>)". Between broadcasts the visualizers go
dark. The band under the web view
shows the host's last log line (scene changes go only to the list): tap it to reload the page,
long-press it for the whole log, scrolled to its end, with Copy (all of it to the clipboard) and Clear.
The log persists across launches in `host.log` in the App Group container (the last 3000 lines, each
timestamped, a `---- launch <date> ----` line at each start). The extension logs each broadcast to
`broadcast.log` in the same container; the app merges its lines into the host log, prefixed `ext:`,
when the list opens and 8 s after the broadcast sheet comes up, each line once.

## Building

No Xcode project is checked in. `ios/project.yml` is an [XcodeGen](https://github.com/yonaskolb/XcodeGen)
spec; `xcodegen generate --spec ios/project.yml` writes `ios/WmpSpotify.xcodeproj` (scheme WmpSpotify),
and both targets' Info.plist and .entitlements files from it.
`.github/workflows/ios.yml` does that on every push to master that touches `ios/`, archives a Release
build numbered with the workflow's run number, and uploads it to TestFlight. The build is for one
account's private TestFlight and never goes to the App Store.

Signing is Xcode's cloud-managed signing. No certificate or provisioning profile is stored anywhere:
xcodebuild signs in to App Store Connect with an API key and creates or fetches what it needs. The
workflow takes three repository secrets:

| Secret          | What it is                                              |
| --------------- | ------------------------------------------------------- |
| `ASC_KEY_ID`    | The key's Key ID                                        |
| `ASC_ISSUER_ID` | The Issuer ID, shown above the list of keys             |
| `ASC_KEY_P8`    | The whole contents of the downloaded `AuthKey_<id>.p8`  |
| `DEV_CERT_P12`  | An Apple Development certificate with its key, as a base64 .p12 (made through the API: `POST /v1/certificates` with a CSR; cloud signing manages distribution certificates only, and a runner without a development identity mints a new one per build until the account's cap) |
| `DEV_CERT_PASSWORD` | That .p12's password |

The key is made at App Store Connect > Users and Access > Integrations > App Store Connect API, as a
Team key with the Admin role: cloud signing creates the distribution certificate, which needs Admin.
The .p8 can be downloaded only once, when the key is made.

## One-time setup

1. Make the API key and add the three secrets (repository Settings > Secrets and variables > Actions).
2. Register the App IDs com.rcircelli.wmpspotify and com.rcircelli.wmpspotify.broadcast (the
   extension) at developer.apple.com > Identifiers (explicit). The archive step does not register them:
   measured 2026-09-30, the archive signed without one and the upload failed with "Error Downloading
   App Information".
3. Register the App Group group.com.rcircelli.wmpspotify (Identifiers > App Groups), then turn on the
   App Groups capability on both App IDs with that group ticked. The extension's socket and log live
   in its container; without it on both, signing fails or the two see different containers.
4. In App Store Connect, Apps > + > New App: iOS, bundle ID com.rcircelli.wmpspotify, any SKU. The name
   has to be unique across the App Store even though this app never ships there. A pending Program
   License Agreement blocks this until the Account Holder accepts it.
5. Run the workflow (Actions > ios > Run workflow). Once the build has processed, add yourself as an
   internal tester (the app's TestFlight tab > Internal Testing) and install it from the TestFlight app.

## Verified on a phone

2026-09-30, build 0.1 (4) on an iPhone: the skin comes up over the web player, Spotify's DRM playback
runs inside the WKWebView itself (Play on Device shows "WMP Spotify (This Device)" as the playing
device, the position advancing, synced lyrics on), and the player state drives the visualizers.
Nothing had to be routed through another Spotify Connect device.

## Known gaps

- The web view keeps to the safe area: black bars at the notch and the home indicator.
- The skin is WMP 9's desktop window at phone size; nothing is laid out for a phone.
- The broadcast has to be started by hand at every launch (iOS requires the Start Broadcast tap), and
  it ends when the app is killed.
- The extension hears every app's audio, not only Spotify's.
- No signature check on the page update. The Windows exes run a new page only when update.json's
  signature verifies (`tauri/src/update.rs`); this app runs whatever wmp.ryancircelli.com serves.
