' Pollen Storm: a grid of seeds and a spray of gold dust blown outward, faster toward the edges
Const PI2 = 6.283185307179586
Dim gust

Sub PresetInitialize()
  tp_nWaveMode = 2
  tp_fWaveAlpha = 1
  tp_bWaveDots = 1
  tp_bWaveThick = 1
  tp_bMaximizeWaveColor = 1
  tp_bAdditiveWaves = 1
  tp_zoomexp = 1.8
  tp_mv_a = 0.6
  tp_mv_x = 18
  tp_mv_y = 10
  tp_mv_r = 1
  tp_mv_g = 0.9
  tp_mv_b = 0.3
  tp_bDarken = 1
  tp_fGammaAdj = 2.4
  tp_fDecay = 0.975
  gust = 0
End Sub

Sub ProcessPerFrame()
  Dim t, v, tr
  t = tp_time
  v = tp_volume
  If v > 2.5 Then v = 2.5
  gust = gust * 0.8 + tp_bass * 0.2
  If gust > 2.5 Then gust = 2.5
  tr = tp_treb
  If tr > 3 Then tr = 3
  tp_fWaveScale = 0.9 + 0.5 * v
  tp_wave_r = 0.9 + 0.1 * Sn(t * 0.6)
  tp_wave_g = 0.7 + 0.3 * Sn(t * 0.41 + 2)
  tp_wave_b = 0.15 + 0.15 * Sn(t * 0.33 + 4)
  tp_wave_x = 0.5 + 0.15 * Sn(t * 0.29)
  tp_wave_y = 0.5 + 0.12 * Cs(t * 0.37)
  tp_mv_dx = 0.02 * Sn(t * 0.9)
  tp_mv_dy = 0.02 * Cs(t * 0.7)
  tp_mv_g = 0.75 + 0.25 * Sn(t * 0.5)
  tp_zoom = 1.025 + 0.02 * gust
  tp_rot = 0.01 * Sn(t * 0.27) + 0.006 * tr
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
