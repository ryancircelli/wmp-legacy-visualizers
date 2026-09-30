# WMP Spotify for iPhone

`WmpSpotify.exe`'s player as an iPhone app. The app is one WKWebView on https://open.spotify.com/, opened
with a desktop user agent so Spotify serves its full web player. Our page is injected over it as an
overlay, as CONTRACT.md v6.1 describes: `WmpSpotify/observer.js` runs at document start, reads the web
player's token, state and query hashes from its own traffic, and mounts the skin in a shadow root on
top. Spotify's page is never driven through its DOM.

The page is not built into the app. Each launch fetches `spotify-inject.js` from wmp.ryancircelli.com
(what deploy.yml publishes) and caches it, so a fix to the player reaches the phone without a new build.
Playback is meant to carry on with the phone locked (the audio background mode).

The visualizers hear the microphone, which picks up the phone's own speaker (and the room). It is the
only source iOS leaves: an app cannot hear another app's output, Spotify's FairPlay playback cannot be
routed through Web Audio, and the two other routes were tried and measured on 2026-09-30. ReplayKit's
in-app capture (build 7) delivered 1024-frame stereo buffers of zeros while Spotify played, even
though a system screen recording of the same app has the music: WebKit's audio comes out of a separate
process that in-app capture does not hear. A local WebSocket from the app to the page (build 6) was
never connected: WebKit refuses ws://127.0.0.1 from Spotify's https page. The one route left untried
is a broadcast upload extension, the system-level capture a screen recording uses, at the cost of an
extension target, an app group, IPC into the app, and the user starting a broadcast from a picker at
every launch. The page asks for the microphone at launch (iOS asks once) and says so in its status
line. The band under the web view shows the host's last log line (scene changes go only to the list):
tap it to reload the page, long-press it for the last 20 lines.

## Building

No Xcode project is checked in. `ios/project.yml` is an [XcodeGen](https://github.com/yonaskolb/XcodeGen)
spec; `xcodegen generate --spec ios/project.yml` writes `ios/WmpSpotify.xcodeproj` (scheme WmpSpotify).
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

The key is made at App Store Connect > Users and Access > Integrations > App Store Connect API, as a
Team key with the Admin role: cloud signing creates the distribution certificate, which needs Admin.
The .p8 can be downloaded only once, when the key is made.

## One-time setup

1. Make the API key and add the three secrets (repository Settings > Secrets and variables > Actions).
2. Register the App ID com.rcircelli.wmpspotify at developer.apple.com > Identifiers (explicit, no
   capabilities). The archive step does not register it: measured 2026-09-30, the archive signed
   without one and the upload failed with "Error Downloading App Information".
3. In App Store Connect, Apps > + > New App: iOS, bundle ID com.rcircelli.wmpspotify, any SKU. The name
   has to be unique across the App Store even though this app never ships there. A pending Program
   License Agreement blocks this until the Account Holder accepts it.
4. Run the workflow (Actions > ios > Run workflow). Once the build has processed, add yourself as an
   internal tester (the app's TestFlight tab > Internal Testing) and install it from the TestFlight app.

## Verified on a phone

2026-09-30, build 0.1 (4) on an iPhone: the skin comes up over the web player, Spotify's DRM playback
runs inside the WKWebView itself (Play on Device shows "WMP Spotify (This Device)" as the playing
device, the position advancing, synced lyrics on), and the player state drives the visualizers.
Nothing had to be routed through another Spotify Connect device.

## Known gaps

- The web view keeps to the safe area: black bars at the notch and the home indicator.
- The skin is WMP 9's desktop window at phone size; nothing is laid out for a phone.
- The visualizers hear the microphone (above), the room as well as the speaker.
- No signature check on the page update. The Windows exes run a new page only when update.json's
  signature verifies (`tauri/src/update.rs`); this app runs whatever wmp.ryancircelli.com serves.
