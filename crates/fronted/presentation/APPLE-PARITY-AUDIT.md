# Apple UI / shared UI audit — 2026-10-04

This is a source and evidence checklist, not a declaration of complete parity.
Settings require matching detailed fields, persisted values, actions, availability,
navigation, and actual rendered layouts. A successful SDK fixture does not prove an
installed application works. A shared tool schema does not prove equal success on
a long task involving third-party applications.

## Settings and detail routes

| Area | Shared behavior checked | Apple implementation / remaining evidence |
| --- | --- | --- |
| System | Execution mode, discovered terminal shells, theme/language, thinking visibility, presets, custom colors/color format/radius/reset, interface/chat/code fonts, three font-size zones, proxy type/host/port/user/password, close-window behavior, tray title privacy/running count | `NativeSettingsPage`, `nativeDesktopSystem`, `nativeDesktopAppearance`, `nativeFontSettings`, `nativeDesktopProxy`; this batch fixes proxy expansion and blur/Return commits, custom-font commits and searchable font lists. Remote rendering and installed settings persistence must be checked on the new commit. |
| Providers | Vendor buckets, ordering, add/edit/delete, URL/API key/auth/OAuth accounts, model discovery/import/manual models; model context/output limits and four cost rates; request proxy/retries/cache retention/custom headers; usage API/JavaScript/secret/timeout/test; failover queue, thresholds, switches/cooldown; retry HTTP codes/patterns; title/commit models | `nativeProviderList`, `nativeProviderModels`, `nativeProviderImports`, `NativeProviderModelSettings`, `NativeProviderRequestSettings`, `NativeProviderRuntimeSettings`, `nativeOAuthAccounts`; model parsing and runtime reducers are shared. Live provider/OAuth requests and every detail route still need packaged-app evidence. |
| Shortcuts | Summon, toggle, new chat, pin; enabled state, recording/change/clear/defaults, conflict and registration failures | `GlobalShortcutsSection` native branch, `nativeGlobalShortcuts`, `PresentationShortcutRecorder`; real registration and macOS permission behavior require the packaged app. |
| Backup/sync | Local export/import, backup scope and automatic backup; WebDAV preset/URL/user/password/clear/remote directory/profile, save/test/upload/download, automatic sync and last-sync/dirty/errors | Both renderers call `useBackupSyncData`; Apple uses `NativeBackupSyncSection` and native confirmation dialogs. Local file round-trips and remote WebDAV are not established by rendering fixtures. |
| Computer use | Native/external driver choice, path/add/check/install/progress; enable; accessibility and screen-capture status/request/open-settings/refresh | Both renderers call `useComputerUseSettings`; macOS invokes the native Swift dispatcher through Rust. No complete browser → image generation → Word/Excel → HTML/PPTX → animation task has been verified. |
| Tool permissions | All shared tool categories, allow/ask/deny, category application/reset, tool descriptions, command safety mode and explanation | `createNativeToolPermissions` consumes the shared tool-policy catalog. Speech/policy rendering fixtures exist; installed approval and execution behavior must also be exercised. |
| Voice | Desktop provider enable/select, all `STT_PROVIDER_FIELDS`, saved-secret indication, connection test; mobile OS microphone/recognition permissions and settings route | Apple desktop and shared desktop use the same provider-field catalog and speech service. iOS must match Android mobile capability routes; actual device recording/network tests remain necessary. |
| Soul | Presets/list/select/new/delete/confirmation, identity/name/personality, language/style, counters, reload/save/status | Both renderers run `SoulSection` state and persistence; native editors use multiline fields. Packaged save/reopen is still required. |
| Memory | Global/project/daily lists, search/type/scope, quotas/status, create/slug/description/body, detail edit/append/review/accept/delete/wipe confirmations | `MemoryPanel` and `NativeMemoryPanel` share `useMemoryPanelData`; `MemorySettingsDrawer` also has a native branch with organizer/summary model, schedule/time/weekday/scope/mode, next run/history/run now and quota warnings. List and drawer routes both belong in installed validation. |
| Other | Hooks, cron and SSH, including their nested forms | This batch restores the three descriptions. Native hooks include type/lifecycle/sequential/timeout/bash/HTTP requests. Cron includes expression/remaining executions/timeout/workdir/model/reasoning/prompt/bash/HTTP and run history. SSH includes host/user/port/password/private key/passphrase/import/proxy/known-host reset. Shared form validators remain authoritative; all detail dialogs need visual checks. |
| Local/cloud | Desktop Web UI enable/scope/port/status/URLs/copy, pairing code/rotation/device revoke; mobile LAN address/code/device name/pair/check/disconnect/prefer/open; blocked terminal/browser/SSH/Git/file-write capabilities; cloud enable/repository owner/name, GitHub vault token/status/save/remove | `nativeAccessSettings` calls the same Rust services. Stale requests and secret handling have adapter tests; cross-device pairing and cloud execution still need integration evidence. |
| About | App name and current version | Native matches `AboutSection`'s current content. Update UI must not be invented as an About feature; it has its own shared flows. |

## Sidebars and workspaces

| Area | Finding / batch change | Follow-up evidence |
| --- | --- | --- |
| Left navigation | New chat, skills, MCP, files, workspace groups, workspace history, recent history/pagination/retry/search and settings already have shared callbacks. Mobile tools additionally route to shell, browser, SSH, Git and background tasks. | Actual installed navigation, empty/loading/error states, scrolling and large text. |
| Workspace operations | Source audit found that native project/group menus were absent. This batch connects project pin/rename/archive/restore/remove, project settings/new chat/file-tree/Finder, group create/rename/delete and move-to-group to existing `ChatPage` handlers. | Adapter tests cover real dispatch, default workspace protection, running-workspace removal, removal confirmation/cancel and retired targets. SDK snapshots must cover the newly reachable rows. |
| Project settings | `WorkspaceProjectSettingsDialog` was mounted only in the shared-renderer return branch. It is now mounted in the native return branch too and opens the existing native `ProjectRootsSection`. | Installed add/remove authorized roots and navigation back. |
| Workspace order/archive | Native previously displayed the raw project order. It now uses `sortWorkspaceProjectsByActivity` and displays archived projects separately with restore actions. | Compare pinned/running/recent ordering with shared desktop and Android; archived projects must not expand active history. |
| Right sidebar | Native lacked per-tab close buttons and keyboard navigation. The panel-level close incorrectly dismissed the active document. This batch separates hide from close, adds per-tab close, and implements arrows/Home/End/Delete with RTL parity. | Verify actual browser, terminal, file and side-chat sessions remain alive on hide; actual close must invoke the shared dismiss handler. |
| Terminal / Git / SSH | Desktop native terminal, Git review and SSH controllers are shared Rust-backed routes; SwiftTerm provides native terminal rendering. Mobile shell and SSH have separate capability-specific adapters. | Terminal input/resize/EOF/cancel, Git stage/commit/diff/conflicts, SSH authentication/host trust/SFTP need installed evidence; route presence alone is insufficient. |
| File previews | Native source editor, Markdown/math/Mermaid, image, PDF, Office/spreadsheet and HTML preview routes exist. | Test actual files, save/reopen, artifact download, annotations and open-in-application. Browser/HTML preview WebKit is distinct from using a WebView as the application UI. |

## Chat and task results

`NativeChatPage` uses the existing composer store, transcript/live store, activity
store, approval controller and queued-turn handlers. The audit checked model
selection, execution mode, plan/web-search/thinking controls, context usage,
attachments/skills, stop, queued edit/run/reorder/remove, streamed work, tool
approval/question cards and file/diff/artifact actions. Adapter tests exercise
these actions. CI 274's mounted inline-math images were visually inspected;
the restored formula is actual ink, not just an accessibility label.

Remaining acceptance includes installed chat send/stop/reopen, actual tool
execution and streamed results, all settings detail pages in light/dark and
narrow/wide layouts, keyboard/navigation behavior, and a comparable cross-platform
task with identical provider/configuration/tool inputs. Model outputs themselves
are not deterministic equality evidence. The requested 90% visual similarity has
not been measured or established.

## Build and runtime evidence

- Baseline CI 274 / `33bf6b8`: all eight jobs passed; macOS 171 and iOS 176 SDK
  tests passed. These results precede this batch.
- Release 127 / `37160487134`: Windows, Linux and Android passed. The Android APK
  was installed and passed settings/environment/stdout/rootfs cwd/Bash/Python/pip/
  live stdin/EOF smoke checks. Its real screenshots were inspected as references.
- Release 127 macOS ARM and Intel: final Rust static linking failed on SwaTex
  `compress2`/`crc32`; this batch adds explicit zlib linking for the static consumer.
  The actual macOS application screenshot harness did not run.
- Release 127 iOS: device IPA construction succeeded; simulator construction failed
  when re-staging read-only SwiftPM font files over device resources. This batch
  makes only staged resources writable before/after copying. A real Python CLI
  regression covers repeated staging and unchanged source permissions.
- New Swift rendering/commit tests will run remotely. Installed iOS shell cancel,
  installer behavior, screenshots and actual macOS screenshots remain pending.
- Local checks for this batch: 512 shared/native presentation tests and five
  Apple resource CLI tests passed, with no skipped cases. TypeScript no-emit,
  architecture and the 55-kind/44-property native contract checks also passed.
  These checks did not compile Swift or run installed Apple applications.

Push this as one reviewed batch. Use the new commit's CI results, then trigger the
full release with smoke checks. Do not substitute an older green CI for the new
commit. No local build/dev/install/cargo or Swift compilation is permitted.
