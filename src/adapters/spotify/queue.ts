// Editing Up Next: Connect's set_queue, the command the web player sends to reorder or remove what plays
// next. It carries the whole next_tracks as they should be, each track as the cluster gave it (uid,
// metadata, provider), with the cluster's prev_tracks and queue_revision. Those are exactly the fields
// librespot, the app's own speaker, requires (librespot-core 0.8.0 dealer/protocol/request.rs
// SetQueueCommand: next_tracks, prev_tracks, queue_revision, logging_params; librespot-connect
// state/handle.rs handle_set_queue replaces both lists wholesale), so queued and context rows alike can
// be moved or removed there. Spotify's own players honouring the same for context rows is unconfirmed:
// the host's log says, three seconds after each edit, whether the next state showed it.
import { command } from './connect';
import { onState } from './state';
import type { ProvidedTrack, Sp } from './sp';

type Raw = ProvidedTrack | null;

/** next_tracks for a new Up Next: `order` is queue.next's rows (by index) in their new order, a row left
 *  out removed; `at` each row's place in `raw`. The entries the store does not show (not named yet, past
 *  its first 30, the delimiter) keep their places; the shown ones fill the shown places in the new order.
 *  A row put above a queued one joins the queue (provider 'queue', is_queued), as a drag into Spotify's
 *  "Next in queue" does: queued tracks always lead. */
export function nextTracks(raw: readonly Raw[], at: readonly number[], order: readonly number[]): Raw[] {
  const slot = new Map(at.map((j, k) => [j, k] as const)), out: Raw[] = [];
  raw.forEach((t, j) => {
    const k = slot.get(j);
    const moved = k === undefined ? t : k < order.length ? raw[at[order[k]!] ?? -1] : null;
    if (moved) out.push(moved);
  });
  const last = out.findLastIndex((t) => t?.provider === 'queue');
  return out.map((t, j) => (t && j < last && t.provider !== 'queue' && /^spotify:(track|episode):/.test(t.uri ?? '')
    ? { ...t, provider: 'queue', metadata: { ...t.metadata, is_queued: 'true' } } : t));
}

/** The edit, optimistic: the store's queue from the new list at once (the last state re-read with it),
 *  the old one back if the player refuses and no newer state has come meanwhile. */
export async function reorderQueue(sp: Sp, order: readonly number[]): Promise<void> {
  const before = sp.last;
  if (!before) return;
  const next = nextTracks(before.next_tracks ?? [], sp.queueAt ?? [], order), after = { ...before, next_tracks: next };
  onState(sp, after, true);
  const ok = await command(sp, { endpoint: 'set_queue', next_tracks: next, prev_tracks: before.prev_tracks ?? [],
                                 queue_revision: before.queue_revision ?? '', logging_params: {} }, null);
  if (!ok) { if (sp.last === after) onState(sp, before, true); return; }
  const uris = (l: readonly Raw[] | undefined) => (l ?? []).map((t) => t?.uri).filter((u) => u && !u.includes('delimiter')).slice(0, 5).join(' ');
  window.setTimeout(() => {
    if (sp.last === after) return;   // no state since: nothing to tell
    const got = uris(sp.last?.next_tracks);
    window.alchemyLog?.('spotify: set_queue ' + (got === uris(next) ? 'applied' : 'not shown by the next state (its first: ' + got + ')'));
  }, 3000);
}
