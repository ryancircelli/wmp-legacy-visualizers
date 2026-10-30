' Night Ferry: twin lamp lines ride a slow swell; the water stretches them into long reflections
Const PI2 = 6.283185307179586
Dim lift

Sub PresetInitialize()
  tp_nWaveMode = 7
  tp_fWaveAlpha = 0.5
  tp_wave_y = 0.35
  tp_fDecay = 0.95
  tp_ib_size = 0.006
  tp_ib_r = 0.1
  tp_ib_g = 0.2
  tp_ib_b = 0.5
  tp_ib_a = 0.8
  tp_ob_size = 0.02
  tp_ob_a = 1
  tp_bBrighten = 1
  lift = 0
End Sub

Sub ProcessPerFrame()
  Dim t, m, w
  t = tp_time
  m = tp_mid
  If m > 2.5 Then m = 2.5
  lift = lift * 0.85 + m * 0.15
  w = 0.5 + 0.5 * Sn(t * 0.15)
  tp_wave_r = 0.35 + 0.65 * w
  tp_wave_g = 0.45 + 0.35 * w
  tp_wave_b = 0.9 - 0.5 * w
  tp_fWaveScale = 0.8 + 0.5 * lift
  tp_fWaveParam = 0.1 * Sn(t * 0.27)
  tp_wave_x = 0.5 + 0.1 * Sn(t * 0.09)
  tp_cx = 0.5 + 0.12 * Sn(t * 0.19)
  tp_cy = 0.5 + 0.08 * Cs(t * 0.23)
  tp_sx = 1.006 + 0.006 * Sn(t * 0.5)
  tp_sy = 0.996
  tp_rot = 0.003 * Sn(t * 0.13)
  tp_dy = 0.001
  tp_ib_b = 0.4 + 0.2 * Sn(t * 0.7)
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
