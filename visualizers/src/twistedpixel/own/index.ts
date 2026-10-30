// Our own TwistedPixel presets (the plug-in's 333 are their authors' and stay out of this repo), by file name; the
// engine reads them as it reads its Presets folder. The files are CRLF, as the engine's are; a checkout that turned
// them to LF is put back.
import auroraFold from './Aurora Fold.js?raw';
import copperLoom from './Copper Loom.vbs?raw';
import emberDrift from './Ember Drift.vbs?raw';
import glassOrchid from './Glass Orchid.vbs?raw';
import mothLantern from './Moth Lantern.vbs?raw';
import nightFerry from './Night Ferry.vbs?raw';
import pollenStorm from './Pollen Storm.vbs?raw';
import prismTunnel from './Prism Tunnel.vbs?raw';
import quartzBloom from './Quartz Bloom.vbs?raw';
import signalGarden from './Signal Garden.js?raw';
import tidalLattice from './Tidal Lattice.vbs?raw';
import velvetPulse from './Velvet Pulse.vbs?raw';

const crlf = (s: string): string => s.replace(/\r?\n/g, '\r\n');
export const OWN: Record<string, string> = Object.fromEntries(Object.entries({
  'Aurora Fold.js': auroraFold,
  'Copper Loom.vbs': copperLoom,
  'Ember Drift.vbs': emberDrift,
  'Glass Orchid.vbs': glassOrchid,
  'Moth Lantern.vbs': mothLantern,
  'Night Ferry.vbs': nightFerry,
  'Pollen Storm.vbs': pollenStorm,
  'Prism Tunnel.vbs': prismTunnel,
  'Quartz Bloom.vbs': quartzBloom,
  'Signal Garden.js': signalGarden,
  'Tidal Lattice.vbs': tidalLattice,
  'Velvet Pulse.vbs': velvetPulse,
}).map(([k, v]) => [k, crlf(v)]));
