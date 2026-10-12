// window.alchemyOccluded (tauri/src/win.rs occluded): a covered window's frame loops stop
// asking for frames, and start again, once each, when it is seen.
import { renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useRaf } from '../../src/ui';

afterEach(() => { window.alchemyOccluded?.(false); vi.unstubAllGlobals(); });

it('useRaf stops while the window is covered and resumes once when it is seen', () => {
  let queue: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => queue.push(f));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const flush = () => { const q = queue; queue = []; for (const f of q) f(0); };
  const cb = vi.fn();
  const { unmount } = renderHook(() => useRaf(cb));

  flush(); flush();
  expect(cb).toHaveBeenCalledTimes(2);
  window.alchemyOccluded!(true);
  flush();                                  // the frame already asked for sees the cover and stops
  expect(queue).toHaveLength(0);
  expect(cb).toHaveBeenCalledTimes(2);
  window.alchemyOccluded!(false);
  window.alchemyOccluded!(false);           // told twice: still one loop
  expect(queue).toHaveLength(1);
  flush();
  expect(cb).toHaveBeenCalledTimes(3);
  unmount();
  window.alchemyOccluded!(true); window.alchemyOccluded!(false);
  expect(queue).toHaveLength(1);            // unmounted: nothing restarts it (the one left is cancelled)
});
