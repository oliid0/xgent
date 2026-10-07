# Current objective
Repair CI #322 / Release #138, align Astryx and Apple UI behavior and settings, move native sources; push only after local test/check/lint.

## Completed
- Audited existing settings routes and shared controllers for system/providers/shortcuts/backup/CUA/permissions/voice/soul/memory/other/access/about, chat evidence, workspace/Git/terminal/SSH; preserve working implementations.
- Apple provider tabs/rows now use the exact installed Iconify brand/outline assets and monochrome treatment used by Astryx (index.css provider-brand rules), through existing SwiftDraw 0.29.0 SVGView; no new dependencies.
- Architecture guard now requires the new Apple/CUA entry points and rejects the obsolete native directory.
- Corrected double RTL mirroring in provider rows; category navigation now scrolls directly to its real selected button after viewport/type-size changes.
- Skills rendering test inspects the real presented sheet. CI #324 exposed SnapshotTesting reparenting UIWindow during capture (UIView strategy/prepareView source, 1.19.6); use existing in-place composited screenshots and accessibility evidence on iOS, wait for completed presentation and dismiss before teardown. macOS now mounts NSWindow, captures attachedSheet, asserts close-button bounds and its actual action.
- CI #324 reproduced the macOS allocator crash despite nanosecond sleeps; the sleep-specific diagnosis was insufficient.
- Read clean Git state, empty history, CI/Release logs, existing UI/contracts/tests and reference image.
- Moved Apple UI to crates/fronted/src-tauri/apple and macOS CUA to crates/computer-use/macos; updated CI, Rust linkage, resource staging/packaging, contract fixtures and ignores.

## Evidence / decisions
- CI #325 still aborts in the long-paste test on Xcode 26.4.1; toolchain update is insufficient. Mounted macOS Skills sheet and close-action assertions pass. Added non-sensitive stage/grouping diagnostics and explicit canRedo assertion to the intact long-paste regression; CI retains actual XCTest/native-host crash reports using the same collection pattern as Release. Reviewed artifact block indentation so screenshot/crash paths remain distinct absolute paths. No test skipped or production editor behavior guessed.
- Actual Astryx browser evidence showed one two-line clamp containing connection, quota diagnostic and proxy, hiding the latter behind long URLs. Split the row's existing data into connection/usage/proxy: only connection is clamped; full quota diagnostics wrap safely. Swift quota text now uses the same supporting typography. Existing browser coverage now requires quota/proxy inside visible row bounds at every width/scale; existing actions/controllers remain connected.
- Reverted ineffective blanket sleep API replacements; preserve original cancellable waits and full native assertions. Restored files: 26.
- Release #138 provider modifier compile error already fixed by 6af73874; do not repeat.
- CI #324 confirms iOS provider categories, RTL provider list, editor/footer layouts pass. Frontend, Rust, device archive, architecture/workflow/diff checks passed. macOS allocator abort and iOS Skills screenshot-window teardown are the remaining failures.
- Pin CI and Apple Release to Xcode 26.4.1: Apple release notes document async stack-allocation crash fixes (https://developer.apple.com/documentation/xcode-release-notes/xcode-26_4_1-release-notes); GitHub runner-images confirms installed compiler/SDK/runtime. iOS Release moves to macos-26-intel because the compiler requires macOS 26.2+ and a-Shell simulator assets require x86_64. Updated existing workflow assertions.
- Preserve shared TS state/actions and Rust backends; edits follow actual failures, not a file-count target.

## Remaining / verification
CI #325: iOS 221 native tests pass, including actual Skills sheets; artifact upload alone failed ENOTFOUND (GitHub endpoint DNS). macOS long-paste allocator abort remains. Release #141 ARM compiles/packages but actual UI smoke reports draft.isHittable false; screenshots show the real composer, accessibility hierarchy exposes it. Investigate hit testing, preserve input assertions. Metadata + crash diagnostics locally verified: 1975 non-Cargo tests pass (471 s), browser geometry passed (113 s), check/lint/guards pass; 19 workflow/native-contract checks pass. Push diagnostics to collect exact crash stage/reports. Whole-app visual similarity and the example live multi-app task are not yet independently measured.
Local: 1975 non-Cargo tests passed; after glyph edits, 11 provider/contract tests and pnpm check/lint passed. Browser narrow-layout passed with screenshot (.ci-artifacts/local-ui/astryx-providers.png). Architecture/native guards and staged whitespace check pass. No local build/dev/Cargo commands executed.
Toolchain follow-up: 13 release-workflow tests, pnpm check/lint, architecture/native guards and whitespace checks pass. Skills follow-up preserves assertions, adds real macOS sheet/close coverage, and uses explicit Void continuation for UIKit dismissal; same local checks pass.
Touched: Apple/CUA source moves, workflow/linkage/resource paths, provider RTL/navigation/glyphs, Skills rendering test, sleep call sites, architecture/contract checks and fixtures.
