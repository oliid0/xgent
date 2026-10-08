# Current objective
Converge Astryx and SwiftUI desktop/mobile UI and real interactions against all 14 references, then verify exact-source Apple CI and packaged applications. Goal remains active.
User steering: consolidated commits/pushes; no incremental CI triggers. No local build/dev/Cargo/make.

## Completed
- Earlier changes through bd7ecdd: readable glass and fluid settings, provider colors/order, composer menu above input/direct Git initialization/pale-blue messages, right-sidebar new-tab/two-column tools/add menu, question navigation/input/skip/close, responsive Git diff/actions, editor state and shell discovery.
- 59-file batch 7e939a15: compact Skill/MCP/model popups with one header, independent scrolling body and persistent real actions; native provider draft/list survives child model settings. Existing validation, reducers, save/delete/install/copy/progress/error behavior remains wired.
- Provider/model rows support narrow/RTL/accessibility layouts with independent ordering controls. Sidebar titles/disclosures and work-process summaries use shared fonts/density, preserving full tool output/diffs and expansion during streaming.
- Both terminals use scaled 14-point monospace, neutral foreground and preserved ANSI colors; pinned SwiftTerm uses 1.1 line spacing. Replay cache avoids unchanged encoding/decoding while preserving input/resize/session/retirement behavior.
- Skill preview leases survive StrictMode setup/cleanup; controller regressions verify actual switch/close/copy payloads.
- Corrective commits fe772e05/b2ca8191: desktop sheets accept screen-constrained sizes; disclosure queries use verified AXDisclosureTriangle roles and retain IDs; mounted iOS replacement test waits for matching real edit acknowledgement; native switches use shared theme accent.
- Current local six-file batch: mobile settings use shared spacing/radius/secondary text; model/MCP detail shells no longer inherit the generic 300x360 minimum. Real nested macOS regression covers short/tall windows, large/accessibility text, header/footer bounds, live Save/Close and surviving parent settings. Pre-push review moved the existing JSON node helper into class scope.

## Evidence / decisions
- All images reviewed. Decisions grounded in installed Astryx 0.6.3 source/types, Astryx MCP/CLI discovery, Swift MCP official docs, GitHub pinned package sources and Swift Package Index. No guessed SDK APIs/dependency additions.
- CI screenshots/AX exposed fixed 736-point previews clipping inside 642-point sheets and hard-coded green iOS switches. macOS #342 captures confirm visible header/footer and compact/expanded work-process evidence.
- Local mobile theme refinement follows iOS #341 screenshots, Astryx MobileAppearanceSettings gap={4}, and nativeTheme spacing/radius/palette mappings; 44-point controls preserved.
- Shared Rust read/write/version guards remain authoritative. Office creation/round-trip/no-overwrite checks pass. Quick Look and Astryx JS renderers differ; arbitrary-document pixel fidelity, deterministic model output and future-bug-free behavior are not established.
- Serialization microbenchmark: median 910.83ms uncached versus 36.78ms cached for 100 unchanged 256 KiB packets, identical output; encoding/serialization only.

## Verification / remaining
- Final non-native tests: 2040/2040 pass; pnpm check/lint pass (694 files, no fixes). Native contract (55 kinds/46 properties), architecture and git diff --check pass. Frontend unchanged after these checks. No local builds/native compilation/Cargo used.
- CI #342 / 37737677043 validates b2ca819123e6e98f178ae860c53ce861c7629e10: all eight jobs finish successfully; both macOS and iOS full logs confirm 230/230 native tests. CI #341's seven macOS/two iOS assertions are repaired in b2ca8191.
- Final six-file batch touches PresentationMobileSettings.swift, PresentationMobileSettingsCard.swift, PresentationMobileSettingsSectionHeader.swift, PresentationView.swift, Tests/DesktopSettingsRenderingTests.swift and history.md. All #342 outcomes are collected; consolidate this theme/detail refinement in one commit/push, then await exact-source CI. Local theme/detail regression has not yet been Apple-compiled.
- After final exact-source CI passes, package that source once with real macOS/iOS interaction diagnostics and inspect runtime screenshots. Do not mark complete before required verification succeeds.
