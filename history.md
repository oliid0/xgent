# Current objective
Converge Astryx and SwiftUI desktop/mobile UI and real interactions against all 14 references; verify exact-source Apple CI and packaged applications. Goal remains active.
User steering: consolidated commits/pushes; no incremental CI. No local build/dev/Cargo/make. Non-native tests, check/lint and existing browser evidence are permitted.

## Completed
- Earlier changes through bd7ecdd: readable glass/fluid settings; provider colors/order; composer menu above input/direct Git initialization/pale-blue messages; right-sidebar new-tab/two-column tools/add menu; question navigation/input/skip/close; responsive Git diff/actions; editor state/shell discovery.
- 7e939a15: compact Skill/MCP/model popups with independent scrolling body and persistent real actions, native provider draft/list retained behind model sheets; compact sidebar/work summaries; scaled monospace terminals/replay cache. Existing save/delete/install/copy/progress/error behavior and streaming output remain connected.
- fe772e05/b2ca8191: screen-constrained desktop sheets, actual AXDisclosureTriangle queries, matching iOS find request acknowledgements and shared switch accent. CI #342 passes all eight jobs, including 230/230 macOS and iOS native tests.
- ae0d07de: mobile shared spacing/radius/secondary text; nested model/MCP sheets adapt without generic minimums. CI #343 macOS passes 231/231, including actual nested Save/Close with parent settings retained.
- Current consolidated batch: wrapped action labels own complete ideal height; provider footer chooses equal-width horizontal or full-width vertical actions. Compact titles cap visual text at two lines, preserving full accessible text; actual Astryx capture confirms the corrected popup.
- Native General/Request/Usage now share one session and final Save/Cancel. Valid requests update the unsaved provider for model discovery; invalid headers remain editable and block Save/new fetch. Cancellation, pre-repaint OAuth fields, concurrent settings and retired usage/catalog replies are guarded.

## Evidence / decisions
- All references reviewed; APIs grounded in installed Astryx 0.6.3, Astryx MCP/CLI, Swift MCP official docs, pinned GitHub package source and Swift Package Index. Provider glyphs match actual Astryx source; no speculative dependency additions.
- #342 iOS screenshot/AX exposed three-line Cancel text overflowing a 98-point background and forced footer columns fragmenting labels. Mounted tests now measure the complete native label at actual width and require accessible actions to stack.
- #343 / 37739757439, SHA ae0d07de68a4c28950fbe61228ccc40c67a73e30: seven jobs succeed; iOS fails five assertions in two tests (Undo text reverts after hosting updates; selected categories outside viewport). Local correction publishes completed Undo/Redo through the verified delegate and re-centers tabs on committed container/content geometry, excluding manual offsets. Native outcome remains unverified.
- Astryx's actual usage regression requires General connection edits to retire pending/settled feedback. The native regression reproduced stale results before correction; it now consults existing provider configuration synchronously before accepting replies and clears settled feedback on change.
- Rust file/version guards remain authoritative. Office round-trip/no-overwrite checks pass; Quick Look versus JS arbitrary-document pixel fidelity and deterministic model output are not established. Cached terminal packets match uncached output; the benchmark measures serialization rather than end-to-end latency.

## Touched files
- Apple: shared controls/detail/provider footer, category tabs/mobile+desktop routing, Undo commands; mounted find/category/provider/model/MCP regressions.
- Frontend: compact Astryx header/CSS, native preview title, provider editor/request controller/settings composition; browser/native preview/provider/settings regressions.
- Packaged macOS/iOS tests: real Add -> General/Request/Usage -> Cancel, obsolete request-back absence, actual disabled new-provider usage test and screenshot/AX evidence per pane. history.md records the same consolidated batch.

## Verification / remaining
- Focused provider/request/settings flows: 25/25 pass. pnpm check/lint pass (694 files, no fixes); native contract passes 55 kinds/46 properties; architecture/diff checks pass.
- Final complete non-native suite after usage-retirement correction passes 2045/2045, zero failures (.ci-artifacts/frontend-provider-final.log); Cargo tests excluded. The preceding baseline passed 2044/2044.
- Actual Astryx layout passes four viewports; refreshed model capture has zero layout failures. #343 macOS nested short/screen-constrained captures show complete header/footer/actions.
- All local gates pass; publish the 23-file batch once, inspect exact-SHA Apple logs/screenshots, then package that source once with actual macOS/iOS diagnostics. SSH authenticates as an account without write access; cached HTTPS credentials are unavailable. GitHub MCP authenticates as owner oliid0 and confirms the unchanged baseline SHA, so publish the verified committed blobs atomically through MCP and verify local/remote trees. Planned manual tag v0.1.0-ci.20261008.154 has not been dispatched.
- Do not mark complete before native/package verification succeeds. No local builds/native compilation/Cargo used.
