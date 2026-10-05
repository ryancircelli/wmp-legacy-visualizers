// Who plays (CONTRACT v10 §3): the host's own player when the host has one and its speaker is where
// commands go (connect.ts target: the active device, or none other is), else Spotify's cloud
// (connect-state). Picked per call; connect.ts's commands keep their optimistic patches above either.
import type { HostPlayer } from '../../host/globals';
import * as hostPlayer from '../../host/player';
import type { RepeatMode } from '../../../model';
import { target } from '../connect';
import { W, type Sp } from '../sp';
import { cloud } from './cloud';
import { host } from './host';

export type Move = 'play' | 'pause' | 'next' | 'prev' | 'seek';

/** A player backend. Each command answers whether the player took it (false: the optimistic change rolls back). */
export interface Player {
  /** seek: to ms */
  transport(cmd: Move, ms?: number): Promise<boolean>;
  /** a context, from one of its tracks or its start; shuffle: turned on with it (false: left as it is) */
  playContext(ctx: string, track: string | null, shuffle: boolean): Promise<boolean>;
  setShuffle(on: boolean): Promise<boolean>;
  setRepeat(m: RepeatMode): Promise<boolean>;
}

/** The host's player is in charge: the host takes commands and they go to its speaker. Its speaker not
 *  known yet (its first session still logging in: 28 s once, 2026-10-04), the host all the same unless
 *  another device plays: it keeps the command for its session, where through the cloud a play went to
 *  this page's own player, which nothing hears, until the speaker came up and took it 20 s later. */
export function hostInCharge(): boolean {
  if (!hostPlayer.available()) return false;
  const spk = hostPlayer.speaker(), w = W(), other = !!w.activeDeviceId && w.activeDeviceId !== w.deviceId;
  return spk ? target(w) === spk : !other;
}

export const player = (sp: Sp): Player => (hostInCharge() ? host(sp) : cloud(sp));

/** The host's report while it is in charge and its speaker the active device: the playback's own word
 *  (state.ts). null otherwise: the cluster's, as before. */
export function hostLive(): HostPlayer | null {
  const s = hostPlayer.state();
  return s?.active && hostInCharge() ? s : null;
}
