# iTunes skin: iTunes 10 (2010), the Windows window and a shared core (build spec)

The third skin for this player: iTunes 10 as Apple shipped it on 1 September 2010, the Windows build on a
desktop (the Tauri app, and the website inside open.spotify.com) and a phone layout on a phone, both over
one shared core. It is React composed from `src/ui`'s headless pieces like `src/skins/wmp9/` and
`src/skins/ipod/` (see `src/skins/types.ts`), and reaches the app only through `ShellContext`.

**How the numbers were obtained.** No full-size capture of the Windows build survives (Wikipedia's
`Itunes10win32.png` is gone; the Wayback keeps its 300 px thumbnail), so the Windows-only parts come from
that thumbnail and a 1024 px crop of the Windows Album List in a 2010 review, and everything the two builds
drew alike (the toolbar, the LCD, the buttons, Cover Flow, the table) from a 1277×902 capture of the Mac
build and Apple's own iTunes 10 pages of September 2010, pixel-sampled. The working notes with every
sampled colour are the build's REFERENCE.md (kept with the agent's scratch, not in the repo: the captures
are Apple's). Anything not seen in a capture is marked **(memory)**; a choice made for the skin where no
capture says is **(chosen)**.

Sources: Wikipedia, *iTunes* (revision of 2011-02-28; `Itunes10win32.png`, Wayback 2011-03-01);
geekonthepc.com, "iTunes 10 (Windows) review", 2010-09-02; versionmuseum.com, *iTunes design history*
(the iTunes 10 Cover Flow and Album List captures); apple.com/itunes/features/ and /whats-new/, Wayback
2010-09-22 and 2010-10-27; iLounge, "Instant Expert: Secrets & Features of iTunes 10"; Apple, "Keyboard
shortcuts in iTunes on PC".

---

> **Status (2026-10-04).** Built: `src/skins/itunes/` (View > Skin in WMP 9 and here; Settings > Skin on the
> iPod, which now lists the registry). The shared core and the desktop layout are done; `phone/` is a
> placeholder for the phone layout (its own agent's).
>
> **2026-10-05: every Spotify feature has a place in the desktop window** (the owner, 2026-10-04: "remember
> these are inspired themes not 1-1 always and we want to fit all spotify features"). Where iTunes had no
> place for one, it is drawn in iTunes' own idioms (a column, a context menu, the strip, the artwork pane, a
> Get Info sheet, the Equalizer window): §3.1. What still cannot be built, and the app command each needs: §3.2.

## 0. At a glance

| | |
|---|---|
| Files | `itunes/index.ts` (the `Skin`), `Root.tsx` (picks the layout), `shortcuts.ts`, `shared/` (the core, `shared/index.ts` its API), `desktop/` (the Windows window), `phone/` (the phone layout) |
| Layout pick | a touch screen whose narrow side is under 600 CSS px is a phone (the screen's size, not the viewport's: the iOS app draws a desktop-wide viewport); anything else is the desktop window |
| Fonts | the system stack `"Segoe UI", "Lucida Grande", Tahoma, Verdana, sans-serif` (`--font-itunes`); no font files |
| Tokens | `--color-itunes-*`, `--background-image-itunes-*` in `src/ui/theme.css` |
| Own state | `localStorage['itunes.view']`: the selected source, each source's view, the artwork pane, the Grid's tab, the LCD's time (zustand persist); `localStorage['itunes.desktop']`: View > Show Canvas |
| Not built | Ping, Movies, TV Shows, iTunes U, Books, Apps, Ringtones, Purchased, SHARED, the column browser, the MiniPlayer, star ratings (the ♥ column is in their place), the checkbox column, the spectrum mode of the LCD; and, for want of an app command (§3.2), new playlists, Smart Shuffle, Mark as Played |

## 1. Spotify on iTunes' sidebar (`shared/sources.ts`)

iTunes 10's sections in its order, each holding what Spotify has in that place:

| section | rows | what they show |
|---|---|---|
| LIBRARY | **Music** | Liked Songs (List / Album List / Cover Flow); its Grid has iTunes' Albums / Artists switch: the saved albums, the followed artists |
| | **Podcasts** | the followed shows as covers; a show opens to its episodes |
| | **Radio** | the stations seeded from what plays, as iTunes' Stream / Comments table |
| STORE | **Spotify** | the home feed's shelves, as the iTunes Store's front page (its dark bar: ‹ back, ⌂ home) |
| | **Search Results** | while a search is typed: songs as rows, then artists, albums and playlists as covers (iTunes searched the store from the same field) |
| (no DEVICES) | — | iTunes 10's DEVICES held the synced iPods; its speakers were the AirPlay menu's (the bottom bar's), where the Connect devices are. Both was the same list twice (the owner, 2026-10-04: "redundant ui on a tight screen space") |
| GENIUS | **Genius** | the playing song's radio, as a playlist ("Based on …") |
| | **Genius Mixes** | Spotify's made-for-you mixes on the home feed (Daily Mix, Discover Weekly, Release Radar, …) |
| PLAYLISTS | **iTunes DJ** | Up Next (`queue.next`), its length as the badge: rows drag to a new place, Delete removes, right-click Move to Top / Remove (`commands.reorderQueue`). The desktop window puts the songs it has played this session (grey) and the playing one above it, as iTunes did (§3.1) |
| | **Recently Played** | the home feed's recently-played shelves, as covers (a smart playlist's gear) |
| | the library's playlists | in library order (the saved albums are Music's Grid, not rows) |

A collection opened inside a source (a Grid cover, a search result, Show Album / Show Artist) shows in its
place with a strip over it (‹ back, its name); an artist is their top songs over their albums. Under the local
engine (no Spotify) there are no sources and the window shows the visualizer.

## 2. The shared core (`shared/`)

The API both layouts build on is `shared/index.ts` (its header documents each export). In short:

- **View state** (`state.ts`): `itunesView` / `useItunesView` / `viewActions` (select, setMode, open / back,
  toggleArtwork, setGridTab, setSidebarOpen, toggleTotal, reveal).
- **Sources and content**: `useSources()` / `buildSources()`; `useSourceContent(source, opened)` returns what
  a source shows as data (`tracks`, `tiles`, `artist`, `stations`, `search`, `none`); `playRow`,
  `playUri`, `showPlaying` (Ctrl+L, the LCD's ➜), `startGenius`, `queueOrder`, `albumsOf`, `statusLine`.
- **Look**: `Lcd`, `TransportCluster`, `Volume`, `SourceList`, `TrackTable`, `AlbumList`, `AlbumGrid`,
  `CoverFlow`, `Icon`, and the CSS module (`styles`: the volume range, the running stripes, the reflection).

### 2.1 The LCD
42 px tall, 4 px radius, a `#939786` rim; the glass `#EDEFE0` → `#E6EAD6` above the middle and `#DFE3C8` →
`#F6F8DF` below it (the glossy split). **Idle**: one centred glyph, a pair of quavers (the original's Apple
logo is not drawn). **Playing**: the title (semibold); the artist and the album taking turns every 4 s (a
click on the line turns it); elapsed · the bar · the time left (a click shows the length instead, kept). The
bar is a thin rounded groove filled dark up to a **diamond** scrubber; dragging scrubs (src/ui `seekHold`:
hold pauses, release seeks), ←/→ on it skip 5 s. A **status note** (`ui.status`) takes the glass for 4 s. The
round ➜ at the right shows the current song. `compact`: two lines and the bar (the phone's).

### 2.2 Transport and volume
Round glossy buttons, ⌀31 / ⌀37 / ⌀31, a `#6E6E6E` rim over `#F7F8F9` → `#B8BBBE` with a glossy top half,
glyphs `#525252`; Play shows ❚❚ while playing; no Stop (iTunes had none). The volume: a 10 px groove
(`#444` rim, `#F1F2F2` → `#A6A9AB`), a ⌀13 knob, the speakers either side (the quiet one mutes).

### 2.3 Tables
`TrackTable`: a sticky 22 px header (`#E5E5E5` → `#FBFBFB`, a `#A6A6A6` rule), header clicks sort (▲ / ▼;
a third click restores the source's order), **20 px rows striped white / `#F2F5F9`** (the Windows build's),
the stripes running on below the last row, the speaker on the playing row (waves while playing), selection
`#5295E3` with focus and `#D4D4D4` without, ↑ / ↓ / Enter, more pages as the end scrolls into view.
Columns: Name, Time, Artist, Album, and Plays where Spotify counts them. `AlbumList`: the album column
(220 px: the cover once the group is three rows tall, the name bold over the artist), a `#DFDFDF` rule
between albums. src/ui's `ListTable` has no sorting, keys or dragging, hence the skin's own table.

### 2.4 Grid and Cover Flow
`AlbumGrid` (src/ui `TileGrid`): 124 px covers with a soft shadow, the name bold and the artist grey under
each; a click selects, a double-click opens, the round ▶ over a cover plays (on hover; always on the playing
context). `CoverFlow`: the front cover flat and 0.72 of the stage tall; the nearest side cover turned 45°
toward the middle, its inner edge at the front cover's edge, the others 0.15 of a cover further out and
shaded darker; mirror reflections fading out; title and artist under the front cover; a dark scrollbar. ← /
→ / Home / End, the wheel and a drag walk; a click brings a side cover to the front; a double-click or Enter
plays. Only seven covers either side are drawn.

## 3. The desktop window (`desktop/`)

```
File Edit View Controls Store Advanced Help          iTunes                      – □ ✕   22 px  #titlebar
(◀◀)(❚❚)(▶▶)  🔈━━━○━🔊   [         LCD         ]   [≡|☰|▦|▥]  (🔍▾ Search   )        54 px  #toolbar
┌ sidebar 188 ┐┃┌ content ─────────────────────────────────────────────────────────┐
│ LIBRARY …   │┃│ (strip: ‹ back / the store's dark bar / Albums | Artists)        │
│ [artwork]   │┃│ List · Album List · Grid · Cover Flow / covers / stations / …    │
└─────────────┘┃└──────────────────────────────────────────────────────────────────┘
 +  ⤨  ⟳  ▣            22 songs, 1.6 hours                        ((AirPlay)) ⚛        25 px  #bottombar
```

- **Chrome**: one grey gradient (`#F3F3F4` → `#A3A6A9` over 76 px) from the top edge; the menu row is the
  caption (`#titlebar`: drag, double-click maximizes under the host); minimize / maximize / close drawn as
  Windows 7's glyphs, close red under the pointer. Under a host that draws its own title bar
  (`auth.nativeTitle`) the title and the caption buttons are not drawn.
- **Windows host**: the Tauri exe draws WMP 9's XP title bar and frame round every page
  (tauri/src/titlebar.rs). While this layout is mounted it asks the host to step aside
  (`desktop/Chrome.tsx useOwnWindow`: `alchemyNativeChrome(false, '#F3F3F4')`, the chrome's top row), and
  gives the frame back as it unmounts (`true`, and `auth.nativeTitle` true for the next skin). Its own
  caption row is then the window's: it drags (Aero Snap with it), a double-click maximizes, and the
  window resizes from its edges. The host remembers it, so the next launch opens without the XP strip.
  Not available from the page's caption: Snap Layouts on hovering maximize, and the right-click system
  menu (Alt+Space opens it). An exe without `alchemyNativeChrome` keeps its strip, and the title and
  caption buttons stay hidden as above.
- **Menus** (`desktop/menus.ts`, Windows 7's look): **File** Open Spotify Link…, Get Info (the playing song),
  Close Window, Exit; **Edit** Preferences…; **View** (Show Sidebar on a narrow window) as List / Album List /
  Grid / Cover Flow (Ctrl+Alt+3–6), Show Artwork, Show Canvas, Show Visualizer, Visualizer ▸, Refresh Rate ▸,
  Lyrics, Karaoke Highlight, Show Equalizer (the host's player only), Full Screen, Skin ▸ (the registry);
  **Controls** Play/Pause, Next, Previous, Go to Current Song, Shuffle, Repeat ▸ Off / All / One, the volume,
  Mute, Play On ▸ (the devices; AirPlay… where the host has the system's picker), Like, Add to Playlist ▸;
  **Store** Spotify Home, Search Spotify, Log Out; **Advanced** Open Stream…, Start Genius, Start Playlist /
  Album / Artist Radio (the playing context's); **Help** Keyboard Shortcuts, Source Code on GitHub, Report a
  Problem, Show Log (the iOS app's), Check for Updates, Refresh Player (the iOS app's), About.
- **Toolbar**: the transport, the volume, the LCD (up to 560 px, centred), the view switcher (greyed where a
  source has one view, and while the visualizer shows), the search field (400 ms after the last key, Enter at
  once; ⓧ or Esc clears; marked `data-search-box` for Ctrl+F).
- **Sidebar**: `SourceList` (the selection a blue-grey bar, blue while the list has focus) and the
  **artwork pane** (Now Playing's cover; a click shows the song). A 4 px splitter (`#D1D1D1` → `#BABABA`).
- **Bottom bar**: + (greyed: Spotify playlists are not made here), shuffle, repeat (blue when on, a small 1 for
  one song), the artwork pane; the status text (`statusLine`: "22 songs, 1.6 hours", "8 albums" in Music's
  Grid; no GB: Spotify has no files); the **AirPlay menu** (the Connect devices, this window as "WMP Spotify
  (This Device)"; the playing device's name beside it when it is elsewhere) and **Genius** (the playing song's
  radio).
- **Right-click** (`desktop/Pointer.tsx`): **a song** Play, Play Next (`addToQueue`), Like / Add to Playlist,
  Show Album, Show Artist, Start Genius, Get Info, Copy Spotify Link; on iTunes DJ's Up Next rows Move to Top
  and Remove from Up Next instead of Play Next. **A cover** (any grid: the store, Music's Grid, Podcasts, Genius
  Mixes, Recently Played, search results, an artist's albums) Play, Shuffle, Open, Save to Your Library /
  Follow (not the user's own playlists), Start Album / Playlist / Artist Radio, Copy Spotify Link. **A source**
  (a playlist, Music) Play, Shuffle, Start Playlist Radio, Copy Spotify Link.
- **The visualizer** is the app's Now Playing view: View > Show Visualizer (Ctrl+T) puts it in the window under
  the toolbar (the sidebar, the content and the bottom bar give way), with the lyrics over it while they are on;
  a double-click is full screen. iTunes opens on the library: the skin turns a restored Now Playing into the
  library when it comes up under Spotify. The local engine (no Spotify) shows the visualizer always.
- **Narrow windows**: under 760 px the sidebar folds away (View > Show Sidebar lays it over the content) and the
  view switcher goes (View has the four); the volume and the search field shorten down to 640 px.
- **Dialogs** (Windows 7's frame): Preferences (iTunes' General / Playback / Advanced pane bar over the app's
  settings, and the host player's sound, §3.1; Cancel restores), the Equalizer, Get Info, About, Keyboard
  Shortcuts, Open Stream, and the update notes.

### 3.1 Spotify's features in the window

Every feature the iPod and WMP 9 skins expose, and where it lives here. The pieces iTunes had no place for are
`desktop/spotify.ts` (the logic) and `desktop/Pointer.tsx` (the right-click menus).

| Spotify's | where in the window |
|---|---|
| Like | the **♥ column**, last, where iTunes had Rating: ♥ where liked, ♡ on the row under the pointer or selected; a click likes / unlikes (src/ui's batched saved flags; Liked Songs' rows liked without asking). Also a song's right-click, Controls > Like, Get Info's ♥ Liked |
| Save to Your Library, Follow | a cover's right-click; ♥ on an opened page's strip |
| Add to Playlist (✓ where it is; a pick toggles, so also removal) | a song's right-click, Controls |
| Play Next (the queue) | a song's right-click |
| Shuffle play | an opened page's strip, a cover's and a source's right-click (shuffle on, then the collection) |
| Song radio | Start Genius (the bottom bar's ⚛, Advanced, a song's right-click), as before |
| Playlist / Album / Artist Radio | Advanced (the playing context's), a source's and a cover's right-click, the genius atom on an opened page's strip: the station seeded from it (`fetchRadio`, the iPod's Start Radio), played; the LCD's note when there is none |
| Canvas | the **artwork pane**, where iTunes played a video: the clip muted and looping (an image Canvas still), the cover when it has none or it fails; View > Show Canvas |
| Lyrics, karaoke | over the visualizer, as before; and **Get Info > Lyrics** for the playing song: every line, the one sung now lit and kept in view (Spotify's lyrics view); View > Lyrics, Karaoke Highlight |
| Podcasts | Podcasts' covers; a show's episodes with **iTunes' blue dot** where unplayed (Name, Time, Release Date), counted as episodes |
| Radio stations | Radio (Stream / Comments), as before |
| Recently Played | the source (the home feed's shelves), as before; and iTunes DJ's played songs |
| iTunes DJ | the songs played in this window this session, grey (the last 10, iTunes' default; Spotify gives the app no song history), the playing one, then Up Next; only Up Next drags, leaves with Delete, Moves to Top |
| Play On (Connect) | the AirPlay menu and Controls > Play On; **AirPlay…** after the devices where the host has the system's route picker (the iOS app on an iPad) |
| Artist, album pages | opened in a source (‹ back), the strip with Play, Shuffle, ♥ and the radio |
| Search buckets | Search Results' strip: All · Songs · Artists · Albums · Playlists, as the iTunes Store filtered its results by kind; one kind alone pages on |
| Home shelves | STORE > Spotify, the shelves as the store's sections, as before |
| Share | Copy Spotify Link (iTunes' Copy iTunes Store URL) in every right-click menu and Get Info |
| Track details | **Get Info** (File, a song's right-click): the cover, names, explicit, length, release, track / disc, Spotify's play count, the album's label and copyright, ♥, the link |
| The host player's sound | **Preferences > Playback**: Crossfade Songs (1–12 s), Sound Check, Audio quality; **Advanced**: the audio cache; **View > Show Equalizer**: iTunes' Equalizer window (On, the presets applied at once, the ten bands showing the preset's curve). Only while the host plays itself (`auth.hostPlayer`) |
| Updates, log, refresh | Help: Check for Updates (and the new download), Show Log, Refresh Player (the iOS app's), Report a Problem |
| Log out | Store > Log Out of Spotify, as before |

### 3.2 Not here: the app has no command for it

| feature | the command it needs |
|---|---|
| Smart Shuffle (the bottom bar's ⤨ cycling In Order → Shuffle → Smart Shuffle, Controls > Shuffle ▸) | `playback.shuffle` as `'off' \| 'on' \| 'smart'` (read from the player's state) and `setShuffle(mode)`; the iPod has a plain toggle too |
| New playlist (the greyed +) | `createPlaylist(name): Promise<string>` (the new uri); rename and delete beside it |
| Mark as Played (an episode's right-click) | `markPlayed(episodeUri, played)` |
| Clear Up Next | `reorderQueue([])` would also drop the playing context's own next songs (it edits queued and context rows alike): a `clearQueue()` that leaves the context's is wanted |
| Song history in iTunes DJ beyond this window's session | a recently-played-tracks query (Spotify's player history) |


## 4. Keys (`shortcuts.ts`)

| keys | does |
|---|---|
| Space | play / pause (the app's) |
| Enter | play the selected song (the lists') |
| Ctrl+→ / Ctrl+← | next / previous song (not while typing) |
| Ctrl+Alt+→ / Ctrl+Alt+← | fast forward / rewind 10 s |
| Ctrl+↑ / Ctrl+↓ | volume up / down |
| Ctrl+Alt+↓ | mute |
| Ctrl+L | go to the current song (this skin's: the app's lyrics toggle is View > Lyrics here) |
| Ctrl+T | visualizer on / off |
| Ctrl+F | the search field |
| Ctrl+Shift+F | full screen |
| Ctrl+Alt+3 … 6 | List, Album List, Grid, Cover Flow |
| Ctrl+G | the artwork pane |
| Ctrl+U | Open Stream (a Spotify link) |
| Ctrl+, | Preferences |
| Ctrl+K | karaoke highlight (the app's) |

## 5. Differences from the reference, and why

- The idle LCD shows a pair of quavers, not Apple's logo; no Apple artwork, bitmaps or fonts are used (a public
  repository). Glyphs are drawn as SVG paths of what the captures show.
- The Windows build's own pixels are known only at thumbnail size: the caption buttons and the menu row are
  Windows 7's ordinary ones **(memory)**, the toolbar and LCD the Mac capture's (the two builds drew them alike).
- No checkbox column (its meaning, "skip this song", has no Spotify counterpart), no "GB". Star ratings are
  Spotify's ♥ (one heart, not five stars).
- The + button is greyed: there is no command to make a playlist (§3.2).
- iTunes DJ's history is this window's own (Spotify gives the app no song history); it starts empty each launch.
- The Equalizer's band sliders show a preset's curve but do not move: the host player takes presets, not bands.
- Get Info's Lyrics is the playing song's only (lyrics are fetched for it alone).
- Album List rows have no right-click menu and no ♥ column (the shared table there takes neither yet).
- The LCD's left button (the spectrum display) is not drawn: the page has no spectrum of Spotify's audio there.
