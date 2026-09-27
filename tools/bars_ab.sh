#!/bin/sh
# bars_ab.sh PRESET FRAMES.bin MAX [W=354] [H=345] [RAWEVERY=0]
# Real Bars and Waves (hostP.ps1 -Vis bars, MediaInfo(2ch) like WMP) vs tools/js_bars.js.
# FRAMES.bin must be in the Windows harness dir.  Output kept in $OUT (default scratch dir).
ROOT=`cd "\`dirname "$0"\`/.." && pwd`
HD=${ALCHEMY_HOST_DIR:?set ALCHEMY_HOST_DIR to the harness folder, as a WSL path}
WHD=${ALCHEMY_HOST_WIN:?set ALCHEMY_HOST_WIN to the harness folder, as a Windows path}
P=$1; BIN=$2; MAX=$3; W=${4:-354}; H=${5:-345}; RE=${6:-0}
OUT=${OUT:-${TMPDIR:-/tmp}/bars_ab}/p$P; rm -rf "$OUT" "$HD/harness-out/barsab$P"; mkdir -p "$OUT"
cp "$ROOT/tools/hostP.ps1" "$HD/hostP.ps1"
powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$WHD\\hostP.ps1" -Vis bars \
  -Channels 2 -Preset $P -Width $W -Height $H -Frames "$WHD\\$BIN" -Out "$WHD\\harness-out\\barsab$P" \
  -Max $MAX -Hash -RawEvery $RE > "$OUT/host.txt" 2>&1
mv "$HD/harness-out/barsab$P" "$OUT/real"
node "$ROOT/tools/js_bars.js" "$HD/$BIN" "$OUT/port" $P $MAX $W $H $RE > /dev/null
echo "bars preset $P  $W x $H  `"$ROOT/tools/cmp_hash.sh" "$OUT/real/stats.csv" "$OUT/port/stats.csv"`"
