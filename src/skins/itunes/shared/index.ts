// shared: ready
// The iTunes 10 skin's shared core: what the desktop (Windows) layout and the phone layout both build
// on. Data and actions come from src/ui (as every skin's); this adds iTunes' own model of them (the
// source list, what a source shows, the view state) and its look (the LCD, the transport, the tables,
// the grid, Cover Flow, the glyphs). The look is Tailwind utilities on the `itunes-*` tokens in
// src/ui/theme.css; every component takes a className. Reference: the scratch REFERENCE.md and
// docs/itunes-skin.md.
//
// View state (state.ts) — the skin's own, persisted in localStorage 'itunes.view' (zustand persist):
//   itunesView          the zustand store: { source, views, artwork, gridTab, total } persisted, plus the
//                       session's { stack, sidebarOpen, reveal }
//   useItunesView(sel)  a slice of it (re-renders on change)
//   viewActions         select(sourceId), setMode(mode, source?), open(uri) / back() (the stack of pages
//                       opened inside a source), toggleArtwork(), setGridTab('albums'|'artists'),
//                       setSidebarOpen(on), toggleTotal() (the LCD's right time), reveal(source, opened)
//                       (select a source with a page opened and bump `reveal`: "show the current song")
//   modeOf(state, source, fallback?)  the view a source shows in; VIEW_MODES, VIEW_NAMES, DEFAULT_VIEW
//   types ViewMode ('list' | 'album' | 'grid' | 'flow'), ItunesView
//
// The source list (sources.ts) — Spotify on iTunes' sidebar (LIBRARY Music / Podcasts / Radio; STORE
// Spotify / Search Results; DEVICES; GENIUS Genius / Genius Mixes; PLAYLISTS iTunes DJ / Recently Played
// / the library's playlists):
//   useSources()        { sections, find(id), loading } from the store and the library query
//   buildSources(input) the same, pure (tests); [] under the local engine (show the visualizer instead)
//   types Source ({ id, label, icon, kind, uri?, badge?, on? }), SourceSection, SourceKind, SourceInput
//
// What a source shows (content.ts):
//   useSourceContent(source, opened)  a Content: 'tracks' (rows, ctx, total, more(), queue?, browse? for
//                       Music's Grid), 'tiles' (TileGrid sections), 'artist' (top songs + albums),
//                       'stations', 'search' (render with src/ui useSearchResults inside SearchScope),
//                       'device', 'none'. `opened` = the top of the view state's stack (or the phone's own)
//   playRow(sh, content, track)  play a row in its context, from itself
//   playUri(sh, uri)    play a tile: a collection whole, an artist / show / station as a context, a track
//   showPlaying(sh)     "show the current song": select its source (and open its album/artist), bump reveal
//   startGenius(sh, trackUri?)  the song's radio (the playing song's without a uri)
//   queueOrder(n, {move: [from, to]} | {remove: i})  an Up Next order for commands.reorderQueue
//   albumsOf(tracks)    the songs grouped by album (AlbumGroup: name, artist, img, tracks, index, first)
//   statusLine(content), spanText(ms)  the status text ("12 songs, 47 minutes")
//   opensPage(uri)      a uri that opens a page (playlist, album, artist, show, Liked Songs)
//   types Content, TracksContent, TilesContent, ArtistContent, StationsContent, SearchContent,
//         DeviceContent, NoContent, AlbumGroup
//
// Components:
//   Lcd({ compact?, onGoto?, className })  the status display: idle glyph / status note / the song
//                       (title; artist and album taking turns; elapsed, the seek bar #seektrack with its
//                       diamond, the time left or the length). `compact`: two lines and the bar, no ➜
//   useLcd(), lcdSub(track, turn), lcdTimes(ms, length, total), LCD_TURN  its text, for a layout of its own
//   TransportCluster({ compact?, className })  Previous / Play-Pause / Next (#bprev #bplay #bnext)
//   Volume({ className, sliderClassName })   the speakers and the slider (#vol)
//   SourceList({ sections, selected, onSelect, className })  the sidebar list (↑ / ↓ walk it)
//   TrackTable(props)   the striped, sortable song table (TrackTableProps: rows, columns?, now, playing,
//                       onPlay, onSelect?, more?, resetKey?, queue? {move, remove}, onContextMenu?, reveal?,
//                       empty?, row? (px; 20 = Windows)); COLUMNS, listColumns(rows), sorted(); TrackColumn
//   AlbumList({ rows, now, playing, onPlay, more?, resetKey?, empty?, row? })  Album List view
//   AlbumGrid({ sections, onOpen, onPlay, more?, size? 'normal'|'small' })  Grid view (src/ui TileGrid)
//   CoverFlow({ covers, index, onIndex, onActivate, size?, top?, bar? })  Cover Flow (keys, wheel, drag,
//                       reflections; size / top: the front cover's, else from the stage's height; bar: its scrollbar);
//                       flowPlace(d, size); FlowCover
//   Icon({ name, size?, className, title? })  the monochrome glyphs; IconName
//   styles              the CSS module: .vol (a range input), .stripes (rows striped past the last,
//                       --row / --head), .reflect (Cover Flow's fading mirror)
export { DEFAULT_VIEW, itunesView, modeOf, useItunesView, VIEW_MODES, VIEW_NAMES, viewActions, type ItunesView, type ViewMode } from './state';
export { buildSources, useSources, type Source, type SourceInput, type SourceKind, type SourceSection } from './sources';
export {
  albumsOf, opensPage, playRow, playUri, queueOrder, showPlaying, spanText, startGenius, statusLine, useSourceContent,
  type AlbumGroup, type ArtistContent, type Content, type NoContent, type SearchContent, type StationsContent,
  type TilesContent, type TracksContent,
} from './content';
export { Lcd, LCD_TURN, lcdSub, lcdTimes, useLcd } from './Lcd';
export { TransportCluster, Volume } from './Transport';
export { SourceList } from './SourceList';
export { COLUMNS, listColumns, sorted, TrackTable, type TrackColumn, type TrackTableProps } from './TrackTable';
export { AlbumList } from './AlbumList';
export { AlbumGrid } from './AlbumGrid';
export { CoverFlow, flowPlace, type FlowCover } from './CoverFlow';
export { Icon, type IconName } from './icons';
export { default as styles } from './itunes.module.css';
