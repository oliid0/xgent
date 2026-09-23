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
- Replaced mobile SSH shell invocation and credential temp files with a native `russh` session; wired authentication, known-host trust, bounded output, timeout, duplicate-run protection, and cancellation. Reviewed and formatted the integration; native CI validation remains pending.
- Added a mobile-only libgit2 backend for local repository status, history, diffs, commit details, stage, unstage, discard, init, and commit. Rewired SwiftUI/Astryx mobile Git review to native commands. Added HTTPS fetch/push and clean fast-forward pull using the native GitHub token vault. Missing Git author identity now shows name/email fields. Mutations reject worktree path escapes and empty commits; updated the old shell-dependent hint.
- Bound Android's vendored OpenSSL cross-build to the NDK `llvm-ranlib` after release CI failed because its inferred `aarch64-linux-android-ranlib` executable does not exist.

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
- Verify native SSH and Git in a new Android/iOS release build after the NDK archiver fix; correct compile or runtime failures.
- Inspect the final diff, push the Git implementation, and track CI/release workflows. The consolidated local checks passed: `pnpm check`, `pnpm native:check`, `pnpm lint`, and `pnpm test:non-native` (1211/1211).

## Touched files
- Prior files above, plus `crates/fronted/src-tauri/{Cargo.toml,src/{lib.rs,commands/{mod.rs,runtime/{mod.rs,mobile_ssh.rs,shell.rs},workspace/{mod.rs,mobile_git.rs}}}}`, `crates/fronted/src/{i18n/config.ts,pages/chat/mobile/MobileGitReviewPanel.tsx}`; `history.md`.

## Verification/CI
- `a76d1e2` CI passed frontend, diff, architecture, workflow checks and Rust tests. Android release `35891447482` failed at vendored OpenSSL's missing cross `ranlib`; iOS and desktop release jobs remain in progress. Consolidated local checks passed before the workflow edit.
