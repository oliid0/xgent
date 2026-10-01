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
