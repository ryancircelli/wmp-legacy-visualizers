// The Media Library's details pane (WMP 9's media info): what the selection is about. CONTEXT mode
// shows the tree's playlist / album / Liked Songs (or a collection tile picked in the tiles view);
// TRACK mode the selected row. Renders whatever metadata the store has: a missing field is a
// missing line, never a blank pane.
import { useState, type ReactNode } from 'react';
import { LIKED, mss, totalMs, type CollectionMeta, type Commands } from '../model';
import { canSave, useSaved } from './AddTo';
import { useAlbumMeta, useArtist, useCollection } from './data';
import { useLibrary } from './hooks';
import {
  count, detailsPaneOn, hmm, isAlbum, isContext, shareUrl, uiSettings, type TrackInfo,
} from './selectors';
import { useApp, useShell } from './shell';

/** Commands the pane uses only when the adapter has them (not in every model version). */
type Optional = Partial<{ addToQueue(uri: string): void; playRadio(seedUri: string): void }>;
/** openArtist with the artist to open (the model's takes it with the search work) */
type OpenArtist = { openArtist(uri?: string): Promise<void> };

export interface DetailsContext {
  uri: string;
  kind: CollectionMeta['kind'] | 'search' | 'list';
  name: string;
  image?: string;
  owner?: { name: string; uri?: string; avatar?: string };
  artists?: { name: string; uri: string }[];
  followers?: number;
  saved?: boolean;
  description?: string;
  releaseDate?: string;
  label?: string;
  copyright?: string;
  /** "Playlist", "Album · Single", ... */
  kindLine: string;
  /** the Playlists / Albums headings: "12 playlists" in place of the track count */
  headingCount?: string;
  total: number;
  /** the loaded tracks' length (ms) */
  ms: number;
  share: string;
  playable: boolean;
}

/** Which mode, what to show and what the buttons do. */
export function useDetails() {
  const sh = useShell(), get = () => sh.store.getState(), lib = useLibrary();
  const st = useApp((s) => ({ open: detailsPaneOn(s), shuffle: s.playback.shuffle }));
  const c = () => get().commands;
  const sel = lib.selected;
  const track = sel ? lib.tracks.find((t) => t.uri === sel) : undefined;
  // a collection tile selected in the tiles view, else the tree's node
  const cUri = sel && !track && isContext(sel) ? sel : lib.node ?? '';
  // the Playlists / Albums headings are lists of collections, not one
  const heading = !cUri || cUri === 'playlists' || cUri === 'albums' || cUri === 'search';
  // the node's data is useLibrary's (the same queries); a picked tile's comes from its own
  const tile = cUri !== lib.node, col = useCollection(heading ? null : cUri), artist = useArtist(heading ? null : cUri);
  const meta = artist.page?.meta ?? col.meta;
  const rows = artist.page?.tracks ?? col.rows;
  const item = lib.findItem(cUri);
  const albumMeta = useAlbumMeta(track?.albumUri);
  const kind: DetailsContext['kind'] = meta?.kind ?? (cUri === LIKED ? 'liked' : isAlbum(cUri) ? 'album'
    : cUri.startsWith('spotify:playlist:') ? 'playlist' : cUri === 'search' ? 'search' : 'list');
  const fmt = meta?.format ? meta.format.charAt(0) + meta.format.slice(1).toLowerCase() : '';
  const context: DetailsContext = {
    uri: cUri, kind,
    name: meta?.name ?? item?.name ?? (cUri === LIKED ? 'Liked Songs' : tile && !heading ? 'Loading…' : lib.name),
    headingCount: heading ? lib.count : undefined,
    image: meta?.image ?? item?.image,
    owner: meta?.owner ?? (item?.owner ? { name: item.owner } : undefined),
    // an album row names its artist before its details load
    artists: meta?.artists ?? (item?.artist ? [{ name: item.artist, uri: '' }] : undefined),
    followers: meta?.followers, saved: meta?.saved, description: meta?.description,
    releaseDate: meta?.releaseDate, label: meta?.label, copyright: meta?.copyright,
    kindLine: { playlist: 'Playlist', album: 'Album', liked: 'Liked Songs', artist: 'Artist', search: 'Search results', list: '' }[kind]
      + (fmt && (kind === 'album' ? fmt.toLowerCase() !== 'album' : true) ? ' · ' + fmt : ''),
    total: meta?.total ?? (col.total || item?.total || rows.length),
    // the length only once every track is loaded (a partial sum would read as the whole)
    ms: rows.length && rows.length >= (meta?.total ?? col.total) ? totalMs(rows) : 0,
    share: meta?.shareUrl ?? shareUrl(cUri),
    playable: isContext(cUri) || cUri === LIKED || kind === 'artist',
  };
  // a playlist / album / artist can be saved (followed): Save / Saved ✓
  const savable = canSave(cUri) && (kind === 'playlist' || kind === 'album' || kind === 'artist');
  const savedNow = useSaved(savable ? [cUri] : [])(cUri) ?? meta?.saved;
  const opt = c() as Commands & Optional;
  // an artist plays as a context (its top tracks); a playlist / album / Liked Songs from its first track
  const playWhole = () => (kind === 'artist' ? c().playContext(context.uri, null) : c().playAll(context.uri));
  return {
    open: st.open,
    toggle: () => get().actions.setSettings(uiSettings({ detailsPane: !st.open })),
    mode: track ? 'track' as const : 'context' as const,
    /** context mode: null = not savable (Liked Songs, the headings), else whether it is saved */
    saved: savable ? !!savedNow : null,
    save: () => { if (savable) void c().addTo(cUri, LIKED, !savedNow); },
    context, track: track ?? null, albumMeta,
    /** leave track mode (the "back to" link, Esc in the table) */
    back: () => get().actions.setUi({ libSel: null }),
    playAll: () => playWhole(),
    shufflePlay: () => { if (!get().playback.shuffle) c().toggleShuffle(); playWhole(); },
    copyLink: () => {
      const url = context.share, a = get().actions;
      if (!url) return;
      if (!navigator.clipboard) { a.setStatus('Could not copy the link'); return; }
      navigator.clipboard.writeText(url).then(() => a.setStatus('Link copied: ' + url), () => a.setStatus('Could not copy the link'));
    },
    play: (t: TrackInfo) => c().playContext(t.ctx ?? t.uri, t.uri),
    openAlbum: (t: TrackInfo) => { if (t.albumUri) c().openInLibrary(t.albumUri, t.album); },
    openArtist: (uri: string) => void (c() as unknown as OpenArtist).openArtist(uri),
    addToQueue: opt.addToQueue ? (t: TrackInfo) => opt.addToQueue!(t.uri) : null,
    radio: opt.playRadio ? (t: TrackInfo) => opt.playRadio!(t.uri) : null,
  };
}

export interface DetailsClasses {
  root?: string; grip?: string; body?: string;
  /** the open pane's column and its header band (what the pane shows: Playlist, Album, Track, ...) */
  column?: string; band?: string; art?: string; img?: string; avatar?: string; name?: string; line?: string;
  link?: string; badge?: string; desc?: string; more?: string; stats?: string; small?: string; buttons?: string;
  button?: string; back?: string;
  /** track mode: the title and the Add to control on one row */
  titleRow?: string;
}

/** Artists of a track row: each name with its uri when the row carries them one for one. */
function artistLinks(t: TrackInfo): { name: string; uri?: string }[] {
  const names = t.artist ? t.artist.split(', ') : [];
  return names.map((name, i) => ({ name, uri: t.artistUris?.length === names.length ? t.artistUris[i] : undefined }));
}

/** The pane: a ‹ › grip (collapse / expand) and, while open, the body for the mode. Shown state:
 *  data-open, data-mode. `placeholder` stands in for a missing cover. */
export function DetailsPane({ id, classes: k, placeholder, addTo }: {
  id?: string; classes: DetailsClasses; placeholder?: ReactNode;
  /** track mode: the skin's Add to control for the track, beside the title */
  addTo?: (uri: string) => ReactNode;
}) {
  const d = useDetails(), [more, setMore] = useState(false), x = d.context, t = d.track;
  const art = (src?: string) => <div className={k.art}>{src ? <img className={k.img} src={src} alt="" /> : placeholder}</div>;
  const line = (v: ReactNode, key?: string) => v || v === 0 ? <div className={k.line} key={key}>{v}</div> : null;
  const btn = (label: string, f: () => void, bid?: string) => <button type="button" className={k.button} id={bid} onClick={f}>{label}</button>;
  return (
    <aside className={k.root} id={id} data-open={d.open || undefined} data-mode={d.mode} aria-label="Details">
      <button type="button" className={k.grip} aria-expanded={d.open} title={d.open ? 'Hide the details pane' : 'Show the details pane'}
              onClick={d.toggle}>{d.open ? '›' : '‹'}</button>
      {d.open && <div className={k.column}>
      <div className={k.band} id={id && id + 'band'}>{t ? 'Track' : x.kindLine.split(' · ')[0] || 'Details'}</div>
      {t ? (
        <div className={k.body} data-mode="track">
          <button type="button" className={k.back} onClick={d.back}>‹ back to {x.name}</button>
          {art(t.image ?? t.art ?? undefined)}
          <div className={k.titleRow}>
            <div className={k.name}>{t.title}{t.explicit && <span className={k.badge} title="Explicit">EXPLICIT</span>}</div>
            {addTo?.(t.uri)}
          </div>
          {line(artistLinks(t).map((a, i) => (
            <span key={i}>{i ? ', ' : ''}{a.uri
              ? <button type="button" className={k.link} onClick={() => d.openArtist(a.uri!)}>{a.name}</button> : a.name}</span>
          )))}
          {line(t.album && (t.albumUri
            ? <button type="button" className={k.link} title="Show in Media Library" onClick={() => d.openAlbum(t)}>{t.album}</button> : t.album))}
          <div className={k.stats}>
            {line(t.duration ? 'Length ' + mss(t.duration) : '')}
            {line(t.playcount != null ? count(t.playcount) + ' plays' : '')}
            {line(t.releaseDate ?? d.albumMeta?.releaseDate ? 'Released ' + (t.releaseDate ?? d.albumMeta?.releaseDate) : '')}
            {line(d.albumMeta?.label)}
            {line(t.trackNumber ? 'Track ' + t.trackNumber + (t.discNumber && t.discNumber > 1 ? ', disc ' + t.discNumber : '') : '')}
          </div>
          <div className={k.buttons}>
            {btn('Play', () => d.play(t), 'dplay')}
            {d.addToQueue && btn('Add to queue', () => d.addToQueue!(t))}
            {d.radio && btn('Song radio', () => d.radio!(t))}
          </div>
        </div>
      ) : (
        <div className={k.body} data-mode="context">
          {art(x.image)}
          <div className={k.name}>{x.name}</div>
          {x.owner && line(<>{x.owner.avatar && <img className={k.avatar} src={x.owner.avatar} alt="" />}by {x.owner.name}</>)}
          {x.artists?.length ? line(x.artists.map((a) => a.name).join(', ')) : null}
          {x.followers != null && line('♥ ' + count(x.followers) + (x.followers === 1 ? ' follower' : ' followers'))}
          {x.description && (
            <>
              <div className={k.desc} data-clamped={!more || undefined}>{x.description}</div>
              {x.description.length > 180 && (
                <button type="button" className={k.more} onClick={() => setMore(!more)}>{more ? 'less' : 'more'}</button>
              )}
            </>
          )}
          <div className={k.stats}>
            {line(x.headingCount ?? (x.total === 1 ? '1 track' : x.total + ' tracks') + (x.ms ? ' · ' + hmm(x.ms) : ''))}
            {line(x.releaseDate ? 'Released ' + x.releaseDate : '')}
            {line(x.label)}
            {x.copyright && <div className={k.small}>{x.copyright}</div>}
            {line(x.kindLine)}
          </div>
          {(x.playable || x.share || d.saved !== null) && (
            <div className={k.buttons}>
              {x.playable && btn('Play all', d.playAll, 'dplayall')}
              {x.playable && btn('Shuffle play', d.shufflePlay, 'dshuffle')}
              {d.saved !== null && btn(d.saved ? 'Saved ✓' : 'Save', d.save, 'dsave')}
              {x.share && btn('Copy link', d.copyLink, 'dcopy')}
            </div>
          )}
        </div>
      )}
      </div>}
    </aside>
  );
}
