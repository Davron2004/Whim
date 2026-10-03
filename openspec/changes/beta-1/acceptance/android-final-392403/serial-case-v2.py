"""Serial root-owned UI orchestration; no product or environment changes."""
import ast, re, shlex, subprocess, sys, time
ACTION = '/tmp/whim-beta1-android-action.py'
ADB = '/Users/davrondjabborov/Library/Android/sdk/platform-tools/adb'

def action(*args):
    result = subprocess.run([sys.executable, ACTION, *args], capture_output=True, text=True, timeout=55)
    if result.returncode:
        sys.stdout.write(result.stdout); sys.stderr.write(result.stderr)
        raise SystemExit(result.returncode)
    return result.stdout

def labels(raw):
    result = set()
    for line in raw.splitlines():
        if not line.startswith(("'", '"')): continue
        try: result.add(ast.literal_eval(line[:line.index(' android.')]))
        except (ValueError, SyntaxError): pass
    return result

def wait(label, seconds=120):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        raw = action('show')
        if label in labels(raw):
            print('OBSERVED:', label, flush=True)
            return raw
        time.sleep(1)
    print(raw)
    raise SystemExit('Expected native label did not appear within bound: ' + label)

def capture(name):
    raw = action('capture', name)
    print('CAPTURE:', name, flush=True)
    return raw

def adb(*args):
    subprocess.run([ADB, '-s', 'emulator-5560', *args], stdin=subprocess.DEVNULL, check=True, timeout=20)

if len(sys.argv) < 2: raise SystemExit('mode required')
mode = sys.argv[1]
if mode == 'start':
    if len(sys.argv) not in (4, 5): raise SystemExit('start requires CASE PROMPT [plan-only]')
    if not re.fullmatch(r'post-[a-zA-Z0-9-]+', sys.argv[2]): raise SystemExit('invalid case name')
    if not sys.argv[3].strip(): raise SystemExit('nonempty prompt required')
    if len(sys.argv) == 5 and sys.argv[4] != 'plan-only': raise SystemExit('invalid optional mode')
elif mode == 'wait':
    if len(sys.argv) not in (4, 5): raise SystemExit('wait requires LABEL CAPTURE [SECONDS]')
    if not sys.argv[2] or not re.fullmatch(r'post-[a-zA-Z0-9-]+', sys.argv[3]): raise SystemExit('invalid wait target or capture')
    if len(sys.argv) == 5 and (not sys.argv[4].isdigit() or not 1 <= int(sys.argv[4]) <= 180): raise SystemExit('invalid wait bound')
else:
    raise SystemExit('unknown mode')
if mode == 'start':
    case, prompt = sys.argv[2:4]
    wait('What should it do?', 15)
    action('tap', 'Describe an app…')
    adb('shell', 'input', 'text', shlex.quote(prompt.replace(' ', '%s')))
    capture(case + '-prompt')
    action('tap', 'Continue')
    wait('How much should it hold?', 30)
    action('tap', 'Just today')
    action('tap', 'Type it')
    action('tap', 'It stays, ticked')
    action('tap', 'Continue')
    wait('Build it', 30)
    capture(case + '-plan')
    if len(sys.argv) > 4 and sys.argv[4] == 'plan-only': raise SystemExit(0)
    action('tap', 'Build it')
    wait('Making it', 15)
    capture(case + '-building')
elif mode == 'wait':
    wait(sys.argv[2], int(sys.argv[4]) if len(sys.argv) > 4 else 120)
    capture(sys.argv[3])
