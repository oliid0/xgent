import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("Android smoke input preserves shell syntax as one remote text argument", () => {
  const script = fileURLToPath(new URL("../../../../scripts/release/smoke-android-interactions.py", import.meta.url));
  const result = spawnSync(process.platform === "win32" ? "python" : "python3", ["-c", String.raw`
import ast, pathlib, shlex, sys
tree = ast.parse(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'type_text')
calls = []
namespace = {'shlex': shlex, 'adb': lambda *args: calls.append(args)}
exec(compile(ast.Module(body=[function], type_ignores=[]), sys.argv[1], 'exec'), namespace)
values = ['printf xgent-shell-ok', 'read answer; printf "xgent-input-$answer"',
          "printf 'quoted value' && cat /etc/os-release", 'echo $(pwd) > output', 'ready']
for value in values:
    namespace['type_text'](value)
    args = calls.pop()
    assert args[:3] == ('shell', 'input', 'text')
    remote = shlex.split(' '.join(args[1:]))
    assert len(remote) == 3, remote
    assert remote[:2] == ['input', 'text']
    assert remote[2].replace('%s', ' ') == value, remote
for node in ast.walk(tree):
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == 'run_terminal':
        value = node.args[0]
        if isinstance(value, ast.Constant) and isinstance(value.value, str):
            assert '%s' not in value.value, 'Android input text reserves %s for spaces'
`, script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("Android terminal input waits for focused stable bounds and rejects lost keys before execution", () => {
  const script = fileURLToPath(new URL("../../../../scripts/release/smoke-android-interactions.py", import.meta.url));
  const result = spawnSync(process.platform === "win32" ? "python" : "python3", ["-c", String.raw`
import ast, pathlib, re, sys, xml.etree.ElementTree as ET
tree = ast.parse(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
names = {'matches', 'terminal_inputs', 'tap_terminal_input', 'enter_terminal_text'}
functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
class Clock:
    now = 0
    def monotonic(self): return self.now
    def sleep(self, duration): self.now += duration
clock = Clock()
calls, captures, typed = [], [], []
def frame(focused='false', bounds='[10,700][310,744]', text='', disabled_command=False):
    root = ET.Element('hierarchy')
    # The background composer and disabled command are not the terminal input.
    ET.SubElement(root, 'node', {'class':'android.widget.EditText', 'enabled':'true', 'focused':'true', 'text':'background'})
    panel = ET.SubElement(root, 'node', {'class':'android.view.View', 'content-desc':'Mobile terminal'})
    if disabled_command:
        ET.SubElement(panel, 'node', {'class':'android.widget.EditText', 'enabled':'false', 'text':'command'})
    ET.SubElement(panel, 'node', {'class':'android.widget.EditText', 'enabled':'true', 'focused':focused, 'bounds':bounds, 'text':text})
    return root
frames = []
def snapshot():
    if len(frames) > 1: return frames.pop(0)
    return frames[0]
namespace = {'re':re, 'time':clock, 'snapshot':snapshot, 'adb':lambda *args:calls.append(args),
             'capture':captures.append, 'type_text':typed.append}
exec(compile(ast.Module(body=functions, type_ignores=[]), sys.argv[1], 'exec'), namespace)
frames[:] = [frame(), frame(), frame('true'), frame('true','[10,420][310,464]'),
             frame('true','[10,420][310,464]'), frame('true',text='printf xgent-shell-ok')]
namespace['enter_terminal_text']('printf xgent-shell-ok')
assert clock.now >= 1, 'Typing must wait through focus and the keyboard resize'
assert len(calls) == 1 and calls[0][2] == 'tap', calls
assert typed == ['printf xgent-shell-ok'] and not captures
# A live stdin input is chosen while the command field is disabled.
frames[:] = [frame('true', text='ready', disabled_command=True)]
namespace['enter_terminal_text']('ready')
assert typed[-1] == 'ready'
# Missing focus must never inject text.
frames[:] = [frame()]
count = len(typed)
try: namespace['tap_terminal_input'](timeout=1)
except AssertionError as error: assert 'focus' in str(error)
else: raise AssertionError('An unfocused input cannot be accepted')
assert len(typed) == count
# Preserve the observed lost-first-character failure instead of silently
# retyping, running it, or reporting a Shell exit-code failure.
frames[:] = [frame('true', text='rintf xgent-shell-ok')]
try: namespace['enter_terminal_text']('printf xgent-shell-ok', timeout=1)
except AssertionError as error:
    assert 'rintf xgent-shell-ok' in str(error) and 'input mismatch' in str(error)
else: raise AssertionError('Lost input must fail before Run command')
assert typed.count('printf xgent-shell-ok') == 2, 'The failing input is typed once only'
assert captures[-1] == 'terminal-input-mismatch'
`, script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});


test("Android snapshots never reuse a stale XML after a successful-exit dump with no root", () => {
  const script = fileURLToPath(new URL("../../../../scripts/release/smoke-android-interactions.py", import.meta.url));
  const result = spawnSync(process.platform === "win32" ? "python" : "python3", ["-c", String.raw`
import ast, pathlib, subprocess, sys, tempfile, xml.etree.ElementTree as ET
from types import SimpleNamespace
tree = ast.parse(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'snapshot')
calls, captures, delays = [], [], []
state = {'data': b'<hierarchy><node text="stale"/></hierarchy>', 'dumps': 0, 'fail': False}
def adb(*args):
    calls.append(args)
    if args[1] == 'rm': state['data'] = None; return b''
    if args[1] == 'uiautomator':
        state['dumps'] += 1
        if state['dumps'] > 1 and not state['fail']: state['data'] = b'<hierarchy><node text="fresh"/></hierarchy>'
        return b''  # AOSP returns normally even when it wrote no hierarchy.
    if state['data'] is None: raise subprocess.CalledProcessError(1, args)
    return state['data']
with tempfile.TemporaryDirectory() as directory:
    namespace = {'adb': adb, 'ET': ET, 'subprocess': subprocess, 'time': SimpleNamespace(sleep=delays.append), 'evidence': pathlib.Path(directory), 'capture': captures.append}
    exec(compile(ast.Module(body=[function], type_ignores=[]), sys.argv[1], 'exec'), namespace)
    root = namespace['snapshot']()
    assert [node.get('text') for node in root.iter('node')] == ['fresh']
    assert calls[0] == ('shell', 'rm', '-f', '/sdcard/xgent-interactions.xml')
    assert len([c for c in calls if c[1] == 'rm']) == 2
    assert not captures
    state['fail'] = True
    try: namespace['snapshot']()
    except AssertionError as error: assert 'fresh Android hierarchy' in str(error)
    else: raise AssertionError('Repeated null-root dumps must fail instead of accepting stale XML')
    assert captures == ['accessibility-unavailable']
`, script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("busy installation recovers fresh hierarchy beyond four attempts within its original deadline", () => {
  const script = fileURLToPath(new URL("../../../../scripts/release/smoke-android-interactions.py", import.meta.url));
  const result = spawnSync(process.platform === "win32" ? "python" : "python3", ["-c", String.raw`
import ast, pathlib, subprocess, sys, tempfile, xml.etree.ElementTree as ET
tree = ast.parse(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'snapshot')
class Clock:
    now = 0
    def monotonic(self): return self.now
    def sleep(self, duration): self.now += duration
clock = Clock()
state = {'dumps': 0, 'data': b'<hierarchy><node text="stale"/></hierarchy>', 'fail': False}
captures, timeouts = [], []
def adb(*args, timeout=30):
    assert 0 < timeout <= min(30, deadline - clock.now), 'ADB must use the remaining deadline'
    timeouts.append(timeout)
    clock.sleep(min(0.1, timeout))
    if args[1] == 'rm': state['data'] = None; return b''
    if args[1] == 'uiautomator':
        state['dumps'] += 1
        if state['dumps'] > 5 and not state['fail']:
            state['data'] = b'<hierarchy><node text="(1/76) Installing ncurses"/></hierarchy>'
        return b''
    return state['data'] or b'cat: No such file or directory'
with tempfile.TemporaryDirectory() as directory:
    namespace = {'adb':adb, 'ET':ET, 'subprocess':subprocess, 'time':clock,
                 'evidence':pathlib.Path(directory), 'capture':captures.append}
    exec(compile(ast.Module(body=[function], type_ignores=[]), sys.argv[1], 'exec'), namespace)
    deadline = 10
    root = namespace['snapshot'](deadline=deadline)
    assert state['dumps'] == 6 and clock.now < deadline
    assert root.find('node').get('text') == '(1/76) Installing ncurses'
    assert not captures
    state['fail'] = True
    deadline = clock.now + 1
    try: namespace['snapshot'](deadline=deadline)
    except AssertionError as error: assert 'fresh Android hierarchy' in str(error)
    else: raise AssertionError('A busy installer must still fail when its existing deadline expires')
    assert clock.now <= deadline and captures == ['accessibility-unavailable']
    assert max(timeouts) <= 10
`, script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
