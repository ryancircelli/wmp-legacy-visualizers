# iTunes skin on a phone: iTunes 10 (2010) folded to an iPhone in portrait (build spec)

The phone layout of the iTunes 10 skin (`src/skins/itunes/phone/`), picked by `itunes/Root.tsx` on a touch
screen whose narrow side is under 600 CSS px. It builds on the skin's shared core (`shared/`, its API in
`shared/index.ts`; docs/itunes-skin.md §1–2) and reaches the app only through `ShellContext`, as every skin.

**There was no iTunes for the iPhone.** Everything here is iTunes 10's own look (the grey toolbar, the LCD,
the round transport buttons, the sidebar with its bold grey headers, the striped table, the bottom bar, Cover
Flow) laid out the way the iPhone's own Music app of 2010 (iOS 4) laid out a phone: one page at a time under
a fixed top, ‹ back to the page before, a list's count as its last row, its search bar scrolling with the
list, action sheets for a song's choices, and Cover Flow when the phone is turned on its side. Where iTunes
and the Music app are both silent the choice is marked **(chosen)**. The look's colours and metrics are the
desktop build's (REFERENCE.md, the desktop agent's scratch notes from the 2010 captures).

**The owner's ruling (2026-10-04, on the first screenshots): "redundant ui on a tight screen space".** So
nothing shows twice on a screen: the toolbar is one row, the view switch is a song list's own, the status
line is a list's last row, Now Playing repeats nothing the LCD shows, and the bottom bar holds only what no
page holds. §6 lists what was cut and where each function now lives.

---

## 0. At a glance

| | |
|---|---|
| Files | `phone/Root.tsx` (the frame, the toolbar, the bottom bar, the phone on its side), `phone/Pages.tsx` (the source list, a source's page, the search bar), `phone/NowPlaying.tsx`, `phone/Prefs.tsx`, `phone/Sheet.tsx` (action sheets, the long press), `phone/nav.ts` (the page stack), `phone/host.ts` (the iOS app's bindings, the scale) |
| Drawn at | the iPhone 4's 320 points across the narrow side, scaled to the phone (§1) |
| Pages | the source list (with search), a source (what it shows), Now Playing, Preferences; on its side Cover Flow alone |
| Always on screen (portrait) | the toolbar (time and battery, the transport, the LCD) and the bottom bar (Preferences, shuffle, repeat, AirPlay) |
| Taps | a tap plays a song or opens a cover (iTunes: a double-click); a long press (500 ms) opens a song's sheet; every tap is felt (`alchemyHaptic('light')`; the long press `'medium'`) |
| Tests | `tests/skins/itunes-phone.test.tsx` |

## 1. Size, safe areas and the iOS app

- **The viewport.** The iOS app keeps WebKit in its desktop content mode (Spotify's web player stops
  reporting its state at a phone-wide viewport: `src/skins/ipod/host.ts`), so the page is about 980 CSS px
  wide on a 390-point phone. The layout is drawn at **320 px across the narrow side** (the iPhone 4's width)
  and scaled up with one `transform: scale(s)` on `#chrome`, `s = min(innerWidth, innerHeight) / 320`
  (`host.ts fit`). iTunes' 12 px text then reads at about 15 points on a 390-point phone and a 36 px row is
  44 points, the touch target. A transform, not CSS `zoom`: WebKit's `getBoundingClientRect` and pointer
  coordinates disagree under `zoom`, which would break every shared slider. Nothing in the layout uses src/ui's
  portalled menus or dialogs (they would draw outside the scale): sheets are the layout's own.
- **Points to px.** The host reports insets and the keyboard in points; one point is
  `320 / min(screen.width, screen.height)` layout px, in either orientation.
- **Host chrome** (`host.ts useHostChrome`, a copy of the iPod's, as a skin imports no skin): the edge
  layout, the status bar hidden, the home indicator shown, the log band hidden, orientation **any** (for
  Cover Flow on its side), a black background, and the screen let sleep (`alchemyAwake(false)`: the Music
  app let it; the iPod keeps it awake). Unmounted with another skin chosen, the layout, status bar and band
  go back to the app's defaults; the next skin sets its own.
- **The time and battery** draw in the toolbar's top, over the notch, where the Windows build had its menu
  row and caption buttons: the time at the left (the phone's 12 / 24 hours, re-read on the minute), the
  battery at the right (`__wmpBattery`, a bolt while charging; full without a report). Only in the iOS app
  (`window.alchemyLayout`); a browser keeps its own status bar and gets no band.
- **The keyboard.** While `__wmpKeyboard` is up, the bottom bar gives way to a spacer of the keyboard's
  height, so a list ends above it.
- **No zoom, no callout.** The root is `touch-action: manipulation`, `-webkit-touch-callout: none`,
  `-webkit-text-size-adjust: 100%`. The search field's text is 16 px drawn at 13 (scaled .8125): iOS zooms
  the page into a focused field whose text is under 16 px.
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
│  page                                │
│  …                                   │
├──────────────────────────────────────┤
│ ⚙   ⤨   ⟳                 ((▲)) Kitchen│  bottom bar, 36 px + safe-area bottom
└──────────────────────────────────────┘
```

- **Toolbar, one row**: the shared `TransportCluster` at its desktop size (31 / 37 / 31 px: 38 / 45
  points), each button's hit area grown 4 px round; the shared `Lcd compact` (48 px: title, the artist and
  album taking turns, elapsed / the groove with its diamond / time left). Its seek groove takes a finger
  8 px above and below. A tap anywhere else on the LCD opens Now Playing, or goes back from it **(chosen)**;
  a fingertip covers its 13 px lines, so the artist line's turn and the time's flip (a click's on a desktop)
  are not taken on the phone.
- **Bottom bar**: Preferences (the gear, in the place of iTunes' `+`, which Spotify playlists do not get
  here), shuffle, repeat (a small 1 for one song; lit blue when on), and at the right **AirPlay**: the Play
  On sheet, lit while another device plays, the device's name after the glyph as iTunes named its chosen
  speaker (iLounge 16b: "Living Room").
- **Pages** (`nav.ts`): `['sources', 'source']` at launch: the app opens on the selected source (iTunes
  opened on it; the selection is the shared view state's, persisted), ‹ leading to the source list. Now
  Playing and Preferences go on top; ‹ goes back a page, or first out of what was opened inside a source
  (the shared view state's stack). "Show the current song" (Ctrl+L, Now Playing's sheet) brings the
  source's page up. Only the top page is mounted.
- **On its side** (the viewport wider than tall): Cover Flow alone on the black, as the Music app turned to
  it, inside the side insets; no toolbar and no bottom bar. Its covers are the selected song list's albums
  (the saved albums for anything else), starting at the playing one; a tap on the front cover plays it (a
  flick that ends on it is a flick), a tap on a side cover brings it to the front.
- **The local engine** (a phone browser on the website): the visualizer fills the page (there is no
  library to list), as the desktop window shows it.

## 3. Pages (`Pages.tsx`)

**The strip** over every page but the source list: ‹ with where it goes back to (the page under's name:
"iTunes" for the source list), the name centred, the page's own control at the right. Light (the table
header's gradient) over lists; dark over the store and Search Results (iTunes' store bar) and Now Playing.

**The source list**: the shared `SourceList` (LIBRARY Music / Podcasts / Radio; STORE Spotify / Search
Results; GENIUS Genius / Genius Mixes; PLAYLISTS iTunes DJ with Up Next's count / Recently Played / the
library's playlists) at the phone's row height: rows 36 px, 13 px labels, 18 px glyphs, headers given room
(class overrides on the shared list: see §7). The selected source keeps iTunes' selection bar, so coming
back shows where you were. Above it, scrolling with it, **the search bar**: iTunes' rounded field on the
table header's grey. Typing searches Spotify 400 ms after the last key (Search Results appears under
STORE); the keyboard's Search key opens the results. **(chosen)**: live results on this page would replace
the list under the typing finger, and moving to the results page while typing would close the keyboard.

**A source's page**, by what it shows (`useSourceContent`):

| Content | On the phone |
|---|---|
| Songs (Music, a playlist, an album, Genius, iTunes DJ) | the strip's view switch, small: **List / Album List / Grid** (Cover Flow is the phone on its side; a source left in Cover Flow on a desktop shows as List). **List**: the shared `TrackTable`, columns Name / Time / Artist, 36 px rows in iTunes' stripes, the speaker on the playing row, a header tap sorts; the page scrolls, not the table, so the table's header sticks at the top and the **status line** ("15 songs, 1.0 hours", `statusLine`) is the list's last row with the stripes running on under it, as the Music app ended its lists with their count. More pages load as the end nears. **Album List**: the album column narrowed to 96 px (the cover up to 80 px once the album is two rows tall, its name bold and the artist under it), its songs beside it (#, name, length) in the stripes, a rule between albums, the status line last. **Grid**: the shared `AlbumGrid` at its small size; Music's Grid has iTunes' Albums | Artists pills in a slim bar under the strip |
| Covers (the store's front page, Podcasts, Genius Mixes, Recently Played) | the shared `AlbumGrid`, small; the store's sections headed |
| An artist | the top songs (Name / Time / Plays), then its albums as covers |
| Radio | the stations as a table (Stream / Comments, iTunes' radio columns) |
| Search Results | the search bar again (the query in it; clearing it goes back to the source list), the songs as rows, then Artists / Albums / Playlists as headed covers; a result opens inside the source, ‹ back to the results |

A tap on a song plays it in its context (`playRow`), once: the press and a double tap's double-click are
the same tap within 700 ms. A tap on a cover opens it; its round ▶ plays it where it stands.

## 4. Now Playing (`NowPlaying.tsx`)

iTunes 10 had no such page; its artwork pane and Cover Flow showed the cover. So it is **Cover Flow's front
cover alone**: the black stage with its grey wash, the cover as large as the page lets it be (28 px narrower
than the page, at most 420 px) with its mirror image fading below (the shared `.reflect`), then **one slim
row**: Like (Spotify's Liked Songs; a heart, blue when liked), Lyrics (the app's switch), Up Next (iTunes
DJ). The strip: ‹ and **•••**, the song's sheet (Like, Add to Playlist…, Show Album, Show Artist, Go to
Current Song, Start Genius, Play On…). The toolbar's LCD over it names the song and runs its progress, and
the phone's buttons are the volume, so the page has no caption, no second scrubber and no volume slider.

- **Lyrics** over the cover's foot while they are on: synced as the current line and the next (karaoke per
  its setting, iTunes' light blue for what has been sung), plain ones scrolled with the song over the cover;
  as the desktop shows them over the visualizer.
- **Canvas**: a tap on the cover swaps it for the song's Spotify Canvas (filling the stage, muted, looping)
  and back, remembered (`localStorage 'itunes.phone.canvas'`). **Off at first (chosen)**: iTunes had none,
  and a looping video costs the phone more than a picture; only while it is chosen is one fetched, and it
  pauses with the app in the background.

## 5. Sheets, Up Next, devices, Preferences

- **Action sheets** (`Sheet.tsx`, iOS 4's): the blue-grey translucent panel from the bottom, white glossy
  buttons, the destructive one red, Cancel dark; a choice closes it, then acts. A song's (a long press on a
  row): Play, Play Next (when the engine queues), Like / Unlike, Add to Playlist… (a sheet of the editable
  playlists, those holding the song checked: `useAddTo`), Show Album, Show Artist, Start Genius. iOS sends
  no `contextmenu` for a long press, so the layout times its own (500 ms, 10 px of slack) and swallows the
  tap that ends it; a right-click does the same in a desktop browser.
- **Up Next is iTunes DJ** (PLAYLISTS, its count on the row): the queue as the table; a song's sheet there
  adds **Move to Top, Move Up, Move Down, Remove from Up Next**, each asking the engine for the new order
  (`queueOrder` → `commands.reorderQueue`), as the iPod's Queue does. No drag to reorder (the shared table's
  drag is HTML5's, which touch does not drive).
- **Devices are AirPlay's** (the bottom bar): iTunes 10's DEVICES held synced iPods and its speakers were
  the AirPlay menu's, so the Spotify Connect devices are only there: `useDevices` (the playing one checked,
  offline ones greyed, this phone "WMP Spotify (This Device)"), then **AirPlay…** (the phone's own picker,
  `alchemyRoutePicker`) where the app has it.
- **Preferences** (iTunes' Edit > Preferences; one list under the source list's headers instead of the
  dialog's panes, rows in the stripes, a switch an iTunes check box, a value at the right, › a page):

| Header | Rows |
|---|---|
| GENERAL | Skin › (the registry's skins, this one checked), Show Lyrics, Highlight Lyrics Word by Word |
| PLAYBACK (*`auth.hostPlayer`*: the iOS app's own player) | Equalizer › (iTunes' presets, applied at a tap so each is heard), Crossfade Songs (Off → 2 → 5 → 8 → 12 seconds), Sound Check, Audio Quality (Normal → High → Very High), Keep Played Songs (Audio Cache) |
| ADVANCED | About WMP Spotify › (counts, versions, the device playing, the trademark note), Check for Updates (the answer as the row's value; a found update's act a row under it), Refresh Player (*`alchemyRestart`*), Show Log (*`alchemyShowLog`*), Source Code, Report a Problem |
| ACCOUNT (*`auth.canLogout`*) | Log Out of Spotify (confirmed in a sheet, the act red) |

Not carried from the iPod's Settings: Color, Click Wheel, Clicker, Theme, Main Menu, Library Filters,
Library View and Reset Settings are the iPod's own device and menus; shuffle, repeat and the device are the
bottom bar's here.

## 6. What the owner's ruling cut, and where each function lives now

| Was | Now |
|---|---|
| a second toolbar row: the view switch and the search field | the view switch in a song list's strip (List / Album List / Grid); search at the top of the source list, and on Search Results |
| Cover Flow in the view switch | the phone turned on its side |
| the bottom bar's status text | the last row of a song list (List, Album List, iTunes DJ) |
| the bottom bar's artwork button (Now Playing) | a tap on the LCD |
| the bottom bar's Genius button | the GENIUS source; Now Playing's ••• and a song's sheet: Start Genius |
| Now Playing's title / artist caption and second scrubber | the toolbar's LCD |
| Now Playing's volume slider | the phone's buttons (Play On's device: its own) |
| the DEVICES section | the AirPlay button's sheet |

## 7. Performance

Only the top page is mounted. Nothing runs per frame while paused: the LCD's clock (`usePosition`) asks
for frames only while a song plays and re-renders once a second (its groove at a pixel step), the time in
the notch band re-reads on the minute, and the stage sizes the cover from a `ResizeObserver` (a turn, the
keyboard), never per frame. Cover Flow moves by CSS transitions. The Canvas is off unless chosen.
Wanted from the shared core (listed for its owner, not done here): a `row` prop for `SourceList` (the phone
overrides its 20 px rows with `!` classes), a tap-to-play / tap-to-open option for `TrackTable` and
`AlbumGrid` (the phone plays from `onSelect` and opens tiles from a wrapper's click), a footer slot in
`TrackTable` (the phone makes the table non-scrolling inside its own scroller for the status row), Cover
Flow's caption placed clear of its scrollbar on a short stage, and one shared frame loop for `useFrame`
(each LCD clock runs its own while playing; the LCD's artist/album turn also re-renders every 4 s while
paused).

## 8. Must-nots

- No Apple bitmaps, logos or fonts (a public repo): every glyph is the shared SVG set or drawn here.
- No import of another skin, `src/adapters/**` or `src/engine/**`; no edits to `shared/`.
- No portalled src/ui menu or dialog (it would draw outside the scale): sheets only.
