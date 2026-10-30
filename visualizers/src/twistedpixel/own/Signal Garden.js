// Signal Garden: a scope line plants rings that twist as they grow upward (JScript)
var pi2 = 6.283185307179586;
var glow = 0;

// sine from plain arithmetic: reduce to a quarter turn, then a Taylor polynomial
function sn(a) {
  var t = a / pi2;
  t = t - Math.floor(t + 0.5);
  if (t > 0.25) t = 0.5 - t;
  if (t < -0.25) t = -0.5 - t;
  var u = t * pi2;
  var q = u * u;
  return u * (1 - q / 6 * (1 - q / 20 * (1 - q / 42 * (1 - q / 72 * (1 - q / 110)))));
}

function PresetInitialize() {
  tp_nWaveMode = 4;
  tp_fWaveAlpha = 0.9;
  tp_bWaveThick = 1;
  tp_fWaveScale = 1.1;
  tp_bModWaveAlphaByVolume = 1;
  tp_fModWaveAlphaStart = 0.5;
  tp_fModWaveAlphaEnd = 1.3;
  tp_fDecay = 0.97;
  tp_ib_size = 0.008;
  glow = 0;
}

function ProcessPerFrame() {
  var t = tp_time;
  glow = glow * 0.9 + min(tp_treb_att, 3) * 0.1;
  tp_wave_r = 0.3 + 0.3 * sn(t * 0.41);
  tp_wave_g = 0.8 + 0.2 * sn(t * 0.3 + 2);
  tp_wave_b = 0.4 + 0.3 * sn(t * 0.53 + 4);
  tp_wave_y = 0.25 + 0.1 * sn(t * 0.2);
  tp_ib_r = 0.2;
  tp_ib_g = 0.6 + 0.3 * sn(t * 0.23);
  tp_ib_b = 0.3;
  tp_ib_a = 0.3 + 0.15 * min(glow, 2);
  tp_zoom = 1.008;
}

function ProcessPerPixel() {
  tp_rot = (0.025 + 0.02 * glow) * sn(tp_rad * 9 - tp_time * 1.5);
  tp_dy = -0.002 * (1 - tp_y);
}
