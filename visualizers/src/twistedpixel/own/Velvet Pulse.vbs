' Velvet Pulse: a spinning figure is wrung into a three-lobed twist, echoed upside down and back to front
Const PI2 = 6.283185307179586
Dim twist, orb

Sub PresetInitialize()
  tp_nWaveMode = 5
  tp_fWaveAlpha = 1
  tp_bAdditiveWaves = 1
  tp_fWaveScale = 1.3
  tp_bTexWrap = 0
  tp_fGammaAdj = 2.2
  tp_fVideoEchoAlpha = 0.3
  tp_fVideoEchoZoom = 1.5
  tp_nVideoEchoOrientation = 3
  twist = 0
  orb = 0
End Sub

Sub ProcessPerFrame()
  Dim t, b
  t = tp_time
  b = tp_bass_att
  If b > 2.5 Then b = 2.5
  twist = 0.05 * Sn(t * 0.15) + 0.02 * b
  tp_wave_r = 0.75 + 0.25 * Sn(t * 0.31)
  tp_wave_g = 0.1 + 0.1 * Sn(t * 0.47 + 1)
  tp_wave_b = 0.6 + 0.4 * Sn(t * 0.23 + 3)
End Sub

Sub ProcessPerPixel()
  tp_rot = twist * (0.9 - tp_rad)
  tp_zoom = 1.01 + 0.025 * Sn(tp_ang * 3 + tp_time * 0.8) * tp_rad
End Sub

' two soft glows circle each other, so there is always something to wring
Function ProcessCustomShape()
  Dim a
  a = tp_time * 0.6 + orb * 3.141592653589793
  tp_shape_enabled = 1
  tp_shape_sides = 20
  tp_shape_additive = 1
  tp_shape_x = 0.5 + 0.14 * Cs(a)
  tp_shape_y = 0.5 + 0.18 * Sn(a)
  tp_shape_rad = 0.05 + 0.02 * twist
  tp_shape_r = 0.9
  tp_shape_g = 0.2 + 0.2 * orb
  tp_shape_b = 0.7
  tp_shape_a = 0.35
  tp_shape_a2 = 0
  orb = orb + 1
  If orb < 2 Then
    ProcessCustomShape = True
  Else
    orb = 0
    ProcessCustomShape = False
  End If
End Function

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
