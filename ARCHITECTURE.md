# Page architecture v7 — TypeScript + React (branch react-ts)

Decision (user, 2026-09-24): TypeScript everywhere, React for the skins, a real store, popular maintained libraries.
The visualizer engine stays numerically byte-identical (docs/EXACTNESS.md is the gate). The host boundary
(CONTRACT.md v1–v6.1: messages, bindings, window globals, bundle file names) is UNCHANGED.

## Toolchain (Node 24 / npm)
- vite ^6 + @vitejs/plugin-react, TypeScript ^5 (`strict: true`, `noUncheckedIndexedAccess`), vite-plugin-singlefile
- react ^19, react-dom ^19; state: zustand ^5 (slices + `subscribeWithSelector` + devtools middleware)
- tests: vitest + @testing-library/react + jsdom for units; the existing Playwright smokes (tests/*.js) re-pointed at dist/
- lint: eslint ^9 flat config with typescript-eslint (recommended-type-checked) + eslint-plugin-react-hooks; prettier
- CSS: Tailwind v4 (`@tailwindcss/vite`) utilities over the tokens in `src/ui/theme.css`, plus one small CSS Module per
  skin for what utilities cannot say (see "Tailwind"); UI primitives: Radix (menubar, dropdown-menu, dialog)
- npm scripts: `dev`, `build`, `test`, `lint`, `typecheck`, `smoke`. `python3 build.py` and `deno/build.ts` are RETIRED
  once `npm run build` produces the same outputs; the desktop host's build and CI call `npm ci && npm run build`.

## Outputs (unchanged names; the host and CI depend on them)
- `dist/index.html` — the whole page as ONE self-contained file (singlefile; no external requests but fonts none, and the
  lrclib/host sockets at runtime). Served by Cloudflare, unpacked by the exe, embedded by the screensaver.
- `alchemy.html` at the repo root = a copy of dist/index.html (kept for the README/Downloads habit) — via `npm run build`.
- `dist/spotify-inject.js` — JSON `{ "html": <body inner markup: just the mount node>, "css": <all css>, "js": <the bundle
  as an IIFE/classic script string> }`. The Deno host injected it into open.spotify.com (its spotify.ts, unchanged
  shape); the Tauri host does not use it. The js must be a classic script (no `import`/`export`, no `type=module`), so Vite builds `format: 'iife'`.
- `dist/version.json`, `_headers`, `_redirects` as now (site/make_dist.py or an npm script; keep behaviour).

## Layout
```
src/
  engine/            visualizers, TypeScript, numerics untouched (see "Engine")
    rand.ts effect.ts shift.ts kernels.ts draw.ts alchemy.ts bars.ts battery/{warps,draws,draws-a,index}.ts
    index.ts         createEngine(kind, canvas) → { render(level), setPreset(n), debug(), ... } (was Alchemy.Engine…)
    audio/           TimedLevel producers: analyser from a MediaStream (Web Audio, WMP dB range), PCM from the host socket
  model/             framework-free. NO DOM, NO React.
    types.ts         Track, Context, Device, Station, HomeSection, LibraryItem, Lyrics, View, MediaStatus, …
    store.ts         zustand store: slices { auth, playback, queue, library, home, radio, devices, lyrics, ui, settings, vis }
    commands.ts      the Commands interface every adapter implements (play/pause/next/prev/seek/volume/mute/shuffle/
                     repeat/transfer/search/loadPlaylist/loadLiked/loadHome/loadRadio/openLink/logout/…)
    settings.ts      persisted settings (localStorage key unchanged so upgrades keep the user's choices)
  adapters/
    spotify/         the web player's channels (port of src/95-spotify.js): observers (window.__wmpSpotify + events),
                     pathfinder.ts (hashes: W.hashes → script scan → baked table → 412 rescan), connect.ts (commands,
                     volume, transfer), radio.ts (seed_to_playlist GET), home.ts, library.ts, search.ts, state.ts
                     (player_state → playback slice; numbers are strings; is_paused; no active device = paused),
                     player/ (who plays, picked per command: one Player interface — transport, playContext,
                     setShuffle, setRepeat — with two backends, `cloud` (connect-state, connect.ts command) and
                     `host` (the host's own speaker through host/player.ts, CONTRACT v10), and the router: the host's
                     when it has a player and its speaker is the command's target. connect.ts keeps the optimistic
                     patches above both; state.ts lays the host's report over the cluster's state while its speaker
                     is active. The UI never knows which one played)
    local/           the app/website: system audio or share picker (getDisplayMedia), host GSMTC `media` frames,
                     mediaCmd over the socket, lyrics from the host (CONTRACT v4/v5)
    host/            the socket to the desktop host (PCM + JSON), alchemyWin*/alchemyReady/alchemySpotifyLogout bindings,
                     screensaver/app/spotify mode detection (window.alchemyScreensaver, alchemyEngine, alchemyRoot);
                     player.ts, the one door to a host's own player (alchemyPlayer, __wmpPlayer, __wmpSpeaker), any host's
  skins/
    types.ts         Skin = { id, name, Root: React.FC, shortcuts? } (see "Skins")
    menus.ts         WMP 9's menus as data (File / View / Play / Tools / Help, the visualization picker)
    wmp9/            the WMP 9 "Corporate" (XP) skin: components/ (TitleBar, MenuBar, TaskPane, Screen, Visualizer,
                     Transport, SeekBar, PlaylistPane, MediaLibrary, MediaGuide, RadioTuner, Devices, Lyrics, Options,
                     About, Shortcuts, dialogs, menus), wmp9.module.css (+ per-component modules), index.ts
    registry.ts      { wmp9 } — the future WMP 11 skin is a second entry; the user's choice lives in settings.skin
  ui/                the shared, skin-agnostic layer (see "Shared UI layer"): headless components + hooks over the
                     store, the accelerator table, theme.css (Tailwind theme, variants, base)
  app/
    App.tsx          picks the skin, wires adapters (spotify when window.alchemyEngine === 'spotify', else local),
                     keyboard shortcuts (WMP 9 accelerators), fullscreen/bare, view switching, Shell.hold semantics
    mount.tsx        createRoot on document (standalone) or on window.alchemyRoot (the open shadow root in Spotify
                     mode); styles adopted into the shadow root (constructed stylesheet) — the host does this already
                     from spotify-inject.js's css; keep it that way
  main.ts            entry
```
Old `src/*.js`, `template.html`, `build.py`, `deno/build.ts` are deleted at cut-over (same PR), not kept alongside.

## Engine
Port each src/NN-*.js to a TS module by wrapping, not rewriting: same functions, same typed arrays, same integer ops
(`| 0`, `>>>`), same evaluation order; add types (Uint8Array, Float64Array, number) and `export`s only. The custom
rand/LCG, the ucrtbase sin/cos/atan2 clones and the FMA emulation move verbatim. Gate: tools/js_render*.js, js_bat.js,
js_bars.js (the A/B drivers) must run against the built engine (give them a small `dist/engine.js` classic build or
load the TS through tsx) and reproduce docs/EXACTNESS.md on a sample: Alchemy 3 000 frames at 1700000000, Bars presets
0–3 at 3 000, Battery presets 0, 1, 9, 20 at 3 000 — identical, before the old files are deleted. (The full 30 000 pass
is re-run once at the end by the lead.)

The output step (index.ts present / blit, gl.ts's shader) is the only place a surface becomes canvas pixels, and it has
one option of its own: `options.alpha` 'opaque' (the default: alpha 255, byte for byte what it always was) or 'luma'
(alpha = the brightest channel × 1.25, black clear; premultiplied in WebGL2, unpremultiplied ImageData in 2D), with
`options.tint` [r,g,b] painting every pixel that colour (the surface a mask). The WebGL2 context has an alpha channel
for every canvas so the two switch at run time; the visualizers never read either. The app sets them from `vis.alpha` /
`vis.tint` (ticker.ts), which only a skin showing the visualizer over something asks for (the iPod's Over Cover).

## Store (zustand) — the one state the skins read
auth { loggedIn, engine: 'spotify'|'local' } · playback { status, track{uri,title,artist,album,art,duration}, position
(ms at `at` timestamp), paused, shuffle, repeat: 'off'|'context'|'track', volume 0..100, muted, canSeek/Next/Prev,
context{uri,kind,name}, from: string } · queue { next: Track[] } · library { playlists, albums, liked, byUri: Record<uri,
{ tracks, total, name, loading }> } · home { greeting, sections } · radio { stations } · devices { list } · lyrics { status,
lines, plain, enabled } · ui { view: 'now'|'library'|'guide'|'radio'|'devices', taskPane, playlistPane, fullscreen,
bare, dialog, menu } · settings (persisted) { vis, preset, fps, animate, lyrics, volume, muted, skin, clockMode, … } ·
vis { kind, preset, hold, alpha, tint, scale } (alpha / tint: the engine's output; scale: a skin's frame size over
settings.scale while it shows; none saved)
Adapters write the store through actions; skins subscribe with selectors; commands are a `Commands` object on the
store (`useStore.getState().commands`). Position extrapolation is a selector helper (`positionNow(state)`), never a
1 Hz setState.

## Skins
A skin is markup and classes over `src/ui`: it composes the shared components and hooks, adds its own look (Tailwind
utilities on `src/ui/theme.css`'s tokens, plus one CSS Module for what utilities cannot say) and holds no store logic.
It must not import from adapters/ or engine/ (only model/ types and constants, `src/ui`, and `<Visualizer/>` from app/,
which owns the canvas + RAF + hold). The menus, transport, seek pills (±10 s), lyrics disc (Ctrl+L), shuffle disc,
picker ▾, playlist pane links, clock elapsed/remaining and the band label = view name are all src/ui behaviour.

What a second skin (WMP 11) provides — `src/skins/<id>/index.ts` exporting a `Skin`, and one line in registry.ts:
- `id`, `name` — `settings.skin` holds the id; `skinFor()` falls back to wmp9.
- `Root: FC` — the whole player, rendered inside `<ShellContext>` (store, presets, portal, shortcuts, toggleFullscreen,
  nativeSize, debugText). Root must:
  - mark its wrapper `data-ui-root` (the base layer: box-sizing, control fonts, `[hidden]`, the focus ring) and carry
    the app states as data attributes on its window element — `data-bare` (isBare: full screen / screensaver),
    `data-spotify`, `data-nopl`, `data-notask` — which the theme's `bare:` / `spotify:` / `nopl:` / `notask:` variants read;
  - render `<Visualizer/>` while `useScreenShown()` (Now Playing, or anything full screen), `<ViewHost views={…}/>`
    for the Spotify views, `<DialogHost dialogs={…}/>` with a body for each of `options`, `about`, `keys`, `link`
    (store ui.dialog; the menus open them), and a `<MenuBar>` / `<Dropdown>`s fed by `menus.ts` (or its own data);
  - render views for `library`, `search` (inside `<SearchScope.Provider value={useSearchView().scope}>`), `guide`,
    `radio` in `<ViewHost>`, and the device disc (`useDevices` + `Dropdown`) in the transport;
  - in the Media Library, render `<DetailsPane>` beside the list (collapsible; the skin hides it under 900 px with the
    `lt-900` variant; `settings.detailsPane`, View > Details Pane) and switch `<ListTable>` / `<TileGrid>` on
    `useLibrary().view` (`settings.libraryView`: the header's two buttons, View > Library View, Ctrl+Shift+T). Tiles is a
    browse mode: no tree, `showTiles` = the covers (Liked Songs, Playlists, Albums; a click opens, a double-click plays
    whole), an opened collection is always the table under `crumb` ("‹ Playlists ›"; `ui.libNode` keeps the level).
    Tracks are never tiles anywhere (search songs and artist top tracks are rows);
  - put the repeat disc (`TransportButton action="repeat"`, `data-repeat`) in the transport and the lyrics toggle
    (`action="lyrics"`) with the visualizer controls, rendered on Now Playing only;
  - keep the ids the host and the smokes use: `#chrome`, `#titlebar` (the host squares their corners by id: the
    window element and the caption), and the smokes' control ids (`#bplay`, `#time`, `#seektrack`, `#vol`, …, as wmp9).
- `shortcuts?` — its accelerator table (`Shortcut[]`, src/ui/shortcuts.ts); omitted = WMP 9's. App dispatches it under
  the Spotify engine, and the Keyboard Shortcuts dialog lists it (`useShortcuts()`).
- Its tokens: colours/gradients it adds to `src/ui/theme.css` `@theme` under its own prefix (wmp9 uses `luna-*`, `xp-*`
  and role names), since Tailwind's theme is one per build.

## Shared UI layer (src/ui) — Tailwind, Radix, headless pieces
Headless = behaviour + markup hooks, unstyled: every piece takes `className`/`id` (and `classes`/`ids` for its parts)
and shows state as data attributes (`data-on`, `data-sel`, `data-now`, `data-top`, `data-off`, `data-disabled`, Radix's
`data-state` / `data-highlighted`) for the skin's `data-*:` variants.

Components (props beyond className/id):
- `MenuBar { menus: [name, label, () => MenuEntry[]][], classes: MenuClasses, listId?, listClassName?, triggerClassName?,
  burger?: {id?, className?} }` — Radix Menubar: click toggles, hover switches while one is open, arrows walk (Left/Right
  between menus, into/out of submenus), Escape closes; `burger` = the narrow-width ☰ list, menus then cascade right.
- `Dropdown { owner, items: () => MenuEntry[], classes, children: the trigger element }` — Radix DropdownMenu (the view
  pill, the picker). `MenuEntry = { label, accel?, check?, sub?, act? } | { sep: true }`; items are built as a menu
  opens. `MenuClasses = { content, item, check, label, accel, sep }`. Content carries `data-depth` (0 = top).
  Which menu is open is the store's `ui.menu` owner (`top:<name>`, `side:<name>`, `burger`, or a Dropdown's owner), so
  the page's Escape and every opener agree; `useMenus().close(owner)` ignores a late close from a menu switched away from.
- `DialogHost { dialogs: Record<name, FC> }` — the backdrop (`#modal` in wmp9) and whichever body `ui.dialog` names;
  `Dialog { title, label, buttons: [text, onClick, id?][], classes: {title, titleText, close, buttons, button}, style? }`
  — the frame: Radix Dialog (non-modal, see below), first control focused (ring only if opened from the keyboard),
  ✕ / Escape / backdrop close. `useCloseDialog()`.
- `Slider { value 0..1 | -1, inset, disabled?, onCommit(f), thumbClassName?, thumbId? }` — the shell's drag: press
  (left button) previews, drag follows (pointer captured), release commits, cancel drops; the thumb is placed by CSS
  from `--seek`. `SeekBar { track: Slider props, pillClassName?, rewind, forward }` — the extrapolated position on a
  Slider (release seeks: `seekTo(sh, f)`) and the ±10 s pills (Spotify). `VolumeSlider` — the native range (0..100
  Spotify volume / 0..200 capture sensitivity).
- `TransportButton { action: play|stop|prev|next|mute|shuffle|repeat|lyrics, className: string | (on) => string,
  children: node | (on) => node }` — what it does, its title, `data-on` (playing / muted / shuffling / lyrics on);
  shuffle and lyrics are spans (WMP's discs), shuffle is a toggle only under Spotify. `useTransportAction(action)`.
- `Clock` — elapsed / -remaining, a click flips it (with a session), the length as its title.
- `Karaoke { classes: {cur, next, sung, now}, ids? }` — the current line's words (`data-k` sung/now, the fill in `--f`),
  the next line, a fade per line.
- `ListTable { rows: Track[], columns? (TRACK_COLUMNS: Title|Artist|Album|Length m:ss), selected, now, onSelect,
  onActivate, more: {label, load} | null, resetKey?, tableClassName?, headClassName?, cellClassName?, rowClassName?,
  moreClassName?, lenClassName?, tableId?, bodyId? }` — click selects, double-click plays, Load more, scroll to top
  when resetKey changes. `Tree { nodes: TreeNode[], selected, onSelect, nodeClassName? }`.
- `TaskList { tasks: ({view, id, label, disabled?} | node)[], itemClassName? }` — view buttons, the current one data-on.
- `TileGrid { sections: {title?, items: TileItem[]}[], selected?, onClick, onDoubleClick?, onPlay?, current?, onEscape?,
  more?, classes }` — cover tiles (data-sel, a last Load more tile); a click opens (Enter at once), a collection tile's
  round corner ▶ (`classes.play`, Ctrl+Enter) plays in place, shown on hover / focus and always on the playing context's
  tile (`current` = `usePlayingContext()`: ❚❚, a click pauses); `Tiles { classes }` is the Media Guide's (a click opens a
  playlist / album in the library, an artist on its page; the corner plays). The library's tiles come from
  `useLibrary()` (`tiles`, `clickTile` selects, `playTile`, `openTile`; the Playlists / Albums headings are tiles).
- `DetailsPane { classes, placeholder? }` + `useDetails()` — the Media Library's info pane: CONTEXT mode (the tree's
  playlist / album / Liked Songs, or a picked collection tile: cover, name, owner or artists, followers, saved,
  description with a more/less clamp, tracks · h:mm once all are loaded, release / label / copyright, kind; Play all,
  Shuffle play, Copy link) and TRACK mode (the selected row: cover, title + EXPLICIT, artist and album links, length,
  plays, release, track/disc; Play, and Add to queue / Song radio only if the commands grow `addToQueue(uri)` /
  `playRadio(seedUri)`). "‹ back to …" and Esc in the list return to context mode; a missing field is a missing line.
- Search is its own view (task pane: Now Playing, Media Guide, Media Library, Search, Radio Tuner = Ctrl+1..5).
  `useSearchView()` gives the box (400 ms debounce, Enter at once via `useDebounced(...).now`, × clears; Ctrl+E opens
  the view and focuses the element the skin marks `data-search-box`) and a `SearchScope` the view provides: inside it
  `useLibrary()` / `useDetails()` / `useSearch()` show the results, or a result's artist / album / playlist page
  opened in place (‹ All results back; "Open in Media Library" sends it there via openArtist / openInLibrary). The
  results page: the top result card, then Songs / Artists / Albums / Playlists with counts (a table and name +
  subtitle rows, or tiles), "Show all N" for one type with Load more (`commands.searchMore(type)`). A track selects
  (the pane) / double-click plays. `library.search.note` goes to the status line (App). The library tree is
  Playlists, Albums, Liked Songs (+ the artist opened from Now Playing).
- Play on Device is the transport's device disc: `useDevices(icon)` → a `Dropdown`'s entries (icon by kind, the active
  one checked, offline disabled, "(this window)"; a choice calls `commands.transfer`), `elsewhere` lights the disc,
  `title` = "Play on Device: <active>". MenuItem has `icon?` and `disabled?` for it.
- Seeking by hand (`seekHold`, the scrub store `src/ui/scrub.ts`): holding the bar pauses at once if playing; the
  thumb and the clock follow the pointer with no seek; the release seeks and, once that settles, resumes, showing the
  scrubbed position until the next playback state (or 3 s); Escape cancels (no seek, resume); ←/→ on the focused bar
  skip ±5 s without pausing.
- `AddTo { uri, saved?, menu?, owner, classes, menuClasses }` + `useAddTo(uri)` / `useSaved(uris)` (src/ui/AddTo.tsx) —
  Spotify's Add to: a round +/✓ button toggles Liked Songs (`commands.addTo(uri, LIKED, on)`), its ▾ or a right-click
  opens Liked Songs + "Add to playlist ▸" (editable playlists, checked by `fetchMembership`, asked only when that
  submenu opens); saved flags are queries of 50 with `store.saved` / `store.membership` winning. In the details pane
  (track mode beside the title; context mode Save / Saved ✓), the Now Playing pane's playing row, the tables' first
  column (`ListTable lead`; hover / selected rows), and the Play menu (Ctrl+D, Add to Playlist).
- `Tiles { classes }` (Media Guide, see TileGrid), `StationList { classes }`,
  `DeviceList { classes: {…, icon: (kind) => string} }` (transfer; data-on active, data-off offline),
  `ViewHost { views: Partial<Record<View, FC>> }` (Spotify only, nothing while bare).

Hooks: `usePlayback()` (media, playing, capture, spotify, track, from, canSeek, shuffle, repeat, muted, volume, lyrics,
status) · `usePosition(fn(ms, state) → primitive)` (the store's position at `at`, run on while playing; re-renders only
on the frame the derived value changes — no interval, no per-tick setState) · `useLibrary()` (Media Library: tree, node,
name, count, tracks, more, open, selectRow, playRow, playAll, search) · `usePaneLibrary()` (Spotify's right pane groups)
· `usePresetList(ref)` · `useVisControl()` · `useNowPlaying()` · `useMenus()` · `useShortcuts()` · `useView()` ·
`useClockMode()` · `useLyrics()` / `useLyricScroll(ref, on)` · `useFullscreen()` · `useScreenShown()` ·
`useDebugText()` · `useCaption()` · `useWindowControls()` (caption drag / double-click, min / max / close, the grip) ·
`useDebounced(fn)`. The low-level ones stay in `shell.ts`: `useApp(selector)` (shallow), `useFrame`,
`useRaf`, `prevNext`, `cyclePreset`, `presetLabel`, `isPlaying`, `VIEW_LABELS`, `cx`.
Selectors skins repeated (`src/ui/selectors.ts`): isSpotify, isBare, duration, isContext, isAlbum, artOk,
seekFraction, clockText, deviceKind, deviceKindName, deviceName.

Portals: menus and dialogs render into `Shell.portal`, which App supplies — `document.body` standalone, the open shadow
root under Spotify — each portalled root marked `data-ui-root`.

Radix inside the Spotify shadow root: the document sees every event from inside retargeted to the host, and
`document.activeElement` is always the host. So the Dialog runs non-modal (Radix's focus trap and aria-hiding judge
focus by document.activeElement) with our own backdrop, auto-focus and Escape; menu content treats a press on any
opener (`data-menuzone`, read from `composedPath()`) as that opener's to handle rather than a press outside.

### Tailwind (src/ui/theme.css)
- Tailwind v4, `@tailwindcss/vite` in both page builds; only `src/skins` and `src/ui` are scanned. No preflight: the
  page globals stay in index.html, and under Spotify the sheet is adopted into a shadow root on Spotify's page; the base
  layer is the skin's few resets scoped to `[data-ui-root]`. spotify-smoke checks Spotify's page keeps its own styles.
- `--spacing: 1px` (p-7 = 7px): the skin is measured in pixels, and rem would follow Spotify's root font size.
- Tokens: the Luna palette by role (`--color-luna-*`, `--color-xp-*`, pane/transport roles; every solid colour the
  skin uses), the two- and three-stop gradients as `--background-image-*` (bg-<name>), `--font-xp` (Tahoma stack),
  `--font-mono`, sizes 10–20 px, radii xs/sm/md/lg/win (2/3/4/6/8 px), `--shadow-menu`, `--shadow-dialog`.
- Variants: `max-620` / `max-520` / `max-440` (inclusive `max-width`, as the skin always had), `bare` / `spotify` /
  `nopl` / `notask` (the data attributes on #chrome; declared after the widths so a state beats a width), and `hover`
  as plain `:hover` (Tailwind's default also requires `@media (hover: hover)`).
- Shadow root: Tailwind registers its per-element variables (`--tw-border-style`, `--tw-shadow`, …) with `@property`,
  which a shadow root ignores; theme.css declares their initial values for every element (Tailwind itself does so only
  for browsers without @property). spotify-smoke fails if the css registers one theme.css does not cover.
- Cascade: the CSS Module is unlayered, so it beats every utility — each kept rule sets only properties no utility sets
  on that element.

What stayed in `src/skins/wmp9/wmp9.module.css`, and why:
| rule | why not utilities |
|---|---|
| `:global(body.maximized) .corners` | host-facing: the host (WM_SIZE) and App toggle `body.maximized`; squares #chrome/#titlebar |
| `.titlebar` | 9-stop Luna caption gradient |
| `.wbtn`, `:hover`, `.x`, `.x:hover` | 5-stop caption-button gradients and their hover twins |
| `.topbar` | 16 pixel-positioned stops (the pinstripe, the seps at 15 and 29 px) |
| `.knob` | 4-stop radial + a 3-layer shadow (the task pane knob) |
| `.npband` | 9 pixel-positioned stops |
| `.npill`, `:hover, [data-state=open]` | 5-stop pill gradient and its lit twin |
| `.tasklist` | 5-stop horizontal gradient |
| `.seekrow` | 10 pixel-positioned stops |
| `.seekthumb` | two stacked gradients (the grey window in the green bar) |
| `.transport` | 22 pixel-positioned stops |
| `.disc`, `.disc.muted` | stacked radial highlight + 6-stop linear (the silver discs; peach while muted) |
| `.sbtn`, `.sbtn.lit` | 4-stop disc gradients |
| `.rbtn`, `:hover`, `.radioplay` | 4-stop radial gradients |
| `.vol` + `::-webkit-slider-runnable-track/-thumb`, `::-moz-range-track/-thumb` | a native range's vendor pseudo-elements |
The SVG-drawn chrome (swooshes, lozenge, icons) is inline SVG in the components, as before; no `:host` rules remain.

## Tests
- vitest: model (store/actions/selectors), adapters (spotify with the fixtures in tests/spotify-fixtures.json — reuse
  them; local with fake host frames), components (RTL: menus, transport, library table, views) — target the same
  behaviours tests/spotify.test.js and tests/battery.test.js etc. cover today; engine unit tests ported as-is.
- Playwright smokes (tests/shell-smoke.js, spotify-smoke.js) kept, pointed at dist/index.html and dist/spotify-inject.js.
- tests/skins/alignment.smoke.js: measured alignment rules over every view (standalone and in the Spotify shadow root,
  1x and 2x device pixels, 1200/620/520/440 px): edged boxes on whole device pixels, header rows on one centre line,
  table headers over their columns, even tiles, the transport discs, the details pane level with the list header,
  no near-black panel borders, no doubled borders, centred button labels.

## Ownership (parallel agents, disjoint paths)
A toolchain+engine: package.json, vite/ts/eslint config, src/engine/**, tools/* adapters, tests/engine/**
B model+adapters: src/model/**, src/adapters/**, tests/model/**, tests/adapters/**
C skin+app: src/skins/**, src/app/**, src/main.ts, tests/skins/**, tests/*-smoke.js
D host+CI: deno-webview/** (spotify.ts injection of the new bundle, deno.json tasks), deno/** (retire build.ts;
  both folders since removed with the Deno host, docs/history/deno-webview.md),
  .github/workflows/**, site/**, README/HANDOFF build sections
Lead: cut-over commit (delete old files), exactness re-run, live verification, PR.

## v7.1 — optimistic transport, TanStack Query for fetched data (decided 2026-09-25)
- Transport commands (play/pause/next/prev/seek/shuffle/repeat/transfer, and volume/mute already) update the store at
  once and mark `playback.pending`; the next player_state confirms, a rejection rolls back with a status-bar note, and a
  2 s silence just clears pending. Position extrapolation honours the optimistic paused flag.
- Fetched data — library collections, search pages, home, radio, artist, details — moves to @tanstack/react-query
  (infinite queries for paging, per-uri caching, background refresh, retry with the 429 gate). The adapters keep the
  framework-free query functions (pathfinder ops, hashes, 412 rescan, 429 wait); the hooks live in src/ui; zustand
  keeps auth, playback, queue, devices, lyrics, ui, settings, vis. Skins are unaffected (they read hooks). QueryClient
  is created in src/app and provided to the skin root; devtools in dev builds only.
- src/ui/data.ts (the hooks): `useLibraryList()`, `useCollection(uri)` (infinite over `fetchCollectionPage`: rows, meta,
  total, hasMore, loadMore = the Load more row/tile), `useCollectionFirstPages(uris)` (the Now Playing pane's opened
  playlists), `useSearchAll(q)` (the combined search, one query), `useSearch(q, type)` (a typed bucket, infinite: Show all
  starts it at once; Load more while the last page has a nextOffset; "N+" while not exact), `useHome()`,
  `useRadioSeeds()` + `useRadio(seeds)`, `useArtist(uri)`, `useAlbumMeta(uri)` (the details pane's track mode). The
  query functions and keys come from `Shell.queries` (the app passes `adapters.getQueries()`; src/ui imports only its
  type). Queries wait for the engine (Spotify: `auth.loggedIn`, as the adapter binds its functions at start).
- src/app/query.ts `createQueryClient`: staleTime 60 s (home, lists, search, artists 5 min per query), gcTime 1 h (a
  view switch never refetches), no refetch on window focus or reconnect, retry / retryDelay = the adapter's
  `retryPolicy` (the 429 gate). `window.Alchemy.query` = { client, keys } for diagnostics and the smokes' seeding.
- Tests: tests/skins/harness.tsx mounts the skin over fake query functions (plain data, vitest mocks) under a
  QueryClient; the smokes stub fetch as before (the alignment smoke seeds the cache under the real keys).
