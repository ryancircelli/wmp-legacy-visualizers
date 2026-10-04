// The iPod's EQ presets in its menu's order (Settings > EQ), each a gain in dB for the host player's ten
// bands, 32, 64, 125, 250, 500, 1k, 2k, 4k, 8k and 16k Hz (CONTRACT v10 `eq:<json>`). The curves are
// iTunes' own 10-band presets at exactly these frequencies, as widely published (the same table eqMac's
// AdvancedEqualizerDefaultPresets.swift, at twice the scale, and Cog's Cog.q1.json ship). Off and Flat
// are all zeros: the host bypasses its equalizer.
export interface EqPreset { id: string; name: string; gains: readonly number[] }

const p = (id: string, name: string, ...gains: number[]): EqPreset => ({ id, name, gains });
export const EQ_PRESETS: readonly EqPreset[] = [
  p('off', 'Off', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
  p('acoustic', 'Acoustic', 5, 4.9, 3.95, 1.05, 2.15, 1.75, 3.5, 4.1, 3.55, 2.15),
  p('bass-booster', 'Bass Booster', 5.5, 4.25, 3.5, 2.5, 1.25, 0, 0, 0, 0, 0),
  p('bass-reducer', 'Bass Reducer', -5.5, -4.25, -3.5, -2.5, -1.25, 0, 0, 0, 0, 0),
  p('classical', 'Classical', 4.75, 3.75, 3, 2.5, -1.5, -1.5, 0, 2.25, 3.25, 3.75),
  p('dance', 'Dance', 3.57, 6.55, 4.99, 0, 1.92, 3.65, 5.15, 4.54, 3.59, 0),
  p('deep', 'Deep', 4.95, 3.55, 1.75, 1, 2.85, 2.5, 1.45, -2.15, -3.55, -4.6),
  p('electronic', 'Electronic', 4.25, 3.8, 1.2, 0, -2.15, 2.25, 0.85, 1.25, 3.95, 4.8),
  p('flat', 'Flat', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
  p('hip-hop', 'Hip Hop', 5, 4.25, 1.5, 3, -1, -1, 1.5, -0.5, 2, 3),
  p('jazz', 'Jazz', 4, 3, 1.5, 2.25, -1.5, -1.5, 0, 1.5, 3, 3.75),
  p('latin', 'Latin', 4.5, 3, 0, 0, -1.5, -1.5, -1.5, 0, 3, 4.5),
  p('loudness', 'Loudness', 6, 4, 0, 0, -2, 0, -1, -5, 5, 1),
  p('lounge', 'Lounge', -3, -1.5, -0.5, 1.5, 4, 2.5, 0, -1.5, 2, 1),
  p('piano', 'Piano', 3, 2, 0, 2.5, 3, 1.5, 3.5, 4.5, 3, 3.5),
  p('pop', 'Pop', -1.5, -1, 0, 2, 4, 4, 2, 0, -1, -1.5),
  p('rnb', 'R&B', 2.62, 6.92, 5.65, 1.33, -2.19, -1.5, 2.32, 2.65, 3, 3.75),
  p('rock', 'Rock', 5, 4, 3, 1.5, -0.5, -1, 0.5, 2.5, 3.5, 4.5),
  p('small-speakers', 'Small Speakers', 5.5, 4.25, 3.5, 2.5, 1.25, 0, -1.25, -2.5, -3.5, -4.25),
  p('spoken-word', 'Spoken Word', -3.46, -0.47, 0, 0.69, 3.46, 4.61, 4.84, 4.28, 2.54, 0),
  p('treble-booster', 'Treble Booster', 0, 0, 0, 0, 0, 1.25, 2.5, 3.5, 4.25, 5.5),
  p('treble-reducer', 'Treble Reducer', 0, 0, 0, 0, 0, -1.25, -2.5, -3.5, -4.25, -5.5),
  p('vocal-booster', 'Vocal Booster', -1.5, -3, -3, 1.5, 3.75, 3.75, 3, 1.5, 0, -1.5),
];

/** The preset of an id; an unknown one is Off. */
export const eqPreset = (id: string): EqPreset => EQ_PRESETS.find((x) => x.id === id) ?? EQ_PRESETS[0]!;
