#!/bin/sh
# pinned_ab.sh PIN FRAMES.bin MAXFRAMES
# Deterministic DLL-vs-port A/B for Alchemy: pins _time64 via tools/hostP.ps1's IAT hook so
# srand(time(NULL)) is fixed, then compares EVERY frame's FNV-1a surface hash and per-frame
# rand() count against tools/js_renderP.js.  Prints "N/N frames EXACT" or the first bad frame.
# Needs hostP.ps1 + the frames .bin in the Windows harness dir (HD below).
ROOT=`cd "\`dirname "$0"\`/.." && pwd`
HD=${ALCHEMY_HOST_DIR:?set ALCHEMY_HOST_DIR to the harness folder, as a WSL path}
WHD=${ALCHEMY_HOST_WIN:?set ALCHEMY_HOST_WIN to the harness folder, as a Windows path}
TMP=${TMPDIR:-/tmp}/pinned_ab.$$
PIN=$1; BIN=$2; MAX=$3
mkdir -p "$TMP"; rm -rf "$HD/PINAB$PIN"
cp "$ROOT/tools/hostP.ps1" "$HD/hostP.ps1" 2>/dev/null
powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$WHD\\hostP.ps1" -Vis alchemy \
  -Frames "$WHD\\$BIN" -Out "$WHD\\PINAB$PIN" -Max $MAX -PinTime $PIN -Hash >/dev/null 2>&1
node "$ROOT/tools/js_renderP.js" "$HD/$BIN" "$TMP/port" $MAX $PIN >/dev/null 2>&1
awk -F, 'NR>1{h=$6; sub(/^0+/,"",h); print $1","h","$4}' "$HD/PINAB$PIN/stats.csv"   > "$TMP/r.txt"
awk -F, 'NR>1 && $1>=0{h=$3; sub(/^0+/,"",h); print $1","h","$2}' "$TMP/port/stats.csv" > "$TMP/p.txt"
n=`wc -l < "$TMP/r.txt"`; bad=`diff "$TMP/r.txt" "$TMP/p.txt" | grep -c '^<'`
first=`diff "$TMP/r.txt" "$TMP/p.txt" | grep '^<' | head -1 | sed 's/^< //' | cut -d, -f1`
if [ "$bad" = "0" ]; then echo "pin=$PIN  $BIN  $n/$n frames EXACT"
else echo "pin=$PIN  $BIN  $bad/$n MISMATCH (first frame $first)"; fi
[ -n "$KEEP" ] && { mkdir -p "$KEEP"; cp "$HD/PINAB$PIN/stats.csv" "$KEEP/real_$PIN.csv"; cp "$TMP/port/stats.csv" "$KEEP/port_$PIN.csv"; }
rm -rf "$TMP" "$HD/PINAB$PIN"
