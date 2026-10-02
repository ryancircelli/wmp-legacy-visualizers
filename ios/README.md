# WMP Spotify for iPhone

`WmpSpotify.exe`'s player as an iPhone app. The app is one WKWebView on https://open.spotify.com/, opened
with a desktop user agent so Spotify serves its full web player. Our page is injected over it as an
overlay, as CONTRACT.md v6.1 describes: `WmpSpotify/observer.js` runs at document start, reads the web
player's token, state and query hashes from its own traffic, and mounts the skin in a shadow root on
top. Spotify's page is never driven through its DOM.

The page is not built into the app: `spotify-inject.js` comes from wmp.ryancircelli.com (what
deploy.yml publishes), and so does `observer.js`, as `ios-observer.js` (taken only when it is our
script, not an error page), so a fix to either reaches the phone without a new build. A launch, in order:

1. The window comes up in the page's last layout. The messages below that shape the first frame
   (`layout`, `statusbar`, `homeindicator`, `band`, `orientation`, `background`, `keyboard`) are kept
   in UserDefaults as the page sends them and applied again when the app starts, before the web view
   shows, so a skin's layout (the iPod's edge to edge on black) does not flash the default one first.
2. The web view starts at once from the copies the last launch saved in Application Support (the
   builds before kept them in Caches, read when there is none), the observer built into the app
   standing in for one never saved: no network wait (`page: bundle from cache`, `page: observer from
   cache|bundled`). With no bundle saved (the first launch) it waits for the site's, the built-in
   observer the fallback (`page: bundle from site|none`, `page: observer from site|bundled`).
3. Behind it the app fetches the site's two files and saves each that parses for the next launch
   (`page: bundle on site unchanged|updated|not fetched`, the same for the observer, in the list
   only). One that differs from what this launch runs goes into the web view's user script once the
   page has mounted (observer.js's `overlay mounted` line), so a reload runs it. A new bundle also
   refreshes the page in place (`page: bundle updated from site: refreshing in place`): observer.js's
   `alchemyRestart`, run half a second after the page's `window.Alchemy` appears, fetches the bundle
   again and remounts the page without stopping the music. A new observer cannot be swapped into a
   live document and runs from the next load (`page: observer updated from site: runs from the next
   load`).
4. The page mounts its skin. The iPod skin draws its body and wheel at once, with a boot screen in its
   screen (src/skins/ipod/Boot.tsx: the note and a progress bar on black) until Spotify's sign-in,
   the first player state or device list, and the speaker's session are in, 6 s at most; logged
   out, Spotify's login page shows at once.

Measured before this order, which waited for the site at every launch: launch to bundle fetched
under 1 s, overlay mounted about 1 s, dealer socket about 2 s, registered and first state about 3 s.
The order above is not yet measured on a phone.
The page talks to the app through `webkit.messageHandlers.<name>.postMessage`: `log` (a line for the host
log), `volume` (below), `open` (an http or https URL, opened outside the app, in Safari or the app that
claims it), `layout` (`"edge"` puts the web view over the whole screen, under the notch and the home
indicator, with the band hidden; `"safe"`, the default, is the layout described below) and `showlog`
(the whole log in its sheet, for an edge-to-edge page with no band to long-press). The app tells the page
the web view's safe-area insets in points as `window.__wmpSafeArea = {top, right, bottom, left}`, then
fires `wmp-safe-area` on `window`, whenever they change and again after each `layout` message (so a
reloaded page that sends its layout gets them); inside the safe area they are all 0. They are the
window's safe area where the web view overlaps it, never the keyboard (which SwiftUI counts in a hosted
view's own insets while it shows).
Playback is meant to carry on with the phone locked (the audio background mode).
Link previews are off in the web view: a long press on a link is the page's, not a preview.
The skin's volume and mute set the app's own output level (`Librespot.setLevel`, the "volume" message:
a squared gain on the speaker's player node, kept across launches, the visualizers fed before it), and
it comes back as `__wmpVolume` (below). It is not the system's volume: iOS gives apps no way to set
that. The usual workaround, the slider of an off-screen MPVolumeView, was found and driven and the
system did not follow ("volume: asked 12, the system is at 10" at every try, build 37, 2026-10-02), so
the hardware buttons' level is the ceiling the app's level plays under.

For a phone skin (an iPod click wheel, say) the page has more messages, each a string (JSON where
noted), posted with `webkit.messageHandlers.<name>.postMessage(<string>)` and wrapped by `observer.js` as
`alchemy*` bindings (`alchemyHaptic`, `alchemyAwake` and so on):

- `haptic`: `"selection"` (a wheel detent), `"light"`, `"medium"`, `"heavy"`, `"rigid"`, `"soft"`,
  `"success"`, `"warning"`, `"error"`, or `"prepare"` (readies the selection generator). One generator
  per kind is kept and readied again after each use; only each kind's first use is logged.
- `hapticpattern`: JSON `{"events":[{"t":0,"i":1,"s":0.5,"d":0}]}`, each event's start and duration in
  seconds (`d` 0 or left out is a tap, else continuous) and its intensity and sharpness 0 to 1, played by
  Core Haptics. Nothing on a device without haptics.
- `sound`: a system sound id (`1104` is the keyboard tick); each id is logged once.
- `awake`: `"on"` keeps the screen from sleeping, `"off"` lets it.
- `statusbar`, `homeindicator`: `"hidden"` or `"shown"`.
- `band`: `"hidden"` or `"shown"` (the default), the log band under the web view in the safe layout;
  hidden, the web view takes its place and the log opens by `showlog`.
- `background`: a CSS hex color, `"#rrggbb"` or `"#rgb"`, behind the web view and in the safe layout's
  bars (black by default); anything else is ignored.
- `keyboard`: `"ignore"` (the default: the keyboard covers the page) or `"avoid"` (the layout shrinks to
  above the keyboard). In `"ignore"`, on open.spotify.com with `scroll` off, nothing moves for the
  keyboard: WebKit's scroll to the focused field is undone as it happens, and as the keyboard hides the
  scroll view's inset (WebKit's, for the keyboard, which it left about 26 pt short once) goes back to
  none and its offset to rest (`InsetWebView.watchKeyboard`; the log's list says `keyboard: shown, <h>
  pt` and `keyboard: hidden`). Elsewhere (Spotify's login page) WebKit still scrolls to its fields. The
  input accessory bar over the keyboard (‹ › ✓) stays: WKWebView has no API for it, only swizzling its
  private content view.
- `scroll`: `"on"` or `"off"` (the default), the web view's own scrolling and bounce.
- `orientation`: `"portrait"`, `"landscape"` or `"any"`; the window turns to it and stays.
- `appearance`: `"light"`, `"dark"` or `"auto"`, the window's (and so the page's `prefers-color-scheme`).
- `brightness`: a level 0 to 1, or `"state"` for `__wmpBrightness`.
- `viewport`: `"mobile"` or `"desktop"` (the default), WebKit's content mode, kept across launches; a
  change reloads the page. The desktop user agent stays either way, since Spotify needs it.
- `routepicker`: AirPlay's output picker.
- `audiosession`: `"solo"` (the default: other apps' audio stops), `"mix"` (plays alongside it) or
  `"duck"` (lowers it).
- `share`: a text or URL for the share sheet. `clipboard`: a text copied.
- `notify`: JSON `{"title","body","seconds","id"}`, a local notification that many seconds on (1 at
  least; the same id replaces it), or `"cancel:<id>"`. iOS asks to allow notifications the first time.
  None shows while the app is in front.
- `open` also takes `"settings"`, the app's page in Settings.
- `reset`: all website data cleared (Spotify signs out), then the page reloaded.
- `host`: everything below pushed at once, for a page to ask at load.

The app pushes state as a global on `window` and an `Event` of the matching name, each at its change and
all on `host`: `__wmpHost` `{build, version, ios, model, scale, fps, voiceOver, viewport}` (`wmp-host`,
on `host` only), `__wmpVolume` 0 to 100, the app's own output level (`wmp-volume`; not the system's volume: see `alchemySetVolume`), `__wmpBattery` `{level, charging}`
with `level` -1 when unknown and `charging` true when plugged in (`wmp-battery`), `__wmpRoute`
`{name, type}` of the first audio output (`wmp-route`), `__wmpBrightness` 0 to 1 (`wmp-brightness`, on
asking only), `__wmpProximity` (`wmp-proximity`; only after `proximity` "on", since iOS blanks the screen while the sensor is covered), `__wmpLowPower` (`wmp-lowpower`), `__wmpThermal`
`"nominal"`, `"fair"`, `"serious"` or `"critical"` (`wmp-thermal`), `__wmpScene` `"active"`,
`"inactive"` or `"background"` (`wmp-scene`) and `__wmpKeyboard`, the keyboard's height in points, 0
when hidden (`wmp-keyboard`). Two events carry no global: `wmp-shake` (the phone shaken) and
`wmp-memory` (a memory warning). Proximity monitoring is on for the report, so the screen goes dark
while the sensor is covered, as in a call.

The visualizers hear the app's own Spotify Connect speaker (librespot, below): the app plays its
audio itself and hands the same buffers to the page as they are played. It cannot pass them over a
socket, since WebKit refuses ws:// from Spotify's https page (build 6), so `Forwarder` in App.swift runs
`__wmpAudio.pcm(<base64>, n)` in the page by evaluateJavaScript, batched every 100 ms (interleaved
stereo int16 LE at rate n), and `observer.js` hands that to the page as its audio socket. A pause or a
stop ends with a moment of silence, so the visualizers go dark instead of holding the last spectrum.
There is no microphone anywhere: the app's audio session is plain playback.

The band under the web view (unless the page hides it with `band`) shows the host's last log line
(scene changes go only to the list): tap it to reload the page, long-press it for the whole log,
scrolled to its end, with Copy (all of it to the clipboard) and Clear. The log persists across launches
in `host.log` in the App Group container group.com.rcircelli.wmpspotify (the last 3000 lines, each
timestamped, a `---- launch <date> ----` line at each start). The group was made for the broadcast
extension (History, below) and stays: moving the log out of it would lose it at the update.

## Librespot

The app is also a Spotify Connect receiver (merged from the `librespot` branch 2026-10-01), through
[librespot](https://github.com/librespot-org/librespot) 0.8.0. It shows up in Spotify's device list as
**WMP Spotify** (a speaker); picked, Spotify plays to the app itself, and the app gets the raw audio.
The music plays out of the app's own audio session, and the visualizers get the same audio. The web view stays the control plane exactly as on master (sign-in, library, commands);
librespot is only the audio sink. The page's own player shows up as "WMP Spotify (This Device)", next to
librespot's "WMP Spotify".

- `ios/librespot/` is a small Rust crate (`wmp-librespot`, staticlib and cdylib) on librespot-core,
  -connect, -playback, -metadata and -discovery 0.8.0 with no audio backend, rustls with compiled-in
  roots, and a sink that hands the app interleaved stereo float32 at 44100 Hz. Its C ABI is
  `wmp_librespot.h`: `wmp_ls_start(name, id, cache_dir, pcm, log, state, np, ctx)`,
  `wmp_ls_token(token, client_id, client_token)`, `wmp_ls_command(cmd)` and `wmp_ls_stop()`. `build.sh`
  builds it for aarch64-apple-ios into `ios/librespot/out/`, which `project.yml` links (with a bridging
  header). CI runs it before xcodegen, its cargo work cached by Cargo.lock.
- `Librespot` in App.swift starts it at launch with the cache in Application Support/librespot. Each
  packet plays through an AVAudioEngine player node and, as it is heard, goes to `Forwarder`, which
  feeds the page. The callback blocks
  while half a second is queued, which paces librespot's decoding. A pause flushes the queue and the
  visualizers go dark.
- **Control Center and the lock screen.** The audio no longer goes through WebKit, so the app feeds
  them itself. librespot's player events (track change, play, pause, seek, end of track, stop) come
  to `Librespot` as one whole JSON object each (the `np` callback: title, artists joined with ", ",
  album, the largest cover's url, duration, position, playing), which it puts in
  `MPNowPlayingInfoCenter`, the cover fetched once per url and added when it lands; a stop clears it.
  `MPRemoteCommandCenter`'s play, pause, play/pause, next, previous and scrubbing go back through
  `wmp_ls_command` ("play", "pause", "toggle", "next", "prev", "seek:<ms>") to the live Spirc, as if
  pressed in the Spotify app; its other commands are off. The session is `.playback` without
  `.mixWithOthers`, which would keep the app out of Control Center: the page's `audiosession`
  message set to `"mix"` or `"duck"` (which implies mixing) would do that, and no skin sends it.
- **Name, id, and which device plays.** The speaker is "WMP Spotify (iOS)": the phone's own name
  ("Ryan's iPhone") is "iPhone" or "iPad" to apps since iOS 16 without an entitlement Apple grants on
  request. The page can rename it (`alchemySpeakerName(name)`, the "speaker" message; a rename
  restarts the receiver under the new name), but no skin offers that: the owner found it confusing
  (2026-10-01) and the iPod skin's Speaker Name row went. `window.prompt` shows as a system alert
  (`WKUIDelegate`) should a skin need a text entry. Its Connect device id is the hash of the
  install's `identifierForVendor`, not of the name (librespot's binary hashes the name, so two
  devices with one name would be one device to Spotify, and a rename would make a new one). The
  app tells the page `window.__wmpSpeaker = {id, name}` (`wmp-speaker`; id null while no session is
  up; the state callback in `wmp_librespot.h`), the Spotify adapter sends its commands to the active
  device, else to the speaker, else to the page's own player (`target` in
  src/adapters/spotify/connect.ts), moves playback that lands on the page's own player to the
  speaker (observers.ts, at most once every 10 s), leaves that player out of its own Play On list
  (src/ui/Lists.tsx), and observer.js registers it with Connect's `hidden` capability, so only the
  speaker shows in pickers on the phone and elsewhere. The web player's own entry is what Windows
  plays through, so nothing hides it there. librespot fills no title, art or duration into the
  state it reports (only the track uri): the page looks those up itself (state.ts).
- Discovery goes through iOS's own mDNSResponder (librespot's `with-dns-sd`). librespot's default,
  libmdns, opens its own multicast socket, which iOS 14 and later allow only with Apple's multicast
  entitlement. The Bonjour route needs `_spotify-connect._tcp` in `NSBonjourServices`, and iOS asks
  once to allow the local network (`NSLocalNetworkUsageDescription`).
- librespot-core is patched by one line (`build.sh` fetches the crate, checks it against crates.io's
  checksum, and sets `OS` to `"linux"` on iOS). Built for iOS, librespot tells Spotify it is an iPhone,
  and Spotify's access points turn that away with "Tried too many access points"
  ([librespot#1477](https://github.com/librespot-org/librespot/issues/1477), open since 2025-03). The
  same happened on Android, and [librespot#1403](https://github.com/librespot-org/librespot/pull/1403)
  fixed it by presenting as Linux. On an iPhone's arm64 this is what a Raspberry Pi running librespot
  sends.

**Sign-in: the web player's token first.** There is no second sign-in. Spotify ended username and
password login for librespot in July 2024
([librespot#1308](https://github.com/librespot-org/librespot/issues/1308)), and librespot 0.8.0's own
binary refuses `--password` ("Password authentication no longer supported, use OAuth", src/main.rs).
What remains is an access token or zeroconf, and the app tries both.

- **Token (first).** The web view is already signed in, and observer.js already reads the web player's
  access token from its own traffic (the `Authorization` header and open.spotify.com/api/token) and
  fires `wmp-spotify-token`, and posts each new token, and once at mount, as the `lstoken` message,
  `"<clientId> <clientToken> <token>"` (the client id from open.spotify.com/api/token's `clientId`, the
  client token from the web player's `client-token` header). master's observer, which the site serves,
  is the one that does it. The app hands all three to librespot (`wmp_ls_token`). librespot serves
  the token and the client token to Spotify's services in place of its own (`core.patch` adds
  `Login5Manager::set_auth_token` and `SpClient::set_client_token`; `src/lib.rs` sets them before
  each connect and on each token), so login5 and clienttoken are never asked while they are held.
  With no session up, librespot logs in at once with
  `Credentials::with_access_token(token)` (librespot-core 0.8.0, `AUTHENTICATION_SPOTIFY_TOKEN`) and
  starts the Connect device on that session, as a pick would. With a session up, it keeps the newest
  token for its next reconnect, used while under 50 min old. The token is never logged. Upstream logs
  in only briefly with a token, to get reusable credentials, which it caches and uses from then on
  ([librespot#1377](https://github.com/librespot-org/librespot/issues/1377)). A web player token
  (open.spotify.com's) logged librespot in where a developer-app token got "Bad credentials"
  ([librespot#1436](https://github.com/librespot-org/librespot/issues/1436), January 2025).
  Why not login5: build 22 got past the access point (`Authenticated as ...`) and then
  `connect failed (token): Invalid state { Login request was denied: INVALID_CREDENTIALS }` from
  login5, which Spirc asks for its spclient token with the stored credentials the login gave and
  Keymaster's client id; build 23, asking with the web player's client id, got `BAD_REQUEST` instead
  (its client token was still Keymaster's). The web player never goes through login5: its token is
  already what spclient and the dealer take, with its client token. The session's client id is still
  set to the token's, kept in `client_id` next to the cached credentials. A rejected token is dropped,
  not retried; the next one the page gets tries again.
- **Zeroconf (the fallback).** A signed-in Spotify app on the same network finds the device, and when
  the device is picked it hands over a credentials blob encrypted for it
  ([docs/authentication.md](https://github.com/librespot-org/librespot/blob/v0.8.0/docs/authentication.md)).
  On build 20 the log said `librespot: discovery up`, but the Spotify app on the same phone never
  listed the device.

Either way, librespot caches reusable credentials (`credentials.json`) and connects with them at
later starts; upstream advises caching ("Credential caching is unavailable, but advisable",
src/main.rs). Once a session is up, the device should show up in every Spotify app, on any network,
for as long as the app is running.

**License.** librespot is MIT, as is this crate. Most of the dependencies are permissive (MIT,
Apache-2.0, ISC, BSD, Zlib, Unicode-3.0; webpki-roots' certificates are CDLA-Permissive-2.0). Two are
MPL-2.0: Symphonia (the decoder) and priority-queue. MPL-2.0 is file-level copyleft: it asks only
that changes to those crates' own files be shared, and they are unmodified here. Nothing goes beyond
the private TestFlight.

**Account risk.** librespot is unofficial and Spotify's terms do not allow it. Lockouts have been
documented in 2024 and 2025: forced password resets for accounts used with librespot, mostly tied to
password logins
([librespot discussion #1311](https://github.com/librespot-org/librespot/discussions/1311)). No bans
have been documented. This uses cached token credentials, not a password, and reconnects at most 5 times
in 10 minutes (librespot's own limit) before it waits to be picked again.

**Getting it up.**

1. Open WMP Spotify signed in. The log should say `librespot: token received`, then
   `librespot: logging in with the token`, and `librespot: session up (token)`, or
   `librespot: connect failed (token): <librespot's error>`.
2. Pick **WMP Spotify** (not "WMP Spotify (This Device)") in the skin's Play On or in any Spotify app.
   The log says `librespot: playing` once the music starts.
3. Fallback, if the token is refused: allow the local network when iOS asks (`librespot: discovery up`)
   and pick WMP Spotify in a Spotify app on the same Wi-Fi (`librespot: credentials from discovery`,
   then `librespot: session up (discovery)`). A computer's Spotify app is the likelier one to list it.
   Later launches say `librespot: cached credentials` and `librespot: session up (cached)`.

Log lines to look for (the band, or the long-press list): `librespot: discovery up` or
`librespot: discovery failed: ...` (a refused local network should show as a dns_sd error,
kDNSServiceErr_PolicyDenied, -65570); `librespot: token received`;
`librespot: session up (token|discovery|cached)` or `librespot: connect failed (<the same>): ...`
(a refused token is librespot's "Login failed with reason: Bad credentials", or a login5 error after
the AP took it); `librespot: playing`,
`paused`, `stopped`, `unavailable: ...`; `librespot: session ended` and the reconnects;
`librespot: output failed: ...` (the audio engine); and librespot's own info, warnings and errors,
all prefixed `librespot:`.

**Seen on a phone (builds 22 and 23, 2026-10-01).** Spotify's access point takes the web player's
token from librespot presenting as Linux (`Authenticated as '<username>' !`, `Country: "US"`), and
caches reusable credentials from it that log in the same way. login5 then refused those credentials
with Keymaster's client id (`INVALID_CREDENTIALS`) and with the web player's (`BAD_REQUEST`); build
24 bypasses login5 with the web player's own tokens.

**Works (build 24, 2026-10-01).** With the web player's token and client token served in place of
login5's (the client id is `d8a5ed958d274c2e8ee717e6a4b0971d`), the cached credentials logged in,
`session up (cached)` followed, spclient resolved, the device showed in the Spotify app's picker on the
same phone, and picking it loaded and played a track through the app (`Loading <...>`, `playing`),
with the next one preloaded. No pairing, no prompt.

**Not yet verified.** CI builds, links, archives and uploads it (builds 19, 20, 22, 23 and 24,
2026-10-01; 24 is the current one), but none of the following has been seen on a phone:

- A launch with no cached credentials at all on build 24 (the token login itself, then the cache).
- Build 25's hidden page player: whether the cluster still lists it (observer.js reads the page's
  full device id from the cluster: `registered as` in the log says so), whether commands from it are
  still taken, and whether the speaker's new device id (from the install id) logs in with the
  cached credentials or needs the token once.
- What happens when the web player's token expires (an hour) while the page is in the background:
  the page refreshes and reposts it while it runs; if it does not, spclient calls fail until it does.
- Why the iOS Spotify app did not list the zeroconf device on its own phone (build 20).
- Whether the audio engine, which runs from launch and renders silence between songs, keeps the app and
  its session alive in the background as intended, and what it costs in battery.
- How the visualizers keep time with librespot's audio. The page gets each buffer as it is played.

**Prior art.** [lufinkey/librespot-swift](https://github.com/lufinkey/librespot-swift) (2025, OAuth
and rodio, built for aarch64-apple-ios) is the only iOS build of librespot found. Its author opened
#1477. No iOS Connect receiver built on librespot was found, nor any other open-source one.

## Building

No Xcode project is checked in. `ios/project.yml` is an [XcodeGen](https://github.com/yonaskolb/XcodeGen)
spec; `xcodegen generate --spec ios/project.yml` writes `ios/WmpSpotify.xcodeproj` (scheme WmpSpotify),
and the app's Info.plist and .entitlements files from it.
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
2. Register the App ID com.rcircelli.wmpspotify at developer.apple.com > Identifiers (explicit). The
   archive step does not register it: measured 2026-09-30, the archive signed without one and the
   upload failed with "Error Downloading App Information". com.rcircelli.wmpspotify.broadcast, the
   retired broadcast extension's, is no longer used.
3. Register the App Group group.com.rcircelli.wmpspotify (Identifiers > App Groups), then turn on the
   App Groups capability on the App ID with that group ticked. The host log lives in its container;
   without it, signing fails.
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

2026-10-01, build 24: the app's own speaker logged in with the web player's token, showed in the Spotify
app's picker on the same phone, and played a track through the app (Librespot, "Works"). 2026-10-02:
the owner confirmed the speaker works, and the broadcast was removed (History).

## Known gaps

- By default the web view keeps to the safe area: bars at the notch and the home indicator, black
  unless the page sets `background` (a page can lift that with `layout`).
- The skin is WMP 9's desktop window at phone size; nothing is laid out for a phone.
- The visualizers hear only the app's speaker: music played on another device, or on the page's own
  player before it moves to the speaker, leaves them dark.
- No signature check on the page update. The Windows exes run a new page only when update.json's
  signature verifies (`tauri/src/update.rs`); this app runs whatever wmp.ryancircelli.com serves.

## History

How the visualizers got their audio before the speaker. ReplayKit's in-app capture delivered only
zeros from the web view (build 7): WebKit's audio comes out of a process in-app capture does not hear.
A broadcast upload extension (`WmpSpotifyBroadcast`, the system-level capture a screen recording uses)
did hear it, since it receives the system's mix of every app's audio (checked 2026-09-30). It sent
that to the app over a Unix socket, `audio.sock` in the App Group container (loopback TCP from the
extension to the app never connected, build 9), each frame the body's length (4 bytes, little-endian),
a type byte and the body (type 0 `{"rate":n}`, type 1 interleaved stereo int16 LE; ReplayKit's app
audio arrived as big-endian int16, build 6). It worked, but had to be started from iOS's broadcast
sheet at every launch (the app opened the sheet by tapping an RPSystemBroadcastPickerView's button; iOS
requires the Start Broadcast tap), heard every app's audio, and showed the red recording indicator. The
speaker replaced it on 2026-10-02: the extension, its picker, `alchemyBroadcast` and `__wmpBroadcast`
were removed (the code is in git history). observer.js still posts `broadcast` `"manual"` once at
start, so builds up to 32, which still have the sheet, never open it by themselves.
