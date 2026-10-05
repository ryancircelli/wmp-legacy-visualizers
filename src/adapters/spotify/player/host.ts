// The host's own player (host/player.ts, CONTRACT v10): fire and forget; its next report is the answer
// (state.ts). No connect-state round trip, so none of its workarounds (connect.ts command) apply here.
import type { Player } from '.';
import * as hostPlayer from '../../host/player';
import type { Sp } from '../sp';
import { trustHost } from '../state';

/** A player ignores every command but a transfer while its speaker is not the active device. `play`
 *  and `load` take the playback themselves; anything else is sent after `take`, once the host reports
 *  its speaker active (5 s at most, as long as connect.ts waits for an answer; false then). One take
 *  serves every command waiting on it. A host that sends no reports is not waited on. */
let taking: Promise<boolean> | null = null;
function active(): Promise<boolean> {
  if (hostPlayer.state()?.active !== false) return Promise.resolve(true);
  return (taking ??= new Promise<boolean>((resolve) => {
    const done = (ok: boolean) => { window.clearTimeout(timer); off(); taking = null; resolve(ok); };
    const off = hostPlayer.subscribe(() => { if (hostPlayer.state()?.active) done(true); });
    const timer = window.setTimeout(() => done(false), 5000);
    hostPlayer.send('take');
  }));
}

/** trust: a toggle or a play, after which the host's report of shuffle and repeat is right (state.ts trustHost) */
const send = (cmd: string, trust?: Sp): Promise<boolean> => {
  if (trust) trustHost(trust);
  hostPlayer.send(cmd);
  return Promise.resolve(true);
};
const after = (cmd: string, trust?: Sp): Promise<boolean> => active().then((ok) => ok && send(cmd, trust));

export const host = (sp: Sp): Player => ({
  transport: (cmd, ms = 0) => (cmd === 'play' ? send('play') : after(cmd === 'seek' ? 'seek:' + ms : cmd)),
  // shuffle false is "leave it as it is" (null), as the cloud's play sends no override then
  playContext: (context, track, shuffle) => send('load:' + JSON.stringify({ context, track, shuffle: shuffle || null, position: 0 }), sp),
  setShuffle: (on) => after('shuffle:' + (on ? 1 : 0), sp),
  // no Smart Shuffle in CONTRACT v10's commands (librespot has none): refused, never sent as a plain shuffle
  setShuffleMode: (m) => (m === 'smart' ? Promise.resolve(false) : after('shuffle:' + (m === 'shuffle' ? 1 : 0), sp)),
  setRepeat: (m) => after('repeat:' + m, sp),
});
