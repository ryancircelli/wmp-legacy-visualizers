#!/bin/sh
# cmp_hash.sh HOST_stats.csv PORT_stats.csv -- compare per-frame (hash, rand count) between a
# hostP.ps1 -Hash run and a js_renderP.js / js_bars.js run.  Port frame -1 (the probe) is skipped.
# Prints "identical N/N" or the first differing frame and the mismatch count.
awk -F, 'NR==1{for(i=1;i<=NF;i++)c[$i]=i; next} {h=$c["hash"]; sub(/^0+/,"",h); print $1","h","$c["rand"]}' "$1" > "$1.k"
awk -F, 'NR==1{for(i=1;i<=NF;i++)c[$i]=i; next} $1>=0{h=$c["hash"]; sub(/^0+/,"",h); print $1","h","$c["rand"]}' "$2" > "$2.k"
n=`wc -l < "$1.k"`; m=`wc -l < "$2.k"`
bad=`paste -d'|' "$1.k" "$2.k" | awk -F'|' '$1!=$2' | wc -l`
first=`paste -d'|' "$1.k" "$2.k" | awk -F'|' '$1!=$2{print; exit}'`
if [ "$n" != "$m" ]; then echo "LENGTH host=$n port=$m"; fi
if [ "$bad" = 0 ]; then echo "identical $n/$n"; else echo "DIFFER $bad/$n first: $first"; fi
rm -f "$1.k" "$2.k"
