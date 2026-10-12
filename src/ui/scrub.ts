// The seek bar's scrub: while the bar is held (and until playback confirms the seek) the clock and
// the thumb show this position instead of the extrapolated one. null = not scrubbing.
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

export const scrub = createStore<{ ms: number | null }>(() => ({ ms: null }));
export const useScrub = () => useStore(scrub, (s) => s.ms);
