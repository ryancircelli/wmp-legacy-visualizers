' Moth Lantern: a paper lantern wanders the dark, its flame spitting sparks, with three moths looping round it
Const PI2 = 6.283185307179586
Dim lamp, moth, lx, ly, warm

Sub PresetInitialize()
  tp_nWaveMode = 3
  tp_fWaveSmoothing = 0.7
  tp_fWaveScale = 0.25
  tp_fDecay = 0.95
  lamp = 0
  moth = 0
  warm = 0
End Sub

Sub ProcessPerFrame()
  Dim t, b
  t = tp_time
  b = tp_bass_att
  If b > 2.5 Then b = 2.5
  warm = warm * 0.85 + b * 0.15
  lx = 0.5 + 0.15 * Sn(t * 0.13)
  ly = 0.5 + 0.1 * Cs(t * 0.17)
  tp_wave_x = lx
  tp_wave_y = ly
  tp_wave_r = 1
  tp_wave_g = 0.6 + 0.1 * warm
  tp_wave_b = 0.25
  tp_zoom = 1.004
  tp_dy = -0.001
End Sub

Function ProcessCustomShape()
  tp_shape_enabled = 1
  tp_shape_additive = 1
  tp_shape_x = lx
  tp_shape_y = ly
  If lamp = 0 Then
    tp_shape_sides = 30
    tp_shape_rad = 0.13 + 0.03 * warm
    tp_shape_r = 1
    tp_shape_g = 0.75
    tp_shape_b = 0.35
    tp_shape_a = 0.5
    tp_shape_r2 = 1
    tp_shape_g2 = 0.4
    tp_shape_b2 = 0.1
    tp_shape_a2 = 0
    lamp = 1
    ProcessCustomShape = True
  Else
    tp_shape_sides = 12
    tp_shape_rad = 0.035
    tp_shape_r = 1
    tp_shape_g = 0.95
    tp_shape_b = 0.8
    tp_shape_a = 0.95
    tp_shape_r2 = 1
    tp_shape_g2 = 0.7
    tp_shape_b2 = 0.3
    tp_shape_a2 = 0.8
    lamp = 0
    ProcessCustomShape = False
  End If
End Function

Function ProcessWaveform()
  Dim j, tau, th, rho, x, y, fade
  For j = 0 To 49
    tau = tp_time - j * 0.03
    th = tau * (1.3 + 0.4 * moth) + moth * 2.1
    rho = 0.15 + 0.06 * Sn(tau * 2.7 + moth)
    x = lx + 0.75 * rho * Cs(th) + 0.012 * Sn(tau * 7.1 + moth)
    y = (1 - ly) + rho * Sn(th) + 0.012 * Cs(tau * 6.3 + moth)
    fade = 1 - j / 50
    AddWaveformElement j, x, y, 0.75 + 0.25 * Sn(moth * 2.3), 0.85, 0.6 + 0.4 * Cs(moth * 1.7), fade
  Next
  moth = moth + 1
  If moth < 3 Then
    ProcessWaveform = True
  Else
    moth = 0
    ProcessWaveform = False
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
