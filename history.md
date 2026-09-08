# Current objective
Finish mobile startup/CI, reliable CUA discovery/control, real file previews/editing, conversation panels, attachment/open-with actions and launch/chat UX.

## Completed
- Attachment IPC uses snake_case; blue underlined file links and generated file cards above full-width diffs.
- PDF.js page rendering with offline assets, real PPTX slides, DOCX rendering/text editing, XLSX cells, native PDF/PPTX annotations and image rotation. Legacy DOC/RTF/PPT use installed OS/LibreOffice conversion.
- Installed Windows application catalog and launch_app; macOS directory discovery and localized aliases; CUA component capability upgrade.
- Conversation-scoped browser/file/terminal/side-chat panels, bounded inactive resources and retained unsaved drafts. My Files/code open in chat column.
- Native open-with chooser, local/file URL routing, browser menu surface occlusion, empty browser landing, side-chat draft initialization, collapsed reasoning and Ctrl/Cmd+Enter steering.
- Native Windows PowerShell/project dependency paths, embedded-browser/research tool policy, lightweight paint-gated launch bootstrap and revised welcome layout.
- Android emulator smoke moved to one shell script. iOS launch captures stdout/stderr/system diagnostics.

## Evidence / decisions
- Base 003b1c1: CI #101 passed; Release #35 failed mobile launch checks after successful packaging. Android action lost variables between script lines; iOS process exited without usable crash evidence.
- Astryx MCP search/get and CLI manifest/build discovery completed before UI edits. No local build/dev/Cargo commands.
- Preserve native file formats with guarded saves; no sidecar-only annotation success. Legacy Office conversion requires installed conversion software.

## Remaining
- Push and run CI/release checks; diagnose any remaining iOS runtime failure.
- Verify actual rendered wide/narrow layouts, interactions and console from CI artifact; run CUA against real application with updated component.
- Address new evidence, then final handoff. Do not claim all requested behavior verified yet.

## Touched / verification
- Frontend chat/browser/preview/runtime/settings/theme; native browser/CUA/workspace/shell; release workflow/scripts and regression tests.
- 2026-09-07: pnpm check PASS; pnpm lint PASS (515 files); pnpm test:non-native PASS (1123 tests, Cargo excluded); git diff --check PASS.
- Logs: %TEMP%/xgent-final-{check,lint,test}.log. CI and rendered verification pending.
