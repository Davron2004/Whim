#!/bin/bash
# MEASUREMENT-ONLY (design-system-v1 task 24.6): sign, build and install the instrumented Release
# build on Davron's iPhone 15 Plus (and nothing else). Needs an Apple ID of team 2B7K4YLS34 signed
# in under Xcode > Settings > Accounts. Never uninstalls: an install that would wipe the app fails.
#   scripts/scratch/hx-install.sh
set -eu
UDID=00008120-000A3D4E0E92201E
WT=/Users/davrondjabborov/Work/other/Whim/.claude/worktrees/device-24-6
cd "$WT/ios"
/Users/davrondjabborov/.cache/whim-run/capped-run.sh --mb 8192 --secs 2400 -- \
  xcodebuild -workspace Whim.xcworkspace -scheme Whim -configuration Release \
    -destination "id=$UDID" -derivedDataPath build/dev -allowProvisioningUpdates \
    WHIM_BUILD_NUMBER=435735 build
xcrun devicectl device install app --device "$UDID" build/dev/Build/Products/Release-iphoneos/Whim.app
xcrun devicectl device info apps --device "$UDID" | grep -i whim
