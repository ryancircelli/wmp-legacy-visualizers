# iPod skin: iPod nano 5th generation, tall touch version (build spec)

The second skin for this player: an iPod nano (5th generation, 2009) as a phone-portrait page.
The screen is on top and the click wheel below. Touch drives it (mouse and keyboard on Windows).
It has no visualizer and no audio capture. It is React, composed from `src/ui`'s headless pieces
like `src/skins/wmp9/` (see `src/skins/types.ts`), and it reaches the app only through
`ShellContext` (`src/ui/shell.ts`).

**How the numbers were obtained.** Apple's nano 5G User Guide embeds the device's own UI
screenshots at the native **240×376**. They were extracted from the PDF and pixel-sampled (the
main menu, Now Playing and each of its overlays, the hold-centre menu, Genius Mixes, FM radio, the
Radio menu, Pedometer, Voice Memos, Screen Lock, the Energy Saver clock). The images are
JPEG-compressed, so colours are ±3 per channel and edges ±1 px. Device geometry was measured from
a front photo of a real nano 5G. Anything that is reconstructed rather than measured or documented
is marked **(reconstructed)**.

Primary source: *iPod nano User Guide* (5th gen), Apple, 2009,
<https://cdsassets.apple.com/live/6GJYWVAV/user/ma1194_ipod_nano_5th_gen_userguide.pdf>, cited
below as **[UG p.N]** with the printed page number. Every other source is cited inline and listed at
the end.

---

> **Status (2026-10-01).** Built: `src/skins/ipod/` (View > Skin in WMP 9; Settings > Skin on the
> iPod). Since this spec was written the adapter gained the three things §4.6 and §6 (items 1, 3, 7)
> call impossible: Liked Songs as a playback context (`spotify:user:<name>:collection`), followed
> artists (`libraryV3` filtered to Artists) and add-to-queue (`add_to_queue`), so Songs, Shuffle
> Songs, Artists and On-The-Go are real. The skin keeps the desktop viewport (a phone-wide one
> left Spotify's web player without state) and the chrome's §1.6 sizing gave way to the owner's:
> the screen spans the width inside a 3% margin, the wheel below it.
>
> **The tree is Spotify's now (owner, 2026-10-01), the look still the nano's.** Main menu: Home
> (Spotify's shelves), Search, Library, Radio, Now Playing while a track is loaded, Settings, Extras
> (off by default). Library: Playlists (Queue first), Liked Songs, Albums, Artists, Podcasts & Shows
> (off by default), Queue, Cover Flow (off by default). Gone: Shuffle Songs (the status bar's shuffle,
> repeat and heart are tap toggles), Videos, Photos, Voice Memos, Genres, Composers, Audiobooks,
> Genius Mixes. §2.3 below is the nano's own tree, kept as the reference it was.

## 0. At a glance

| | |
|---|---|
| Device | iPod nano 5G: 2.2" 240×376 portrait LCD at 204 ppi, Click Wheel, polished anodized aluminium, 9 colours ([EveryMac](https://everymac.com/systems/apple/ipod/specs/ipod-5th-generation-5g-nano-specs.html)) |
| UI font | Helvetica Bold (2007+ iPods; Podium Sans before) ([Wikipedia: Podium Sans](https://en.wikipedia.org/wiki/Podium_Sans)) |
| Build | every page of the 5G menu tree. Pages with no Spotify meaning are **hidden** or **repurposed** (§4), and pure-UI Extras are built for real (Clocks, Stopwatch, Calendars, Screen Lock, Notes, Sleep Timer) |
| Do not build | visualizer, capture, Video Camera, Voice Memos recording, FM hardware |
| Wheel | 15° detents (24 per turn), a haptic `selection` plus sound 1104 per detent that moves something |

---

## 1. Hardware look

### 1.1 The real device, measured

| Quantity | Value | Source |
|---|---|---|
| Body | 90.7 × 38.7 × 6.2 mm, 36.4 g, all-aluminium | [EveryMac](https://everymac.com/systems/apple/ipod/specs/ipod-5th-generation-5g-nano-specs.html) |
| LCD | 2.2" (56 mm) diagonal, 240×376, 204 ppi, so 29.9 × 46.8 mm | EveryMac; [iFixit teardown](https://www.ifixit.com/Teardown/iPod+Nano+5th+Generation+Teardown/1157) |
| LCD width / body width | **0.77** | photo-measured ([Commons photo](https://commons.wikimedia.org/wiki/File:IPod-Nano-5G-front.png)) |
| LCD top from body top | 5.1 mm (5.6 % of height) | photo |
| Black glass around the LCD | about 2 mm left and right, 2.5 mm top, 2.2 mm bottom | photo |
| Wheel diameter D | 27 mm = **0.70 × body width** | photo |
| Centre button | 13.3 mm = **0.49 D** | photo |
| Wheel centre | 79 % of body height from the top; about 4 mm between glass and wheel; 6 mm wheel to bottom edge | photo |
| Glyph centres | **0.39 D** from the wheel centre (MENU top, ⏯ bottom, ⏮ left, ⏭ right) | photo |
| Glyph size | MENU: cap height 0.052 D (≈ 0.072 D bold font), width 0.22 D; ⏮ / ⏭ 0.107 D wide, 0.047 D tall | photo |

### 1.2 Body colours

Apple shipped nine colours: silver, black, purple, blue, green, yellow, orange, pink and
(PRODUCT) RED. Yellow and RED were Apple Store only. Each has a "glossier, shinier finish than the
fourth generation" ([Wikipedia: iPod Nano](https://en.wikipedia.org/wiki/IPod_Nano);
[iPodWiki](https://ipodwiki.com/wiki/IPod_nano_(5th_generation))).

**The wheel.** On every colour the ring is white (#f2f2f2) with grey glyphs, and the **centre
button is the body's own aluminium** (body-coloured, polished). On the black model the ring is black
with light glyphs and the centre is dark-grey aluminium. Sources:
[purple photo](https://commons.wikimedia.org/wiki/File:IPod-Nano-5G-front.png) and
[black photo](https://commons.wikimedia.org/wiki/File:IPod_Nano_5th.jpg). Wikipedia notes the button
labels were "gray" rather than colour-matched, except on the black model.

*Silver is uncertain.* One rendering shows silver with a black ring
([lineup render](https://commons.wikimedia.org/wiki/File:IPod_nano_5G.png)), and parts sellers list
only "Silver" and "Black" 5G wheels
([PowerbookMedic](http://www.powerbookmedic.com/iPod-Nano-5th-Gen-Click-Wheel---Silver-p-52992.html)).
Keep the ring as its own setting (§6).

The values below were sampled from the lineup render's mid-body (the "base"). The purple and green
in the render are duller than real photos, so the suggested values are saturated to match photos.

| Colour | Sampled base | Suggested `hsl()` (base) | Shadow edge | Specular | Ring / glyphs |
|---|---|---|---|---|---|
| Silver | #a4a4a4 | `0 0% 66%` | #8a8a8a | #dcdcdc | white / #8e8e93 (or black / #e6e6e6) |
| Black | #313131 | `0 0% 19%` | #1e1e1e | #5b5b5b | **black #161616 / #e6e6e6** |
| Purple | #6d5a93 | `268 42% 44%` | #36266b | #8775a5 | white / #8e8e93 |
| Blue | #0ca0d4 | `196 89% 44%` | #045f97 | #46aedb | white / #8e8e93 |
| Green | #00914a | `140 70% 34%` | #005123 | #349e6d | white / #8e8e93 |
| Yellow | #edd10e | `52 89% 49%` | #c08e27 | #efebbf | white / #8e8e93 |
| Orange (owner's) | #e59a1f | `30 85% 50%` | #933917 | #efe9dc | white / #8e8e93 |
| Pink | #e25c9d | `331 70% 62%` | #9b2952 | #eebed7 | white / #8e8e93 |
| (PRODUCT) RED | #c8333a | `357 62% 47%` | #ab2e2a | #ed8fa2 | white / #8e8e93 |

### 1.3 The aluminium in CSS: one hue knob

The 5G nano is a flattened oval in section, so it reads as a vertical cylinder. The render shows a
dark edge, then the base colour, then a bright specular band about 55–60 % across, then the base
again, then a dark edge. On top of that sits a very fine grain. That gives three layers:

```css
.body {
  /* Settings > Color sets these three (presets) or --h/--s only (Custom) */
  --h: 30; --s: 85%; --l: 50%;
  --grain-alpha: .06;                       /* 0 = polished, .12 = brushed-looking */
  --base: hsl(var(--h) var(--s) var(--l));
  --hi:   color-mix(in srgb, var(--base), white 55%);
  --lo:   color-mix(in srgb, var(--base), black 38%);
  background:
    var(--grain),
    linear-gradient(180deg, rgb(255 255 255 / .10), transparent 30%, rgb(0 0 0 / .12)),
    linear-gradient(90deg, var(--lo) 0%, var(--base) 9%, var(--base) 40%,
                    var(--hi) 57%, var(--base) 74%, var(--lo) 100%);
  background-blend-mode: soft-light, normal, normal;
}
/* fine noise: an inline SVG feTurbulence tile, rasterised once by the browser (no network).
   Isotropic (polished); use baseFrequency='.02 .9' for horizontal brushing. */
.body { --grain: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 .9 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.06'/%3E%3C/svg%3E"); }
```

- **The colour is one variable.** Presets set `--h --s --l`. "Custom" turns `--h` with the wheel in
  5° steps (as `screens/settings/logic.ts stepHue` already does) and leaves `--s`/`--l` alone.
  Everything else derives through `color-mix`, which needs Safari 16.2+ and Chromium 111+, so both
  hosts have it.
- **The centre button** uses the same layers with the 90° gradient turned to 180° (lit from above),
  plus `box-shadow: inset 0 1px 2px rgb(0 0 0/.35), 0 1px 0 rgb(255 255 255/.5)` so it sits in the ring.

### 1.4 Glossy black glass

The glass is one black rectangle around the LCD, about 2 mm proud on each side, with tight radii.

```css
.glass { background:#050505; border-radius: 6px; padding: <2mm-equivalent>;
  box-shadow: inset 0 0 0 1px rgb(255 255 255/.07), 0 1px 0 rgb(255 255 255/.22), 0 -1px 0 rgb(0 0 0/.35); }
.glass::after { content:''; position:absolute; inset:0; border-radius:inherit; pointer-events:none;
  background: linear-gradient(155deg, rgb(255 255 255/.13) 0%, rgb(255 255 255/.03) 37%, transparent 37.5%); }
```

The glare also crosses the LCD (it is one pane of glass). Keep it at alpha ≤ .06 over the LCD itself
so text stays crisp.

### 1.5 The click wheel

| Part | Geometry (D = wheel diameter) | Look |
|---|---|---|
| Ring | D, circular | white: `radial-gradient(circle at 50% 38%, #fdfdfd, #eeeeee 62%, #e1e1e1)`, `box-shadow: inset 0 1px 1px #fff, inset 0 -1px 2px rgb(0 0 0/.12), 0 0 0 1px rgb(0 0 0/.08)`. Black: `radial-gradient(#2a2a2a, #121212)` |
| Centre button | **0.49 D** (radius 0.245 D) | body aluminium (§1.3) |
| MENU | centred, 0.39 D above centre; bold, font ≈ 0.072 D, letter-spacing .02em | #8e8e93 (black ring: #e6e6e6) |
| ⏮ (left), ⏭ (right) | centres 0.39 D left and right; 0.107 × 0.047 D | same grey; drawn as SVG (bar plus two triangles) |
| ⏯ (bottom) | centre 0.39 D below; ▶ then ❚❚, 0.10 D wide | same grey |

The ring does not visibly depress. Feedback is haptic and sound only (§3.3).

### 1.6 Proportions on a phone (and in a desktop window)

The phone is the iPod: the aluminium fills the viewport edge to edge. `useHostChrome` in
`src/skins/ipod/host.ts` already asks for the edge layout, a hidden status bar and portrait. Inside
the safe area (`window.__wmpSafeArea`, event `wmp-safe-area`), the real 0.77 / 0.70 width ratios do
not fit a phone's height: 0.77 W of LCD at 240:376 plus a 0.70 W wheel is about 925 pt on a 390 pt
phone. So the layout fits **height first**:

```
A  = viewport height - safeTop - safeBottom          (usable height)
D  = min(0.70 * W, 0.35 * A)                          (wheel)
G  = gaps: 8 (top) + 2*glassPad(12) + 20 (glass->wheel) + 12 (bottom) = 64 pt
Sh = A - D - G;  Sw = Sh * 240/376;  if Sw > 0.80*W: Sw = 0.80*W, Sh = Sw*376/240 (and centre vertically)
k  = Sw / 240                                         (CSS px per LCD pixel)
```

| Device (pt) | usable A | wheel D | LCD | k |
|---|---|---|---|---|
| iPhone SE 375×667 | 647 | 226 | 228×357 | 0.95 |
| iPhone 14/15 390×844 | 763 | 267 | 278×435 | 1.16 |
| iPhone Pro Max 430×932 | 839 | 294 | 307×481 | 1.28 |

**Windows and browser.** Draw the same device as a phone-shaped body, `height = 96vh`,
`width = min(100vw, 0.46 × height)`, centred on a dark backdrop (#111). Use the same formula inside.

**Scaling the LCD.** Lay the whole screen out in **240×376 CSS px** and scale it with `zoom: k`.
WebKit and Chromium both support `zoom`, it stays crisp, and every metric in §2 can be used
verbatim. The wheel is outside the zoomed box, so pointer maths there is unaffected.

---

## 2. The screen UI, every page

### 2.1 Fonts

| Use | Font (240-unit px) | Measured from |
|---|---|---|
| List rows | **Helvetica Bold 18**, black, left inset **10** | "Videos" and "Video Camera" ink widths (57 and 118 px) match Helvetica Bold 18 exactly |
| Menu status-bar title | Helvetica Bold 12, black, inset 10 | "iPod" = 26 px |
| Row value (right) | Helvetica Bold 14, **#3e94e1**; white on the selected row; right inset 9 | Radio menu "On" |
| Now Playing artist / album | Helvetica 12, white | "Phoenix" = 43 px |
| Now Playing title | Helvetica Bold 14, white | "1901" = 31 px |
| Times, "N of M" | Bold 11–12 white; "2 of 10" regular 12 #d0d0d0 | |
| Hold-centre popup rows | Helvetica Bold 16, white, centred | "Start Genius" = 93 px |

The CSS stack is `font: 700 18px "Helvetica Neue", Helvetica, Arial, sans-serif`. iOS WKWebView
has Helvetica. On Windows, Arial is metric-compatible with Helvetica, so the widths above hold.
Load no web font: the page runs inside Spotify's.

### 2.2 Colours and metrics (240×376 units)

| Element | Value |
|---|---|
| **Menu status bar** | y 0–19 (20 tall): `linear-gradient(#fbfbfb, #b2b2b2)`, 1 px bottom line **#7a7e81** |
| **Dark status bar** (Now Playing, Genius Mixes, Radio, Cover Flow, Extras apps) | y 0–19: flat #4f4f4f to #474747, white 12 px bold text, **time centred** ("9:42 AM") |
| Status icons (right, 4 px apart, 4 px from the edge) | play ▶ light blue `#67caff→#3a9be0` when playing; ❚❚ grey #6d6d6d when paused (none when stopped); battery 24×11, green #a2c871 fill, outlined; lock 7×9 when Screen Lock is on; on dark bars all white |
| Now Playing status, left | shuffle and repeat glyphs (white 12×9 each) when on; "repeat one" shows a 1 badge |
| List background / text | #ffffff / #000000 |
| **Row height** | **list height ÷ visible rows**: 12 visible in a plain menu, so **29.67** (356/12); 9 above the preview panel, so **30.67** (276/9). Measured: Radio menu pitch 29.6, main menu 30.7 |
| **Selection bar** | full width, row height: `linear-gradient(180deg, #4ea0dc 0%, #4690d4 40%, #3f7fcd 70%, #336ac7 100%)`, 1 px top highlight #97c4e3, 1 px bottom **#1855a6**; text and value white |
| Chevron | **only on the selected row** (5G): white `›`, 7×11, bold, right edge at x = 233 |
| Checkmark (choice lists, Main Menu items) | `✓` right-aligned, #3e94e1, white when selected **(reconstructed)** |
| Preview panel (main menu) | y 296–375 (80 tall), see §2.4 |
| Now Playing bands | info y 20–79: `linear-gradient(#424242, #010101)`; art y 80–319 (240×240); controls y 320–375: `linear-gradient(#656565, #262626)` |
| Progress bar | x 46–194 (148 wide), y 341–349 (9 tall), radius 1. Elapsed: glossy blue `linear-gradient(#cee4ff, #7a98ce 45%, #5181d6 55%, #6ca9e8)`. Remainder: `linear-gradient(#ffffff, #e8e8e8 55%, #c6c6c6)`. Elapsed time right-aligned at x 40, remaining "-m:ss" from x 200 |
| Scrubber | same track all white/grey, with a **blue diamond** playhead 9×9 (`#4785fc`, white 1 px rim) |
| Popup (hold centre) | rows **30**, from y 20 down; row bg `rgb(80 80 80/.94)`, 1 px separators #3a3a3a / #6a6a6a; selected = the selection-bar gradient at `#4a9fe2→#3367ca`; the screen under it dims to 50 % |

**Lists.**

- **Scrolling.** The selection moves first. The list scrolls one row when the selection would leave
  the viewport, with no centring. Clamp at the ends: no wrap, and no tick sound or haptic when
  nothing moves.
- **Scroll indicator (reconstructed).** When a list overflows, show a 4 px grey (#9a9a9a, 60 %)
  indicator at the right edge, as on the iPod classic. The nano guide shows no overflowing list.
- **Long text.** Unselected rows clip with an ellipsis. The **selected row marquees** after 1 s at
  30 px/s, pausing 1 s at each end. The Now Playing info lines do the same.
- **Transitions.** Push slides in from the right and pop slides in from the left, 220 ms
  `cubic-bezier(.2,.8,.2,1)`. The status bar does not slide; its title cross-fades.
- **Loading.** A row reading "Loading…" in grey (#8e8e93). The spinner is the iPod's 12-spoke
  activity wheel (seen on the "OK to Disconnect" screen [UG p.14]), 16 px, in place of the status
  bar's play icon.
- **Empty.** A single row with no chevron that does nothing ("No Playlists", "No Songs").

### 2.3 The menu tree (nano 5G, verified)

Items marked ✔ appear in the guide's text or screenshots. Others are standard iPod items not spelled
out in the guide and are marked (std). §4 says what each becomes on Spotify.

```
Main menu  (screenshot UG p.9/13; "Now Playing" is appended while something plays)
├── Music ✔ ................ Genius Mixes ✔, Playlists ✔ (On-The-Go ✔ first), Artists, Albums,
│                            Songs, Genres, Composers, Audiobooks ✔, Search ✔
│                            (+ Compilations ✔ opt-in via Settings > General > Music Menu [UG p.45])
│                            Cover Flow is NOT a menu item on the nano: rotating the nano 90° opens
│                            it [UG p.37-38]; the iPod classic lists it under Music [classic UG p.33]
├── Videos ✔ ............... Movies, Rentals, Music Videos, TV Shows, Video Podcasts (std),
│                            Camera Videos ✔ [UG p.49], Settings ✔ (TV Out, TV Signal, ...)
├── Photos ✔ ............... All Photos ✔, <albums>, Settings ✔ (Time Per Slide, Music, Repeat,
│                            Shuffle Photos, Transitions, TV Out, TV Signal) [UG p.69-70]
├── Podcasts ✔ ............. shows, newest first, blue dot = unplayed [UG p.47]
├── Radio ✔ ................ the FM screen; MENU there opens the Radio menu: Play Radio, Stop Radio,
│                            Favorites, Tagged Songs, Recent Songs, Radio Regions, Live Pause [UG p.65]
├── Video Camera ✔ ......... viewfinder [UG p.52]
├── Extras ✔ ............... Alarms ✔ (Create Alarm, Sleep Timer) [p.78], Calendars ✔ (All Calendars,
│                            To Do's) [p.82], Clocks ✔ [p.77], Contacts ✔ [p.82], Fitness ✔ (Pedometer,
│                            History, Settings) [p.72-73], Games ✔ (Klondike, Maze, Vortex) [p.76],
│                            Notes ✔ [p.84], Screen Lock ✔ (Lock, Reset Combination) [p.79-80],
│                            Stopwatch ✔ [p.79], Voice Memos ✔ [p.75]   (alphabetical, as the classic)
├── Settings ✔
│   ├── About ✔ ............ centre cycles info screens: capacity, counts, serial, version [UG p.12]
│   ├── Shuffle ✔ .......... Off / Songs / Albums [UG p.43]
│   ├── Repeat ✔ ........... Off / One / All [UG p.44]
│   ├── General ✔ .......... Main Menu ✔ (checklist + Preview Panel On/Off) [p.10], Music Menu ✔
│   │                        (checklist + Reset Menu) [p.45], Font Size ✔ (Standard/Large) [p.10],
│   │                        Backlight ✔ (timer, default 10 s, Always On) [p.11], Brightness ✔ [p.11],
│   │                        Clicker ✔ (On/Off) [p.11], Rotate ✔ (Cover Flow/Off) [p.38],
│   │                        Sort Contacts ✔ [p.82], Spoken Menus ✔ (only if enabled in iTunes) [p.83]
│   ├── Playback ✔ ......... Shake ✔ (Shuffle/Off) [p.44], Volume Limit ✔ (+ combination lock)
│   │                        [p.45-46], Sound Check ✔, EQ ✔ [p.47], Audio Crossfade ✔ [p.47],
│   │                        Audiobooks ✔ (speed) [p.48], Mono Audio ✔ [p.83], Energy Saver ✔ [p.18]
│   ├── Date & Time ✔ ...... Date, Time, Time Zone, 24 Hour Clock, Time in Title [UG p.77]
│   ├── Radio Regions ✔ [UG p.66]
│   ├── Language ✔ [UG p.10]
│   ├── Legal (std; not in the guide text)
│   └── Reset Settings ✔ ... Reset / Cancel [UG p.12]
├── Shuffle Songs ✔ ........ whole library at random, skipping audiobooks and podcasts [UG p.43]
└── Now Playing ✔ .......... (while something plays)
```

Corrections to the owner's working list. "FM Radio" is labelled **Radio**. **Voice Memos lives
in Extras**, not the main menu. **Video Camera** is a main-menu item. Extras also has **Alarms**.
The names are plural: **Clocks**, **Calendars**. Settings groups most items under **General** and
**Playback**. Holding MENU on the 5G **goes straight to the main menu** [UG p.6]; it toggled the
backlight only on older iPods.

### 2.4 Pages

#### Main menu

- **Layout (UG p.9; screenshot measured).** Menu status bar with the title "iPod", or the time when
  Time in Title is on, as in the [real-device photo](https://commons.wikimedia.org/wiki/File:IPod-Nano-5G-front.png).
  Below it, 9 rows of 30.67 and the **preview panel** at y 296–375.
- **Preview panel.** Three 80×80 tiles side by side, showing "album art, photo thumbnails, available
  storage, and other information relating to the menu item selected" [UG p.9-10]. Settings >
  General > Main Menu > Preview Panel turns it off, and then the list gets all 356 units (11.6 rows,
  12 at 29.67).
- **Preview panel motion (reconstructed).** One tile cross-fades to a new cover every 3 s, staggered.
- **Preview content on Spotify:**

| Selected item | Panel |
|---|---|
| Music, Shuffle Songs | covers from the library list |
| Photos | covers, in a different order |
| Radio | station covers |
| Extras | a clock: 32 px bold time over a 12 px date on black |
| Settings | "Spotify", then device name, then Liked count (12 px, on #f2f2f2) |
| Now Playing | current art plus a 2-line title/artist |

#### List pages (Playlists, Artists, Albums, Songs, search results, Settings lists)

- One-line rows (§2.2) with the chevron on the selected row when the row opens a page.
- Values right-aligned in blue: a setting's current value, or "On"/"Off".
- **Albums and artists (reconstructed).** 2-line rows (name 18 bold; artist or owner 13 regular,
  #6b6b6b, white when selected) with a 40×40 cover at the left, as the iPod classic draws them.
  Keep the plain 1-line style if this proves too dense at 29.67.
- The first row of an album, playlist or artist page is **All Songs** / **Shuffle**. On the iPod,
  Play/Pause on a collection row plays it [UG p.6].

#### Now Playing (UG p.33–37; screenshots p.33–35 measured)

| Band | y (units) | Content |
|---|---|---|
| Status | 0–19 | left: shuffle and repeat glyphs; centre: time; right: ▶ or ❚❚ and battery |
| Info | 20–79 | artist (12 regular) / **title (14 bold)** / album (12 regular), centred, line pitch 17, first line centred at y 32.5; each marquees when long |
| Art | 80–319 | 240×240 cover; no art gives a grey gradient tile with a ♪ glyph |
| Controls | 320–375 | the cover's **mirror reflection** (`scaleY(-1)`, opacity .25) under the dark gradient; the **mode row** centred at y 345; "**N of M**" (12 regular #d0d0d0) centred at y 361 |

Pressing the centre cycles the mode row [UG p.33-34] (screenshots p.33–35, in this order). Each
mode returns to the default after **5 s idle (reconstructed)**:

1. **Progress (default).** elapsed / glossy bar / -remaining. **Wheel = volume:** the row becomes a
   volume bar (small speaker, bar, loud speaker; same bar style, fill = volume) while turning, and
   reverts 2 s after the last tick (reconstructed: the guide says only "When you see the progress
   bar, use the Click Wheel to change the volume" [UG p.34]).
2. **Scrubber.** the diamond playhead; **wheel = seek**.
3. **Genius slider.** "Genius [⇨ slider] Start", a two-state slider. Only shown when Genius data
   exists [UG p.34-35].
4. **Shuffle slider.** shuffle icon, then a segmented control **Off | Songs | Albums**; the active
   segment is light grey #d8d8d8 with dark text, the others dark grey with white text [UG p.35].
5. **Rating.** five bullets that the wheel turns into ★ (blue #2f7ff0 stars) [UG p.36].
6. **Lyrics.** the lyrics over the art area (white 14 px on black at 70 %), scrolled with the
   song [UG p.37]. Skipped when there are none. (This player: not a mode; they show by themselves,
   §4.3.)

**Hold centre** opens the popup over a dimmed screen (screenshot p.38): Start Genius, Add to
On-The-Go, Browse Album, Browse Artist, Cancel [UG p.39-42]. Audiobooks add a speed choice
[UG p.48].

**Sleep and backlight.**

- **Hold Play/Pause turns the iPod off** [UG p.6]. Here that pauses playback and blacks the LCD;
  any control wakes it.
- **Backlight timer** [UG p.11] dims the LCD to black after N s idle.
- **Energy Saver off** [UG p.18]: instead of black, show the black-on-white clock screen
  (screenshot p.17): big thin time about 70 px, a progress bar, a play/pause box and a battery.
- On the phone, `alchemyAwake(true)` while Backlight is "Always On" or while the clock screen is
  wanted; otherwise let the phone sleep.
- **This player** (the owner's ruling, 2026-10-02): no Backlight, Brightness or Energy Saver of its
  own; the device's screen does that.

#### Search (UG p.44–45; layout reconstructed, the guide has no screenshot)

> **This player (owner's ruling 2026-10-02: "search should open a keyboard if clicked instead of using
> a scroll wheel"):** no letter strip. A search field in the iPod's look is the list's first position;
> a tap or centre on it focuses it and the platform's keyboard types, searching after 400 ms; the
> keyboard's Search key closes it and selects the first result; × clears. Unfocused, the wheel moves
> through the field and the results. The nano's picker below is the reference it replaced.

- **Layout.** Menu status bar "Search". Results fill the list area. A bottom band 56 tall (dark
  gradient as the Now Playing controls) holds the **query** (white 16 bold, magnifier glyph at left)
  over a **letter strip** "A…Z 0…9" (14 bold white). The strip scrolls so the current letter sits in
  a centred blue box (the selection gradient, 20×22).
- **Wheel** moves the letter. **Centre** types it, and the iPod searches on each character
  [UG p.45]. **⏭** types a space and **⏮** deletes [UG p.45].
- **MENU** moves focus to the results list (the wheel then scrolls results). In the results, MENU
  goes back to the picker; pressing it there leaves.
- **Results** carry a type glyph at the left: ♪ song, a head-and-shoulders silhouette for an artist, a disc for an album,
  list-lines playlist; drawn as SVG, 12 px [UG p.45].

#### Cover Flow (UG p.37–38; screenshot p.36, landscape 376×240)

- **The real one.** A white floor with reflections. The centred cover faces front; neighbours are
  turned about 70° and stacked tight. Album title (bold 14) and artist (12) under the centre. Wheel
  or ⏮⏭ flip covers. Centre flips the cover to its track list on the back. Fast spinning shows a
  letter.
- **Ours.** A **portrait page** under Music. The host locks portrait, and the classic puts Cover Flow
  in Music [classic UG p.33].
  - The centre cover is 150×150 at y 70. Each side cover gets `rotateY(±65deg)` at a 38-unit pitch
    under `perspective: 500px`, with a `-webkit-box-reflect: below 0 linear-gradient(transparent 70%, rgb(255 255 255/.35))`.
  - Render only ±6 neighbours. The title and artist sit at y 250 and 268.
  - Centre pushes the album's track list (no flip animation in v1). Play/Pause plays the album.
  - Background: the dark status bar plus a `linear-gradient(#fff, #e9e9e9)` floor, matching the
    screenshot's white Cover Flow.

#### Genius Mixes (UG p.40–41; screenshots p.40)

- **Layout.** Dark status bar. A header band 56 tall, the same gradient as Now Playing info, with
  "◀ Mix name ▶" (16 bold) and two lines of artists (12). A 2×2 cover mosaic 220×220 at y 82. Page
  dots at the bottom (6 px, white for the current mix, grey for the rest).
- **⏮ / ⏭ change mixes.** The wheel does too (reconstructed). Centre or Play plays the mix, and a
  small speaker icon follows the playing mix's name.

#### Radio (UG p.58–66; screenshots p.57–63)

- **Layout.** Dark blue-black gradient `linear-gradient(#0d1420, #1b2a44 45%, #0a0f18)`. Big
  frequency digits (white, about 60 px bold, glossy, with a reflection) and a small "FM".
- **RDS line at the top:** station name, 14 bold grey. Song title (18 bold) and artist (12) below it.
- **The dial at the bottom:** a tick scale, the numbers 96 98 100 102 (14 bold), a red needle
  #e0201a, and orange dots on favourites. Centre switches the dial with the Live Pause bar.
- **⏮⏭** seek to the next station (or the next favourite). Hold-centre gives Tag / Add to Favorites /
  Cancel. MENU opens the Radio menu.

#### Photos (UG p.69–70)

- **The real one.** Albums lead to a thumbnail grid. The wheel moves the selection and ⏮⏭ page
  through it. Centre shows the photo full-screen, and Play starts a slideshow.
- **Ours (repurposed, §4).** Album art. The grid is 4 columns of 56×56 with a 4 px gap. The
  selection is a 2 px blue (#3f7fcd) ring plus a scale of 1.08.
- Full screen is the cover 240×240 centred on black, with its name and owner or artist underneath.

#### Extras: pages we build

| Page | Layout | Controls |
|---|---|---|
| **Clocks** | a list of cities, each row showing the time at right in blue; the selected city opens a full page with a big analogue face (white by day, black by night; 180 px; black hands, red seconds) plus the city and date **(face reconstructed)** | centre on the list: Add (region, then city) / Delete [UG p.77] |
| **Stopwatch** | big `mm:ss.hh` (40 px bold) with the **two most recent laps above** it (16 px) [UG p.79]; a log list | **Play** start/stop, **centre** lap, MENU then **New Timer**; logs show start, total, shortest/longest/average lap; Delete Log / Clear Logs. `logic.ts Stopwatch` persists across visits |
| **Calendars** | the month grid (7 columns, 28 wide, header row of weekdays 12 px), today ringed blue; "No events" | wheel moves the day, **⏮⏭ change the month** [UG p.73], centre shows the day ("No events") |
| **Screen Lock** | blue-grey gradient (`#9fb0c4→#5e6f84`), an SVG padlock, a 4-digit tumbler (the current digit is white on the selection blue) and a caption "New Combination" / "Confirm Combination" / "Enter Combination" (screenshot p.78) | wheel picks the digit, centre confirms, ⏮⏭ move between digits [UG p.80]. Lock shows the padlock until the combination is entered; the status bar shows the lock icon |
| **Notes** | list of notes, then a text page (14 regular, scrolling by wheel) | ship with a "Read Me" note listing the wheel controls and §4's mapping |
| **Alarms > Sleep Timer** | Off, 15, 30, 60, 90, 120 minutes (checkmark list) [UG p.78] | at expiry `commands.pause()`; the status bar shows a small moon (reconstructed) |

Stretch goals:

- **Games** (Klondike, Maze, Vortex [UG p.76]). Vortex, a wheel-driven brick game in a tube, is the
  natural one for a wheel.
- **Alarms > Create Alarm.** It only fires while the app is foregrounded. On the phone it could also
  use `alchemyNotify`.

Hide: Contacts, Fitness (no step data reaches the page), Voice Memos (the iOS app has no
microphone path).

#### Settings pages

- **Value lists** (Sleep Timer, Color, Play On, Theme, Skin) are a list with a checkmark on the
  current choice.
- **Toggles** (Clicker, Click Wheel, Visualizer Fit, Time in Title, Library View) flip in place on
  centre and show their value in blue.
- This player's Settings is **one list under section headers** (§4.4, "This player's Settings
  tree"): a header is the iPod OS grouped list's short grey band with its name in bold white
  (`MenuItem.header`, ui.tsx MenuScreen); the wheel, the keys and a tap pass over it, and a section's
  first row brings its header into view.
- **About** cycles screens on centre [UG p.12]: "iPod" big; Songs / Playlists / Albums counts;
  Version; Playing On.
- **Reset Settings** and **Log Out** are 2-row confirm lists (Reset/Cancel, Log Out/Cancel) with
  the action row highlighted red `linear-gradient(#e35d5b, #b8211f)` **(reconstructed)**.

---

## 3. Click wheel behaviours

### 3.1 Controls, per screen

| Control | Lists | Now Playing | Search picker | Radio (ours) | Photos | Stopwatch |
|---|---|---|---|---|---|---|
| Rotate | move selection | default: **volume** · scrub: **seek** · sliders: move slider · rating: stars | letter | tune station | move selection | scroll log |
| Centre | open / do | cycle the mode row (§2.4) | type the letter | dial ↔ progress | full screen | lap |
| **Hold centre** (600 ms) | context popup for the row (song: Like, Add to Playlist, Start Radio, Browse Album/Artist) | popup (§4.3) | — | Add to Favorites / Cancel | — | — |
| MENU | back | back | to results / leave | Radio menu | back | menu |
| **Hold MENU** | **main menu** [UG p.6] | main menu | main menu | main menu | main menu | main menu |
| ⏯ | play the row (collections: all) [UG p.6] | play/pause | — | play/pause | slideshow | start/stop |
| **Hold ⏯** (1.5 s) | **sleep** (pause, LCD off) [UG p.6] | sleep | sleep | sleep | sleep | sleep |
| ⏭ / ⏮ | next / previous track (works anywhere) | next / previous (⏮ restarts after 3 s, as Spotify) | space / delete | next / previous station | next / previous page | — |
| Hold ⏭ / ⏮ | — | **fast-forward / rewind** [UG p.6] | — | — | last / first photo | — |

**Fast-forward and rewind on Spotify.** Do not repeat `commands.skip()` every 200 ms. Each call is
a network round-trip, and 10 s per call at 5 Hz is a 50× jump. Instead:

1. While the button is held, run the **local scrub** (`scrub.setState({ ms })` from
   `src/ui/scrub.ts`) at 4× real time, rising to 8× after 2 s and 16× after 5 s. The Now Playing bar
   and times follow the scrub.
2. On release, call `commands.seek(ms)` once, then clear the scrub when the next playback state
   arrives (the pattern `seekHold` uses in `src/ui/Transport.tsx`).

**The scrub mode's wheel** works the same way:

- **Step:** 1 % of the length (at least 1 s) per detent, times the acceleration (1, 2 or 4 by tick
  rate).
- **Commit:** **400 ms after the last tick**, never once per tick.

**Volume:** `actions.setVolume(v ± 2)` per detent (0–100), so about two full turns from silence to
maximum. `src/skins/ipod/screens/nowplaying/logic.ts volumeStep` already does this.

### 3.2 Rotation: detents, gesture, acceleration

- **Detent: 15° (24 per revolution).** Rockbox's iPod click-wheel driver reads 96 raw positions per
  turn and moves one item per 4. Only the 1G/2G nano used 6, giving 22.5°
  ([Rockbox `button-clickwheel.c`](https://github.com/Rockbox/rockbox/blob/master/firmware/target/arm/ipod/button-clickwheel.c):
  `WHEELCLICKS_PER_ROTATION 96`, `WHEEL_SENSITIVITY 4`).
  - Our wheel is about 1.5× the real 27 mm. At 15° that is roughly 4 mm of thumb travel per detent
    on the ring's mid-line, against 2.8 mm on the nano.
  - Keep `DETENT` as a **tuning knob (12–18°)** and try 12° on the phone.
  - [ipod-classic-js](https://github.com/tvillarete/ipod-classic-js) uses 15° for mouse and 23° for
    touch.
- **Turn or press.**
  - A ring touch becomes a **turn** once it has moved more than half a detent (7.5°) around the
    centre. After that it fires no button.
  - Ignore angle changes inside 15 % of the radius, where atan2 is noise.
  - A touch that never turns is a press of the zone under it. The zones: centre inside 0.245 D, then
    four 90° sectors (MENU at top, ⏭ right, ⏯ bottom, ⏮ left).
  - The in-progress `ClickWheel.tsx` already does all of this. Its `HUB = 0.36` should be **0.49**
    (the measured centre ÷ wheel ratio), unless a larger ring is wanted for thumbs.
- **Hold:** 600 ms for centre, MENU, ⏮ and ⏭; 1.5 s for ⏯ (sleep), so a slow tap never sleeps.
- **Acceleration (long lists only, > 100 rows).** Velocity is filtered as Rockbox does
  (`v = (15v + new)/16`) and resets after **250 ms** without a tick (`WHEEL_FAST_OFF_TIMEOUT`).
  At ≥ 6 ticks/s move 3 rows per tick; ≥ 10, 5 rows; ≥ 14, 8 rows (ipod-classic-js's table).
- **Letter jump** [UG p.11]. Fast spinning on a long **alphabetical** list shows a big letter (a
  60×60 rounded translucent black square, white 40 px bold) and the wheel then steps by letter;
  symbols and numbers come after Z. Lifting the thumb (pointerup) returns to rows.
  - Use it only on lists we sort A–Z locally: Artists, Albums, Cover Flow, Playlists if sorted.
  - Liked Songs is in date order, so it gets acceleration only.

### 3.3 Feedback: the clicker and detent feel

- **Per detent that moves something:** `window.alchemyHaptic?.('selection')` plus, while Settings >
  General > Clicker is On, `window.alchemySound?.(1104)` (the iOS keyboard tick). The iPod's clicker
  ticks through the speaker or headphones [UG p.11].
- **At a list end** nothing moves, so there is no tick (as on the iPod).
- **Haptic budget.** Cap haptics at 30/s. Above that, drop ticks: the visual still moves.
- Call `alchemyHaptic('prepare')` on pointerdown (`ClickWheel.tsx` does).
- **Button presses:** `alchemyHaptic('light')`. **Holds:** `'medium'` when the hold fires.
  Errors such as "can't seek": `'warning'`.
- **Without `alchemySound`** (Windows, browser), use Web Audio:
  - one shared `AudioContext`, resumed on the first gesture;
  - per tick, a 4 ms buffer of white noise under a 1.5 ms exponential decay, through a 3 kHz
    high-pass, at gain .12;
  - mute it while `document.hidden`.
  - On the iOS app do **not** use Web Audio for the tick; `alchemySound` exists there.

### 3.4 Desktop input

The arrows tick, Enter is centre, Escape and Backspace are MENU. `ClickWheel.tsx` captures these on
window; Space is the page's own play/pause. In addition:

- the **mouse wheel over the device** ticks once per 40 px of delta (accumulate; reset after 250 ms);
- a **right-click on the wheel** is a hold of that zone.

If `auth.hostWindow && !auth.nativeTitle`, the aluminium outside the screen and wheel is the window
caption (`useWindowControls().onCaptionMouseDown`).

---

## 4. Spotify mapping

### 4.1 What the skin has to work with

- **`useShell()`** gives `{ store, presets, queries, client, shortcuts, portal, toggleFullscreen, nativeSize, debugText }`
  (`src/ui/types.ts`). The iPod uses `store`, `queries` (through the `src/ui/data.ts` hooks) and
  `client`, and ignores `presets`, `nativeSize` and `debugText`.
- **`useApp(selector)`** reads the store (`src/model/store.ts`):
  - `playback`: track, status, position/at, shuffle, repeat, canSeek/Next/Prev, context, from
  - `queue.next`
  - `saved`, `membership` (optimistic)
  - `devices`, `lyrics`, `ui.searchQ`
  - `settings`: volume, muted, lyrics, karaoke, skin
  - `auth`: engine, loggedIn, canLogout, hostWindow, nativeTitle
- **Commands** (`src/model/commands.ts`):
  - transport: `playPause`, `play`, `pause`, `stop`, `next`, `prev`, `seek(ms)`, `skip(sec)`,
    `toggleShuffle`, `setRepeat(off|context|track)`, `cycleRepeat`
  - playing collections: `playContext(ctx, track?)`, `playItem({uri, ctx})`, `playAll(uri)`
  - library: `search(q)`, `transfer(deviceId)`, `setLiked(uri,on)`, `addTo(track, target, on)`
  - other: `openLink`, `logout`, `win`, `checkForUpdates`
  - **Not used by this skin:** `startCapture`, and the WMP-view navigators `openInLibrary`,
    `openAlbum`, `openArtist`, `openFrom` (they drive WMP's Media Library state; the iPod keeps
    its own stack).
- **Data hooks** (`src/ui/data.ts`, `src/ui/hooks.ts`, `src/ui/AddTo.tsx`, `src/ui/Lists.tsx`):

| Area | Hooks |
|---|---|
| Library | `useLibraryList` (playlists and saved albums, ≤ 400), `useCollection(uri)` (paged rows, meta, total, loadMore) |
| Artists and albums | `useArtist(uri)` (top tracks and albums), `useAlbumMeta` |
| Search | `useSearchAll(q)`, `useSearch(q, bucket)` |
| Home and radio | `useHome` (the home shelves), `useRadioSeeds` and `useRadio` (stations) |
| Lyrics | `useLyrics`, `usePlainLyrics`, `useLyricScroll` |
| Playback | `usePlayback`, `usePosition`, `useClockMode`, `useNowPlaying`, `usePlayingContext` |
| Devices | `useDevices(icon)` (Connect devices as menu entries) |
| Like and add | `useAddTo(uri)` (liked flag, toggle, playlists with membership), `useSaved`, `toggleSaved`, `playingTrack` |
| Prefetch | `useWarm` (prefetch the row under the selection) |

- **Query keys and fetchers** (`src/adapters/spotify/queries.ts`, reached only through
  `shell.queries`): `fetchLibraryList`, `fetchCollectionPage`, `fetchSearch`, `fetchHome`,
  `radioSeeds`, `fetchRadio`, `fetchArtist`, `fetchAlbumMeta`, `fetchLyrics` (the App mounts
  `useLyricsFor`, so the skin only reads `useLyrics`), `fetchSaved`, `fetchEditablePlaylists`,
  `fetchMembership`, `applyMembership`.
- **How WMP 9 plays things** (`src/skins/wmp9/components/Views.tsx`, `src/ui/hooks.ts useLibrary`).
  A track row plays `playContext(t.ctx ?? t.uri, t.uri)`. A collection tile plays
  `playAll(uri)` (playlist, album) or `playContext(artistUri, null)`. Search results
  `click`/`play` the same way. Radio stations are `playItem({ uri })` on the station playlist. The
  iPod does exactly the same per row.

### 4.2 Every iPod page → Spotify

| iPod page | Spotify | Source / call | Verdict |
|---|---|---|---|
| **Music** | — | — | keep |
| Music > **Cover Flow** (added, classic-style) | saved albums, sorted by artist (the iPod's order [UG p.37]) | `useLibraryList()` filtered `isAlbum`, `image` covers; centre pushes the album; ⏯ `playAll(uri)` | **build** (simplified, §2.4) |
| Music > **Genius Mixes** | the **home feed** shelves: each item made of a playlist or album becomes a "mix" page | `useHome().sections`; mosaic from `img`; play `playItem({ uri })` | **build** (this is where Media Guide lives) |
| Music > **Playlists** | the user's playlists, library order. First row **On-The-Go** = Spotify's queue, read-only (`queue.next`) | `useLibraryList()` not `isAlbum`, then `useCollection(uri)` pages (call `loadMore()` when the selection is within 10 rows of the loaded end) | **build** |
| Music > **Artists** | **No followed-artists query exists.** `fetchLibraryList`'s `contextRow` keeps only playlists and albums | options in §6; meanwhile derive from saved albums' `artist` names (names only, no uri) and push an artist page of their albums in the library | **decide** |
| Music > **Albums** | saved albums (A–Z) | `useLibraryList()` + `useCollection(albumUri)`; a 2-line row with cover | **build** |
| Music > **Songs** | **Liked Songs** | `useCollection(LIKED)` (50 per page). A row plays `playContext(t.ctx ?? t.uri, t.uri)`, and **a Liked row has `ctx` null, so it plays inside its album** (adapter limit, same as WMP 9) | **build** (§6) |
| Music > Genres, Composers | no genre or composer data on Spotify tracks | — | **hide** (Music Menu checklist can show them later as "Moods" = home sections; §6) |
| Music > Audiobooks | not exposed by the adapter | — | **hide** |
| Music > Compilations | — | — | **hide** (opt-in item on the real one too) |
| Music > **Search** | Spotify search | each typed letter: `commands.search(q)`, then `useSearchAll(ui.searchQ)`; results flattened Songs, Artists, Albums, Playlists; each bucket's last row "More…" opens `useSearch(q, bucket)` paged | **build** |
| **Videos** | nothing playable | — | **hide** by default (§6: or a "Home" shelves page in this slot) |
| **Photos** | **album-art browser** | covers of `useLibraryList()` items plus Liked; ⏯ plays the collection | **build** (repurposed) |
| **Podcasts** | no shows query: `contextRow` drops `spotify:show`, search has no show bucket. The **home feed does carry** `spotify:show`/`episode` items, and `playItem` plays episodes | — | **hide** in v1 (§6) |
| **Radio** | **Spotify radio**: song radio and artist radio for what plays, radio for recent artists, the feed's Recommended Stations | `useRadio(useRadioSeeds())`, drawn as the **FM dial** (station *i* at 87.5 + 0.2*i* MHz for the big digits, station name as RDS, the playing title and artist below). Turning tunes; it **plays 600 ms after the wheel rests**: `playItem({ uri: station.uri })`. ⏮⏭ seek a station. Radio menu: Play Radio, Stop Radio (`pause`), Favorites (local list), Recent Songs (stations played, local) | **build** (repurposed) |
| **Video Camera** | — | — | **hide** |
| **Extras** | pure UI | §2.4 | **build** Clocks, Stopwatch, Calendars, Screen Lock, Notes, Alarms > Sleep Timer; **stretch** Games, Create Alarm; **hide** Contacts, Fitness, Voice Memos |
| **Settings** | §4.4 | — | **build** |
| **Shuffle Songs** | "shuffle on and play Liked Songs" is **not possible today**: `playAll(LIKED)` starts the first Liked track *in its album*, because the adapter names no Liked Songs context | interim: shuffle on (`toggleShuffle` if off), then play a random Liked track `playContext(t.ctx ?? t.uri, t.uri)`; real fix in §4.6 | **decide** (§6) |
| **Now Playing** | — | listed while `hasMedia` | **build** |

### 4.3 Now Playing on Spotify

| Element | Source |
|---|---|
| Artist / title / album, art | `playback.track` (`artist`, `title`, `album`, `art` / `image`) through `useNowPlaying()` |
| Times, bar | `usePosition` / `useClockMode`, `duration`; elapsed / `-remaining` always (the iPod shows both) |
| **"N of M"** | the track's index among the playing context's loaded rows: `useCollection(playback.context?.uri)` plus `logic.ts ofText`. Hide the line when unknown (Liked rows playing in their album, radio before its first page) |
| Mode 1, volume | `actions.setVolume`. On the iPhone the adapter forwards it to `alchemySetVolume` when this window is the active device (`src/adapters/spotify/connect.ts`). Also **listen to `wmp-volume`** (`window.__wmpVolume`, the hardware buttons) and flash the volume bar (see §4.6) |
| Mode 2, scrubber | local scrub, then `commands.seek` (§3.1); hidden when `!canSeek` |
| Mode 3, **Genius slider → "Radio" slider** | "Radio [⇨] Start" starts **song radio**: `fetchRadio([radioSeeds()[0]])` through the `useRadio` query, then `playItem({ uri: stations[0].uri })`. Shown when `useRadioSeeds()` is non-empty |
| Mode 4, shuffle slider | **Off \| Songs** (Spotify has no album shuffle; drop "Albums"). Moving it calls `toggleShuffle()` when it differs from `playback.shuffle` |
| Mode 5, **rating → Like** | §6. Recommended: a heart slider "♡ \| ♥" bound to `useAddTo(playingTrack).saved / toggle` |
| Lyrics (not a centre mode) | over the art by themselves, at its foot just above the mode row (plain ones a four-line window), in every mode, whenever `lyricsShown(s)` (`settings.lyrics` on and the track has some); no centre press (the owner's ruling, 2026-10-02: the nano's mode 6 went unfound). `useLyrics()` (synced: the current line, next line dimmed, karaoke per `settings.karaoke`) or `usePlainLyrics()` plus `useLyricScroll` (scrolled by position, never by touch: a tap on them is the art's tap, Canvas -> cover -> visualizer; the ⋯ stays over them). The centre cycles progress -> scrubber -> Radio only |
| **Hold centre popup** | **Start Radio** · **Add to Playlist…** (a list of `useAddTo(uri).playlistMenu().sub` entries with checkmarks; centre toggles membership through `addTo`) · **Like / Unlike** (`toggle`) · **Browse Album** (push the album page for `track.albumUri`) · **Browse Artist** (`track.artistUris[0]`, then `useArtist`: top tracks, then albums) · **Play On…** (`useDevices`; centre calls `transfer(id)`) · Cancel |
| Repeat glyph | `playback.repeat`: context = repeat, track = repeat-one |

### 4.4 Where the Spotify-only things live

| Thing | Place in the iPod UI |
|---|---|
| **Connect device picker** (WMP's "Play on") | **Settings > Play On** (under Playback) (checkmark list from `useDevices().items()`; offline ones greyed; ours named "WMP Spotify (This Device)") and the Now Playing **hold-centre > Play On…**. When playing elsewhere, the menu status bar shows a small speaker glyph (reconstructed). Optional on iPhone: a last row "AirPlay…" calls `alchemyRoutePicker()` |
| **Like / Unlike** | Now Playing mode 5 (§6); hold-centre on Now Playing and on any song row |
| **Add to playlist** | hold-centre > Add to Playlist… (only `fetchEditablePlaylists` targets; membership via `fetchMembership`; optimistic marks in `store.membership`) |
| **Lyrics** | over Now Playing's art while on (§4.3). **Lyrics** On/Off (`actions.setLyricsEnabled`) and **Karaoke** On/Off (`setKaraoke`) in Now Playing's ⋯ menu and its hold-centre popup (not in Settings) |
| **Radio from a track** | Now Playing mode 3 slider; hold-centre > Start Radio; main menu **Radio** |
| **Home / Media Guide shelves** | **Music > Genius Mixes** (§4.2) |
| **Log out** | **Settings > Log Out**, the last row, under Account (only when `auth.canLogout`), confirm list, then `commands.logout()` |
| **Skin switch** | **Settings > Skin** (under Appearance): "iPod ✓" / "Windows Media Player 9" sets `actions.setSettings({ skin: 'wmp9' })`. WMP 9's way here is its View > Skin submenu (already in `src/skins/menus.ts`) |
| **Colour** | **Settings > Color** (under Appearance): the nine names (§1.2) plus **Custom** (a page with a hue strip; the wheel turns `--h` 5° per detent with a live preview; centre saves). Plus **Click Wheel**: White / Black ring |
| **Shuffle / Repeat** | the Now Playing status row's toggles only (not in Settings) |
| **Visualizer** | Now Playing's ⋯ menu and hold-centre popup: **Visualizer…**, the engines, then an engine's presets (not in Settings). **Settings > Visualizer Fit** (under Appearance): Fit / Stretch |
| **Shake** (iPhone only) | **Settings > Shake** (under Playback): Shuffle / Off. On `wmp-shake`, `commands.next()` (with shuffle on, Spotify's next is random; the iPod's shake also leaves the shuffle setting alone [UG p.43]) |
| **Brightness, backlight, date and time** | not the skin's (the owner's ruling, 2026-10-02: "we are not the OS"): the device's own. The clocks follow the device's 12 / 24 hours (the platform's locale default, `logic.ts h24`, `ui.tsx useTime`) |
| **Battery** in the status bar | iPhone: `window.__wmpBattery` / `wmp-battery` (`useHostGlobal`). Windows / Chromium: `navigator.getBattery()` when present. Otherwise draw it full |
| **About** | Songs = `useCollection(LIKED).total`; Playlists and Albums = `useLibraryList` counts; Version = `__wmpHost.version (build)` on iPhone; Playing On = the active device; **Check for Updates** = `commands.checkForUpdates()` answered in a 1-row page |

**This player's Settings tree** (2026-10-02, the owner's rulings: what Now Playing controls is not
repeated here, nor what the device does (brightness, backlight, energy saver, date and time, the 24-hour
clock), and the rest is **one screen** under section headers; a row marked › opens its page; *gated*
rows show only with their host, and a header with no row shown under it is not shown):

| Header | Its rows, in order |
|---|---|
| **Playback** | Play On ›, Volume Limit ›, Shake (*iPhone*: Shuffle / Off) |
| **Appearance** | Skin ›, Color ›, Click Wheel (White / Black), Clicker (On / Off), Theme › (Light / Dark / Automatic, *`alchemyAppearance`*), Visualizer Fit (Fit / Stretch), Time in Title (On / Off) |
| **Menus** | Main Menu ›, Library Filters ›, Library View (Grid / List) |
| **General** | About ›, Check for Updates ›, Refresh Player (*`alchemyRestart`*), Reset Settings ›, Legal › |
| **Support** | Source Code, Report a Problem, Host Log (*`alchemyShowLog`*) |
| **Account** | Log Out › (*`auth.canLogout`*: the confirm list) |

**Settings that have no Spotify meaning: hidden.** Language, Radio Regions, Rotate, Sort Contacts,
Spoken Menus, EQ, Sound Check, Audio Crossfade, Audiobooks speed, Mono Audio, Font Size (stretch),
and Volume Limit (stretch: a skin-local cap on `setVolume`).

**Kept and skin-local** (in `ipod.settings`, `src/skins/ipod/settings.ts`):

- Main Menu checklist plus Preview Panel, and the Music Menu checklist
- Clicker, Shake, Time in Title
- Color, Click Wheel, Sleep Timer
- Reset Settings (resets `ipod.settings` only, never the app's)

### 4.5 Must-nots

- No `startCapture`.
- No visualizer: the skin never renders the engine canvas.
- No calls to the WMP view navigators (`openInLibrary` / `openAlbum` / `openArtist` / `openFrom`)
  and no `actions.setView`. They move WMP 9's state (`ui.view`, `libNode`), which would greet the
  user on switching back.
- No per-tick network. Debounce seek (400 ms), tuning (600 ms) and search (one per typed character).

### 4.6 Changes needed outside `src/skins/ipod/`

**Already in the working tree** (uncommitted, 2026-09-30), so no action is needed:

- `src/skins/registry.ts` lists `ipod`.
- WMP 9's **View > Skin** submenu is in `src/skins/menus.ts`.

**Still open** (for the lead; this spec does not make them):

1. **Optional adapter work**, each unlocking an iPod page:
   - (a) keep `spotify:artist` rows from libraryV3 (`contextRow` in `src/adapters/spotify/library.ts`)
     for **Artists**;
   - (b) keep `spotify:show` rows and page a show's episodes for **Podcasts**;
   - (c) name the Liked Songs context (`spotify:user:<id>:collection`) so **Songs** and **Shuffle
     Songs** play inside Liked Songs;
   - (d) an `addToQueue(uri)` command for **Add to On-The-Go**.
2. **`wmp-volume` to the store**: the phone's hardware volume buttons are reported
   (`window.__wmpVolume`) but nothing writes them into `settings.volume`, so the iPod's volume bar
   would drift from the real volume.

---

## 5. Alignment with the in-progress `src/skins/ipod/`

Checked against the files as they stood while this was written (2026-09-30).

| File / value | Spec says |
|---|---|
| `ClickWheel.tsx DETENT = 360/24` | ✔ 15°. Keep it tunable (12–18°) |
| `ClickWheel.tsx HUB = 0.36` | the measured centre button is **0.49** of the wheel's diameter (radius ratio 0.49 as well) |
| `ClickWheel.tsx` hold ⏮/⏭ repeats every 200 ms | use the local-scrub fast-forward (§3.1), not repeated `skip()` |
| `HOLD_MS = 600` | ✔ for centre / MENU / ⏮⏭; use 1.5 s for ⏯ (sleep) |
| `nowplaying/logic.ts Mode` = default, scrub, lyrics | add **radio** (the Genius slot), **shuffle**, **like** (the rating slot) between scrub and lyrics, in the order of §2.4 |
| `logic.ts scrubStep` 2 % / `volumeStep` 2 | ✔ volume. Scrub: 1 % with acceleration and a 400 ms commit (2 % without acceleration is acceptable) |
| `settings.ts COLORS` (HSL) | close. Suggested values in §1.2 (purple 268/42/44, green 140/70/34, orange 30/85/50, silver lightness 66) |
| `contract.ts Screens.videos / photos / fmRadio / voiceMemos` | videos: hidden (or Home, §6); photos: album-art browser; fmRadio: Spotify radio on the FM dial; voiceMemos: hidden |
| `contract.ts Chrome.MenuScreen preview` | the preview panel is the **main menu's only** (80 tall, 3 tiles) |

---

## 6. For the owner to decide

1. **Artists.** Add followed artists to the adapter (small change, true iPod Artists), or derive
   artists from saved albums (names only; each shows its saved albums), or hide.
2. **Podcasts.** Hide until the adapter exposes saved shows, or show only the home feed's shows and
   episodes.
3. **Songs and Shuffle Songs play inside Liked Songs?** This needs the adapter to name the Liked
   Songs context. Until then a Liked row plays inside its album, and Shuffle Songs can only start a
   random Liked track (in its album) with shuffle on.
4. **The rating slot.** A Like heart (recommended; real data), or five cosmetic stars that do
   nothing on Spotify.
5. **The Videos slot.** Hidden, or a "Home" page listing the home-feed shelves (Genius Mixes already
   carries them).
6. **Genres / Composers.** Hide, or repurpose Genres as the home feed's section titles ("Moods").
7. **On-The-Go.** A read-only view of Spotify's queue, plus an `addToQueue` command for "Add to
   On-The-Go"?
8. **Touch on the LCD itself.** Wheel-only (authentic), or also allow tapping a row and swiping the
   list.
9. **Silver's click-wheel ring.** White or black (sources disagree); the setting exists either way.
10. **Cover Flow placement.** A Music-menu page in portrait (this spec), or real landscape on
    rotation (needs `alchemyOrientation('any')` while it shows).
11. **Album order.** A–Z (the iPod's) or Spotify's recents order.
12. **Extras scope for v1.** Clocks, Stopwatch, Calendars, Screen Lock, Notes and Sleep Timer
    (proposed); Games and Create Alarm later.

---

## Sources

- Apple, *iPod nano User Guide* (5th generation), 2009: <https://cdsassets.apple.com/live/6GJYWVAV/user/ma1194_ipod_nano_5th_gen_userguide.pdf>. This is the menu tree, the controls and the screenshots measured here.
- Apple, *iPod nano User Guide* (4th generation): <https://cdsassets.apple.com/live/6GJYWVAV/user/ma629_ipod_nano_4th_gen_userguide.pdf>. Used for the Now Playing and preview-panel comparison.
- Apple, *iPod classic User Guide* (160GB, late 2009): <https://cdsassets.apple.com/live/6GJYWVAV/user/ma1195_ipod_classic_160gb_user_guide.pdf>. Shared menu system; Cover Flow as a Music item.
- EveryMac, iPod nano 5th Gen specs: <https://everymac.com/systems/apple/ipod/specs/ipod-5th-generation-5g-nano-specs.html>
- iFixit, iPod Nano 5th Generation Teardown: <https://www.ifixit.com/Teardown/iPod+Nano+5th+Generation+Teardown/1157>
- Wikipedia, iPod Nano: <https://en.wikipedia.org/wiki/IPod_Nano>. Wikipedia, Podium Sans: <https://en.wikipedia.org/wiki/Podium_Sans>
- iPodWiki, iPod nano (5th generation): <https://ipodwiki.com/wiki/IPod_nano_(5th_generation)>
- iLounge review, iPod nano (fifth-generation): <https://www.ilounge.com/index.php/reviews/entry/apple-inc-ipod-nano-fifth-generation>
- Macworld review, fifth-generation iPod nano: <https://www.macworld.com/article/200094/5g_ipod_nano_review.html>
- Wikimedia Commons: [front photo (purple)](https://commons.wikimedia.org/wiki/File:IPod-Nano-5G-front.png), [black wheel photo](https://commons.wikimedia.org/wiki/File:IPod_Nano_5th.jpg), [nine-colour render](https://commons.wikimedia.org/wiki/File:IPod_nano_5G.png)
- PowerbookMedic, 5G click wheel parts: <http://www.powerbookmedic.com/iPod-Nano-5th-Gen-Click-Wheel---Silver-p-52992.html>
- Rockbox, iPod click-wheel driver: <https://github.com/Rockbox/rockbox/blob/master/firmware/target/arm/ipod/button-clickwheel.c>
- tvillarete/ipod-classic-js (wheel thresholds, velocity skips, selection gradient): <https://github.com/tvillarete/ipod-classic-js>
- tyseanahspell/ipod-snapshot, a 5G nano web recreation. Useful structure, but its **black** menu background is wrong; the 5G's menus are white: <https://github.com/tyseanahspell/ipod-snapshot>
