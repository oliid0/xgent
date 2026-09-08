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
adb install -r "$release_apk"
adb shell monkey -p com.ohi.xgent -c android.intent.category.LAUNCHER 1
sleep 5
app_pid="$(adb shell pidof com.ohi.xgent | tr -d '\r')"
test -n "$app_pid"
adb shell dumpsys window windows | grep -F 'com.ohi.xgent'
composer=""
for attempt in $(seq 1 12); do
  adb shell uiautomator dump /sdcard/xgent-ui.xml >/dev/null 2>&1 || true
  adb pull /sdcard/xgent-ui.xml "$RUNNER_TEMP/xgent-android-ui.xml" >/dev/null 2>&1 || true
  composer="$(python3 - "$RUNNER_TEMP/xgent-android-ui.xml" <<'PY'
import re, sys, xml.etree.ElementTree as ET
try:
    root = ET.parse(sys.argv[1]).getroot()
except (OSError, ET.ParseError):
    raise SystemExit(0)
for node in root.iter('node'):
    if node.get('class') != 'android.widget.EditText' or node.get('enabled') != 'true':
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
if adb logcat -d AndroidRuntime:E '*:S' \
  | grep -E -A 12 'Process: com\.ohi\.xgent'; then
  echo "Xgent emitted an Android fatal exception during launch" >&2
  exit 1
fi
