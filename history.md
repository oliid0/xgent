# Current objective
Repair desktop settings and composer, Android compilation, and iOS navigation while using `xx`/`yy` as function references without importing their UI or gateway code.

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
- Applied Biome's two import/format corrections after TypeScript and native presentation checks passed; remaining consolidated checks continue after this fix.

## Evidence and decisions
- Started from clean `main` at `3175331`; inspected prior history, screenshots, `xx`, `yy`, Astryx 0.6 source/MCP/CLI, Swift documentation, and release logs.
- CI at `83e621a` and `da80012` passed. Unsigned release `35888070327` at `83e621a` passed Android, iOS, Windows, Linux, and both macOS builds; the earlier Android Kotlin and macOS Intel packaging failures no longer reproduce.
- Installed Windows client saved, read, and deleted a temporary global memory; the list returned to zero. Its window restored the persisted 561×1085 client size and position from `main-window-size.json`. No storage or geometry change is justified by this reproduction.
- `xx` provider persistence differs from this repository only by an unconditional auto-sync call; the current desktop guard is required because that service is desktop-only.
- Installed Windows client: compact language selection saved; in wide settings dialog, the visible option did not highlight on hover and clicking it only dismissed the menu. The dialog's popover animation applies a persistent transform, so modal menus now use their measured position without that transform.
- iOS screenshots 1125/1128 show the chat composer painted over the open sidebar. The SwiftUI chat view had placed it in a `safeAreaInset` outside the chat stack; it is now a sibling of the transcript within that stack.
- New visual references 0386–0406 show pale grouped settings cards, circular navigation buttons, and a simple sidebar. They guide styling of existing controls only.

## Remaining
- Verify the desktop selector fix in a new package; inspect other memory entry points and wipe behavior only when a safe reproduction is available.
- Inspect and complete mobile SSH, Git review, resource library, files, MCP/Skills store, permissions, and routing against `yy`.
- Verify native SSH and Git in a new Android/iOS release build after the `git2` type fixes; correct compile or runtime failures.
- Push and track CI/release for mobile Git and file import; then continue deeper `xx`/`yy` function review and rendered/mobile runtime checks. Consolidated local checks passed: `pnpm check`, `pnpm native:check`, `pnpm lint`, `pnpm test:non-native` (1211/1211).

## Touched files
- Prior files above, plus `.github/workflows/desktop-release.yml`, mobile Git/SSH sources, workspace FS, SwiftUI attachment picker, mobile Files/Git panels, shared file tree, i18n, and `history.md`.

## Verification/CI
- CI passed at `a76d1e2` and `7f8838b`. Release `35892585519` passed all desktop targets but Android/iOS exposed nine `git2` return-type errors now fixed locally. Android passed the prior NDK `ranlib` step. Local TypeScript, native mapping, lint, and 1211 non-Cargo tests passed for the current source edits; new CI is pending.
