# Current objective
Repair desktop and mobile function paths while using `xx`/`yy` as references without importing their UI or gateway code. Current focus: desktop proxy/providers/authorized external CUA driver setup and mobile native/optional-shell/LAN/cloud tool orchestration with complete activity and result evidence.

## Completed
- Registered existing desktop backup, STT, and model failover commands that had been defined but omitted from Tauri's desktop invoke handler.
- Corrected the Android Bluetooth adapter nullability error reported by release CI at `BluetoothDiscovery.kt:41`.
- Kept iOS settings child routes inside the original SwiftUI sheet; the current route now follows the presentation stack.
- Moved the iOS chat composer into the chat page's main SwiftUI stack so the sidebar covers the entire chat surface, including its input area.
- Split mobile personal-assistant device permissions from tool execution policies: each now has a distinct settings route, and the assistant page no longer renders tool policy controls.
- Updated the existing native settings flow check to verify both distinct routes and tool policy editing from the tool-permissions page.
- Tightened that check to inspect the policy controls inside settings groups, so it proves the assistant route excludes them and the tool-permissions route includes them.
- Allowed the composer execution controls to wrap within their available width.
- Routed the iOS chat header's More action to its existing tool list as a full-screen root page.
- Removed the extra branded label from the iOS system launch storyboard; the system-required launch surface now yields directly to app content.
- Routed mobile SSH and background tasks from chat to root pages; scheduled tasks and Hooks now close to chat instead of bouncing between each other.
- Passed the root/sheet presentation mode through scheduled-task and Hook detail pages so chat tools do not open a new drawer.
- Kept background process logs in the same root surface instead of presenting a second sheet.
- Added ClawHub `public-github` download handoff support to the existing Skill installer, constrained to a pinned commit and validated relative path.
- Added a focused Rust regression test for valid handoffs, path traversal, mutable refs, and ordinary Skill JSON.
- Aligned Skill card links with ClawHub's documented canonical `/<owner>/skills/<slug>` route.
- Removed transformed entry geometry from popovers inside native desktop dialogs after reproducing the wide settings menu's visible but unclickable options.
- Gave existing iOS SwiftUI settings groups rounded card containers with inset rows, following the new visual references while preserving their actions.
- Styled the existing iOS sheet/page navigation buttons as bordered circles to match the visual references without adding controls.
- Restored the typed Xgent heading in the compact sidebar header so its navigation has the same clear hierarchy as the reference.
- Replaced the mobile file header's sandbox absolute path with the workspace folder name and removed the root row's repeated absolute path; file operations still use the original cwd and relative paths.
- Applied the four formatting changes requested by Biome in the scheduled-task, Hooks, and native-settings routes.
- Updated two existing native presentation tests to assert the requested full-page iOS More route and in-stack composer layout instead of their obsolete menu/inset behavior.
- Replaced mobile SSH shell invocation and credential temp files with a native `russh` session; wired authentication, known-host trust, bounded output, timeout, duplicate-run protection, and cancellation. Mobile builds compile the SSH implementation up to the later Git source errors.
- Added a mobile-only libgit2 backend for local repository status, history, diffs, commit details, stage, unstage, discard, init, and commit. Rewired SwiftUI/Astryx mobile Git review to native commands. Added HTTPS fetch/push and clean fast-forward pull using the native GitHub token vault. Missing Git author identity now shows name/email fields. Mutations reject worktree path escapes and empty commits; updated the old shell-dependent hint.
- Bound Android's vendored OpenSSL cross-build to the NDK `llvm-ranlib` after release CI failed because its inferred `aarch64-linux-android-ranlib` executable does not exist.
- Added a workspace-scoped, atomic native file import command for mobile Files: validates the selected filename and destination, caps decoded content, avoids overwrites with numbered names, and writes bytes without shell access.
- Exposed the existing iOS SwiftUI picker as a file-only option for Files and added an Android Astryx file-tree import action with a post-import refresh hook.
- Wired both mobile file pickers to the native atomic import command, with 9-file/20 MB limits, selected-folder targeting, duplicate-safe names, visible errors, and refreshed tree selection.
- Added a focused Rust test proving binary imports preserve existing files and reject traversal through both folder and filename inputs.
- Fixed mobile `git2` return-type handling from Android/iOS compiler logs (`StatusEntry::path`, `Reference::name/shorthand`, `Commit::summary`); both mobile release jobs reached the same nine source errors after the NDK fix.
- Routed mobile previews of editable text formats through the existing guarded text reader so Markdown, HTML, CSV/TSV, and plain text render their contents and retain save conflict checks.
- Kept the SwiftUI Files root mounted when it opens a document; closing its root preview/editor now reveals the file list again. Android retains its existing fullscreen overlay route.
- Preserved per-mode provider usage scripts across mode switches and persistence using the existing provider settings payload, following the behavior in `xx` without changing the provider UI.
- Fixed the remaining mobile Git history lifetime error reported by Android release CI by owning the commit author's name before constructing the history entry.
- Routed iOS spreadsheet and presentation previews to an inline SwiftUI Quick Look controller backed by a bounded temporary file; converted HTML documents use that route too, and unsupported types show a visible error. Kept platform-specific rendering branches syntactically independent.
- Applied Biome's requested formatting and import order for the provider usage script change after the consolidated checks; TypeScript and native mapping checks passed.
- Applied Biome's two import/format corrections after TypeScript and native presentation checks passed; remaining consolidated checks continue after this fix.

## Evidence and decisions
- Started from clean `main` at `3175331`; inspected prior history, screenshots, `xx`, `yy`, Astryx 0.6 source/MCP/CLI, Swift documentation, and release logs.
- CI at `83e621a` and `da80012` passed. Unsigned release `35888070327` at `83e621a` passed Android, iOS, Windows, Linux, and both macOS builds; the earlier Android Kotlin and macOS Intel packaging failures no longer reproduce.
- Installed Windows client saved, read, and deleted a temporary global memory; the list returned to zero. Its window restored the persisted 561×1085 client size and position from `main-window-size.json`. No storage or geometry change is justified by this reproduction.
- `xx` provider persistence differs from this repository only by an unconditional auto-sync call; the current desktop guard is required because that service is desktop-only.
- The native file preview previously used the binary preview reader for text formats; that response omits text content except for DOCX/PPTX, leaving the mobile file page empty despite a valid file.
- Apple presentation selects the last mounted root document. The Files page was unmounted before its preview/editor appeared, so closing the latter returned to chat instead of Files.
- `xx` keeps separate usage-query scripts for general, New API, and custom modes; current mode switching changed only `mode`, so one mode's script leaked into the next. The provider storage preserves additional JSON fields, and Rust reads only the active `script`.
- Release `35905392293` reached mobile Rust compilation; Android exposed one `git2::Signature` temporary lifetime error in `mobile_git_history`, now addressed.
- `yy` uses Quick Look for Office files; Apple documents `QLPreviewController` support for Microsoft Office and RTF and recommends `canPreview`. The native file page previously fell through to an empty state for spreadsheets and presentations.
- Installed Windows client: compact language selection saved; in wide settings dialog, the visible option did not highlight on hover and clicking it only dismissed the menu. The dialog's popover animation applies a persistent transform, so modal menus now use their measured position without that transform.
- iOS screenshots 1125/1128 show the chat composer painted over the open sidebar. The SwiftUI chat view had placed it in a `safeAreaInset` outside the chat stack; it is now a sibling of the transcript within that stack.
- New visual references 0386–0406 show pale grouped settings cards, circular navigation buttons, and a simple sidebar. They guide styling of existing controls only.

## Remaining
- Verify the desktop selector fix in a new package; inspect other memory entry points and wipe behavior only when a safe reproduction is available.
- Inspect and complete mobile SSH, Git review, resource library, files, MCP/Skills store, permissions, and routing against `yy`.
- Verify native SSH, Git, SwiftUI Quick Look, and file import in a new Android/iOS release build and on devices; correct compile or runtime failures.
- Push this follow-up and track CI/release; continue deeper `xx`/`yy` function review, MCP/Skills store validation, and rendered/mobile runtime checks. The desktop selector fix still needs a new client package after the existing running process can be safely closed.
- Audit the user's compound mobile workflow end to end: browser research, health/nearby-device permissions and data, MCP/Skill execution, workspace file writes/diffs, optional shell package installation, LAN PC/cloud delegation, and chat/activity traces. Repair concrete missing edges without importing reference UI/gateway code.

## Touched files
- Prior files above, plus `.github/workflows/desktop-release.yml`, mobile Git/SSH sources, workspace FS, SwiftUI attachment picker, mobile Files/Git panels, shared file tree, i18n, and `history.md`.

## Verification/CI
- CI passed at `a76d1e2`, `7f8838b`, and `035f7cf`. Release `35905392293` reached Android/iOS Rust compilation; both failed on the same history-author lifetime error now fixed locally. Desktop release jobs are still finishing. Current `pnpm check`, `pnpm native:check`, `pnpm lint`, and `pnpm test:non-native` pass (1212/1212). A new CI/release run is pending.
