// The phone's pages, as an iPhone app of 2010 stacked them: the source list (iTunes' sidebar, full
// width), a source (what it shows, with what was opened inside it on the shared view state's stack),
// and over those Now Playing and Preferences. ‹ goes back a page, or out of what was opened in the
// source first. The session's only: the app opens on the selected source (iTunes opened on it too),
// its ‹ leading to the source list.
import { create } from 'zustand';
import { itunesView, viewActions } from '../shared';

export type Page = 'sources' | 'source' | 'now' | 'prefs';

export const phoneNav = create<{ pages: Page[] }>(() => ({ pages: ['sources', 'source'] }));

const pages = () => phoneNav.getState().pages;
export const topPage = (p: readonly Page[]): Page => p[p.length - 1] ?? 'sources';

export const nav = {
  /** a source picked (the source list, search, "show the current song"): its page over the list */
  source: (id?: string) => {
    if (id !== undefined) viewActions.select(id);
    phoneNav.setState({ pages: ['sources', 'source'] });
  },
  /** the source list alone (a search cleared on its results) */
  home: () => phoneNav.setState({ pages: ['sources'] }),
  /** Now Playing or Preferences on top (brought up if already under) */
  push: (p: 'now' | 'prefs') => {
    const s = pages();
    if (topPage(s) !== p) phoneNav.setState({ pages: [...s.filter((x) => x !== p), p] });
  },
  back: () => {
    const s = pages();
    if (topPage(s) === 'source' && itunesView.getState().stack.length) viewActions.back();
    else if (s.length > 1) phoneNav.setState({ pages: s.slice(0, -1) });
  },
};

/** Now Playing's two switches, kept across launches (localStorage 'itunes.phone.canvas' / '.vis'): the
 *  song's Spotify Canvas in the centre cover's place, and the visualizer in the stage's (iTunes' View >
 *  Show Visualizer). Both off at first: each costs the phone more than a picture. */
type NowView = { canvas: boolean; vis: boolean };
const KEY: Record<keyof NowView, string> = { canvas: 'itunes.phone.canvas', vis: 'itunes.phone.vis' };
const read = (k: keyof NowView) => { try { return localStorage.getItem(KEY[k]) === '1'; } catch { return false; } };
export const nowView = create<NowView>(() => ({ canvas: read('canvas'), vis: read('vis') }));
export const setNowView = (k: keyof NowView, on: boolean) => {
  nowView.setState({ [k]: on });
  try { localStorage.setItem(KEY[k], on ? '1' : '0'); } catch { /* blocked storage: the session's */ }
};
