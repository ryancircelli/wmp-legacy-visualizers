// Spotify's cloud: connect-state player commands to whichever device connect.ts target() names, each
// falling back to the host's mediaCmd (SMTC) where it has one (connect.ts command).
import type { Player } from '.';
import { command, type Cmd } from '../connect';
import type { Sp } from '../sp';

export const cloud = (sp: Sp): Player => ({
  transport: (cmd, ms = 0) => command(sp, cmd === 'play' ? { endpoint: 'resume' } : cmd === 'pause' ? { endpoint: 'pause' }
    : cmd === 'next' ? { endpoint: 'skip_next' } : cmd === 'prev' ? { endpoint: 'skip_prev' }
    : { endpoint: 'seek_to', value: ms }, () => sp.fallback(cmd, cmd === 'seek' ? ms : undefined)),

  playContext(ctx, track, shuffle) {
    const c: Cmd = { endpoint: 'play', context: { uri: ctx, url: 'context://' + ctx },
                     play_origin: { feature_identifier: 'playlist', feature_version: 'xpui' } };
    // options always present, even empty: librespot's play command requires the field (an absent
    // one is "unknown endpoint" → 400), so a shelf play with no starting track died on the speaker.
    const o: Record<string, unknown> = {};
    if (track) o.skip_to = { track_uri: track };
    if (shuffle) o.player_options_override = { shuffling_context: true };
    c.options = o;
    return command(sp, c, null);
  },

  setShuffle: (on) => command(sp, { endpoint: 'set_shuffling_context', value: on }),

  // The three-way shuffle as the web player sends it for each of its settings (captured 2026-10-05, its
  // shuffle menu's Smart Shuffle): set_options with the mode beside shuffling_context.
  setShuffleMode: (m) => command(sp, { endpoint: 'set_options', shuffling_context: m !== 'off',
                                       modes: { context_enhancement: m === 'smart' ? 'RECOMMENDATION' : 'NONE' } }),

  // One set_options (what the web player's own client has), not two set_repeating_* commands: those
  // race and one is lost (measured live: Off -> Track left context off, Track -> Off left track on).
  setRepeat: (m) => command(sp, { endpoint: 'set_options', repeating_context: m !== 'off', repeating_track: m === 'track' }),
});
