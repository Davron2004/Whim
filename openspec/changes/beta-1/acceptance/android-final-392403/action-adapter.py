"""Root-owned adapter: refuse stale UI dumps; keep the pinned capture helper unchanged."""
import os
import signal
import subprocess
import sys

ADB = '/Users/davrondjabborov/Library/Android/sdk/platform-tools/adb'
HELPER = '/Users/davrondjabborov/Work/other/Whim/openspec/changes/beta-1/acceptance/android-final-392403/post-ui.py'
if len(sys.argv) < 2 or sys.argv[1] not in {'show', 'capture', 'tap', 'longtap'}:
    raise SystemExit('show | capture NAME | tap LABEL | longtap LABEL')

# This one file is written by our helper on our leased device. A failed dump must
# never make the helper read a previous screen's hierarchy.
subprocess.run([ADB, '-s', 'emulator-5560', 'shell', 'rm', '-f',
                '/sdcard/whim-post-ui.xml'], check=True, timeout=10)
child = subprocess.Popen([sys.executable, HELPER, *sys.argv[1:]],
                         start_new_session=True)
try:
    result = child.wait(timeout=45)
except subprocess.TimeoutExpired:
    os.killpg(child.pid, signal.SIGTERM)
    try:
        child.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        child.wait()
    raise SystemExit('Owned Android action timed out after 45 seconds')
raise SystemExit(result)
