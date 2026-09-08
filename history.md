# Current objective
Complete the remaining desktop/mobile repairs. User reports progress about 50%; CUA, mobile Shell/GUI and native startup remain unverified.

## Implemented
- Real PDF/PPTX/DOCX/XLSX previews, guarded document/cell/annotation/image saves; legacy Office conversion through installed converters.
- Attachment IPC/links, generated-file cards/open-with, chat-column My Files, conversation-scoped panels and bounded inactive resources.
- Thinking collapsed, immediate steering, welcome/boot UI, local browser navigation and menu occlusion; Windows native shell and project dependency paths.
- CUA installed-app discovery/launch and Windows UIA document text. Revision 2 requires updated component rather than silently retaining an old binary.
- Android/iOS project-local Python paths; Android npm paths, existing .venv, preserved PATH and guest /workspace cwd.
- Mobile command pipe events, incremental UTF-8 output and cleanup; conversation-scoped bounded activity/replay on desktop/mobile, CUA per-step events and real browser captures/results. Narrow composer controls no longer wrap.
- Shared browser console/errors and Resource Timing diagnostics; iOS document-start injection; duplicate runtime injection is idempotent.

## Evidence / decisions
- Read xx driver/catalog, yy/cua Windows runtime and yy Android ShellExecutor/PRootKernel plus iOS shell/browser references. Current Android lacks persistent process/GUI bridge and local mobile CUA is disabled: enabling a tool alone cannot supply a desktop.
- Windows Get-StartApps confirms Notepad installed. Real native component discovery/control still needs validation.
- Astryx MCP search/get and CLI manifest/build discovery completed; no local build/dev/Cargo commands.
- CI #103 (7101f4a) passed. Previous Release #36 is no longer listed and its ID returns 404; current GitHub MCP repository access works. Trigger a fresh release against the next commit.

## Remaining
- Native CUA end-to-end test in disposable Notepad; fix actual runtime failures; macOS/Linux verification.
- Android persistent Shell/local servers, configurable environment and Linux GUI/CUA integration; iOS a-Shell limits and startup failure.
- Verify activity viewer/compact layout and file editors from compiled CI artifact, across wide/narrow sizes, interactions, console and accessibility.
- Finish embedded browser automation/debugging gaps, mobile release smoke and all requested remaining behavior. Do not claim complete from unit checks alone.

## Verification / touched
- Latest check PASS; lint PASS (516 files); non-native suite PASS (1126 tests), then new streaming regression PASS (3 activity tests). Cargo excluded; git diff --check PASS.
- Activity tests cover isolation/bounds, CUA event correlation/cleanup and split UTF-8 visibility before completion. Browser test covers diagnostics limits and duplicate injection.
- Logs: %TEMP%/xgent-activity-{check,lint,test-non-native}.log. Native/rendered verification pending.
- Touched browser shared/iOS runtime, mobile Kotlin/Swift runners, frontend tool registry/tools/activity/composer/i18n/styles, CUA IPC/component revision, release staging and regression tests.
