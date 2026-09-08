#!/usr/bin/env bash
set -eu
release_apk="dist/Xgent-${XGENT_RELEASE_TAG}-Android-universal.apk"
adb logcat -c
adb install -r "$release_apk"
adb shell monkey -p com.ohi.xgent -c android.intent.category.LAUNCHER 1
sleep 12
app_pid="$(adb shell pidof com.ohi.xgent | tr -d '\r')"
test -n "$app_pid"
adb shell dumpsys window windows | grep -F 'com.ohi.xgent'
adb exec-out screencap -p > "$RUNNER_TEMP/xgent-android-smoke.png"
test "$(wc -c < "$RUNNER_TEMP/xgent-android-smoke.png")" -gt 10000
if adb logcat -d AndroidRuntime:E '*:S' \
  | grep -E -A 12 'Process: com\.ohi\.xgent'; then
  echo "Xgent emitted an Android fatal exception during launch" >&2
  exit 1
fi
