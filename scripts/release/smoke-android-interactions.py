"""Exercise the installed APK through accessibility and real touch input."""
import os
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

evidence = Path(os.environ["RUNNER_TEMP"])


def adb(*args):
    return subprocess.check_output(["adb", *args], timeout=30)


def snapshot():
    adb("shell", "uiautomator", "dump", "/sdcard/xgent-interactions.xml")
    data = adb("exec-out", "cat", "/sdcard/xgent-interactions.xml")
    (evidence / "xgent-android-interactions.xml").write_bytes(data)
    return ET.fromstring(data)


def matches(node, labels):
    return any(node.get(key, "").strip() in labels for key in ("text", "content-desc"))


def tap(labels, timeout=30, scroll=False):
    deadline = time.monotonic() + timeout
    swipes = 0
    size = adb("shell", "wm", "size").decode()
    width, height = map(int, re.findall(r"(\d+)x(\d+)", size)[-1])
    while time.monotonic() < deadline:
        for node in snapshot().iter("node"):
            if node.get("enabled") != "true" or not matches(node, labels):
                continue
            bounds = list(map(int, re.findall(r"-?\d+", node.get("bounds", ""))))
            if len(bounds) != 4:
                continue
            left, top = max(0, bounds[0]), max(0, bounds[1])
            right, bottom = min(width, bounds[2]), min(height, bounds[3])
            if right > left and bottom > top:
                adb("shell", "input", "tap", str((left + right) // 2), str((top + bottom) // 2))
                time.sleep(1)
                return
        if scroll and swipes < 6:
            adb("shell", "input", "swipe", str(width // 2), str(height * 3 // 4),
                str(width // 2), str(height // 3), "400")
            swipes += 1
        time.sleep(1)
    raise AssertionError(f"No enabled visible control: {labels}")


def tap_terminal_input(timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for panel in snapshot().iter("node"):
            if panel.get("class") != "android.view.View" or not matches(
                panel, {"移动终端", "Mobile terminal"}
            ):
                continue
            for node in panel.iter("node"):
                if node.get("class") != "android.widget.EditText" or node.get("enabled") != "true":
                    continue
                bounds = list(map(int, re.findall(r"\d+", node.get("bounds", ""))))
                if len(bounds) == 4 and bounds[2] > bounds[0] and bounds[3] > bounds[1]:
                    adb(
                        "shell", "input", "tap",
                        str((bounds[0] + bounds[2]) // 2),
                        str((bounds[1] + bounds[3]) // 2),
                    )
                    return
        time.sleep(1)
    raise AssertionError("No enabled visible terminal command input")


def capture(name):
    (evidence / f"xgent-android-{name}.png").write_bytes(adb("exec-out", "screencap", "-p"))


# These labels come from the same zh/en dictionaries as the installed controls.
tap({"打开边栏", "Open Sidebar"})
tap({"设置", "Settings"})
capture("settings")
tap({"返回对话", "Back to Chat"})
tap({"工作工具", "Workspace tools"})
tap({"Shell 管理", "Shell management"})
tap({"刷新状态", "Refresh status"})
capture("shell-settings")
nodes = list(snapshot().iter("node"))
if any(matches(node, {"安装基础环境", "Install base environment"}) for node in nodes):
    tap({"安装基础环境", "Install base environment"})
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        nodes = list(snapshot().iter("node"))
        if any(matches(node, {"已就绪", "Ready"}) for node in nodes):
            break
        time.sleep(2)
    else:
        raise AssertionError("The bundled Shell environment did not become ready")
# Wait for the install/refresh action to finish, then install actual packages
# through the Android settings controls. A ready rootfs only contains BusyBox.
tap({"刷新状态", "Refresh status"}, timeout=300)
tap({"Linux essentials"}, scroll=True)
tap({"Python and pip"}, scroll=True)
tap({"安装所选能力包", "Install selected packs"}, scroll=True)
tap({"返回设置", "Back to Settings"}, timeout=300)
tap({"返回对话", "Back to Chat"})
tap({"工作工具", "Workspace tools"})
tap({"打开终端", "Open terminal"})


def run_terminal(command, expected_output=None, expected_exit=0, clear=True, exact=True):
    if clear:
        tap({"清空终端记录", "Clear terminal history"})
    tap_terminal_input()
    adb("shell", "input", "text", command.replace(" ", "%s"))
    tap({"运行命令", "Run command"})
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        nodes = list(snapshot().iter("node"))
        exit_codes = [
            int(match.group(1))
            for node in nodes for key in ("text", "content-desc")
            if (match := re.fullmatch(r"(?:退出码：|Exit code: )(-?\d+)", node.get(key, "").strip()))
        ]
        returned = any(code != 0 for code in exit_codes) if expected_exit is None else expected_exit in exit_codes
        if returned:
            if expected_output is not None:
                outputs = [
                    node.get(key, "")[len("stdout:\n"):].strip()
                    for node in nodes for key in ("text", "content-desc")
                    if node.get(key, "").startswith("stdout:\n")
                ]
                assert any(
                    output == expected_output if exact else expected_output in output
                    for output in outputs
                ), f"The native Shell must expose actual stdout for {command!r}"
            return
        time.sleep(1)
    capture("shell-failure")
    raise AssertionError(f"The native Shell did not return exit code {expected_exit}: {command!r}")


run_terminal("printf xgent-shell-ok", "xgent-shell-ok", clear=False)
capture("shell-result")
run_terminal("cd /etc", "/etc")
run_terminal("ls apk", "repositories", exact=False)
run_terminal("cd ..", "/")
run_terminal("pwd", "/")
run_terminal("cd -", "/etc")
run_terminal("cd /xgent-definitely-missing", expected_exit=None)
run_terminal("pwd", "/etc")
capture("rootfs-navigation")
run_terminal("cd /workspace", "/workspace")
run_terminal("pwd", "/workspace")
run_terminal("bash --version", "GNU bash", exact=False)
run_terminal("python3 --version", "Python 3.", exact=False)
run_terminal("python3 -m pip --version", "pip ", exact=False)
capture("python-pack")
print("PASS: settings, bundled environment, native stdout, rootfs ls/cd, retained cwd, Bash and installed Python/pip pack")
