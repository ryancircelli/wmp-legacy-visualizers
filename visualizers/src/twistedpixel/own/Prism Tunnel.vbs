' Prism Tunnel: a ring at the far end changes hue every instant and streams out as a rainbow corridor
Const PI2 = 6.283185307179586
Dim pulse, avg

Sub PresetInitialize()
  tp_nWaveMode = 1
  tp_fWaveAlpha = 0.9
  tp_bWaveThick = 1
  tp_bMaximizeWaveColor = 1
  tp_bTexWrap = 0
  tp_ob_size = 0.01
  tp_ib_size = 0.006
  tp_fDecay = 0.97
  tp_nBeatDetectionSensitivity = 70
  pulse = 0
  avg = 0
End Sub

Sub ProcessPerFrame()
  Dim t, b, h
  t = tp_time
  b = tp_bBeatDetected
  If avg = 0 Then avg = b
  avg = avg * 0.94 + b * 0.06
  pulse = pulse * 0.85
  If b > avg * 1.1 + 0.02 Then pulse = 1
  h = t * 1.3
  tp_wave_r = 0.5 + 0.5 * Sn(h)
  tp_wave_g = 0.5 + 0.5 * Sn(h + 2.1)
  tp_wave_b = 0.5 + 0.5 * Sn(h + 4.2)
  tp_fWaveScale = 0.07 + 0.08 * pulse
  tp_fWaveParam = -0.42 + 0.1 * pulse
  tp_ob_r = 1 - tp_wave_r
  tp_ob_g = 1 - tp_wave_g
  tp_ob_b = 1 - tp_wave_b
  tp_ob_a = 0.6
  tp_ib_r = tp_wave_r
  tp_ib_g = tp_wave_g
  tp_ib_b = tp_wave_b
  tp_ib_a = 0.3 + 0.6 * pulse
  tp_cx = 0.5 + 0.08 * Sn(t * 0.31)
  tp_cy = 0.5 + 0.08 * Cs(t * 0.37)
  tp_wave_x = tp_cx
  tp_wave_y = 1 - tp_cy
  tp_rot = 0.025 * Sn(t * 0.11) + 0.015 * pulse
End Sub

Sub ProcessPerPixel()
  tp_zoom = 1.03 + 0.05 * tp_rad + 0.02 * pulse
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
