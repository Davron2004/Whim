"""Observe a label, then save the successful dump without another UIAutomator call."""
import ast
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

ACTION = '/tmp/whim-beta1-android-action.py'
ADB = '/Users/davrondjabborov/Library/Android/sdk/platform-tools/adb'
SERIAL = 'emulator-5560'
BASE = Path('/Users/davrondjabborov/Work/other/Whim/openspec/changes/beta-1/acceptance/android-final-392403')
SCRATCH = '/sdcard/whim-post-ui.xml'
LABEL_LINE = re.compile(r'''^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s+android\.[A-Za-z0-9_.$]+\s''')
OBSERVATION_ERROR = re.compile(
    r'^ERROR: (?:could not get idle state|'
    r'null root node returned by UiTestAutomationBridge)[.!]?\s*$', re.MULTILINE)


def arguments(argv):
    if len(argv) not in (2, 3):
        raise ValueError('usage: LABEL CAPTURE [SECONDS1..180]')
    label, name = argv[:2]
    if not label.strip() or '\x00' in label:
        raise ValueError('nonempty label required')
    if not re.fullmatch(r'post-[a-zA-Z0-9-]+', name):
        raise ValueError('post- evidence name required')
    seconds = 120
    if len(argv) == 3:
        if not re.fullmatch(r'[0-9]+', argv[2]) or not 1 <= int(argv[2]) <= 180:
            raise ValueError('observation bound must be an integer from 1 to 180')
        seconds = int(argv[2])
    paths = {key: BASE / (name + suffix) for key, suffix in (
        ('xml', '.xml'), ('png', '.png'), ('window', '-window.txt'),
        ('receipt', '-observe.json'))}
    if any(os.path.lexists(path) for path in paths.values()):
        raise ValueError('refusing evidence overwrite')
    return label, name, seconds, paths


def labels(raw):
    found = set()
    for line in raw.splitlines():
        match = LABEL_LINE.match(line)
        if match:
            value = ast.literal_eval(match[1])
            if isinstance(value, str):
                found.add(value)
    return found


def retryable_observation_error(raw):
    if not OBSERVATION_ERROR.search(raw):
        return False
    # Do not let a known UIA message hide another explicit Android failure.
    for line in raw.splitlines():
        stripped = line.strip()
        if re.match(r'^(?:ERROR:|error:|adb:)', stripped) and not OBSERVATION_ERROR.fullmatch(stripped):
            return False
    return True


def main(argv):
    label, name, seconds, paths = arguments(argv)
    helper_hash = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    action_hash = hashlib.sha256(Path(ACTION).read_bytes()).hexdigest()
    started_wall = datetime.datetime.now(datetime.timezone.utc).isoformat()
    started = time.monotonic()
    deadline = started + seconds
    attempts = 0
    retries = 0
    while time.monotonic() < deadline:
        attempts += 1
        show_started = time.monotonic()
        # The reviewed wrapper owns its UI child's timeout and cleanup. Let it
        # finish: its child starts a separate session, so killing the wrapper
        # early would leave the dump running after this observer has returned.
        shown = subprocess.run([sys.executable, ACTION, 'show'], stdin=subprocess.DEVNULL,
                               capture_output=True, text=True, timeout=65)
        show_finished = time.monotonic()
        diagnostic = shown.stdout + '\n' + shown.stderr
        if shown.returncode:
            if retryable_observation_error(diagnostic):
                retries += 1
            else:
                sys.stdout.write(shown.stdout)
                sys.stderr.write(shown.stderr)
                raise RuntimeError('reviewed show failed: exit ' + str(shown.returncode))
        elif OBSERVATION_ERROR.search(diagnostic):
            if not retryable_observation_error(diagnostic):
                raise RuntimeError('show reported another Android failure: ' + diagnostic)
            retries += 1
        elif label in labels(shown.stdout):
            break
        remaining = deadline - time.monotonic()
        if remaining > 0:
            time.sleep(min(0.25, remaining))
    else:
        raise RuntimeError('expected native label did not appear within bound: ' + label)

    def read_adb(*args):
        return subprocess.check_output([ADB, '-s', SERIAL, *args], stdin=subprocess.DEVNULL,
                                       stderr=subprocess.PIPE, timeout=20)

    xml_started = time.monotonic()
    xml = read_adb('exec-out', 'cat', SCRATCH)
    xml_finished = time.monotonic()
    root = ET.fromstring(xml)
    if root.tag != 'hierarchy' or not any(
            label in (node.get('text'), node.get('content-desc')) for node in root.iter('node')):
        raise RuntimeError('fresh scratch XML does not contain the exact observed label')
    png_started = time.monotonic()
    png = read_adb('exec-out', 'screencap', '-p')
    png_finished = time.monotonic()
    if not png.startswith(b'\x89PNG\r\n\x1a\n'):
        raise RuntimeError('screencap did not return a PNG')
    window_started = time.monotonic()
    window = read_adb('shell', 'dumpsys', 'window')
    window_finished = time.monotonic()
    if not window.strip():
        raise RuntimeError('dumpsys window returned no data')
    receipt = {
        'status': 'captured', 'capture': name, 'label': label, 'serial': SERIAL,
        'helper': str(Path(__file__).absolute()), 'helper_sha256': helper_hash,
        'action': ACTION, 'action_sha256': action_hash, 'adb': ADB,
        'started_utc': started_wall, 'requested_seconds': seconds,
        'attempts': attempts, 'observation_error_retries': retries,
        'timing_seconds_since_start': {key: value - started for key, value in (
            ('show_started', show_started), ('show_finished', show_finished),
            ('xml_copy_started', xml_started), ('xml_copy_finished', xml_finished),
            ('png_started', png_started), ('png_finished', png_finished),
            ('window_started', window_started), ('window_finished', window_finished))},
        'deadline_overrun_at_match_seconds': max(0, show_finished - deadline),
        'artifacts': {key: {'path': str(paths[key]), 'sha256': hashlib.sha256(data).hexdigest()}
                      for key, data in (('xml', xml), ('png', png), ('window', window))},
        'visual_validation': 'Pending root visual check: PNG/window may follow a UI transition after the XML dump.'}
    # Guarded before any action, and still exclusive at publication. A collision
    # can leave only new partial files; a success receipt is always written last.
    for key, data in (('xml', xml), ('png', png), ('window', window),
                      ('receipt', (json.dumps(receipt, indent=2) + '\n').encode())):
        with paths[key].open('xb') as output:
            output.write(data)
    print('OBSERVED:', label, flush=True)
    print('CAPTURE:', name, flush=True)
    print('RECEIPT:', paths['receipt'], flush=True)


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except (ValueError, RuntimeError, OSError, ET.ParseError, subprocess.SubprocessError) as error:
        raise SystemExit(str(error))
