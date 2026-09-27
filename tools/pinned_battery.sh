#!/bin/sh
# pinned_battery.sh [NPINS] [FRAMES] -- run pinned_ab.sh over many seeds x inputs.
ROOT=`cd "\`dirname "$0"\`/.." && pwd`
N=${1:-60}; M=${2:-300}
i=1
while [ $i -le $N ]; do
  PIN=$((1300000000 + i*7919))
  for f in frames_tone.bin frames_K_tone300.bin frames_bass128.bin frames_steps.bin; do
    "$ROOT/tools/pinned_ab.sh" $PIN $f $M
  done
  i=$((i+1))
done
echo PINNED_BATTERY_DONE
