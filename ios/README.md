# WMP Spotify for iPhone

`WmpSpotify.exe`'s player as an iPhone app. The app is one WKWebView on https://open.spotify.com/, opened
with a desktop user agent so Spotify serves its full web player. Our page is injected over it as an
overlay, as CONTRACT.md v6.1 describes: `WmpSpotify/observer.js` runs at document start, reads the web
player's token, state and query hashes from its own traffic, and mounts the skin in a shadow root on
top. Spotify's page is never driven through its DOM.

The page is not built into the app. Each launch fetches `spotify-inject.js` from wmp.ryancircelli.com
(what deploy.yml publishes) and caches it, so a fix to the player reaches the phone without a new build.
The visualizers' audio is the microphone: iOS gives an app no way to hear another app's output.
Playback is meant to carry on with the phone locked (the audio background mode).

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
2. Run the workflow (Actions > ios > Run workflow). The archive step registers the App ID
   com.rcircelli.wmpspotify in the developer portal; the upload step then fails, as there is no app
   record yet. (Or register the identifier by hand first, at developer.apple.com > Identifiers.)
   If the archive fails with "Your team has no devices", register the iPhone at developer.apple.com >
   Devices: the archive is signed for development before the upload re-signs it for distribution.
3. In App Store Connect, Apps > + > New App: iOS, bundle ID com.rcircelli.wmpspotify, any SKU. The name
   has to be unique across the App Store even though this app never ships there.
4. Run the workflow again. Once the build has processed, add yourself as an internal tester (the app's
   TestFlight tab > Internal Testing) and install it from the TestFlight app.

## Untested

Nothing has run on a device yet. Above all, whether Spotify's DRM playback runs inside a WKWebView
with a desktop user agent at all. If it does not,
the overlay still shows and controls what the account plays on any other Spotify Connect device, the
phone's own Spotify app included.

## Known gaps

- The web view keeps to the safe area: black bars at the notch and the home indicator.
- The skin is WMP 9's desktop window at phone size; nothing is laid out for a phone.
- No signature check on the page update. The Windows exes run a new page only when update.json's
  signature verifies (`tauri/src/update.rs`); this app runs whatever wmp.ryancircelli.com serves.
