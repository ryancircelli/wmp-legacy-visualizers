#!/bin/sh
# battery_ab.sh PRESET PIN FRAMES.bin MAX [CHANNELS=2]
# Real Battery (hostP.ps1 -Vis battery -Pal, pinned _time64, MediaInfo(2ch) like WMP) vs tools/js_bat.js.
# Per frame it compares the FNV-1a of the 384x288 8-bit FRONT surface (`ihash`), the rand() count, and
# the whole palette control block incl. the FNV of the LIVE palette (pal.csv).  Not the 640x480 DIB
# hash: GDI's STRETCH_DELETESCANS column/row pick and the DLL's one-frame palette display lag (spec
# battery/10 §2.3, §5) are host blit behaviour, and the DIB is a function of FRONT + LIVE anyway.
# FRAMES.bin must be in the Windows harness dir.  Output kept in $OUT (default scratch dir).
ROOT=`cd "\`dirname "$0"\`/.." && pwd`
HD=${ALCHEMY_HOST_DIR:?set ALCHEMY_HOST_DIR to the harness folder, as a WSL path}
WHD=${ALCHEMY_HOST_WIN:?set ALCHEMY_HOST_WIN to the harness folder, as a Windows path}
P=$1; PIN=$2; BIN=$3; MAX=$4; CH=${5:-2}; TAG=bat${P}_${PIN}_c$CH
OUT=${OUT:-${TMPDIR:-/tmp}/battery_ab}/$TAG; rm -rf "$OUT" "$HD/harness-out/$TAG"; mkdir -p "$OUT"
cmp -s "$ROOT/tools/hostP.ps1" "$HD/hostP.ps1" || cp "$ROOT/tools/hostP.ps1" "$HD/hostP.ps1"
# ALCHEMY_HOST_SHARE (UNC, e.g. \\wsl$\Ubuntu-22.04\tmp\x) + ALCHEMY_HOST_SHARE_DIR (its WSL path): the host's
# temp (Add-Type compiles there) and output go to the share instead of C: — needed when C: is full.
if [ -n "$ALCHEMY_HOST_SHARE" ]; then
  HOUT="$ALCHEMY_HOST_SHARE_DIR/$TAG"; rm -rf "$HOUT"
  powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "\$env:TEMP='$ALCHEMY_HOST_SHARE'; \$env:TMP=\$env:TEMP; & '$WHD\\hostP.ps1' -Vis battery -Channels $CH -Preset $P -PinTime $PIN -Frames '$WHD\\$BIN' -Out '$ALCHEMY_HOST_SHARE\\$TAG' -Max $MAX -Pal" > "$OUT/host.txt" 2>&1
else
  HOUT="$HD/harness-out/$TAG"
  powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$WHD\\hostP.ps1" -Vis battery \
    -Channels $CH -Preset $P -PinTime $PIN -Frames "$WHD\\$BIN" -Out "$WHD\\harness-out\\$TAG" \
    -Max $MAX -Pal > "$OUT/host.txt" 2>&1
fi
mkdir -p "$OUT/real"; mv "$HOUT/stats.csv" "$HOUT/pal.csv" "$OUT/real/"; rm -rf "$HOUT"
node --max-old-space-size=4096 "$ROOT/tools/js_bat.js" "$HD/$BIN" "$OUT/port" $P $MAX $PIN > /dev/null
rm -f "$OUT/port/live.csv"
key() { awk -F, 'NR==FNR{if(FNR>1){for(i=10;i<=NF;i++)sub(/^0+/,"",$i); p[$1]=$0} next} FNR==1{for(i=1;i<=NF;i++)c[$i]=i; next}
  $1>=0{h=$c["ihash"]; sub(/^0+/,"",h); print $1","h","$c["rand"]"|"p[$1]}' OFS=, "$1/pal.csv" "$1/stats.csv"; }
key "$OUT/real" > "$OUT/r.k"; key "$OUT/port" > "$OUT/p.k"
n=`wc -l < "$OUT/r.k"`; m=`wc -l < "$OUT/p.k"`
bad=`paste -d'#' "$OUT/r.k" "$OUT/p.k" | awk -F'#' '$1!=$2' | wc -l`
first=`paste -d'#' "$OUT/r.k" "$OUT/p.k" | awk -F'#' '$1!=$2{print; exit}'`
[ "$n" != "$m" ] && echo "LENGTH host=$n port=$m"
if [ "$bad" = 0 ] && [ "$n" = "$m" ]; then r="identical $n/$n"; else r="DIFFER $bad/$n first: $first"; fi
echo "battery preset $P  pin $PIN  $r"
