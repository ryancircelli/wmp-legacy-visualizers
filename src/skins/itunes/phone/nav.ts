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
  /** Now Playing's toggle (a tap on the LCD): on, or back from it */
  toggleNow: () => (topPage(pages()) === 'now' ? nav.back() : nav.push('now')),
  back: () => {
    const s = pages();
    if (topPage(s) === 'source' && itunesView.getState().stack.length) viewActions.back();
    else if (s.length > 1) phoneNav.setState({ pages: s.slice(0, -1) });
  },
};
