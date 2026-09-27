// "Add to": Liked Songs and the user's playlists (Spotify). A round button toggles Liked Songs
// (+, ✓ once saved); its ▾ (or a right-click on the button) opens a menu: Liked Songs, then
// "Add to playlist ▸" with the playlists the user can edit, checked where the track is. The saved
// flags are queries batched 50 per list; membership is asked only when that submenu opens (it can
// cost playlist reads). The store's optimistic marks (saved, membership) win over what was fetched;
// the adapter rolls them back on a refusal and invalidates what changed.
import { useQueries, useQuery } from '@tanstack/react-query';
import { useState, type MouseEvent } from 'react';
import { LIKED, type AppState } from '../model';
import { useMenus } from './hooks';
import { Dropdown, type MenuClasses, type MenuEntry, type MenuItem } from './Menu';
import { useApp, useShell } from './shell';
import type { Shell } from './types';

const STALE = 5 * 60_000, BATCH = 50;
const spotifyReady = (s: AppState) => s.auth.engine === 'spotify' && s.auth.loggedIn === true;
/** Only Spotify tracks and collections can be saved (not local files, not the headings). */
export const canSave = (uri: string | null | undefined): uri is string => !!uri && /^spotify:(track|album|playlist|artist):/.test(uri);

/** Saved flags for these uris (queries of 50); `store.saved` (optimistic) wins. undefined = not known yet. */
export function useSaved(uris: readonly string[], enabled = true): (uri: string) => boolean | undefined {
  const q = useShell().queries, ready = useApp(spotifyReady), over = useApp((s) => s.saved);
  const list = uris.filter(canSave), chunks: string[][] = [];
  for (let i = 0; i < list.length; i += BATCH) chunks.push(list.slice(i, i + BATCH));
  const rs = useQueries({ queries: chunks.map((c) => ({
    queryKey: q.keys.saved(c), queryFn: () => q.fetchSaved(c), staleTime: STALE, enabled: ready && enabled })) });
  const data: Record<string, boolean> = {};
  for (const r of rs) Object.assign(data, r.data);
  return (u) => over[u] ?? data[u];
}

/** Outside a component (Ctrl+D, the Play menu): the saved flag the store or any cached batch knows. */
function knownSaved(sh: Shell, uri: string): boolean | undefined {
  const o = sh.store.getState().saved[uri];
  if (o !== undefined) return o;
  for (const [, d] of sh.client?.getQueriesData<Record<string, boolean>>({ queryKey: sh.queries.keys.saved([]) }) ?? [])
    if (d && uri in d) return d[uri];
  return undefined;
}

/** Save to / remove from Liked Songs (a track; a playlist, album or artist: save / follow). Asks
 *  first when nothing says whether it is saved. */
export async function toggleSaved(sh: Shell, uri: string): Promise<void> {
  let v = knownSaved(sh, uri);
  if (v === undefined && sh.client) {
    v = (await sh.client.fetchQuery({ queryKey: sh.queries.savedKey(uri), queryFn: () => sh.queries.fetchSaved([uri]), staleTime: STALE }))[uri];
  }
  await sh.store.getState().commands.addTo(uri, LIKED, !v);
}

/** The playing Spotify track's uri (what Ctrl+D and the Play menu act on), else null. */
export const playingTrack = (s: AppState): string | null => {
  const u = s.auth.engine === 'spotify' ? s.playback.track?.uri : null;
  return u?.startsWith('spotify:track:') ? u : null;
};

/** One uri's Add to: its saved flag, the Liked toggle, and the menu entries. `known`: the saved
 *  flag a list batched (null while the list is still asking); then this asks nothing for it. */
export function useAddTo(uri: string | null, known?: boolean | null) {
  const sh = useShell(), q = sh.queries, ready = useApp(spotifyReady);
  const own = useSaved(uri ? [uri] : [], known === undefined)(uri ?? '');
  const saved = known ?? own;
  // the playlists and the membership load once "Add to playlist" opens for this uri
  const [want, setWant] = useState<string | null>(null), on = !!uri && want === uri && ready;
  const pls = useQuery({ queryKey: [...q.keys.libraryList(), 'editable'], queryFn: () => q.fetchEditablePlaylists(), staleTime: STALE, enabled: on });
  const plUris = (pls.data ?? []).map((p) => p.uri);
  const mem = useQuery({ queryKey: [...q.membershipKey(uri ?? ''), ...plUris], queryFn: () => q.fetchMembership(uri!, plUris),
                         staleTime: 60_000, enabled: on && plUris.length > 0 });
  const over = useApp((s) => (uri ? Object.fromEntries(Object.entries(s.membership).map(([pl, m]) => [pl, m[uri]])) : {}));
  const c = () => sh.store.getState().commands;
  const toggle = () => { if (uri) void c().addTo(uri, LIKED, !saved); };
  // a playlist the answer left out is unknown: unchecked, still choosable — but not while the answer
  // is on its way (a click then would add a second copy to a playlist that already has the track)
  const inPl = (pl: string) => over[pl] ?? mem.data?.[pl];
  const playlists = (): MenuEntry[] => !pls.data ? [{ label: '…', disabled: true }]
    : !pls.data.length ? [{ label: 'No playlists to add to', disabled: true }]
    : [...(mem.isFetching ? [{ label: '…', disabled: true }] : []),
       ...pls.data.map((p) => ({ label: p.name, check: inPl(p.uri) === true, disabled: mem.isFetching && inPl(p.uri) === undefined,
                                 act: () => void c().addTo(uri!, p.uri, inPl(p.uri) !== true) }))];
  const playlistMenu = (label = 'Add to playlist'): MenuItem => ({ label, sub: playlists(), disabled: !uri, onOpen: () => setWant(uri) });
  return {
    uri, saved,
    toggle,
    playlistMenu,
    entries: (): MenuEntry[] => [{ label: 'Like', check: !!saved, act: toggle }, { sep: true }, playlistMenu()],
  };
}
export type AddToApi = ReturnType<typeof useAddTo>;

export interface AddToClasses {
  root?: string;
  /** the round button (on = saved) */
  button: string | ((on: boolean) => string);
  arrow?: string;
}

/** A heart: outlined, or filled while the track is liked (in Liked Songs). currentColor: the skin
 *  colours it. */
function Heart({ on }: { on: boolean }) {
  return (
    <svg className="block mx-auto" width="9" height="9" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 10.4C3.3 8.4 1.3 6.8 1.3 4.5 1.3 3 2.5 1.9 3.8 1.9c1 0 1.7.5 2.2 1.3.5-.8 1.2-1.3 2.2-1.3 1.3 0 2.5 1.1 2.5 2.6 0 2.3-2 3.9-4.7 5.9Z"
            fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
    </svg>
  );
}

/** The Add to control: the round heart button (a click likes / unlikes: Liked Songs) and, with `menu`, its ▾
 *  (a right-click on the button opens the same menu). Clicks stop here (a table row under it
 *  neither selects nor plays). `owner` names the menu (one per place). */
export function AddTo({ uri, saved, menu = true, owner, classes, menuClasses, id }: {
  uri: string;
  /** from a list's batch (null: it is still asking); omitted = ask for this uri alone */
  saved?: boolean | null; menu?: boolean; owner: string; classes: AddToClasses; menuClasses: MenuClasses; id?: string;
}) {
  const a = useAddTo(uri, saved), m = useMenus(), on = !!a.saved;
  const stop = (e: MouseEvent) => e.stopPropagation();
  return (
    <span className={classes.root} onClick={stop} onDoubleClick={stop} data-addto="">
      <button type="button" id={id} className={typeof classes.button === 'function' ? classes.button(on) : classes.button}
              data-on={on || undefined} aria-pressed={on} title={on ? 'Unlike' : 'Like'} aria-label={on ? 'Unlike' : 'Like'}
              onClick={a.toggle} onContextMenu={menu ? (e) => { e.preventDefault(); m.set(owner); } : undefined}><Heart on={on} /></button>
      {menu && (
        <Dropdown owner={owner} items={a.entries} classes={menuClasses}>
          <button type="button" className={classes.arrow} title="Add to" aria-label="Add to" data-menuzone="">▾</button>
        </Dropdown>
      )}
    </span>
  );
}
