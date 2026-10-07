# Current objective
Repair CI #322 / Release #138, align Astryx and Apple UI behavior and settings, move native sources; push only after local test/check/lint.

## Completed
- Audited existing settings routes and shared controllers for system/providers/shortcuts/backup/CUA/permissions/voice/soul/memory/other/access/about, chat evidence, workspace/Git/terminal/SSH; preserve working implementations.
- Apple provider tabs/rows now use the exact installed Iconify brand/outline assets and monochrome treatment used by Astryx (index.css provider-brand rules), through existing SwiftDraw 0.29.0 SVGView; no new dependencies.
- Architecture guard now requires the new Apple/CUA entry points and rejects the obsolete native directory.
- Corrected double RTL mirroring in provider rows; category navigation now scrolls directly to its real selected button after viewport/type-size changes.
- Skills rendering test inspects the actual window including the presented native sheet, rather than only the underlying hosting view.
- Replaced constant Duration-based Task.sleep calls with equivalent cancellable nanosecond sleeps in Apple UI/tests (Swift issue #86204 cross-module specialization crash; CI abort occurred after sleep).
- Read clean Git state, empty history, CI/Release logs, existing UI/contracts/tests and reference image.
- Moved Apple UI to crates/fronted/src-tauri/apple and macOS CUA to crates/computer-use/macos; updated CI, Rust linkage, resource staging/packaging, contract fixtures and ignores.

## Evidence / decisions
- Release #138 provider modifier compile error already fixed by 6af73874; do not repeat.
- CI #322 failures addressed: RTL provider row order, selected category overflow, Skills preview test hierarchy and macOS XCTest sleep specialization crash (https://github.com/swiftlang/swift/issues/86204); Apple runners must confirm.
- Preserve shared TS state/actions and Rust backends; edits follow actual failures, not a file-count target.

## Remaining / verification
Push verified changes and track new CI/Release; review Apple screenshots and resolve any further actual failures. Whole-app visual similarity and the example live multi-app task are not yet independently measured.
Local: 1975 non-Cargo tests passed; after glyph edits, 11 provider/contract tests and pnpm check/lint passed. Browser narrow-layout passed with screenshot (.ci-artifacts/local-ui/astryx-providers.png). Architecture/native guards and staged whitespace check pass. No local build/dev/Cargo commands executed.
Touched: Apple/CUA source moves, workflow/linkage/resource paths, provider RTL/navigation/glyphs, Skills rendering test, sleep call sites, architecture/contract checks and fixtures.
