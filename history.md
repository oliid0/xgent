# Current objective
Repair Apple CI/Release and align functional settings/sidebar/chat behavior and Astryx/SwiftUI visuals across platforms. No local build/dev/Cargo. Finish coherent fixes and non-Cargo checks before one push; preserve the user's request to avoid frequent CI.

## Completed / evidence
- Apple UI moved to src-tauri/apple; macOS CUA moved to crates/computer-use/macos; native directory removed and build/workflow references updated.
- Provider RTL/selection, exact installed Iconify glyphs, full quota/proxy diagnostics and mounted Skills sheets fixed. Actual Astryx narrow/large-font provider screenshots checked.
- macOS long-paste crash traced to overlapping AppKit/custom undo records; one attributed inverse owns each edit. Paste/copy/undo/redo/teardown pass in CI #328. Xcode 26.4.1 pinned.
- Composer image attachments inside input, blue inline file/folder mentions, floating suggestions; native image lifecycle uses shared workspace reads with cancellation/loading/error/removal.

## Coherent local fix group
- XChat receives no agent workspace path; manual workspace tools, existing panels and workspace dialogs hidden/guarded. Browser remains. Desktop/mobile launch and archive regressions pass.
- Functional browser new-tab Review/Terminal/Files/side-chat actions; side Review/Files reuse existing shared panel/data. Both UIs use real copy-address/default-browser actions, errors, translated more/devtools menus and rounded address fields. Native tools visibly named.
- Bottom terminal reuses real PTY/session, keeps browser/chat above, resizes and returns to side. Shared native docking state, retirement/output regression and real SwiftTerm/browser/chat rendering coverage added. Short-height bounds and unique tab/panel accessibility IDs fixed.
- System PowerShell normal banner/profile/policy restored; PTY creation uses existing spawn_blocking pattern. Startup speed is unmeasured; Rust checks remain CI-only.
- Removed all obsolete window geometry saving/restoring/plugin/dependency. Startup cleans only exact old geometry files/numeric migration copies, preserving other data. CUA preference uses unified storage. iOS uses sandbox data/.xgent and migrates old nested root; Android retains OS app directory. Cleanup/migration Rust regression added; iterator prefix dereference audited against Rust Pattern signature.
- Shared work grouping uses verified MCP identity or explicit common intent, preserving file targets, narratives, rounds, actual details and error/running states. Both UIs use the same grouping; native call counts translated.
- AOSP confirms null-root dump may succeed without writing; Android smoke deletes stale snapshots, bounded retries and intermediate captures. Packaged mac smoke records computed AX failure and physically clicks/selects/types exact composer replacements at startup/dismissal/narrow width; actual outcome awaits CI.

## Verification / CI
- CI #328 (7bf5d2bb): ALL jobs success, including macOS/iOS/device/frontend/Rust/guards.
- Release #142 (same SHA): Linux/Windows success; Intel/ARM fail computed empty-composer hit; Android failed navigation after null-root snapshots; iOS simulator smoke still running. AX client is untrusted, so direct AX error does not prove a blocked composer.
- Clean final non-Cargo suite: ALL 1986 passed (350.6 s), no failures/cancellations/skips. One earlier transient image worker stall was terminated; all 3 actual raster/encoding tests passed independently and again in clean suite. Two obsolete grouping/composer assertions corrected without dropping their behavioral checks.
- Latest check/lint pass (685 files); native contract 55 kinds/46 properties and architecture guard pass. Browser SSR with installed components/icons + Edge at 240/320/390/640/1280 px renders all 9 controls without horizontal clipping; screenshot inspected (.ci-artifacts/browser-dock).
- Local commits 18bc254/74b66cb plus completed 48-file feature/storage/smoke group will be pushed together after final checks. No CI triggered during the local group.

## Remaining
- One coherent commit/push; track CI and unsigned/non-publishing Release to complete success, including new native dock/landing and actual packaged input.
- Full settings/sidebar/preview/chat parity audit, extension integration and complex multi-app task evidence; 90% similarity/completion equivalence not independently established. Installed Tauri extension API does not support Apple; no fake install controls.

Touched: composer/presentation, ChatPage/browser/right-sidebar/mobile actions/work transcript, Apple panel/control/layout tests, terminal runtime, unified storage/startup/window dependency, release interaction smoke/tests, locales and history.
