// Aurora Fold: a high scope line spills curtains that fold as they fall, behind a doubled echo (JScript)
var pi2 = 6.283185307179586;
var sway = 0;

// sine and cosine from plain arithmetic: reduce to a quarter turn, then a Taylor polynomial
function sn(a) {
  var t = a / pi2;
  t = t - Math.floor(t + 0.5);
  if (t > 0.25) t = 0.5 - t;
  if (t < -0.25) t = -0.5 - t;
  var u = t * pi2;
  var q = u * u;
  return u * (1 - q / 6 * (1 - q / 20 * (1 - q / 42 * (1 - q / 72 * (1 - q / 110)))));
}
function cs(a) { return sn(a + 1.5707963267948966); }

function PresetInitialize() {
  tp_meshx = 16;
  tp_meshy = 12;
  tp_nWaveMode = 6;
  tp_bAdditiveWaves = 1;
  tp_fWaveAlpha = 0.6;
  tp_wave_x = 0.82;
  tp_fVideoEchoAlpha = 0.3;
  tp_fVideoEchoZoom = 2.0;
  tp_nVideoEchoOrientation = 0;
  tp_fDecay = 0.965;
  sway = 0;
}

function ProcessPerFrame() {
  var t = tp_time;
  var b = tp_bass;
  if (b > 2.5) b = 2.5;
  sway = sway * 0.9 + b * 0.1;
  tp_wave_r = 0.35 + 0.35 * sn(t * 0.19 + 3);
  tp_wave_g = 0.75 + 0.25 * sn(t * 0.27);
  tp_wave_b = 0.55 + 0.3 * cs(t * 0.21);
  tp_fWaveParam = 0.06 * sn(t * 0.33);
  tp_fWaveScale = 0.8 + 0.4 * sway;
}

function ProcessPerPixel() {
  var t = tp_time;
  tp_dy = 0.004 + 0.003 * sn(tp_x * 9 + t);
  tp_sx = 1 + 0.015 * cs(tp_y * 5 + t * 0.5);
}
