// The app's Spotify Connect receiver (ios/librespot, ios/README.md "Librespot"); build.sh copies this
// next to libwmp_librespot.a in out/.
#pragma once
#include <stddef.h>
#include <stdint.h>

// Interleaved stereo float32 frames at 44100 Hz, on librespot's player thread. It may block: that is
// the back-pressure that paces playback. frames 0 (samples NULL): the sink stopped (a pause, a stop).
typedef void (*wmp_ls_pcm_cb)(void *ctx, const float *samples, size_t frames);
// A UTF-8 log line, "librespot: ...", from any thread.
typedef void (*wmp_ls_log_cb)(void *ctx, const char *line);
// The session's state, from librespot's thread: its Connect device id (40 hex, UTF-8) when a session
// comes up, NULL when it ends.
typedef void (*wmp_ls_state_cb)(void *ctx, const char *device_id);

// Starts the receiver on a thread of its own: a Speaker called `name`, its Connect device id the hash
// of `id` (NULL or "": of the name; stable per install, so a rename keeps the device), the credentials
// cached in `cache_dir`. 0 started, -1 already running or bad input.
int32_t wmp_ls_start(const char *name, const char *id, const char *cache_dir, wmp_ls_pcm_cb pcm, wmp_ls_log_cb log,
                     wmp_ls_state_cb state, void *ctx);
// The web player's access token (UTF-8), the client id it was issued to and the web player's client
// token (both UTF-8; NULL or "" keeps the last one; the client id outlives the launch in cache_dir).
// librespot serves the token and client token to Spotify's services in place of its own (login5 and
// clienttoken are never asked while they are held: they refuse a web login), and with no session up
// logs in with the token at once (token credentials, or the cached ones); with one up, it is kept for
// the next reconnect while it is fresh (50 min). Never logged.
void wmp_ls_token(const char *token, const char *client_id, const char *client_token);
// Asks the receiver to shut down; a later wmp_ls_start starts it again.
void wmp_ls_stop(void);
