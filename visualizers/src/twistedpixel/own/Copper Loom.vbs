' Copper Loom: the left channel bends a ring, the two channels weave a thread net, inked onto pale cloth
' (the picture is inverted, so the colours below are the complements of what shows)
Const PI2 = 6.283185307179586
Dim pass, wl, wr, hue

Sub PresetInitialize()
  tp_nWaveMode = -1
  tp_bInvert = 1
  tp_fDecay = 0.93
  tp_zoom = 0.995
  tp_warp = 0.3
  pass = 0
  hue = 0
End Sub

Sub ProcessPerFrame()
  wl = tp_WaveformLeft()
  wr = tp_WaveformRight()
  hue = tp_time * 0.11
End Sub

Sub ProcessPerPixel()
  tp_rot = 0.012 * (1 - tp_rad) + 0.004 * Sn(tp_time * 0.3)
End Sub

Function ProcessWaveform()
  Dim i, k, a, r, s
  If pass = 0 Then
    ' a closed ring: the samples run out and back so both ends meet
    tp_bWaveDots = 0
    For i = 0 To 287
      If i < 144 Then k = i * 2 Else k = (287 - i) * 2
      a = i * PI2 / 287 + hue
      r = 0.2 + wl(k) * 0.0016
      AddWaveformElement i, 0.5 + 0.75 * r * Cs(a), 0.5 + r * Sn(a), 0.4, 0.72 + 0.1 * Sn(hue), 0.9, 0.9
    Next
    pass = 1
    ProcessWaveform = True
  Else
    ' left against right: a thread net
    tp_bWaveDots = 1
    s = 0.0045
    For i = 0 To 287
      AddWaveformElement i, 0.5 + wl(i * 2) * s * 0.75, 0.5 + wr(i * 2) * s, 0.85, 0.8 - 0.15 * Sn(hue * 1.7), 0.45, 1
    Next
    pass = 0
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
