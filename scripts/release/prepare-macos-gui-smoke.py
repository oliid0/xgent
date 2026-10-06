"""Check the macOS 26 Intel runner's IconServices before native UI testing.

Runner image regression: https://github.com/actions/runner-images/issues/14751
This is CI preparation, never part of the shipped application. Healthy agents
and other platforms are left alone. UI interaction assertions remain enabled.
"""
import os
import platform
import subprocess
import sys
from pathlib import Path


PROBE = """import AppKit
import Foundation
import UniformTypeIdentifiers
let image = NSWorkspace.shared.icon(for: UTType.plainText)
guard let data = image.tiffRepresentation, !data.isEmpty else { exit(2) }
print("IconServices probe ready")
"""


def prepare(environ=None, system=None, machine=None, version=None, run=None, uid=None):
    environ = os.environ if environ is None else environ
    system = platform.system() if system is None else system
    machine = platform.machine() if machine is None else machine
    version = platform.mac_ver()[0] if version is None else version
    if (environ.get("GITHUB_ACTIONS") != "true" or system != "Darwin"
            or machine != "x86_64" or version.split(".")[0] != "26"):
        print("IconServices preparation: unaffected environment")
        return
    run = subprocess.run if run is None else run
    uid = os.getuid() if uid is None else uid
    evidence = Path(environ["RUNNER_TEMP"])
    log = evidence / "xgent-macos-iconservices.log"
    source = evidence / "xgent-macos-icon-probe.swift"
    binary = evidence / "xgent-macos-icon-probe"
    source.write_text(PROBE, encoding="utf-8")

    def command(args, timeout):
        with log.open("a", encoding="utf-8") as stream:
            stream.write(f"Command: {args!r}\n")
            try:
                result = run(args, capture_output=True, text=True, timeout=timeout)
                stream.write(f"Exit: {result.returncode}\n{result.stdout or ''}\n{result.stderr or ''}\n")
                return result.returncode == 0
            except subprocess.TimeoutExpired:
                stream.write(f"Timed out after {timeout} seconds\n")
                return False

    # Compile separately: a slow compiler must not be diagnosed as a broken
    # icon daemon. Only the rendered image request has the short timeout.
    if not command(["xcrun", "swiftc", str(source), "-o", str(binary)], 120):
        raise RuntimeError("Could not compile the IconServices environment probe")
    if command([str(binary)], 15):
        print("IconServices preparation: healthy agent")
        return
    service = f"gui/{uid}/com.apple.iconservices.iconservicesagent"
    command(["launchctl", "print", service], 10)
    command(["log", "show", "--last", "5m", "--style", "compact", "--predicate",
             'process == "iconservicesagent"'], 15)
    # This disposable Intel VM can crash-loop the agent on Metal. Prevent
    # respawn and let AppKit use its generic fallback, then require the same
    # actual icon request to complete before running any application tests.
    command(["launchctl", "bootout", service], 15)
    if not command(["launchctl", "disable", service], 15):
        raise RuntimeError("Could not isolate the runner's broken IconServices agent")
    if not command([str(binary)], 15):
        raise RuntimeError("IconServices still hangs after CI preparation; see " + str(log))
    print("IconServices preparation: generic icon fallback verified on affected CI VM")


if __name__ == "__main__":
    try:
        prepare()
    except (OSError, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
