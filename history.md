# Current objective
Repair cross-platform builds and shared Astryx/SwiftUI behavior, including real Office editing. User authorizes a combined push/build after verification. No local build/dev/Cargo. Goal remains active; feature parity and native runtime success are not yet complete.

## Completed
- Pushed 6b12c0a7 (103 files): shared OfficeCreate with docx 9.9.0 / pptxgenjs 4.0.1 / JSZip / SheetJS source packages and actual permission/checkpoint/no-overwrite flow; DOCX paragraph/table text, XLSX cell and PPTX text-run editing; conflict/stale-draft guards. Standalone old annotation UI removed. No executable/Skill integration; deleted license files/notice generation stay deleted.
- Shared/native composer: above-plus bounded menu, actual files/folders and installed Skills, runtime switches, branch:repository/init state, blue inline mentions, images inside the composer and above-composer @/slash menus. XChat workspace actions are guarded.
- Browser/panels: real new-tab workspace actions and navigation, session headers/closure/ownership, right plus creates browser and bottom plus creates terminal. Component CSS is in index.css; theme CSS/imports/config are preserved.
- Pushed c2a10802: DOCX whitespace insertion preserves unchanged hyperlink boundaries; native finite Stack panes and accessible divider replace split-view feedback; missing appearance fixture fixed. iOS start-page error details scroll with tools. ios_system v3.0.4 interpreter rotation limited to the one bundled Python; module/pip/exit/recovery/alias smoke retained.

## Current follow-up (not yet pushed)
- Requested yy/OfficeCLI-main/src/officecli and yy/genoffice-main/packages directly reviewed: typed cells, cross-run DOCX replacement, atomic PPTX table paths, paragraph/run source indices and original-package XLSX mutation. Existing package-preserving writer was retained.
- XLSX failing real browser-write/read regression showed edited numbers became text. Existing numeric/boolean cells now retain unambiguous calculation types; styles, other ZIP parts and literal identifiers/unsafe/nonfinite/formula-looking text are preserved. Two round-trip regressions added.
- CI #333 actual macOS bridged host still crashes at 871-point resize. Apple docs permit multiple fitting probes: composer now measures an independent attributed TextKit snapshot, without changing live frame/container/content/selection. Actual viewport wrapping refresh is coalesced outside layout. Finite and infinite probe regressions plus the actual bridged-window assertions remain; runtime repair is unconfirmed.
- CI #333 iOS: 222 tests, 5 assertions fail across browser lazy tool discovery, initial code-reference selection/scroll and one narrowed provider strip. Browser test scrolls the real viewport to mount lazy rows before measuring; retained input retries reveal on its own attachment/layout; categories reveal when actual strip size changes and clip overflow. Visibility/selection/action assertions remain unchanged.
- Native new-tab tools use existing theme text tint/element radius. Swift MCP Apple layout, TextKit, tint, button shape and ScrollViewReader docs; GitHub MCP upstream GenOffice/ios_system/SplitView/SwiftUIIntrospect sources and Astryx Button docs checked. No guessed package API or local native compilation.

## Verification / CI
- Earlier group full non-Cargo suite 2012/2012 passed. Current typed-cell follow-up complete suite: 2014/2014 passed, 416.4 s, no failures/skips/cancellations; XLSX 14/14, shared/native file + spreadsheet 99/99.
- Latest native browser/composer/settings/code contracts: 60/60; native-ui contract 6/6; native:check 55 kinds/46 properties; pnpm check and lint (689 files) pass. No local Cargo/Swift/Kotlin/app build/dev.
- CI #333 / Release #147 run on exact c2a10802. CI frontend/device/Rust and workflow/architecture/diff pass, including DOCX and Office creation; macOS/iOS hosted tests failed as above. Release Windows/Linux pass; Android/iOS/macOS package/runtime checks are running. Never infer success from a later step: failures can continue for evidence collection.
- Prior Release #146: Windows/Linux/Android package/smoke passed; macOS constraint crash, iOS missing pythonA/pythonB frameworks supplied repair evidence. Ignored downloaded OfficeCLI executable is unreferenced; automatic approval review rejected deletion twice, no bypass attempted.

## Remaining
- Verify current repairs in remote native tests and actual packaged applications; collect all observed failures before another combined follow-up push. Keep history current with exact SHA/results.
- Full Office layout/style editing, legacy DOC editing, inline PDF color/highlight and browser extensions are not implemented. Standalone note UI will not return.
- All settings/details, complex multi-app completion parity and 90% visual similarity still require evidence. Terminal shell/profile/banner and dock work; startup speed is unmeasured. Do not mark the broad goal complete.

Touched in current follow-up: shared spreadsheet writer/round-trip tests; Apple composer measurement/text view/tests, code input/reveal lifecycle, provider category strip, browser tools/scroll regression; history.md.
