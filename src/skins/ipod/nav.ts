// The screen stack (screens/contract.ts Nav). Keys are unique within the stack: pushing a key that
// is already there takes the old one out, so Now Playing reached twice is one entry, and MENU goes
// back the way the user came. Each push gets a fresh slot id (the frame's React key), so a
// replaced screen mounts anew. `dir` is the slide's direction: 1 pushed, -1 popped, 0 none yet.
// toNowPlaying is the one move that keeps a slot: Now Playing already in the stack comes to the top
// as it was. Its factory is handed in (Root passes the nowplaying group's), so this file stays plain.
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Nav, ScreenEntry } from './screens/contract';

export interface Slot { id: number; entry: ScreenEntry }
export interface NavState { stack: Slot[]; dir: -1 | 0 | 1 }
export interface NavStore extends Nav { store: StoreApi<NavState> }

export function createNav(root: ScreenEntry, nowPlaying: () => ScreenEntry): NavStore {
  let n = 0;
  const store = createStore<NavState>()(() => ({ stack: [{ id: n++, entry: root }], dir: 0 }));
  const stack = () => store.getState().stack;
  const put = (base: Slot[], e: ScreenEntry, dir: 1 | -1) =>
    store.setState({ stack: [...base.filter((x) => x.entry.key !== e.key), { id: n++, entry: e }], dir });
  return {
    store,
    push: (e) => put(stack(), e, 1),
    replace: (e) => put(stack().slice(0, -1), e, 1),
    pop: () => { if (stack().length > 1) store.setState({ stack: stack().slice(0, -1), dir: -1 }); },
    home: () => { if (stack().length > 1) store.setState({ stack: stack().slice(0, 1), dir: -1 }); },
    toNowPlaying: () => {
      const s = stack(), e = nowPlaying(), was = s.find((x) => x.entry.key === e.key);
      if (was && was === s[s.length - 1]) return;
      store.setState({ stack: [...s.filter((x) => x !== was), was ?? { id: n++, entry: e }], dir: 1 });
    },
    get depth() { return stack().length; },
  };
}

/** The top slot. */
export const top = (s: NavState): Slot => s.stack[s.stack.length - 1]!;
