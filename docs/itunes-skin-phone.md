# iTunes skin on a phone: iTunes 10 (2010) folded to an iPhone in portrait (build spec)

The phone layout of the iTunes 10 skin (`src/skins/itunes/phone/`), picked by `itunes/Root.tsx` on a touch
screen whose narrow side is under 600 CSS px. It builds on the skin's shared core (`shared/`, its API in
`shared/index.ts`; docs/itunes-skin.md §1–2) and reaches the app only through `ShellContext`, as every skin.

**There was no iTunes for the iPhone.** The look is iTunes 10's own (the grey toolbar, the LCD, the round
transport buttons, the sidebar with its bold grey headers, the striped table, the bottom bar, Cover Flow),
laid out the way the iPhone's own Music app of 2010 (iOS 4) laid out a phone: one page at a time under a
fixed top, ‹ back to the page before, a list's count as its last row, its search bar scrolling with the
list, action sheets for a song's choices, Cover Flow when the phone is turned on its side. Where iTunes and
the Music app are both silent the choice is marked **(chosen)**. Colours and metrics are the desktop
build's (REFERENCE.md, the desktop agent's scratch notes from the 2010 captures).

**The owner's rulings.**
- 2026-10-04, on the first screenshots, "redundant ui on a tight screen space": the toolbar is one row,
  the view switch is a song list's own, the status line a list's last row, the bottom bar holds only what
  no page holds (§6).
- 2026-10-04, on the phone: "i regret saying no duplicate ui, the lack of song control or seeing future
  albums / songs in my cover flow". Now Playing alone repeats the LCD: its scrubber and a big transport
  under the thumb, and its stage is Cover Flow of the play order (§4).
- 2026-10-04, standing: "these are inspired themes not 1-1 always and we want to fit all spotify
  features". Where iTunes had no place for a Spotify feature, it gets one in iTunes' visual language (§8).

---

## 0. At a glance

| | |
|---|---|
| Files | `phone/Root.tsx` (the frame, the toolbar, the bottom bar, the phone on its side, the page guard), `phone/Pages.tsx` (the source list, a source's page, the search bar), `phone/NowPlaying.tsx` (the play order, the controls, the visualizer), `phone/Prefs.tsx`, `phone/Sheet.tsx` (action sheets, the long press, Play On's volume), `phone/nav.ts` (the page stack, Now Playing's two switches), `phone/host.ts` (the iOS app's bindings, the scale) |
| Drawn at | the iPhone 4's 320 points across the narrow side, scaled to the phone (§1) |
| Pages | the source list (with search), a source (what it shows), Now Playing, Preferences; on its side Cover Flow alone |
| Always on screen (portrait) | the toolbar (time and battery, the transport, the LCD) and the bottom bar (Preferences, shuffle, repeat, AirPlay) |
| Taps | a tap plays a song or opens a cover (iTunes: a double-click); a long press (500 ms) opens a song's or a cover's sheet; every tap is felt (`alchemyHaptic('light')`; the long press `'medium'`) |
| Tests | `tests/skins/itunes-phone.test.tsx` |

## 1. Size, safe areas and the iOS app

- **The viewport.** The iOS app keeps WebKit in its desktop content mode (Spotify's web player stops
  reporting its state at a phone-wide viewport: `src/skins/ipod/host.ts`), so the page is about 980 CSS px
  wide on a 390-point phone. The layout is drawn at **320 px across the narrow side** and scaled up with one
  `transform: scale(s)` on `#chrome`, `s = min(innerWidth, innerHeight) / 320` (`host.ts fit`). iTunes' 12 px
  text then reads at about 15 points and a 36 px row is 44 points. A transform, not CSS `zoom`: WebKit's
  `getBoundingClientRect` and pointer coordinates disagree under `zoom`, which would break every shared
  slider. Nothing uses src/ui's portalled menus or dialogs (they would draw outside the scale).
- **Points to px.** The host reports insets and the keyboard in points; one point is
  `320 / min(screen.width, screen.height)` layout px, in either orientation.
- **Host chrome** (`host.ts useHostChrome`, a copy of the iPod's: a skin imports no skin): the edge layout,
  the status bar hidden, the home indicator shown, the log band hidden, orientation **any** (Cover Flow on
  its side), a black background, the screen let sleep (`alchemyAwake(false)`: the Music app let it).
- **The time and battery** in the toolbar's top, over the notch, where the Windows build had its menu row:
  the time (the phone's 12 / 24 hours, re-read on the minute), the battery (`__wmpBattery`, a bolt while
  charging). Only in the iOS app (`window.alchemyLayout`).
- **The keyboard.** While one of the layout's own search fields has the focus, the bottom bar gives way to
  a spacer of the keyboard's height (`__wmpKeyboard`), never more than 60 % of the screen. Only then: the
  host computes the height as the screen's bottom less the keyboard's end frame, and iOS hands a zero end
  frame in some transitions (the app going to the background with the keyboard up, a relaunch), a whole
  screen of keyboard. **That was the owner's blank page (2026-10-05)**: the spacer took every point under
  the toolbar, the page collapsed to nothing and the bottom bar went, leaving white under a live LCD.
  Reproduced in the harness at 844 pt; fixed by the focus and the cap. (Wanted in `ios/`: ignore an empty
  end frame.)
- **No zoom, no callout.** `touch-action: manipulation`, `-webkit-touch-callout: none`,
  `-webkit-text-size-adjust: 100%`. A search field's text is 16 px drawn at 13: iOS zooms the page into a
  focused field whose text is under 16 px.
- **Font.** `"Segoe UI", "Lucida Grande", "Helvetica Neue", Helvetica, Arial`: a phone has neither of
  iTunes' faces, so it falls to the iPhone's own Helvetica of 2010.

## 2. The frame (`Root.tsx`)

```
┌──────────────────────────────────────┐
│ 9:41                            ▭▮   │  the notch band (safe-area top)
│ (◀◀)(▶)(▶▶) ┌──── LCD ─────────────┐ │  toolbar, 54 px: transport + compact LCD
│             │ title / artist·album │ │  (a tap on the LCD: Now Playing)
│             │ 1:01 ━━◆━━━━ -2:53   │ │
├──────────────────────────────────────┤
│ [‹ iTunes]     Road Trip     [≡][☷][▦]│  the page's strip, 36 px
│ (▶ Play)(⤨ Shuffle)(♥ Save)(⚛ Genius) │  a list's head
│  page                                │
├──────────────────────────────────────┤
│ ⚙   ⤨   ⟳                 ((▲)) Kitchen│  bottom bar, 36 px + safe-area bottom
└──────────────────────────────────────┘
```

- **Toolbar, one row**: the shared `TransportCluster` at its desktop size (38 / 45 points), each button's
  hit area grown 4 px round; the shared `Lcd compact`, its seek groove taking a finger above and below. A
  tap anywhere else on the LCD opens Now Playing, or goes back from it **(chosen)**.
- **Bottom bar**: Preferences (in the place of iTunes' `+`), shuffle, repeat (a small 1 for one song), and
  **AirPlay**: Play On, lit while another device plays, its name after the glyph as iTunes named its
  chosen speaker (iLounge 16b).
- **Pages** (`nav.ts`): the app opens on the selected source (the shared view state's, persisted), ‹
  leading to the source list; Now Playing and Preferences go on top; ‹ goes back a page, or first out of
  what was opened inside a source. "Show the current song" brings the source's page up. Only the top page
  is mounted.
- **The page guard**: a page that throws shows "This page could not be shown." with the error and **Back
  to iTunes**, and writes `itunes: <message>` to the host's log (`alchemyLog`); the toolbar and the bottom
  bar stand. Any move tries the page again. (React unmounts the whole tree under an error no boundary
  catches.)
- **On its side**: Cover Flow alone on the black, inside the side insets, no toolbar or bottom bar. On Now
  Playing it is the play order (§4); anywhere else the selected list's albums (the saved albums for
  anything else), starting at the playing one, a tap on the front cover playing it.
- **The local engine** (a phone browser on the website): the visualizer fills the page.

## 3. Pages (`Pages.tsx`)

**The strip** over every page but the source list: ‹ with where it goes back to, the name centred, the
page's own control at the right. Light over lists; dark over the store, Search Results and Now Playing.

**The source list**: the shared `SourceList` (LIBRARY Music / **Albums** / **Artists** / Podcasts / Radio;
STORE Spotify / Search Results; GENIUS Genius / Genius Mixes; PLAYLISTS iTunes DJ with Up Next's count /
Recently Played / the library's playlists) at the phone's row height (class overrides: §7). Albums and
Artists are the phone's own (the iPhone Music app had them among its tabs; iTunes reached them by Music's
Grid): each opens Music in Grid on its tab, answering the owner's "how do i play an album". Above the list,
scrolling with it, **the search bar**: typing searches Spotify 400 ms after the last key (Search Results
appears under STORE); the keyboard's Search key opens the results **(chosen)**.

**A list's head**, at the top of every song list (an album, a playlist, Liked Songs, Genius, an artist's
top songs), scrolling away with it (Spotify's collection header in iTunes' pills; the Music app led a list
with Shuffle): **Play** (Pause while it is what plays), **Shuffle** (the whole list shuffled: Spotify's
shuffle on, then the list played; lit while it plays so), **Save / Saved** (a playlist or album the user
does not own, `useAddTo`; **Follow / Following** an artist), **Genius** (its radio: the station Spotify
seeds from it). A show's head has Play alone.

**A source's page**, by what it shows (`useSourceContent`):

| Content | On the phone |
|---|---|
| Songs | the strip's view switch, small: **List / Album List / Grid** (Cover Flow is the phone on its side). **List**: the shared `TrackTable` (Name / Time / Artist, 36 px rows in iTunes' stripes, the speaker on the playing row, a header tap sorts); the page scrolls, not the table, so the header sticks and the **status line** ("15 songs, 1.0 hours") is the last row with the stripes running on under it, as the Music app ended its lists. **Album List**: the album column narrowed to 96 px (the cover, its name, the artist), its songs beside it. **Grid**: the shared `AlbumGrid`, small; Music's has iTunes' Albums | Artists pills under the strip |
| iTunes DJ (Up Next) | the table with a **grip (≡)** at each row's end: a row dragged by it lands where it is let go (one `reorderQueue`, the iPhone's reorder control of 2010); a long press adds Move to Top / Up / Down and Remove from Up Next |
| A show's episodes | newest first, the **blue dot** on one Spotify says is not started, Name / Date / Time, "4 episodes" last; List alone |
| Covers (the store's front page, Podcasts, Genius Mixes, Recently Played, an artist's albums) | the shared `AlbumGrid`, small. A tap opens; a **long press** is the cover's sheet (§5). The shared grid's round ▶ (shown on a pointer's hover) sat invisibly in each cover's middle on a touch screen, where a finger lands, playing what was meant to open: hidden here but on the playing cover |
| An artist | its head, the top songs (Name / Time / Plays), its albums as covers |
| Radio | the stations as a table (Stream / Comments) |
| Search Results | the search bar again (clearing it goes back to the source list), the songs as rows, then Artists / Albums / Playlists as headed covers |

## 4. Now Playing (`NowPlaying.tsx`)

iTunes 10 had no such page; its artwork pane and Cover Flow showed the cover. So the stage is **Cover Flow
of the play order**: the songs played this session to the left (the last 10, kept as the track changes:
`useKeepPlayed`, a Previous taking the last off), the playing song in front, **Up Next** to the right (up
to 15, `queue.next`, each cover its `art` or `image`), the caption under the front cover. The front cover
is 60 % of the page's width so the ones beside it show (the shared `CoverFlow`'s `size` / `top`, its
scrollbar off: §7); each song keeps its key as the order moves past it, so a track change slides.

- **Browsing**: a flick, or a tap on a side cover, brings it to the front with its title and artist and
  "— tap to play"; a tap on it then plays it (Up Next: skipped to, the songs before it leaving the queue as
  a tap on a queued song in Spotify does; a played one again, in its context). It springs back to the
  playing song 4 s after the last touch (`BROWSE_MS`), and follows a track change.
- **The playing cover**: lyrics over its foot while they are on (synced as the current line and the next,
  karaoke per its setting; plain ones scrolled with the song), as over iTunes' visualizer; a tap swaps it
  for the song's **Spotify Canvas** and back (off at first: a looping video costs the phone more than a
  picture; only while chosen is one fetched).
- **The controls**, the iPhone Music app's of 2010 in iTunes' dress: **Like · Lyrics · Up Next**; the
  **scrubber** (elapsed, iTunes' volume knob on Cover Flow's dark groove, the time left; drag or tap, seeks
  on release as the LCD's); and a big **Previous / Play-Pause / Next** row under the thumb. No volume slider
  here (the phone's buttons; a Connect speaker's is Play On's: §5).
- **•••**, the song's sheet: Like, Add to Playlist…, Show Album, Show Artist, Go to Current Song, Start
  Genius, Play On…, **Show / Hide Visualizer** (iTunes' View > Show Visualizer: the app's visualizer in the
  stage's place, at its shape, opaque in its own colours) and **Visualizer Style…** (the engines, then a
  preset). Off at first; kept (`localStorage 'itunes.phone.vis'`).
- **On its side**: the same play order full size, its scrollbar under it.

## 5. Sheets, Up Next, devices, Preferences

- **Action sheets** (`Sheet.tsx`, iOS 4's): the blue-grey translucent panel, white glossy buttons, the
  destructive one red, Cancel dark; a choice closes it, then acts. iOS sends no `contextmenu` for a long
  press, so the layout times its own (500 ms, 10 px of slack) and swallows the tap that ends it.
  - A song's (a long press on a row): Play, Play Next, Like / Unlike, Add to Playlist…, Show Album, Show
    Artist, Start Genius; on iTunes DJ the moves and Remove.
  - A cover's (a long press on an album, playlist, artist or show): Open, Play, Shuffle, Save to Library /
    Remove (Follow / Unfollow an artist), Start Genius.
  - **Play On** (the AirPlay button): **the volume** of what plays over the devices, as iTunes' AirPlay
    window had its Master Volume over its speakers (a Connect speaker's volume has no other place: the
    phone's buttons turn only the phone); the Connect devices (`useDevices`: the playing one checked,
    offline ones greyed); **AirPlay…** (the phone's own picker) where the app has it.
- **Devices are AirPlay's**: iTunes 10's DEVICES held synced iPods; the Connect devices are only in Play On.
- **Preferences** (one list under the source list's headers, rows in the stripes, a switch an iTunes check
  box, a value at the right, › a page):

| Header | Rows |
|---|---|
| GENERAL | Skin › (the registry's skins), Show Lyrics, Highlight Lyrics Word by Word |
| PLAYBACK (*`auth.hostPlayer`*) | Equalizer › (iTunes' presets, applied at a tap), Crossfade Songs (Off → 2 → 5 → 8 → 12 seconds), Sound Check, Audio Quality, Keep Played Songs (Audio Cache) |
| ADVANCED | About WMP Spotify ›, Check for Updates, Refresh Player (*`alchemyRestart`*), Show Log (*`alchemyShowLog`*), Source Code, Report a Problem |
| ACCOUNT (*`auth.canLogout`*) | Log Out of Spotify (confirmed in a sheet) |

## 6. Where each function lives

| Function | Place |
|---|---|
| Play / pause, previous, next | the toolbar (always); Now Playing's big row |
| Seek | the LCD's groove (always); Now Playing's scrubber |
| Now Playing | a tap on the LCD |
| Shuffle, repeat | the bottom bar; a list's Shuffle plays it shuffled |
| Play a list or album whole | its head's Play / Shuffle; a cover's long press |
| View switch | a song list's strip (List / Album List / Grid); Cover Flow is the phone on its side |
| Status line | a song list's last row |
| Search | the source list's search bar; Search Results' own |
| Genius (song radio) | Now Playing's •••, a song's sheet; a list's head and a cover's sheet for its radio; the GENIUS source |
| Up Next | iTunes DJ; Now Playing's Up Next button and the right of its Cover Flow |
| Devices, a device's volume | the AirPlay button's sheet |
| Visualizer | Now Playing's ••• |

## 7. Performance, and the shared core

Only the top page is mounted. Nothing runs per frame while paused: the clocks (`usePosition`) ask for
frames only while a song plays and re-render once a second (the LCD's groove at a pixel step), the notch
band's time re-reads on the minute, the play order's spring-back is one timer while browsing, the played
list is kept by a store subscription, the stage sizes itself from a `ResizeObserver`. Cover Flow draws the
covers within 7 of the front and moves by CSS transitions. The Canvas and the visualizer are off unless
chosen (the ticker's loop runs only while the visualizer's canvas is mounted).

Changed in `shared/` for the phone: `CoverFlow`'s `size` / `top` (the front cover's, else from the stage's
height) and `bar` (its scrollbar); the `album` and `artist` glyphs; `statusLine` counts a show's episodes.
Still wanted there: a row-height prop for `SourceList` (the phone overrides its 20 px rows with `!`
classes), a tap-to-play / tap-to-open option for `TrackTable` and `AlbumGrid` (the phone plays from
`onSelect`, opens tiles from a wrapper's click, hides the grid's ▶ by a class), a footer slot in
`TrackTable` (the phone makes the table non-scrolling inside its own scroller), and one shared frame loop
for `useFrame` (each clock runs its own while playing).

## 8. The Spotify features, against the iPod skin

Fitted: shuffle and repeat; Play / Shuffle of a whole list; song radio and a playlist's, album's or
artist's radio (Genius); Up Next with drag to reorder, the moves and removal; Play Next; Like; Save /
Follow a playlist, album or artist; Add to Playlist; lyrics, and karaoke on / off; the Canvas; the
visualizer, its engine and preset; podcasts (followed shows; episodes newest first with the unplayed dot);
radio stations; Recently Played; the home feed (STORE > Spotify); Genius Mixes (Spotify's made-for-you
mixes); search; artist pages; Play On with AirPlay… and a device's volume; the host player's EQ, quality,
Sound Check, crossfade and audio cache; about, updates, refresh, the log, logout.

Left out, and why:
- **Smart Shuffle**: the engine has no command for it (`toggleShuffle` only), nor the iPod.
- **Add a whole album or playlist to Up Next**: `addToQueue` takes one track and commands go unordered, so
  an album added track by track could land out of order (wanted: an ordered multi-add in the engine).
- **Hold Previous / Next to scan**: an iPod click-wheel act; the scrubber does it by drag.
- **The visualizer as an overlay on the cover, its opacity**: the iPod's own invention; iTunes' visualizer
  took the window's place, as here.
- **Color, Click Wheel, Clicker, Theme, Main Menu, Library Filters, Library View, Reset Settings, Brick,
  the boot screen**: the iPod's own device and menus.

## 9. Must-nots

- No Apple bitmaps, logos or fonts (a public repo): every glyph is the shared SVG set or drawn here.
- No import of another skin, `src/adapters/**` or `src/engine/**`.
- No portalled src/ui menu or dialog (it would draw outside the scale): sheets only.
