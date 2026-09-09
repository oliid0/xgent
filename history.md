# Current objective
Fix the supplied iOS launch crash, improve observable CUA control, and align chat/activity/settings layouts with yy references and Astryx.
Priority: right sidebar, CUA, live activity and chat display; continue improving custom UI/colors. Full goal remains active.

## Completed in source
- Foreground Windows observations/live previews capture the app's actual physical screen region across monitor intersections. Production probe proved PrintWindow omitted an open Notepad File menu despite accessibility seeing it. Background capture remains non-activating; focus/geometry changes during screen capture reject the frame. CI/native visual verification pending.
- Appearance colors now pair the native picker with editable/copyable HEX fields, localized validation and Escape-to-revert. Only complete valid colors enter persisted settings; invalid drafts leave the applied theme intact. Grounded in rendered settings and Astryx TextInput documentation.
- Minimized apps now yield semantic observations in auto mode and explicit capture errors in image/live-preview mode, instead of exposing the native 187x32 minimized thumbnail as an actionable screen. Grounded in the production probe on this desktop.
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
- Updated the existing navigation contract test to inspect the extracted shared menu. Full non-native run found this stale location assertion; rerun only the affected test after correction.
- CI 34370279257 (07ff0e9) all six jobs PASS; release 34369748134 (bebf64b) PASS. Native DPI artifact on 150% desktop restores/captures full Notepad at 1280x741; coordinate click needs stronger post-action evidence. A minimized window still returned a misleading tiny capture, requiring follow-up.
- Shared sidebar menu typecheck/lint PASS; affected navigation tests 11/11 PASS after the full non-native run exposed a stale source-location assertion. Rendered interaction verification remains.
- Native probe on this 150% Windows desktop: launch 1.8s, precise typing + screenshot 0.24s, Chinese document text/8-character count and stale-token rejection PASS. Screenshot revealed DPI-unaware hosts mixed GetWindowRect logical bounds with DWM physical bounds. Added a per-call RAII DPI context for capture/input, restored on all exits; awaiting native screenshot/click verification.
- CI e292630 found Monaco 0.56's old language-pack import no longer exists. Updated language pack and five worker imports through 0.56's exports map (maps package subpaths to esm/vs), removed obsolete ambient declaration. Adopted CI's resolved Cargo.lock for the locked Windows diagnostic job.
- pnpm 10.32.1 check PASS; lint PASS (527 files); non-native suite 1143/1143 PASS; 4 activity tests PASS after shared preview fix; architecture and diff hygiene PASS. Use CI's pnpm 10.32.1 (global 12 ignores package pnpm settings). No local build/dev/Cargo commands.
- Latest code e7a50fe pushed; CI 34381804027 pending (tracked with GitHub MCP); preceding sidebar CI 34381692795 running. Release 34381102663 on 07ff0e9 running. Next: inspect artifacts for shared-menu wide/narrow interactions and minimized CUA capture behavior. Prior rendered chat layouts passed, but do not establish these new changes. iOS personal-signature physical launch and advanced Blender/video/FPS completion remain unverified.
- Touched computer-use native/driver routing; iOS project/dependency inspection; frontend appearance, transcript/activity, shell stream, preview Open with, navigation/settings and related tests.
- Cargo.lock taken from CI artifact 10111165895: adds the previously missing xgent-computer-use dependency graph; existing package versions/checksums retained.
