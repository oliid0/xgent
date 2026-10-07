# Current objective
Repair cross-platform builds and shared Astryx/SwiftUI behavior, including real Office editing. Combined push/build is authorized after local verification. No local build/dev/Cargo. Swift Package Index and upstream SwiftUIPDF source were also checked; it is a page viewer, while PDFKit selection plus the common source writer provides the required edits. The broad goal remains active: feature parity and native runtime success are incomplete.

## Completed
- Pushed 6b12c0a7 (103 files): shared source-package Office creation through actual permissions/checkpoints/no-overwrite flow; DOCX paragraph/table text, XLSX cells and PPTX text-run editing; conflict/stale-draft guards. Old standalone annotation UI and executable/Skill integration removed. Deleted licenses/notice generation stay deleted.
- Shared/native composer supports above-plus bounded menus, real files/folders/installed Skills, runtime switches, branch:repository/init, inline blue mentions and input images. XChat workspace actions are guarded. Browser/panels have real tabs/navigation/session ownership, right-plus browser and bottom-plus terminal.
- Pushed c2a10802: DOCX whitespace preserves hyperlink boundaries; finite native pane/divider layout; one bundled iOS Python interpreter with module/pip/exit/recovery/alias checks retained.
- Pushed f6926b8c: XLSX numeric/boolean edits retain calculation types and original ZIP/style parts; native composer measures an independent TextKit snapshot outside live layout. CI #334 macOS confirms 223 native tests pass, including actual bridged-window resize.

## Current follow-up (uncommitted)
- Requested yy/OfficeCLI-main/src/officecli and yy/genoffice-main/packages reviewed directly. Applied typed-cell/original-package ideas. Their cross-run DOCX, PPTX source-run anchors and table operations are useful; C#/.NET and Node-only imports require adaptation rather than CLI binaries.
- CI #334 iOS has only two provider bounds assertions failing; actual artifact shows DeepSeek crossing the advanced action at 320/dark/LTR. Repair uses documented LazyHStack/scrollTargetLayout/scrollPosition to maintain selected category through resizing; original bounds/overlap assertions retained.
- Pinned CodeEditorView installs initial text in updateUIView after introspection. Reference reveal listens to actual TextKit editing completion and retries asynchronously; observers retire with the request. Mounted delayed-population/typing regression added.
- Shared PDFKit representable caches input bytes, retaining document/page/zoom through unrelated updates. Actual generated-PDF state and selection/draft-undo/original-annotation regressions added; native execution pending remotely.
- Real inline PDF yellow/green/pink text highlights and undo connect both Astryx and SwiftUI to one pdf-lib writer. Drafts use existing dirty/close/restore/conflict/background-write guards, synchronous retention and guarded fs_write_binary; converted Office PDFs remain read-only. Original pages/forms/rotation/annotations retained. No standalone note page.
- PDF.js actual TextLayer/selection geometry and installed PDFNumber/Highlight/appearance APIs verified; native PDFKit selection APIs verified through Swift MCP. Necessary rendering geometry CSS added only to index.css; theme files/imports/config untouched.
- Release #148 both macOS packages succeed and actual composer typing passes, then the same settings title assertion fails. Screenshot/AX export contains the real heading; smoke uses its stable ID across element types and actual compact navigation menu with existing menu action IDs. All twelve route/title/bounds/closure assertions remain; no speculative production settings-layout change.

## Verification / CI
- Earlier complete non-Cargo suite: 2014/2014 passed. Pending follow-up earlier native/shared contracts: 103/103; release/native contracts: 19/19.
- PDF guarded-write/converted-read-only/conflict/undo/retired-owner and synchronous/background-draft tests pass. Real-browser selection plus visible saved-highlight raster passes four rotations x two zooms. Native PDFKit tests await CI.
- Current pnpm check, lint (691 source files) and native:check (55 kinds/46 properties) pass. Full final non-Cargo suite passed: 2022/2022, zero failures/skips/cancellations, 412.2 seconds; .ci-artifacts/local-ui/pdf-inline-final-tests.log. No local native compile/app build/dev.
- Exact f6926b8cabccbafcc640476c3c0a379c622bf905: CI #334 (37682156025) frontend/Rust/device/macOS/workflow/architecture/diff pass; iOS provider assertions fail. Release #148 (37682174165) Windows/Linux/Android package and launch smoke pass; macOS ARM/Intel settings smoke fail; iOS unsigned device package succeeds, actual simulator/Python alias smoke still running.
- Superseded Release #147 cancelled to release runners; its Win/Linux passes remain evidence, cancelled jobs are not successes. Ignored downloaded OfficeCLI executable is unreferenced; automatic approval review rejected deletion twice, no bypass.

## Remaining
- Local verification is complete. One coherent 22-file follow-up group is ready for the authorized push and exact-SHA native/package CI. Preserve the running Release #148 iOS smoke for its actual outcome; do not cancel or infer success.
- XLSX table header edits need coherent tableColumn/structured-reference updates; no partial rename or invented formula parser. Full Office layout/style and legacy DOC editing, browser extensions, all settings/details, complex multi-app completion parity and 90% visual similarity remain incomplete.
- Terminal shell/profile/banner and dock work; startup speed remains unmeasured. Do not mark the broad goal complete.
