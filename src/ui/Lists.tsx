// Lists every skin shows, as behaviour plus markup hooks: the task list, the Media Library tree and
// details table, the Media Guide tiles, the radio stations, the Connect devices and the view host.
// State shows as data attributes (data-on, data-sel, data-now, data-top, data-off) for the skin's
// data-*: variants; class names come in as props.
import { useLayoutEffect, useRef, type ComponentType, type ReactNode } from 'react';
import { LIKED, mss, type Device, type HomeItem, type HomeSection, type Station, type Track, type View } from '../model';
import type { TreeNode } from './hooks';
import type { MenuEntry } from './Menu';
import { deviceKind, deviceName, isBare, isContext, isSpotify, type DeviceKind } from './selectors';
import { useWarm } from './data';
import { useApp, useShell } from './shell';

const on = (b: boolean | undefined) => b || undefined;

export interface Task { view: View; id: string; label: string; disabled?: boolean }

/** The task pane's view buttons: the current one lit (data-on), a click switches the view. */
export function TaskList({ tasks, className, id, itemClassName, children }: {
  tasks: (Task | ReactNode)[]; className?: string; id?: string; itemClassName?: string; children?: ReactNode;
}) {
  const sh = useShell(), view = useApp((s) => s.ui.view);
  return (
    <div className={className} id={id}>
      {tasks.map((t) => (t && typeof t === 'object' && 'view' in t ? (
        <button key={t.id} className={itemClassName} id={t.id} disabled={t.disabled} data-on={on(view === t.view)}
                onClick={() => sh.store.getState().actions.setView(t.view)}>{t.label}</button>
      ) : t))}
      {children}
    </div>
  );
}

/** A flat tree: headings (data-top) and the nodes under them; the selected one lit (data-on). */
export function Tree({ nodes, selected, onSelect, className, id, nodeClassName }: {
  nodes: TreeNode[]; selected: string | null; onSelect: (target: string) => void;
  className?: string; id?: string; nodeClassName?: string;
}) {
  const warm = useWarm(); // a resting pointer loads the playlist before the click
  return (
    <div className={className} id={id}>
      {nodes.map((n) => (
        <button key={n.key} type="button" title={n.label} className={nodeClassName} data-top={on(n.top)}
                data-on={on(!!n.target && n.target === selected)} onClick={n.target ? () => onSelect(n.target!) : undefined} onPointerEnter={() => warm(n.target)}>{n.label}</button>
      ))}
    </div>
  );
}

export interface Column { header: string; cell: (t: Track) => string; className?: string; titled?: boolean }

/** WMP's details list: Title | Artist | Album | Length by default. A click selects (data-sel), a
 *  double-click plays, the playing track is data-now, and a last "Load more" row pages. Scrolls
 *  back to the top when `resetKey` changes. */
export const TRACK_COLUMNS: Column[] = [
  { header: 'Title', cell: (t) => t.title, titled: true },
  { header: 'Artist', cell: (t) => t.artist, titled: true },
  { header: 'Album', cell: (t) => t.album ?? '', titled: true },
  { header: 'Length', cell: (t) => (t.duration ? mss(t.duration) : '') },
];

export function ListTable({ rows, columns = TRACK_COLUMNS, selected, now, onSelect, onActivate, onEscape, more, resetKey,
                            className, id, tableClassName, tableId, bodyId, headClassName, cellClassName, rowClassName, moreClassName,
                            lenClassName, lead }: {
  rows: Track[]; columns?: Column[]; selected: string | null; now: string | null;
  onSelect: (t: Track) => void; onActivate: (t: Track) => void;
  /** Esc with focus in the list (a click on a row focuses it) */
  onEscape?: () => void;
  more: { label: string; load: () => void } | null; resetKey?: unknown;
  className?: string; id?: string; tableClassName?: string; tableId?: string; bodyId?: string;
  headClassName?: string; cellClassName?: string; rowClassName?: string; moreClassName?: string;
  /** the class a column's className falls back to for the last (Length) column */
  lenClassName?: string;
  /** a first, unlabelled column of controls (the Add to button): its cell for a row */
  lead?: { className?: string; cell: (t: Track, selected: boolean) => ReactNode };
}) {
  const scroll = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (scroll.current) scroll.current.scrollTop = 0; }, [resetKey]);
  const colCls = (base: string | undefined, c: Column, i: number) =>
    [base, c.className ?? (i === columns.length - 1 ? lenClassName : undefined)].filter(Boolean).join(' ') || undefined;
  return (
    <div className={className} id={id} ref={scroll} tabIndex={-1}
         onKeyDown={onEscape && ((e) => { if (e.key === 'Escape' && selected) { e.stopPropagation(); onEscape(); } })}>
      <table className={tableClassName} id={tableId}>
        <thead><tr>
          {lead && <th className={[headClassName, lead.className].filter(Boolean).join(' ')} aria-label="Add to" />}
          {columns.map((c, i) => <th key={c.header} className={colCls(headClassName, c, i)}>{c.header}</th>)}
        </tr></thead>
        <tbody id={bodyId}>
          {rows.map((t, j) => (
            // index in the key: a playlist can hold the same track twice (same uri)
            <tr key={j + ':' + t.uri} className={rowClassName} data-now={on(t.uri === now)} data-sel={on(t.uri === selected)}
                onClick={() => onSelect(t)} onDoubleClick={() => onActivate(t)}>
              {lead && <td className={[cellClassName, lead.className].filter(Boolean).join(' ')}>{lead.cell(t, t.uri === selected)}</td>}
              {columns.map((c, i) => {
                const v = c.cell(t);
                return <td key={c.header} className={colCls(cellClassName, c, i)} title={c.titled ? v : undefined}>{v}</td>;
              })}
            </tr>
          ))}
          {more && <tr className={moreClassName} onClick={more.load}><td className={cellClassName} colSpan={columns.length + (lead ? 1 : 0)}>{more.label}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export interface TileItem { key: string; uri: string; name: string; sub: string; img: string | null; openable?: boolean }
export interface TileSection { title?: string; items: TileItem[] }
export interface TileClasses {
  section?: string; heading?: string; row?: string; tile?: string; img?: string; name?: string; sub?: string; play?: string; more?: string;
}

/** Cover tiles in sections (the Media Guide, the Media Library's covers, search results). A click
 *  is `onClick` (a keyboard click says so: Enter); a collection tile (openable) carries a corner
 *  play button (`onPlay`, also Ctrl+Enter), shown on hover / focus and always on the tile whose
 *  context is `current` — as ❚❚ while it plays (a click pauses). The selected tile is data-sel;
 *  `more` is a last "Load more" tile; a tile without an image gets the skin's `cover` or an empty box. */
export function TileGrid({ sections, selected, onClick, onDoubleClick, onPlay, current, onEscape, more, classes, id, className, cover }: {
  sections: TileSection[]; selected?: string | null;
  /** `keyboard`: Enter / Space (a click with no pointer) */
  onClick: (it: TileItem, keyboard: boolean) => void; onDoubleClick?: (it: TileItem) => void;
  /** play the tile's collection where it stands */
  onPlay?: (it: TileItem) => void;
  /** the playing context: its tile's corner stays shown (❚❚ while it plays; a click toggles) */
  current?: { uri: string | null; playing: boolean; toggle: () => void };
  onEscape?: () => void; more?: { label: string; load: () => void } | null;
  classes: TileClasses; id?: string; className?: string;
  cover?: (it: TileItem) => ReactNode;
}) {
  const isCurrent = (it: TileItem) => !!current?.uri && current.uri === it.uri;
  const warm = useWarm();
  const play = (it: TileItem) => { if (isCurrent(it)) current!.toggle(); else onPlay?.(it); };
  return (
    <div id={id} className={className} tabIndex={onEscape ? -1 : undefined}
         onKeyDown={onEscape && ((e) => { if (e.key === 'Escape' && selected) { e.stopPropagation(); onEscape(); } })}>
      {sections.map((sec, i) => (
        <div key={i} className={classes.section}>
          {sec.title && <div className={classes.heading}>{sec.title}</div>}
          <div className={classes.row}>
            {sec.items.map((it) => {
              const cur = isCurrent(it), playing = cur && current!.playing;
              return (
                <button key={it.key} type="button" className={classes.tile} title={it.name + (it.sub ? '\n' + it.sub : '')}
                        data-sel={on(!!selected && selected === it.uri)} data-uri={it.uri} data-current={on(cur)}
                        onClick={(e) => onClick(it, e.detail === 0)} onDoubleClick={onDoubleClick && (() => onDoubleClick(it))}
                        onPointerEnter={() => warm(it.uri)}
                        onKeyDown={onPlay && it.openable ? (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); play(it); } } : undefined}>
                  {it.img ? <img className={classes.img} src={it.img} alt="" loading="lazy" /> : cover?.(it) ?? <span className={classes.img} />}
                  <span className={classes.name}>{it.name}</span>
                  <span className={classes.sub}>{it.sub}</span>
                  {onPlay && it.openable && (
                    <span className={classes.play} role="button" aria-label={playing ? 'Pause' : 'Play ' + it.name} title={playing ? 'Pause' : 'Play'}
                          data-current={on(cur)} data-playing={on(playing)}
                          onClick={(e) => { e.stopPropagation(); play(it); }} onDoubleClick={(e) => e.stopPropagation()}>{playing ? '❚❚' : '▶'}</span>
                  )}
                </button>
              );
            })}
            {more && i === sections.length - 1 && (
              <button type="button" className={classes.more} onClick={more.load}>{more.label}</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The playing context as TileGrid's `current` (its tile keeps its corner, ❚❚ while playing). */
export function usePlayingContext() {
  const sh = useShell();
  const { uri, playing } = useApp((s) => ({ uri: s.playback.context?.uri ?? null, playing: s.playback.status === 'playing' }));
  return { uri, playing, toggle: () => void sh.store.getState().commands.playPause() };
}

/** a Guide tile with a page to open (and so a corner ▶): a playlist, album, Liked Songs or artist */
const opens = (uri: string) => isContext(uri) || uri === LIKED || uri.startsWith('spotify:artist:');

/** Media Guide: the home feed's sections of tiles (useHome). A click opens (a playlist / album in
 *  the Media Library, an artist on its page; a track plays); the corner ▶ plays without leaving. */
export function Tiles({ sections, classes }: { sections: HomeSection[] | null; classes: TileClasses }) {
  const sh = useShell(), c = () => sh.store.getState().commands, current = usePlayingContext();
  const byKey = new Map<string, HomeItem>();
  const secs = (sections ?? []).map((sec, i) => ({ title: sec.title, items: sec.items.map((it, j) => {
    byKey.set(i + ':' + j, it);
    return { key: i + ':' + j, uri: it.uri, name: it.name, sub: it.sub || '', img: it.img, openable: opens(it.uri) };
  }) }));
  const open = (t: TileItem) => {
    if (t.uri.startsWith('spotify:artist:')) c().openArtist(t.uri);
    else if (opens(t.uri)) c().openInLibrary(t.uri, t.name);
    else c().playItem(byKey.get(t.key)!);
  };
  return <TileGrid sections={secs} classes={classes} onClick={open} onPlay={(t) => c().playItem(byKey.get(t.key)!)} current={current} />;
}

/** Radio Tuner: the stations seeded from what plays; ▶ or a double-click plays one. */
export function StationList({ stations, classes }: {
  /** useRadio's stations (null = still tuning) */
  stations: Station[] | null;
  classes: { row?: string; play?: string; text?: string; name?: string; sub?: string; empty?: string };
}) {
  const sh = useShell(), c = () => sh.store.getState().commands;
  return (
    <>
      {(stations ?? []).map((st) => {
        const play = () => c().playContext(st.uri, null);
        return (
          <div key={st.uri} className={classes.row} onDoubleClick={play}>
            <button type="button" className={classes.play} title={'Play ' + st.name} onClick={play}>▶</button>
            <span className={classes.text}><span className={classes.name}>{st.name}</span><span className={classes.sub}>{st.sub || ''}</span></span>
          </div>
        );
      })}
      {stations && !stations.length && <div className={classes.empty}>No stations yet: play something first.</div>}
    </>
  );
}

/** How this app's own Connect device is named everywhere. */
export const OWN_DEVICE = 'WMP Spotify (This Device)';

/** Play on Device (the transport's device button): Spotify Connect devices as menu entries: the
 *  active one checked, offline ones disabled, ours "WMP Spotify (This Device)"; choosing one moves playback
 *  there. `icon(kind)` is the skin's class for a device kind. */
export function useDevices(icon: (k: DeviceKind) => string) {
  const sh = useShell(), { list: all, self } = useApp((s) => s.devices);
  // On a phone with its own speaker (CONTRACT: __wmpSpeaker) this page's player is hidden from every
  // picker and heard by nothing: it is not offered here either.
  const list = window.__wmpSpeaker?.id ? all.filter((d) => d.id !== self) : all;
  const active = list.find((d) => d.active);
  // our own device goes by the app's name, never its registered one ("Web Player (Microsoft Edge)")
  const name = (d: Device) => (d.id === self ? OWN_DEVICE : deviceName(d));
  const items = (): MenuEntry[] => list.length ? list.map((d) => ({
    label: name(d) + (d.offline ? ' · offline' : ''),
    radio: true, check: !!d.active, disabled: !!d.offline, icon: icon(deviceKind(d)),
    act: d.active || d.offline ? undefined : () => void sh.store.getState().commands.transfer(d.id),
  })) : [{ label: 'No Spotify Connect devices seen yet', disabled: true }];
  return {
    items,
    /** playing on a device other than this window */
    elsewhere: !!active && active.id !== self,
    title: 'Play on Device' + (active ? ': ' + name(active) : ''),
    kind: active ? deviceKind(active) : null,
  };
}

/** The view in the screen's place (Spotify only; the store holds the engine off Now Playing).
 *  Full screen is always the visualizer, so nothing shows while bare. */
export function ViewHost({ views }: { views: Partial<Record<View, ComponentType>> }) {
  const V = useApp((s) => (isSpotify(s) && !isBare(s) ? s.ui.view : null));
  const C = V ? views[V] : undefined;
  return C ? <C /> : null;
}

/** True while the visualizer's screen shows: Now Playing, or anything full screen. */
export const useScreenShown = () => useApp((s) => s.ui.view === 'now' || isBare(s));
