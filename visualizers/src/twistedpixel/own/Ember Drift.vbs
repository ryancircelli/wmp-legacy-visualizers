' Ember Drift: sparks lift off a smouldering ring and drift up through the heat
Const PI2 = 6.283185307179586
Dim heat

Sub PresetInitialize()
  tp_nWaveMode = 0
  tp_fWaveAlpha = 0.35
  tp_fGammaAdj = 1.7
  tp_bWaveThick = 1
  tp_bAdditiveWaves = 1
  tp_fWaveScale = 0.8
  tp_fDecay = 0.92
  tp_ob_size = 0.012
  tp_ob_r = 0.3
  tp_ob_g = 0.05
  tp_ob_b = 0
  tp_ob_a = 0.7
  heat = 0
End Sub

Sub ProcessPerFrame()
  Dim t, b
  t = tp_time
  b = tp_bass_att
  If b > 2.5 Then b = 2.5
  heat = heat * 0.85 + b * 0.15
  tp_wave_r = 0.9 + 0.1 * Sn(t * 0.7)
  tp_wave_g = 0.22 + 0.12 * Sn(t * 0.43 + 1.1) + 0.1 * heat
  tp_wave_b = 0.08 + 0.08 * Sn(t * 0.29 + 2.6)
  tp_fWaveParam = -0.35 + 0.12 * heat + 0.05 * Sn(t * 1.3)
  tp_wave_x = 0.5 + 0.04 * Sn(t * 0.37)
  tp_wave_y = 0.45 + 0.03 * Cs(t * 0.51)
  tp_zoom = 1.012 + 0.018 * heat
  tp_rot = 0.006 * Sn(t * 0.21)
  tp_dy = -0.0035 - 0.002 * heat
End Sub

Sub ProcessPerPixel()
  tp_zoom = tp_zoom + 0.025 * tp_rad
  tp_dx = 0.0025 * Sn(tp_y * 11 + tp_time * 1.7)
End Sub

' sine and cosine from plain arithmetic: reduce to a quarter turn, then a Taylor polynomial
Function Sn(ByVal a)
  Dim t, u, q
  t = a / PI2
  t = t - Int(t + 0.5)
  If t > 0.25 Then t = 0.5 - t
  If t < -0.25 Then t = -0.5 - t
  u = t * PI2
  q = u * u
  Sn = u * (1 - q / 6 * (1 - q / 20 * (1 - q / 42 * (1 - q / 72 * (1 - q / 110)))))
End Function

Function Cs(ByVal a)
  Cs = Sn(a + 1.5707963267948966)
End Function
