' Glass Orchid: six translucent petals turn around a mirrored hexagon that holds the picture itself
Const PI2 = 6.283185307179586
Dim petal, spin, bloom

Sub PresetInitialize()
  tp_nWaveMode = -1
  tp_fDecay = 0.95
  tp_zoom = 0.995
  tp_fWarpAnimSpeed = 0.7
  tp_fWarpScale = 1.4
  tp_fVideoEchoAlpha = 0.35
  tp_fVideoEchoZoom = 1.25
  tp_nVideoEchoOrientation = 1
  tp_fGammaAdj = 1.6
  petal = 0
  spin = 0
  bloom = 0
End Sub

Sub ProcessPerFrame()
  Dim b, tr
  b = tp_bass
  If b > 2.5 Then b = 2.5
  bloom = bloom * 0.8 + b * 0.2
  tr = tp_treb_att
  If tr > 3 Then tr = 3
  spin = spin + 0.008 + 0.012 * tr
  If spin > PI2 Then spin = spin - PI2
  tp_warp = 0.8 + 0.6 * bloom
End Sub

Function ProcessCustomShape()
  Dim a, t
  t = tp_time
  tp_shape_enabled = 1
  If petal < 6 Then
    a = spin + petal * PI2 / 6
    tp_shape_sides = 3
    tp_shape_additive = 1
    tp_shape_x = 0.5 + (0.16 + 0.05 * bloom) * Cs(a)
    tp_shape_y = 0.5 + (0.21 + 0.06 * bloom) * Sn(a)
    tp_shape_rad = 0.09 + 0.04 * bloom
    tp_shape_ang = a
    tp_shape_r = 0.9
    tp_shape_g = 0.5 + 0.4 * Sn(t * 0.3 + petal)
    tp_shape_b = 1
    tp_shape_a = 0.5
    tp_shape_r2 = 0.3
    tp_shape_g2 = 0.1
    tp_shape_b2 = 0.6
    tp_shape_a2 = 0
    tp_shape_border_r = 1
    tp_shape_border_g = 1
    tp_shape_border_b = 1
    tp_shape_border_a = 0.35
    petal = petal + 1
    ProcessCustomShape = True
  Else
    tp_shape_sides = 6
    tp_shape_textured = 1
    tp_shape_x = 0.5
    tp_shape_y = 0.5
    tp_shape_rad = 0.12 + 0.03 * bloom
    tp_shape_ang = -1.5 * spin
    tp_shape_r = 1
    tp_shape_g = 1
    tp_shape_b = 1
    tp_shape_a = 1
    tp_shape_r2 = 0.8
    tp_shape_g2 = 0.7
    tp_shape_b2 = 1
    tp_shape_a2 = 1
    tp_shape_border_r = 1
    tp_shape_border_g = 0.85
    tp_shape_border_b = 0.4
    tp_shape_border_a = 0.6
    petal = 0
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
