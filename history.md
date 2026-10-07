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

## Current coherent repair group (uncommitted)
- Apple compilation: replace inaccessible iOS-file-private child helper with direct children lookup.
- Cron editor: preserve explicit JSON .null in XgentValue optional decoding while keeping absent values nil. Regression checks clearable/required/missing numbers and action acknowledgements.
- iOS Shell: exact pinned dash archive SHA256 9a30ac6b... and simulator/device procargs disassembly verify DASH_LOGIN_SHELL forces first login if absent. Set virtual environment sentinel before ios_fork to prevent host /etc/profile/path_helper. Smoke verifies real stdout, localized numeric exits, explicit exit 7 followed by success, no profile stderr, Python, stdin/EOF/cancellation.
- Both composer UIs cancel/suppress old agent-directory autocomplete in XChat; Astryx also rejects workspace-reference drags. Explicit user uploads remain; native image/mention root matches conversation-scoped uploads.
- Android screenshot shows Shell tap left the anchored menu open. Mobile actions use installed Astryx 0.6.3 modal scrollable BottomSheet, verified with MCP/CLI/source, preserving all live routes and XChat filtering. Smoke records tap geometry and intermediate XML/screenshots; artifact upload includes every captured XML. Packaged transition awaits CI.

## Verification / CI
- CI #328 (7bf5d2bb): all jobs success. Prior coherent 48-file group c8f8d53b pushed once; its clean non-Cargo suite passed 1986/1986.
- CI #329 (c8f8d53b): frontend/Rust/guards pass; Apple compilation fails at the child lookup fixed above.
- Release #143 run 37589800007: Windows/Linux pass; macOS fails the same lookup; Android package builds but Shell menu interaction fails; iOS still building. Release #142 established actual Cron rejection and Shell exit 2 with host path_helper stderr, addressed above.
- Current group: all 1987 non-Cargo tests pass (366.7 s), no failures/cancellations/skips. 56 focused mobile/native and 13 release-workflow regressions also pass; check/lint, native protocol (55 kinds/46 properties), architecture and diff checks pass. Swift/Rust compilation and packaged behavior require CI.

## Remaining
One coherent commit/push, then track CI and unsigned/non-publishing Release including real native input/dock/menu/Shell flows to complete success. Continue detailed settings/sidebar/preview parity audit, extension integration and complex multi-app task evidence; 90% visual similarity and equivalent task completion are not independently established. No fake extension-install controls.

Touched: Apple layout/model/number tests, shared/native composers and chat mode regression, mobile quick actions, iOS execution environment, packaged iOS/Android interaction smoke, release evidence upload and history.
