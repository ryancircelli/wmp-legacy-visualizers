// Persisted settings: the SAME localStorage key and shape src/90-shell.js used, so upgrades keep
// the user's choices. Nothing is renamed; `skin` is new (default 'wmp9'; 'ipod' on a touch device).
import { eqPreset } from './eq';
import type { View, VisKind } from './types';

export { EQ_PRESETS, eqPreset, type EqPreset } from './eq';

export const LS_KEY = 'alchemy.settings';
export const FPS_OPTS = [30, 45, 60, 75, 90, 120] as const;
export const SCALE_OPTS = ['original', 'auto', 0.25, 0.5, 0.75, 1.0] as const;
export type Scale = (typeof SCALE_OPTS)[number];
/** the stream's bitrates in kbps (the host's player: Normal, High, Very High) */
export const QUALITY_OPTS = [96, 160, 320] as const;

export interface Settings {
  fps: number;
  scale: Scale;
  intended: boolean;
  bg: number;
  smoothing: number;
  debug: boolean;
  vis: VisKind;
  preset: number;
  advanced: boolean;
  animate: boolean;
  /** 0..200 capture sensitivity; 0..100 the player's volume in Spotify mode */
  volume: number;
  muted: boolean;
  /** fetch and show lyrics */
  lyrics: boolean;
  /** synced lyrics highlight word by word (off: the current line lit plainly) */
  karaoke: boolean;
  /** seconds the next track fades in over the end of this one, 0 off (the host's own speaker only: auth.hostPlayer) */
  crossfade: number;
  /** the host's own player's sound (auth.hostPlayer, CONTRACT v10): the EQ preset's id (EQ_PRESETS), the
   *  stream's bitrate in kbps, volume normalisation (the iPod's Sound Check), the audio cache */
  eq: string;
  quality: (typeof QUALITY_OPTS)[number];
  normalise: boolean;
  audioCache: boolean;
  /** the clock shows remaining (-m:ss) instead of elapsed */
  remaining?: boolean;
  taskPane?: boolean;
  playlistPane?: boolean;
  view?: View;
  skin: string;
  /** Media Library: the details pane shown */
  detailsPane: boolean;
  /** Media Library: the track table or cover tiles */
  libraryView: 'details' | 'tiles';
}

export const DEFAULTS: Settings = {
  fps: 60, scale: 'original', intended: false, bg: 0x000000, smoothing: 0, debug: false,
  vis: 'alchemy', preset: 0, advanced: false, animate: true, volume: 100, muted: false, lyrics: true, karaoke: true, crossfade: 0, eq: 'off', quality: 160, normalise: true, audioCache: true, skin: 'wmp9', detailsPane: true, libraryView: 'details',
};

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const presetMax = (vis: VisKind) => (vis === 'battery' ? 25 : 3);

/** Normalise any parsed blob (old builds included) to a valid Settings. */
export function normalize(raw: Record<string, unknown>, firstRun = false): Settings {
  const s = { ...DEFAULTS } as Settings & Record<string, unknown>;
  // Under the desktop host a first run with nothing saved starts on Battery > Randomization.
  if (firstRun) { s.vis = 'battery'; s.preset = 0; }
  Object.assign(s, raw);
  // Keys an older build may carry (the retired player frame): neither honoured nor written back.
  delete s.frame; delete s.frameSet;
  s.fps = (FPS_OPTS as readonly number[]).includes(s.fps) ? s.fps : DEFAULTS.fps;
  s.vis = s.vis === 'bars' || s.vis === 'battery' ? s.vis : 'alchemy';
  s.preset = clamp(s.preset | 0, 0, presetMax(s.vis));
  s.scale = (SCALE_OPTS as readonly unknown[]).includes(s.scale) ? s.scale : DEFAULTS.scale;
  s.bg = clamp(s.bg | 0, 0, 0xffffff);
  s.volume = clamp(+s.volume || 0, 0, 200);
  s.animate = s.animate !== false;
  s.lyrics = s.lyrics !== false;
  s.karaoke = s.karaoke !== false;
  s.crossfade = clamp(Math.round(+s.crossfade || 0), 0, 12);
  s.eq = eqPreset(String(s.eq)).id;
  s.quality = QUALITY_OPTS.includes(s.quality) ? s.quality : DEFAULTS.quality;
  s.normalise = s.normalise !== false;   // on unless turned off (Spotify's own default)
  s.audioCache = s.audioCache !== false;
  if (typeof s.skin !== 'string' || !s.skin) s.skin = DEFAULTS.skin;
  s.detailsPane = s.detailsPane !== false;
  s.libraryView = s.libraryView === 'tiles' ? 'tiles' : 'details';
  // 'devices' was a view until Play on Device moved to the bottom bar.
  if ((s.view as string) === 'devices') s.view = 'now';
  return s;
}

export function loadSettings(): Settings {
  let raw: string | null = null;
  try { raw = localStorage.getItem(LS_KEY); } catch { /* blocked storage */ }
  let parsed: Record<string, unknown> = {};
  try { parsed = (JSON.parse(raw || '{}') as Record<string, unknown>) || {}; } catch { /* corrupt blob */ }
  const host = typeof window !== 'undefined' && !!(window as { alchemyElectron?: unknown }).alchemyElectron;
  // No skin chosen yet, on a touch device (a phone, the iOS app): the iPod, which is drawn for one.
  if (typeof parsed.skin !== 'string' && typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) parsed.skin = 'ipod';
  return normalize(parsed, !raw && host);
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* blocked storage */ }
}
