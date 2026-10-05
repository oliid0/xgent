"""Exercise the installed APK through accessibility and real touch input."""
import os
import re
import shlex
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

evidence = Path(os.environ["RUNNER_TEMP"])


def adb(*args):
    return subprocess.check_output(["adb", *args], timeout=30)


def type_text(value):
    # adb shell joins these arguments into a remote shell command. Quote the
    # complete input payload so ;, $, quotes and redirects reach the text field.
    adb("shell", "input", "text", shlex.quote(value.replace(" ", "%s")))


def snapshot():
    adb("shell", "uiautomator", "dump", "/sdcard/xgent-interactions.xml")
    data = adb("exec-out", "cat", "/sdcard/xgent-interactions.xml")
    (evidence / "xgent-android-interactions.xml").write_bytes(data)
    return ET.fromstring(data)


def matches(node, labels):
    return any(node.get(key, "").strip() in labels for key in ("text", "content-desc"))


def tap(labels, timeout=30, scroll=False, scroll_direction="down"):
    deadline = time.monotonic() + timeout
    swipes = 0
    size = adb("shell", "wm", "size").decode()
    width, height = map(int, re.findall(r"(\d+)x(\d+)", size)[-1])
    while time.monotonic() < deadline:
        nodes = list(snapshot().iter("node"))
        # WebView reports controls underneath the fixed settings header as
        # visible. Tapping their reported center instead hits the header.
        header_bottom = max(
            (int(bounds[3]) for node in nodes
             if matches(node, {"返回设置", "Back to Settings"})
             if len(bounds := list(map(int, re.findall(r"-?\d+", node.get("bounds", ""))))) == 4),
            default=0,
        )
        obscured_above = False
        for node in nodes:
            if node.get("enabled") != "true" or not matches(node, labels):
                continue
            bounds = list(map(int, re.findall(r"-?\d+", node.get("bounds", ""))))
            if len(bounds) != 4:
                continue
            left, top = max(0, bounds[0]), max(0, bounds[1])
            right, bottom = min(width, bounds[2]), min(height, bounds[3])
            if (header_bottom and top < header_bottom + 12
                    and not matches(node, {"返回设置", "Back to Settings"})):
                obscured_above = True
                continue
            if right > left and bottom > top:
                adb("shell", "input", "tap", str((left + right) // 2), str((top + bottom) // 2))
                time.sleep(1)
                return
        if scroll and swipes < 12:
            start_y, end_y = (
                (height // 3, height * 3 // 4)
                if obscured_above or scroll_direction == "up"
                else (height * 3 // 4, height // 3)
            )
            adb("shell", "input", "swipe", str(width // 2), str(start_y),
                str(width // 2), str(end_y), "400")
            swipes += 1
        time.sleep(1)
    capture("missing-control")
    visible = [node.get("text", "") for node in snapshot().iter("node") if node.get("text")]
    raise AssertionError(f"No enabled visible control: {labels}; visible state: {visible[-30:]}")


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
tap({"关闭", "Close"})
tap({"工作工具", "Workspace tools"})
tap({"Shell 管理", "Shell management"})
tap({"刷新状态", "Refresh status"}, scroll=True)
capture("shell-settings")
nodes = list(snapshot().iter("node"))
if any(matches(node, {"安装基础环境", "Install base environment"}) for node in nodes):
    tap({"安装基础环境", "Install base environment"}, scroll=True)
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        nodes = list(snapshot().iter("node"))
        if any(matches(node, {"已就绪", "Ready"}) for node in nodes):
            break
        time.sleep(2)
    else:
        capture("install-not-ready")
        visible = [node.get("text", "") for node in snapshot().iter("node") if node.get("text")]
        print("Shell installation did not become ready; visible state:", visible[-30:])
        raise AssertionError("The bundled Shell environment did not become ready")
# Wait for the install/refresh action to finish, then install actual packages
# through the Android settings controls. A ready rootfs only contains BusyBox.
capture("shell-ready")
tap({"浏览 Shell 文件", "Browse Shell files"}, timeout=300)
tap({"etc"})
tap({"alpine-release", "alpine-release etc/alpine-release"}, scroll=True)
deadline = time.monotonic() + 30
while time.monotonic() < deadline:
    if any(re.search(r"\b3\.\d+\.\d+\b", node.get("text", "")) for node in snapshot().iter("node")):
        break
    time.sleep(1)
else:
    capture("shell-file-preview-failed")
    raise AssertionError("The installed Alpine version file must be readable")
capture("shell-file-preview")
tap({"返回文件列表", "Back to files"})
tap({"关闭文件浏览", "Close file browser"})
tap({"刷新状态", "Refresh status"}, timeout=300, scroll=True)
tap({"Linux essentials"}, scroll=True)
tap({"Python and pip"}, scroll=True)
tap({"安装所选能力包", "Install selected packs"}, scroll=True, scroll_direction="up")
time.sleep(3)
capture("package-install-progress")
deadline = time.monotonic() + 90
while time.monotonic() < deadline:
    output = [
        node.get(key, "")
        for node in snapshot().iter("node")
        for key in ("text", "content-desc")
    ]
    if any(
        "fetch https://" in value
        or re.search(r"\(\d+/\d+\) Installing", value)
        or "OK:" in value
        for value in output
    ):
        capture("package-install-output")
        break
    time.sleep(2)
else:
    capture("package-install-output-missing")
    raise AssertionError("The package installer did not expose APK output during or after installation")
tap({"返回设置", "Back to Settings"}, timeout=300)
tap({"关闭", "Close"})
tap({"工作工具", "Workspace tools"})
tap({"打开终端", "Open terminal"})


def run_terminal(command, expected_output=None, expected_exit=0, clear=True, exact=True,
                 program_input=None, eof=False):
    if clear:
        tap({"清空终端记录", "Clear terminal history"})
    tap_terminal_input()
    type_text(command)
    tap({"运行命令", "Run command"})
    if program_input is not None:
        tap_terminal_input()
        type_text(program_input)
        tap({"发送输入", "Send input"})
    if eof:
        tap({"结束输入（EOF）", "End input (EOF)"})
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
                    match.group(1).strip()
                    for node in nodes for key in ("text", "content-desc")
                    if (match := re.fullmatch(r"stdout:\s*(.*)", node.get(key, "").strip(), re.DOTALL))
                ]
                if expected_output == "":
                    # Empty stdout intentionally has no rendered CodeBlock.
                    # EOF must finish successfully without any visible output.
                    assert not any(outputs), f"Unexpected stdout for {command!r}: {outputs!r}"
                else:
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
run_terminal('read answer; printf "xgent-input-$answer"', "xgent-input-ready",
             program_input="ready")
capture("live-stdin")
run_terminal("cat", "", eof=True)
print("PASS: settings, bundled environment, native stdout, rootfs ls/cd, retained cwd, Bash, Python/pip, live stdin and EOF")
