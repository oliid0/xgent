#!/usr/bin/env bash
set -eu
release_apk="dist/Xgent-${XGENT_RELEASE_TAG}-Android-universal.apk"
collect_evidence() {
  adb exec-out screencap -p > "$RUNNER_TEMP/xgent-android-smoke.png" || true
  adb logcat -d > "$RUNNER_TEMP/xgent-android-logcat.log" || true
  adb shell dumpsys webviewupdate > "$RUNNER_TEMP/xgent-android-webview.log" || true
}
trap collect_evidence EXIT
adb logcat -c
# Reduce software-renderer load before launching the application. Release #39
# was blocked by Pixel Launcher's ANR dialog at the emulator's 1440x3120 size.
adb shell wm size 1080x1920
adb shell wm density 420
adb install -r "$release_apk"
adb shell am start -W -n com.ohi.xgent/.MainActivity
sleep 5
app_pid="$(adb shell pidof com.ohi.xgent | tr -d '\r')"
test -n "$app_pid"
adb shell dumpsys window windows | grep -F 'com.ohi.xgent'
composer=""
for attempt in $(seq 1 12); do
  adb shell uiautomator dump /sdcard/xgent-ui.xml >/dev/null 2>&1 || true
  adb pull /sdcard/xgent-ui.xml "$RUNNER_TEMP/xgent-android-ui.xml" >/dev/null 2>&1 || true
  # These emulator setup/launcher ANRs obscure a healthy app. Never dismiss
  # an Xgent ANR: it must still fail the usability check below.
  if grep -F "Pixel Launcher isn't responding" "$RUNNER_TEMP/xgent-android-ui.xml" >/dev/null; then
    adb shell am force-stop com.google.android.apps.nexuslauncher
    adb shell am start -W -n com.ohi.xgent/.MainActivity
    sleep 2
    continue
  fi
  if grep -F "com.google.android.googlesdksetup isn't responding" "$RUNNER_TEMP/xgent-android-ui.xml" >/dev/null; then
    adb shell am force-stop com.google.android.googlesdksetup
    adb shell am start -W -n com.ohi.xgent/.MainActivity
    sleep 2
    continue
  fi
  composer="$(python3 - "$RUNNER_TEMP/xgent-android-ui.xml" <<'PY'
import re, sys, xml.etree.ElementTree as ET
try:
    root = ET.parse(sys.argv[1]).getroot()
except (OSError, ET.ParseError):
    raise SystemExit(0)
for node in root.iter('node'):
    if node.get('package') != 'com.ohi.xgent' or node.get('class') != 'android.widget.EditText' or node.get('enabled') != 'true':
        continue
    bounds = list(map(int, re.findall(r'\d+', node.get('bounds', ''))))
    if len(bounds) == 4 and bounds[2] > bounds[0] and bounds[3] > bounds[1]:
        print((bounds[0] + bounds[2]) // 2, (bounds[1] + bounds[3]) // 2)
        break
PY
)"
  if [ -n "$composer" ]; then break; fi
  sleep 5
done
if [ -z "$composer" ]; then
  echo "No visible enabled chat composer: the Android interface did not become usable" >&2
  adb logcat -d -s XgentStartup chromium RustStdoutStderr >&2
  exit 1
fi
read -r composer_x composer_y <<< "$composer"
adb exec-out screencap -p > "$RUNNER_TEMP/xgent-android-before-keyboard.png"
adb shell input tap "$composer_x" "$composer_y"
# Release .919 injected keys during IME activation (inactive InputConnection).
# Require keyboard focus before input; never repair or retry a partial draft.
input_ready=""
for attempt in $(seq 1 12); do
  adb shell uiautomator dump /sdcard/xgent-ui.xml >/dev/null 2>&1 || true
  adb pull /sdcard/xgent-ui.xml "$RUNNER_TEMP/xgent-android-ui.xml" >/dev/null 2>&1 || true
  adb logcat -d -s XgentViewport:I '*:S' > "$RUNNER_TEMP/xgent-android-viewport.log"
  input_ready="$(python3 - "$RUNNER_TEMP/xgent-android-ui.xml" "$RUNNER_TEMP/xgent-android-viewport.log" <<'PY'
import re, sys, xml.etree.ElementTree as ET
try:
    root = ET.parse(sys.argv[1]).getroot()
    viewport = open(sys.argv[2], encoding='utf-8').read()
except (OSError, ET.ParseError):
    raise SystemExit(0)
states = re.findall(r'ime=(true|false) visibleBottom=(\d+)', viewport)
if states and states[-1][0] == 'true':
    for node in root.iter('node'):
        if node.get('package') == 'com.ohi.xgent' and node.get('class') == 'android.widget.EditText' and node.get('focused') == 'true':
            print('ready')
            break
PY
)"
  if [ "$input_ready" = ready ]; then break; fi
  sleep 1
done
if [ "$input_ready" != ready ]; then
  echo "The chat editor did not retain keyboard focus" >&2
  exit 1
fi
adb shell input text xgent-smoke
sleep 1
adb shell uiautomator dump /sdcard/xgent-ui.xml >/dev/null
adb pull /sdcard/xgent-ui.xml "$RUNNER_TEMP/xgent-android-ui.xml" >/dev/null
grep -F 'xgent-smoke' "$RUNNER_TEMP/xgent-android-ui.xml" >/dev/null
adb logcat -d -s XgentViewport:I '*:S' > "$RUNNER_TEMP/xgent-android-viewport.log"
python3 - "$RUNNER_TEMP/xgent-android-ui.xml" "$RUNNER_TEMP/xgent-android-viewport.log" <<'PY'
import re, sys, xml.etree.ElementTree as ET
viewport = open(sys.argv[2], encoding='utf-8').read()
matches = re.findall(r'ime=true visibleBottom=(\d+)', viewport)
assert matches, 'No keyboard viewport evidence'
bottom = int(matches[-1])
editor = next(n for n in ET.parse(sys.argv[1]).iter('node') if n.get('text') == 'xgent-smoke')
x1, y1, x2, y2 = map(int, re.findall(r'\d+', editor.get('bounds', '')))
assert 0 <= y1 < y2 <= bottom, f'Composer is covered by keyboard: {y1}..{y2}, visible bottom {bottom}'
PY
adb exec-out screencap -p > "$RUNNER_TEMP/xgent-android-keyboard.png"
adb shell input keyevent KEYCODE_BACK
sleep 1
python3 scripts/release/smoke-android-interactions.py
if adb logcat -d AndroidRuntime:E '*:S' \
  | grep -E -A 12 'Process: com\.ohi\.xgent'; then
  echo "Xgent emitted an Android fatal exception during launch" >&2
  exit 1
fi
