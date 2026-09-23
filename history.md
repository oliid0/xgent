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

## Evidence and decisions
- Started from clean `main` at `3175331`; inspected prior history, screenshots, `xx`, `yy`, Astryx 0.6 source/MCP/CLI, Swift documentation, and release logs.
- Latest CI passed, while release failed in Android Kotlin compilation and macOS Intel DMG packaging; iOS IPA and Windows packages succeeded.
- Installed Windows client saved, read, and deleted a temporary global memory; the list returned to zero. Its window restored the persisted 561×1085 client size and position from `main-window-size.json`. No storage or geometry change is justified by this reproduction.
- `xx` provider persistence differs from this repository only by an unconditional auto-sync call; the current desktop guard is required because that service is desktop-only.
- Installed Windows client: compact language selection saved; in wide settings dialog, the visible option did not highlight on hover and clicking it only dismissed the menu. The dialog's popover animation applies a persistent transform, so modal menus now use their measured position without that transform.
- iOS screenshots 1125/1128 show the chat composer painted over the open sidebar. The SwiftUI chat view had placed it in a `safeAreaInset` outside the chat stack; it is now a sibling of the transcript within that stack.
- New visual references 0386–0406 show pale grouped settings cards, circular navigation buttons, and a simple sidebar. They guide styling of existing controls only.

## Remaining
- Verify the desktop selector fix in a new package; inspect other memory entry points and wipe behavior only when a safe reproduction is available.
- Inspect and complete mobile SSH, Git review, resource library, files, MCP/Skills store, permissions, and routing against `yy`.
- Verify and correct the new native SSH channel in mobile CI.
- Run one consolidated non-build verification, inspect the final diff, push, and track CI/release workflows.

## Touched files
- Prior files above, plus `crates/fronted/src-tauri/{Cargo.toml,src/commands/runtime/{mod.rs,mobile_ssh.rs,shell.rs}}`; `history.md`.

## Verification/CI
- TypeScript and native mapping checks passed; lint passed after four formatting corrections. The non-Cargo suite found two obsolete presentation assertions, now updated; focused rerun and new GitHub workflows remain.
