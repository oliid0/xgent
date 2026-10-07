# Current objective
Repair cross-platform builds and shared Astryx/SwiftUI behavior. User now authorizes one combined push/build after local verification. No local build/dev/Cargo. Goal remains active until remote build/runtime evidence and outstanding parity work are complete.

## Current group
- Last pushed: ce68898a. CI #331 failed macOS mounted replacement undo assertions; Release #145 failed iOS actor isolation and packaged macOS sidebar layout. Windows/Linux/Android package+smoke passed.
- Restored iOS browser pageDidStart MainActor. macOS composer rejects infinite/max/window-exceeding TextKit size probes; actual host/measurement regressions added. Undo/redo focuses the real editor; mounted history assertions retained.
- Composer: above-plus bounded menu, real file/folder and selectable installed Skills, runtime toggles, shared branch:repository/init Git state, responsive native model/context/reasoning controls. Shared hooks reject retired/disabled/XChat operations.
- Browser: actual new-tab tools through Astryx Grid/Stack/Button and SwiftUI; normal navigation retained with native chrome. Right plus creates browser tab; bottom plus creates terminal. Both panel headers expose real sessions and session-specific closure/keyboard selection. Stale controls recheck availability, mode, workspace and session.
- F11/F12 use current conversation/session ownership; typed panel expansion requests avoid replay.
- CSS correction: preserve theme files/imports/config. Only sidebar component rules and minimal browser alignment moved into index.css; no separate browserStartPage.css/rightSidebar.css.
- Office uses source packages (docx 9.9.0, pptxgenjs 4.0.1, existing JSZip/SheetJS), no third-party executable or Skill. OfficeCreate enters existing agent work process with scoped write permission/checkpoint/version metadata/no-overwrite behavior and real editable DOCX/XLSX/PPTX output.
- Rust Office creation validates package/limits and uses exclusive create_new. Backend registration and paired-host restrictions wired. Native creation/DOCX tests included in CI; execution pending.
- DOCX text edits preserve runs/styles/unmodeled ZIP parts, reject truncated text. GenOffice surgical text-patch informed Rust adaptation; source attribution remains in code. Not a full layout editor.
- XLSX cell/formula edits round trip; uncached formulas and formula-only trailing columns now display.
- PPTX actual existing text runs edit/save through the shared ZIP/DOM engine in both UIs, preserving formatting and unrelated parts. Exact path/MIME, file/request ownership, stale reads, version conflicts, newer drafts and intentional empty titles guarded.
- Latest user cancels standalone annotation UI completely: removed both note/page views, legacy recovery/state/save paths, shared annotation engine and Apple adapters/tests. Replacement tests confirm PDF/Office previews expose no synthetic note writes. Existing file contents remain intact.
- yy GenOffice PPTX edit-text, OfficeCLI OpenXML Set navigation and open-design editable-output fidelity/CJK tests reviewed; executable-based integration rejected.

## Evidence / verification
- Earlier full non-Cargo suite: 2012/2012 passed; browser/panel follow-up 75/75; spreadsheet 12/12; direct Office engine/tool/mobile 12/12.
- Pre-cleanup full non-Cargo suite: 2027/2027 passed, 535.9 s, no skipped/cancelled tests. PPTX browser engine 3/3; targeted native reader/edit/save/MIME 5/5; shared file saves 10/10.
- Final after annotation cleanup: full non-Cargo suite 2012/2012 passed, 421.5 s, exit 0, no skipped/cancelled tests; TypeScript check, lint (689 files), native contract (55 kinds/46 properties) and diff whitespace pass. Ready for combined push.
- No local Cargo/Swift/Kotlin compile or application build/dev. Remote native/runtime verification pending.
- Source scheme removed; ignored downloaded OfficeCLI executable is unreferenced. Automatic approval review rejected its deletion; no bypass attempted. User-deleted license files and notice generation remain removed.

## Remaining / decisions
- Stage reviewed group, one combined commit/push, then GitHub MCP CI + unsigned/non-publishing Release with smoke enabled; inspect actual macOS sidebar/input/iOS Shell evidence.
- User-specified OfficeCLI src/officecli and GenOffice packages inspected directly: IDocumentHandler Get/Query/Set and cell mutation cleanup; DOCX text anchors; PPTX element/run patch and ZIP gates; XLSX original-package mutation planner. Node/.NET I/O needs the shared Rust/runtime boundary; these are references for richer editing beyond this verified group.
- Browser extensions APIs researched but not integrated. Full Office layout/style editing, legacy DOC edits and inline PDF color/highlight not implemented. Standalone note UI will not return.
- Complex multi-app task completion parity, all settings/detail parity and 90% visual similarity still unverified; do not claim goal completion.
- Terminal system shell/profile/banner and shared dock are implemented; startup speed remains unmeasured.

Touched: shared/native composers and hooks; browser/session/panel views/controllers/tests; Apple sizing/undo/host regressions; iOS actor; shared Office engines/tools/previews/drafts/tests; Rust scoped Office/DOCX writers; CI test steps; package/lock; i18n/index.css/history.
