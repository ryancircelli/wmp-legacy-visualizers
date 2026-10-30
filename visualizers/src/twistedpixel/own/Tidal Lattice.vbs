' Tidal Lattice: a slanted beam skims over water that keeps sliding sideways and wrapping round
Const PI2 = 6.283185307179586
Dim swell

Sub PresetInitialize()
  tp_meshx = 32
  tp_meshy = 24
  tp_bTexWrap = 1
  tp_fDuration = 12.0
  tp_nWaveMode = 6
  tp_fWaveAlpha = 0.85
  tp_bWaveThick = 1
  tp_fWaveScale = 1.2
  tp_fDecay = 0.985
  tp_fGammaAdj = 2.2
  swell = 0
End Sub

Sub ProcessPerFrame()
  Dim t, m
  t = tp_time
  m = tp_mid_att
  If m > 2 Then m = 2
  swell = swell * 0.9 + m * 0.1
  tp_fWaveParam = 0.6 * Sn(t * 0.17)
  tp_wave_x = 0.5 + 0.2 * Sn(t * 0.23)
  tp_wave_y = 0.5 + 0.15 * Cs(t * 0.31)
  tp_wave_r = 0.15 + 0.15 * Sn(t * 0.5)
  tp_wave_g = 0.55 + 0.3 * Sn(t * 0.37 + 1.9)
  tp_wave_b = 0.85 + 0.15 * Sn(t * 0.61 + 0.4)
  tp_dx = 0.0045
  tp_dy = 0.0015 * Sn(t * 0.4)
End Sub

Sub ProcessPerPixel()
  Dim amp
  amp = 0.004 + 0.006 * swell
  tp_dy = tp_dy + amp * Sn(tp_x * PI2 * 3 + tp_time * 1.9)
  tp_dx = tp_dx + 0.6 * amp * Cs(tp_y * PI2 * 2 + tp_time * 1.3)
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
