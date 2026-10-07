# Current objective
Repair Apple CI/Release and align functional settings/sidebar/chat behavior and Astryx/SwiftUI visuals across platforms. No local build/dev/Cargo. Finish coherent fixes and non-Cargo checks before one push; avoid frequent CI.

## Completed
- Apple UI moved to src-tauri/apple; macOS CUA moved to crates/computer-use/macos; native directory and old build/workflow references removed.
- Provider diagnostics, RTL/selection, installed glyphs and mounted Skills sheets fixed; narrow/large-font Astryx screenshots inspected.
- macOS long-paste crash fixed at overlapping AppKit/custom undo ownership; physical paste/copy/undo/redo/teardown pass in CI #328.
- Composer images inside input, blue inline file/folder references and floating suggestions. Work grouping shares verified MCP identity/common intent, real details and status between both UIs.
- Functional browser landing actions, real copy/open/navigation, Review/Files shared data, rounded address controls. Bottom terminal uses real PTY/SwiftTerm sessions, bounds/resizing and keeps chat/browser above.
- XChat hides/guards agent workspace tools and panels while retaining the browser. System PowerShell banner/profile restored and PTY creation moved off the main thread; startup speed remains unmeasured.
- Removed geometry persistence/plugin; cleanup targets only exact obsolete geometry files and numeric migration copies. Unified .xgent storage, iOS sandbox migration and CUA preferences; Android retains its OS app directory.

## Current coherent repair group
- Apple compilation: replace inaccessible iOS-file-private child helper with direct children lookup.
- Cron editor: preserve explicit JSON .null in XgentValue optional decoding while keeping absent values nil. Regression checks clearable/required/missing numbers and action acknowledgements.
- iOS Shell smoke verifies real stdout, localized numeric exits, explicit exit 7 followed by success, no profile stderr, Python, stdin/EOF/cancellation. Release #144 disproved the previous sentinel key: exact procargs string pointer is 0x1b1ff, pointing to **_DASH_LOGIN_SHELL** (leading underscore), not the substring at 0x1b200. Simulator/device pinned archive SHA256 9a30ac6b... both contain the full underscored key; virtual environment key corrected before ios_fork. Runtime archive checksum also matches Package.swift; real execution awaits CI.
- Both composer UIs cancel/suppress old agent-directory autocomplete in XChat; Astryx also rejects workspace-reference drags. Explicit user uploads remain; native image/mention root matches conversation-scoped uploads.
- Android mobile actions use installed Astryx 0.6.3 modal scrollable BottomSheet, verified with MCP/CLI/source, preserving live routes/XChat filtering. Release #144 confirms Shell navigation, base installation and real file preview now pass. Smoke records tap geometry and XML/screenshots; uploads include every captured XML.

## Verification / CI
- CI #328 (7bf5d2bb): all jobs success. Prior coherent 48-file group c8f8d53b pushed once; its clean non-Cargo suite passed 1986/1986.
- CI #329 (c8f8d53b): frontend/Rust/guards pass; Apple compilation fails at the child lookup fixed above.
- c30301d0 group: 1987 non-Cargo tests, 56 focused mobile/native and 13 release-workflow regressions passed; check/lint/native/architecture/diff passed. Cron JSON null fix passes real iOS settings/detail routes and preference relaunch in Release #144.
- Head c30301d0: CI #330 finishes with macOS/device/frontend/Rust passing; iOS fails one of 223 tests when a fixed 500 ms delay expires before its editable find input mounts. Release #144 builds all platforms; Windows/Linux pass. Packaged macOS composer passes, then sidebar toggling causes AppKit constraint recursion/infinite width. iOS Shell still reads host profile; previous virtual sentinel fix is insufficient. Android Shell navigation/install/file preview now passes; UIAutomator loses its root while real package installation is busy. Artifacts inspected; no additional push yet.

## Remaining
Track CI and unsigned/non-publishing Release including real native input/dock/menu/Shell flows to complete success. Continue detailed settings/sidebar/preview parity audit, extension integration and complex multi-app task evidence; 90% visual similarity and equivalent task completion are not independently established. No fake extension-install controls.

## Browser parity and runtime repair (ready for one push)
- Desktop popup events previously reached only Astryx; mobile lacked tab routing. Shared controller now owns one listener across both UIs, validates active conversation/HTTP destination and retires late registrations; pending popups preserve manual tab/conversation selection. iOS WKUIDelegate and Android user-gesture WebViewTransport route real URLs through native events/ACL; temporary Android views retire on destination/timeout/closure/renderer loss. APIs verified with Apple/Android docs and GitHub examples.

- Fixed-frame macOS host disables content-derived sizing constraints before view load, following Apple docs. Public C bridge regression opens/removes sidebar and crosses drawer/inline widths including failed 871-point case, asserting finite pinned bounds. Failing find test awaits editable input with two-second deadline/host evidence and retains replacement/undo/stale assertions. Android installer retries null roots only within original readiness/output deadlines, limits adb calls to remaining time and requires fresh XML; ordinary snapshots retain four attempts.
- Final local verification: **1992/1992 non-Cargo tests pass** (543.4 s), no failures/cancellations/skips; 19 focused popup/Android regressions pass. check/lint (685 files), native protocol (55 kinds/46 properties), architecture and diff checks pass. No local builds/dev/Cargo. Push once, then CI and unsigned/non-publishing Release must confirm actual native runtime success.

Touched: shared/native browser popup routing and event ACL; browser regression explicitly checks manual tab selection during pending popup; Apple presentation host/sidebar and mounted find regressions; iOS sentinel; Android installer snapshot/transient recovery test; history. Prior group touched layout/model/number tests, composers/mode regression, mobile menu and release smoke.
