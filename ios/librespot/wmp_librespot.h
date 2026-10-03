// The app's Spotify Connect receiver (ios/librespot, ios/README.md "Librespot"); build.sh copies this
// next to libwmp_librespot.a in out/.
#pragma once
#include <stddef.h>
#include <stdint.h>

// Interleaved stereo float32 frames at 44100 Hz, on librespot's player thread (with a crossfade set, on
// the sink's own pump thread instead: one thread at a time either way). It may block: that is the
// back-pressure that paces playback. frames 0 (samples NULL): the sink stopped (a pause, a stop; with a
// crossfade, after what was already handed over, and at the end of the context after what was queued).
typedef void (*wmp_ls_pcm_cb)(void *ctx, const float *samples, size_t frames);
// A UTF-8 log line, "librespot: ...", from any thread.
typedef void (*wmp_ls_log_cb)(void *ctx, const char *line);
// The session's state, from librespot's thread: its Connect device id (40 hex, UTF-8) when a session
// comes up, NULL when it ends.
typedef void (*wmp_ls_state_cb)(void *ctx, const char *device_id);
// What plays, from librespot's thread, on each track change, play, pause, seek, end of track and stop:
// one whole JSON object (UTF-8), {"playing":bool,"position":ms,"title":"","artist":"" (", "-joined),
// "album":"","art":"" (the largest cover's url, or ""),"duration":ms,"uri":"spotify:track:..."}. A stop
// sends playing false, position 0 and the track fields empty. Positions here and in the player callback
// are what is heard (with a crossfade, the player's less what the sink has queued ahead).
typedef void (*wmp_ls_np_cb)(void *ctx, const char *json);
// The host's player (the page's window.__wmpPlayer, as it is: the host only forwards it), from
// librespot's thread, at each track change, play, pause, seek, position correction, stop, shuffle or
// repeat change, activation and deactivation, and session end: one whole JSON object (UTF-8),
// {"v":1,"active":bool (the active Connect device),"playing":bool,"uri":"" ("" nothing loaded),"title",
// "artist","album","art" (as np has them),"duration":ms,"position":ms (true at "at"),"at":epoch ms,
// "shuffle":bool,"repeat":"off"|"context"|"track"}. A session end sends active and playing false.
typedef void (*wmp_ls_player_cb)(void *ctx, const char *json);

// Starts the receiver on a thread of its own: a Speaker called `name`, its Connect device id the hash
// of `id` (NULL or "": of the name; stable per install, so a rename keeps the device), the credentials
// cached in `cache_dir`. 0 started, -1 already running or bad input.
int32_t wmp_ls_start(const char *name, const char *id, const char *cache_dir, wmp_ls_pcm_cb pcm, wmp_ls_log_cb log,
                     wmp_ls_state_cb state, wmp_ls_np_cb np, wmp_ls_player_cb player, void *ctx);
// The web player's access token (UTF-8), the client id it was issued to and the web player's client
// token (both UTF-8; NULL or "" keeps the last one; the client id outlives the launch in cache_dir).
// librespot serves the token and client token to Spotify's services in place of its own (login5 and
// clienttoken are never asked while they are held: they refuse a web login), and with no session up
// logs in with the token at once (token credentials, or the cached ones); with one up, it is kept for
// the next reconnect while it is fresh (50 min). Never logged.
void wmp_ls_token(const char *token, const char *client_id, const char *client_token);
// A command (UTF-8) to the live session, from Control Center or the page (as it sent it): "play" (not
// the active device: Spotify's remembered playback taken over first, then resumed), "pause", "toggle",
// "next", "prev", "seek:<ms>", "shuffle:0|1", "repeat:off|context|track", "take" (taken over, not
// resumed) or "load:{"context":uri,"track":uri|null,"shuffle":bool|null,"position":ms}" (activated
// first when not active; always plays; shuffle null leaves it). Dropped, with a log line, while no
// session is up; an unknown one is logged and ignored. Also "crossfade:<s>", taken with or without a
// session: at a track's natural end (not a skip, a load or a seek) the next track fades in over the
// last s seconds of this one (an integer, 0 off, the default; clamped to 0..12). Kept for the process,
// not across launches: the page sends it at its start and at each change. Logged.
void wmp_ls_command(const char *cmd);
// Asks the receiver to shut down; a later wmp_ls_start starts it again.
void wmp_ls_stop(void);
