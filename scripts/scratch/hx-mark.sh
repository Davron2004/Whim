#!/bin/bash
# MEASUREMENT-ONLY (design-system-v1 task 24.6): append a step marker to the haptics capture log.
#   hx-mark.sh <capture-file> <step-id>
# Written with >> because the capture itself is appended (>>) too, so the two never overwrite each other.
set -eu
[ $# -eq 2 ] || { echo "usage: hx-mark.sh <capture-file> <step-id>" >&2; exit 2; }
t=$(perl -MTime::HiRes=time -e 'printf "%.3f", time*1000')
echo "HXM t=$t step=$2" >> "$1"
