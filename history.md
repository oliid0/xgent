# Current objective
Make CUA accurate for editor tasks and multiple windows; implement the five supplied activity/Thinking/progress references and route chat images into the right activity sidebar.

## Completed in source
- Windows/Linux observations no longer activate windows by default. Exact window targets reject ambiguous names; semantic actions precede foreground fallback. `allow_foreground=false` rejects global input, and `focus=true` explicitly restores/activates for observation.
- Windows supports writable ValuePattern and LegacyIAccessible SetValue; targeted keyboard input focuses the indexed editor. Linux exposes bounded text and writable capability, rejects ambiguous accessibility roots. macOS observation is nonactivating and indexed keyboard targeting is wired through AX.
- Activity steps show supplied purpose; grouped summaries count successful file operations. Clicking selects the corresponding tool detail, receives live results, and correlates CUA/shell frames by toolCallId. Pending questions retain transcript controls.
- Composer thumbnail and current task share one strip; task list opens upward. Thinking is localized with an animated gradient orb and reduced-motion fallback. User/tool images share the sidebar preview, preserving slide/zoom/copy/save actions.

## Evidence / limitations / remaining
- Root causes: unconditional get_app_state activation; foreground-selected ambiguous windows; unconnected step selection; old fullscreen image calls. Microsoft windows-rs 0.62.2/UI Automation and GNOME AT-SPI docs grounded native APIs. Astryx MCP search/get plus CLI manifest/build discovery grounded Popover/Collapsible.
- Some rich editors expose read-only TextPattern and require targeted keyboard input. This is not universal background automation or an isolated desktop. Native Notepad and multiwindow performance, final rendered layouts/interactions and platform CI still require verification.
- Prior work preserved: native CUA linkage/settings, mobile startup fixes, browser ownership/geometry fixes. Android Linux-in-PRoot GUI backend remains separate unfinished work; do not restore Android AccessibilityService.

## Verification / CI
- `pnpm check` PASS after correcting HStack alignment and unsupported findLast. `pnpm lint` PASS (519 files); affected files checked after corrections.
- `pnpm test:non-native`: 1136 PASS, one translation-key failure; corrected missing Chinese keys, affected translation suite 3/3 PASS. New navigation and background-target forwarding regressions PASS. No local build/dev/Cargo tools used. Full diff review and git diff --check PASS.
- Touched computer-use Windows/Linux, Swift dispatcher/service/input, CUA sequence metadata, chat activity/progress/image/navigation/styles/i18n and regression tests. New commit/platform verification pending.
