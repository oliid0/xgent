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


def tap(labels, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for node in snapshot().iter("node"):
            if node.get("enabled") != "true" or not matches(node, labels):
                continue
            bounds = list(map(int, re.findall(r"\d+", node.get("bounds", ""))))
            if len(bounds) == 4 and bounds[2] > bounds[0] and bounds[3] > bounds[1]:
                adb("shell", "input", "tap", str((bounds[0] + bounds[2]) // 2), str((bounds[1] + bounds[3]) // 2))
                time.sleep(1)
                return
        time.sleep(1)
    raise AssertionError(f"No enabled visible control: {labels}")


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
tap({"返回设置", "Back to Settings"})
tap({"返回对话", "Back to Chat"})
tap({"工作工具", "Workspace tools"})
tap({"打开终端", "Open terminal"})
tap({"输入命令", "Enter a command"})
adb("shell", "input", "text", "printf%sxgent-shell-ok")
tap({"运行命令", "Run command"})
deadline = time.monotonic() + 45
while time.monotonic() < deadline:
    nodes = list(snapshot().iter("node"))
    if any(matches(node, {"退出码：0", "Exit code: 0"}) for node in nodes):
        break
    time.sleep(1)
else:
    raise AssertionError("The native Shell did not return exit code zero")
capture("shell-result")
print("PASS: sidebar, settings, Shell management, bundled environment, native command execution")
