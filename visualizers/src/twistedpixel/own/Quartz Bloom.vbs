' Quartz Bloom: a ring of crystal tiles opens on every kick, folded top to bottom and solarized
Const PI2 = 6.283185307179586
Dim tile, turn, pulse, avg

Sub PresetInitialize()
  tp_fDuration = 15.0
  tp_nWaveMode = -1
  tp_nBeatDetectionSensitivity = 60
  tp_bSolarize = 1
  tp_fVideoEchoAlpha = 0.5
  tp_fVideoEchoZoom = 1.0
  tp_nVideoEchoOrientation = 2
  tp_fDecay = 0.96
  tile = 0
  turn = 0
  pulse = 0
  avg = 0
End Sub

Sub ProcessPerFrame()
  Dim b
  b = tp_bBeatDetected
  If avg = 0 Then avg = b
  avg = avg * 0.95 + b * 0.05
  pulse = pulse * 0.88
  If b > avg * 1.12 + 0.02 Then pulse = 1
  turn = turn + 0.01 + 0.03 * pulse
  If turn > PI2 Then turn = turn - PI2
End Sub

Sub ProcessPerPixel()
  tp_zoom = 1.008 + 0.012 * Sn(tp_ang * 4 + tp_time) + 0.015 * pulse
  tp_rot = 0.015
End Sub

Function ProcessCustomShape()
  Dim a, ring, h
  a = turn + tile * PI2 / 8
  ring = 0.28 + 0.1 * pulse
  h = tp_time * 0.2 + tile * 0.785
  tp_shape_enabled = 1
  tp_shape_sides = 4
  tp_shape_x = 0.5 + 0.75 * ring * Cs(a)
  tp_shape_y = 0.5 + ring * Sn(a)
  tp_shape_rad = 0.085 + 0.035 * pulse
  tp_shape_ang = a * 2
  tp_shape_r = 0.6 + 0.4 * Sn(h)
  tp_shape_g = 0.6 + 0.4 * Sn(h + 2.1)
  tp_shape_b = 0.6 + 0.4 * Sn(h + 4.2)
  tp_shape_a = 0.7
  tp_shape_r2 = 0.2
  tp_shape_g2 = 0.25
  tp_shape_b2 = 0.4
  tp_shape_a2 = 0.5
  tp_shape_border_r = 1
  tp_shape_border_g = 1
  tp_shape_border_b = 1
  tp_shape_border_a = 0.5
  tile = tile + 1
  If tile < 8 Then
    ProcessCustomShape = True
  Else
    tile = 0
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
