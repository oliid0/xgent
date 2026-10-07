# Current objective
Repair Apple build/runtime failures and converge SwiftUI/Astryx settings, sidebars, chat and workspace behavior using shared actions. Push and package-only CI are authorized after local verification. No local build/dev/Cargo. Full cross-platform feature/task/visual parity is not yet established.

## Completed before this repair
- 6b12c0a7, c2a10802, f6926b8c: shared guarded Office editing; native composer/files/Skills/mentions; browser and terminal panels; pane sizing, DOCX run boundaries, XLSX typed cells and independent TextKit measurement.
- 02d6b91d is already pushed (the previous uncommitted record was stale): real inline PDF selection/highlight/undo through the shared writer, PDFKit state retention, editor reveal timing and provider tabs. The starting worktree was clean.

## Current repairs and evidence
- CI #335 (37691860053), exact 02d6b91d: frontend/Rust/device/workflow/architecture/diff pass. Both Apple test targets compile; macOS fails four PDF fixture assertions, iOS fails those plus eight provider layout assertions.
- PDFKit adds an associated Popup to the original text note (Swift MCP documentation and actual CI output). Regression now checks every original annotation identity instead of assuming one annotation. PDF byte cache also checks view identity, preventing a remounted editor from being blank; same-view page/zoom preservation and remount tests included.
- Actual iOS screenshots show DeepSeek outside the resized category viewport. Eager targets and a layout-keyed scroll state initialize the selected category before layout, including font/RTL/Dynamic Type changes. All original bounds/overlap assertions retained.
- Release #149 (37691878017): both macOS packages compile. ARM smoke uses an empty NSMenuItem label; settings tests now check the selected shared route and nonempty visible title. Explicit menu labels retained. Intel smoke reaches all twelve settings pages, then fails pointer input in the narrow sidebar. Drawer is now a sibling of the disabled workspace; actual AX hit and AppKit mouse tests added, retaining covered-pane blocking and dismissal tests.
- Release #149 Windows/Linux/Android pass; iOS device IPA packaging succeeds, simulator build/smoke still pending at last inspection. Preserve that run for its actual result.
- Astryx MCP/installed 0.6.3 CLI manifest and composition discovery, Swift MCP, GitHub MCP, Swift Package Index, yy native memory/Soul/provider code and supplied visual references reviewed. No new package or unrelated feature introduced.

## Touched files
- Apple PresentationProviderCategoryTabs, PresentationLayout, PresentationMenus, PresentationDesktopSettings, PresentationPDFPreview.
- Apple Tests/DesktopSidebarPlacementTests, Tests/PDFPreviewStateTests; scripts/release/macos-ui-smoke/Tests/PackagedApplicationTests.swift; history.md.

## Verification / CI
- Current pnpm check, lint (691 source files), native:check (55 kinds/46 properties) pass; git diff --check passes.
- Final pnpm test:non-native: 2022/2022 pass, zero failures/skips/cancellations, 413.5 seconds; .ci-artifacts/current-tests.log. No local native compilation/build/dev.
- New exact-SHA native/package CI pending push. Actual prior CI screenshots/AX trees are in ignored .ci-artifacts/current-{0,1,2}.

## Remaining
- Verify this repair on both native platforms and actual packaged apps; fix any failures without relaxing behavioral assertions.
- Detailed settings/component and complex multi-app task parity remain an ongoing objective. Windows/Linux and macOS computer use have distinct native executors behind the common protocol; matching interfaces alone does not prove matching completion.
- Existing gaps remain: XLSX table-header/structured-reference renames, full Office layout/style and legacy DOC editing, browser extensions, complete visual parity and measured startup performance. No claim that all future bugs are eliminated.
