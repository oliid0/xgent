# Current objective
Fix the supplied iOS launch crash, improve observable CUA control, and align chat/activity/settings layouts with yy references and Astryx.

## Completed in source
- iOS app enables Swift runtime embedding and explicitly searches /usr/lib/swift. IPA inspection now rejects unresolved @rpath/libswiftCore.dylib instead of assuming ABI stability resolves it.
- CUA launch waits for an observable window; typing uses the focused editable control; stale/changed states and stale sequences report unapplied errors. Configured external drivers own observations and their input tokens, preserving focus/background capabilities.
- Work records group intermediate operations and collapse after settlement; the final answer and questions remain visible. Model-provided reasoning is hidden by default with a persisted appearance setting.
- Activity renders actual shell output in a read-only terminal and monitors browser/CUA previews. Progress counts completed tasks, fits its content, removes the redundant popover close control and suppresses long hover overlays.
- Neutral gray sidebar, narrower rail, bottom-aligned new-chat composer, bounded activity/settings layout, compact right-panel presentation and plain settings back controls.
- Open with enumerates Windows file associations and invokes the chosen registered handler; default app, system chooser, preview and reveal remain available.

## Evidence / decisions
- yy/Xgent-2026-09-09-182412.ips: DYLD abort at launch, embedded libswift_Concurrency cannot resolve @rpath/libswiftCore.dylib; device trusted the developer signature. Earlier history incorrectly treated Swift ABI stability as sufficient.
- yy/1.html, yy/2.html, supplied screenshots and xx computer-use implementation informed behavior. Astryx MCP search/get and CLI manifest/build discovery used; installed 0.5.0 types take precedence over newer MCP documentation. Windows association APIs checked against windows-rs 0.62.2.

## Verification / remaining
- pnpm check PASS; pnpm lint PASS (527 files); non-native suite 1142/1143 initially, sole obsolete padding assertion removed; all 9 affected checks PASS. Swift rpath, stale CUA, work grouping and UTF-8 stream regressions covered. No local build/dev/Cargo commands.
- Push and GitHub CI/release checks, rendered artifact wide/narrow interactions, Windows native control and iOS physical launch remain to verify. Advanced Blender/video/FPS completion is not established by these source changes.
- Touched computer-use native/driver routing; iOS project/dependency inspection; frontend appearance, transcript/activity, shell stream, preview Open with, navigation/settings and related tests.
