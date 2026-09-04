import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const repoRoot = path.resolve(frontendRoot, "../..");
const workflow = readFileSync(
  path.join(repoRoot, ".github/workflows/desktop-release.yml"),
  "utf8",
).replace(/\r\n?/g, "\n");
const iosProjectTemplate = readFileSync(
  path.join(repoRoot, "crates/fronted/src-tauri/ios.project.yml"),
  "utf8",
).replace(/\r\n?/g, "\n");
const iosConfig = JSON.parse(
  readFileSync(path.join(repoRoot, "crates/fronted/src-tauri/tauri.ios.conf.json"), "utf8"),
);
const iosPlugin = readFileSync(
  path.join(repoRoot, "crates/mobile-execution/ios/Sources/MobileExecutionPlugin.swift"),
  "utf8",
);
const iosPackage = readFileSync(
  path.join(repoRoot, "crates/mobile-execution/ios/Package.swift"),
  "utf8",
);
const androidRootfsPreparation = readFileSync(
  path.join(repoRoot, "scripts/mobile/prepare-alpine-rootfs-android.sh"),
  "utf8",
);
const windowsBrowserBackend = readFileSync(
  path.join(repoRoot, "crates/browser-automation/src/desktop.rs"),
  "utf8",
);
const windowsLaunchSmoke = readFileSync(
  path.join(repoRoot, "scripts/release/smoke-launch-windows.ps1"),
  "utf8",
);
const desktopHost = readFileSync(
  path.join(repoRoot, "crates/fronted/src-tauri/src/lib.rs"),
  "utf8",
);

function jobSource(name, nextName) {
  const start = workflow.indexOf(`  ${name}:\n`);
  const end = workflow.indexOf(`  ${nextName}:\n`, start + 1);
  assert.notEqual(start, -1, `missing ${name} job`);
  assert.notEqual(end, -1, `missing ${nextName} job after ${name}`);
  return workflow.slice(start, end);
}

test("manual release separates packaging, publishing, and signing", () => {
  assert.match(
    workflow,
    /publish:\s*\n\s+description: Publish the packages as a GitHub Release\s*\n\s+required: false\s*\n\s+type: boolean\s*\n\s+default: false/,
  );
  assert.match(
    workflow,
    /sign:\s*\n\s+description:.*requires release settings\)\s*\n\s+required: false\s*\n\s+type: boolean\s*\n\s+default: false/,
  );

  const metadata = jobSource("release-metadata", "release-preflight");
  assert.match(metadata, /publish_release: \$\{\{ steps\.mode\.outputs\.publish_release \}\}/);
  assert.match(metadata, /signed_release: \$\{\{ steps\.mode\.outputs\.signed_release \}\}/);
  assert.match(metadata, /PUBLISH_RELEASE: \$\{\{ github\.event_name == 'push' \|\| inputs\.publish \}\}/);
  assert.match(metadata, /SIGNED_RELEASE: \$\{\{ inputs\.sign \|\|/);

  const preflight = jobSource("release-preflight", "macos");
  assert.match(
    preflight,
    /SIGNED_RELEASE: \$\{\{ needs\.release-metadata\.outputs\.signed_release \}\}/,
  );
  assert.match(preflight, /if: env\.SIGNED_RELEASE != 'true'/);
  assert.match(preflight, /if: env\.SIGNED_RELEASE == 'true'/);

  for (const secret of [
    "APPLE_CERTIFICATE_P12_BASE64",
    "APPLE_CERTIFICATE_PASSWORD",
    "APPLE_ID",
    "APPLE_TEAM_ID",
    "APPLE_APP_SPECIFIC_PASSWORD",
    "TAURI_SIGNING_PRIVATE_KEY",
    "TAURI_UPDATER_PUBLIC_KEY",
  ]) {
    assert.match(preflight, new RegExp(`\\b${secret}\\b`));
  }
  assert.match(workflow, /echo "APPLE_SIGNING_IDENTITY=\$signing_identity" >> "\$GITHUB_ENV"/);
  assert.doesNotMatch(workflow, /secrets\.APPLE_SIGNING_IDENTITY/);
  assert.match(preflight, /APPLE_ID: \$\{\{ vars\.APPLE_ID \}\}/);
  assert.match(preflight, /APPLE_TEAM_ID: \$\{\{ vars\.APPLE_TEAM_ID \}\}/);
  assert.match(
    preflight,
    /TAURI_UPDATER_PUBLIC_KEY: \$\{\{ vars\.TAURI_UPDATER_PUBLIC_KEY \}\}/,
  );
});

test("every platform has signed and package-only build paths", () => {
  const macos = jobSource("macos", "windows");
  const windows = jobSource("windows", "linux");
  const linux = jobSource("linux", "publish");

  for (const [platform, source] of [
    ["macOS", macos],
    ["Windows", windows],
    ["Linux", linux],
  ]) {
    assert.match(source, /release-preflight/, `${platform} must depend on preflight`);
    assert.match(source, /if: env\.SIGNED_RELEASE == 'true'/);
    assert.match(source, /if: env\.SIGNED_RELEASE != 'true'/);
  }

  assert.match(
    linux,
    /bash scripts\/release\/postprocess-linux-appimage\.sh/,
    "Linux post-processing must not depend on the checkout preserving executable bits",
  );
});

test("only the publish job receives repository write permission", () => {
  const beforePublish = workflow.slice(0, workflow.indexOf("  publish:\n"));
  const publish = workflow.slice(workflow.indexOf("  publish:\n"));

  assert.doesNotMatch(beforePublish, /contents: write/);
  assert.match(publish, /permissions:\s*\n\s+contents: write/);
  assert.match(
    publish,
    /if: \$\{\{ needs\.release-metadata\.outputs\.publish_release == 'true' \}\}/,
  );
  assert.match(publish, /create_args=\(--draft --target "\$RELEASE_SHA"/);
  assert.match(publish, /publish_args=\(--draft=false/);
  assert.match(publish, /-f target_commitish="\$RELEASE_SHA"/);
  assert.match(publish, /if \[ "\$SIGNED_RELEASE" = true \]; then/);
  assert.match(publish, /gh release delete-asset "\$RELEASE_TAG" latest\.json --yes/);
});

test("iOS project template preserves the pre-build script YAML boundary", () => {
  assert.match(
    iosProjectTemplate,
    /preBuildScripts:\n\s+\{\{~#each ios-pre-build-scripts\}\}[\s\S]*?\{\{~\/each\}\}\n\n\s+- script:/,
  );
});

test("iOS release prepares host tools and every target before Tauri initialization", () => {
  const ios = jobSource("ios", "publish");
  assert.match(
    ios,
    /targets: aarch64-apple-ios,x86_64-apple-ios,aarch64-apple-ios-sim/,
  );
  assert.match(ios, /for formula in xcodegen libimobiledevice cocoapods/);
  assert.match(ios, /brew link --overwrite --force xcodegen libimobiledevice cocoapods/);
  assert.match(ios, /command -v xcodegen/);
  assert.match(ios, /command -v idevicesyslog/);
  assert.match(ios, /command -v pod/);

  const dependencyStep = ios.indexOf("Install Tauri iOS host dependencies");
  const initStep = ios.indexOf("Initialize Tauri iOS project");
  assert.ok(dependencyStep >= 0 && dependencyStep < initStep);
});

test("release packaging preserves native runtime resources without ABI drift", () => {
  assert.equal(
    iosConfig.bundle.resources["../../mobile-execution/ios/Sources/Resources/"],
    "mobile-execution/",
  );
  assert.match(iosPlugin, /private func bundledResourcesURL\(\) -> URL\?/);
  assert.match(
    iosPlugin,
    /Bundle\.main\.resourceURL[\s\S]*?appendingPathComponent\("assets", isDirectory: true\)[\s\S]*?bundledResourceDirectoryName/,
  );
  assert.doesNotMatch(iosPlugin, /Bundle\.module/);
  assert.doesNotMatch(iosPackage, /resources:\s*\[/);
  assert.match(iosPackage, /exclude: \["Resources"\]/);

  assert.match(androidRootfsPreparation, /\.tar\.gzip/);
  assert.doesNotMatch(androidRootfsPreparation, /android_abi\}\.tar\.gz"/);
  assert.match(workflow, /payload\.startswith\(b"\\x1f\\x8b"\)/);
  assert.match(workflow, /assets\/mobile-execution\/commandDictionary\.plist/);

  assert.match(windowsBrowserBackend, /core\.CanGoForward\(&mut value\)\?/);
  assert.match(windowsBrowserBackend, /core\.CanGoBack\(&mut value\)\?/);
  assert.match(windowsBrowserBackend, /CapturePreviewCompletedHandler/);
  assert.match(windowsBrowserBackend, /\.CapturePreview\(/);
  assert.doesNotMatch(windowsBrowserBackend, /"Page\.captureScreenshot"/);
  assert.match(windowsBrowserBackend, /CallDevToolsProtocolMethodCompletedHandler/);
  assert.match(windowsBrowserBackend, /\.CallDevToolsProtocolMethod\(/);
  assert.match(windowsBrowserBackend, /"Input\.dispatchMouseEvent"/);
  assert.match(windowsBrowserBackend, /"Input\.dispatchKeyEvent"/);
  assert.match(
    windowsBrowserBackend,
    /"automationTransport"\.to_string\(\),\s*json!\("webview2-cdp"\)/,
  );
  assert.match(windowsBrowserBackend, /json!\("webview2-dom-fallback"\)/);
  assert.match(windowsBrowserBackend, /timeout\.saturating_sub\(started\.elapsed\(\)\)/);
  const openSession = windowsBrowserBackend.slice(
    windowsBrowserBackend.indexOf("pub fn open_session"),
    windowsBrowserBackend.indexOf("pub fn list_sessions"),
  );
  assert.doesNotMatch(openSession, /webview\.reload\(\)/);
  assert.doesNotMatch(windowsBrowserBackend, /use windows::Win32::Foundation::BOOL/);
});

test("release jobs smoke launch every newly repaired application target", () => {
  const windows = jobSource("windows", "linux");
  const android = jobSource("android", "ios");
  const ios = jobSource("ios", "publish");

  assert.match(windows, /scripts\/release\/smoke-launch-windows\.ps1/);
  assert.match(windowsLaunchSmoke, /Start-Process[\s\S]*-WindowStyle Hidden/);
  assert.match(windowsLaunchSmoke, /Portable Xgent exited during the launch smoke test/);
  assert.match(windowsLaunchSmoke, /finally[\s\S]*Stop-Process/);
  assert.match(android, /android-emulator-runner@a421e43855164a8197daf9d8d40fe71c6996bb0d/);
  assert.match(android, /adb shell pidof com\.ohi\.xgent/);
  assert.match(android, /adb logcat -d AndroidRuntime:E '\*:S'/);
  assert.match(android, /xgent-android-launch-evidence/);
  assert.match(ios, /--target aarch64-sim/);
  assert.match(ios, /xcrun simctl launch --terminate-running-process/);
  assert.match(ios, /xcrun simctl spawn "\$simulator_udid" ps -p "\$app_pid"/);
  assert.match(ios, /xgent-ios-launch-evidence/);
  assert.match(workflow, /! -name '\*-smoke\.png'/);
});

test("desktop tray click and menu actions can always reveal the main window", () => {
  const showMainWindow = desktopHost.slice(
    desktopHost.indexOf("fn show_main_window"),
    desktopHost.indexOf("fn request_app_exit"),
  );
  assert.doesNotMatch(showMainWindow, /FrontendReadyState/);
  assert.match(showMainWindow, /window\.show\(\)\?[\s\S]*?window\.unminimize\(\)\?[\s\S]*?window\.set_focus\(\)\?/);
  assert.match(desktopHost, /button_state: MouseButtonState::Up/);
  assert.doesNotMatch(desktopHost, /button_state: MouseButtonState::Down/);
  assert.match(desktopHost, /on_menu_event\([\s\S]*?dispatch_app_action\(app, action\)/);
});
