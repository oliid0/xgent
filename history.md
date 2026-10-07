# Current objective
Repair CI #322 / Release #138, align Astryx and Apple UI behavior and settings, move native sources; push only after local test/check/lint.

## Completed
- Audited existing settings routes and shared controllers for system/providers/shortcuts/backup/CUA/permissions/voice/soul/memory/other/access/about, chat evidence, workspace/Git/terminal/SSH; preserve working implementations.
- Apple provider tabs/rows now use the exact installed Iconify brand/outline assets and monochrome treatment used by Astryx (index.css provider-brand rules), through existing SwiftDraw 0.29.0 SVGView; no new dependencies.
- Architecture guard now requires the new Apple/CUA entry points and rejects the obsolete native directory.
- Corrected double RTL mirroring in provider rows; category navigation now scrolls directly to its real selected button after viewport/type-size changes.
- Skills rendering test inspects the actual window including the presented native sheet, rather than only the underlying hosting view.
- CI #324 reproduced the macOS allocator crash despite nanosecond sleeps; the sleep-specific diagnosis was insufficient.
- Read clean Git state, empty history, CI/Release logs, existing UI/contracts/tests and reference image.
- Moved Apple UI to crates/fronted/src-tauri/apple and macOS CUA to crates/computer-use/macos; updated CI, Rust linkage, resource staging/packaging, contract fixtures and ignores.

## Evidence / decisions
- Reverted ineffective blanket sleep API replacements; preserve original cancellable waits and full native assertions. Restored files: 26.
- Release #138 provider modifier compile error already fixed by 6af73874; do not repeat.
- CI #322 layout corrections await iOS runner confirmation. CI #324 frontend, Rust, device archive, architecture/workflow/diff checks passed; macOS XCTest still aborts at long-paste undo/redo teardown.
- Pin CI and Apple Release to Xcode 26.4.1: Apple release notes document async stack-allocation crash fixes (https://developer.apple.com/documentation/xcode-release-notes/xcode-26_4_1-release-notes); GitHub runner-images confirms installed compiler/SDK/runtime. iOS Release moves to macos-26-intel because the compiler requires macOS 26.2+ and a-Shell simulator assets require x86_64. Updated existing workflow assertions.
- Preserve shared TS state/actions and Rust backends; edits follow actual failures, not a file-count target.

## Remaining / verification
Toolchain correction ready for commit; wait for CI #324 iOS evidence before the next push (push would cancel the existing run). Release #140 remains running on 84e21a6. Review Apple screenshots and resolve actual failures. Whole-app visual similarity and the example live multi-app task are not yet independently measured.
Local: 1975 non-Cargo tests passed; after glyph edits, 11 provider/contract tests and pnpm check/lint passed. Browser narrow-layout passed with screenshot (.ci-artifacts/local-ui/astryx-providers.png). Architecture/native guards and staged whitespace check pass. No local build/dev/Cargo commands executed.
Toolchain follow-up: 13 release-workflow tests, pnpm check/lint, architecture/native guards and whitespace checks pass. Native tests retain all assertions and original waits.
Touched: Apple/CUA source moves, workflow/linkage/resource paths, provider RTL/navigation/glyphs, Skills rendering test, sleep call sites, architecture/contract checks and fixtures.
