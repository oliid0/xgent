# Current objective
Fix the supplied iOS launch crash, improve observable CUA control, and align chat/activity/settings layouts with yy references and Astryx.

## Completed in source
- Desktop expanded/rail footers now share the same Astryx action menu, icon, actions and sizing; removed the expanded-only inline menu, two-line Soul identity, duplicate settings control and obsolete imports. Final verification pending.
- iOS app enables Swift runtime embedding and explicitly searches /usr/lib/swift. IPA inspection now rejects unresolved @rpath/libswiftCore.dylib instead of assuming ABI stability resolves it.
- CUA launch waits for an observable window; typing uses the focused editable control; stale/changed states and stale sequences report unapplied errors. Configured external drivers own observations and their input tokens, preserving focus/background capabilities.
- Work records group intermediate operations and collapse after settlement; the final answer and questions remain visible. Model-provided reasoning is hidden by default with a persisted appearance setting.
- Activity renders actual shell output in a read-only terminal and monitors browser/CUA previews. Capture failures are shared with the panel instead of being hidden in capsule-local state. Progress counts completed tasks, fits its content, removes the redundant popover close control and suppresses long hover overlays.
- Astryx core/themes/CLI upgraded from 0.5.0 to 0.5.4; custom accent colors apply to user chat bubbles and semantic controls. Preserved the existing dependency upgrades; kept the test-only TypeScript 6 compiler API alias.
- Neutral gray sidebar, narrower rail, bottom-aligned new-chat composer, bounded activity/settings layout, compact right-panel presentation and plain settings back controls.
- Open with enumerates Windows file associations and invokes the chosen registered handler; default app, system chooser, preview and reveal remain available.

## Evidence / decisions
- yy/Xgent-2026-09-09-182412.ips: DYLD abort at launch, embedded libswift_Concurrency cannot resolve @rpath/libswiftCore.dylib; device trusted the developer signature. Earlier history incorrectly treated Swift ABI stability as sufficient.
- yy/1.html, yy/2.html, supplied screenshots and xx computer-use implementation informed behavior. Astryx MCP search/get and 0.5.4 CLI manifest/build discovery used; installed themeProps and color-scale code confirm sender:user/accent-muted overrides. Windows association APIs checked against windows-rs 0.62.2.

## Verification / remaining
- Native probe on this 150% Windows desktop: launch 1.8s, precise typing + screenshot 0.24s, Chinese document text/8-character count and stale-token rejection PASS. Screenshot revealed DPI-unaware hosts mixed GetWindowRect logical bounds with DWM physical bounds. Added a per-call RAII DPI context for capture/input, restored on all exits; awaiting native screenshot/click verification.
- CI e292630 found Monaco 0.56's old language-pack import no longer exists. Updated language pack and five worker imports through 0.56's exports map (maps package subpaths to esm/vs), removed obsolete ambient declaration. Adopted CI's resolved Cargo.lock for the locked Windows diagnostic job.
- pnpm 10.32.1 check PASS; lint PASS (527 files); non-native suite 1143/1143 PASS; 4 activity tests PASS after shared preview fix; architecture and diff hygiene PASS. Use CI's pnpm 10.32.1 (global 12 ignores package pnpm settings). No local build/dev/Cargo commands.
- Prior iOS fix 002d579 release run 34363971526 succeeded. Push/current CI, rendered artifact wide/narrow interactions and Windows production-engine probe remain. CI compiles the probe; local execution requires no build tools. iOS personal-signature physical launch and advanced Blender/video/FPS completion are not yet established.
- Touched computer-use native/driver routing; iOS project/dependency inspection; frontend appearance, transcript/activity, shell stream, preview Open with, navigation/settings and related tests.
- Cargo.lock taken from CI artifact 10111165895: adds the previously missing xgent-computer-use dependency graph; existing package versions/checksums retained.
