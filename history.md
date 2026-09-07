# Current objective
Repair failing CI, improve state-grounded CUA, mobile shell reliability, and mobile/right-sidebar layout. User tested the latest build; reports remain valid.

## Completed (2026-09-07)
- CI #99: fixed Tauri command macro registration and sha2 0.11 digest encoding. Removed competing CI auto-push jobs; added finite frontend timeouts and a preview artifact for rendered verification.
- Fixed test-loader runtime overrides that caused CUA tests to spin for six hours. Bounded dispatch waits; updated obsolete tray assertion to retain pin restoration before propagating focus errors.
- CUA preserves native state IDs/action evidence. Recovery state is scoped to its adapter; failed post-action observation is an error and completed actions remain counted; cancelled/deadline sequences cannot report success.
- Android: verified SHA-256 of the exact Alpine 3.22.5 aarch64 archive; bin/sh points to /bin/busybox. Translate guest absolute symlinks into relocatable rootfs-relative links, preserve containment checks, and accept root directory entries.
- iOS: select session before applying cwd; use ios_setDirectoryURL from pinned ios_system v3.0.2; clear borrowed FILE pointers before closing them.
- Mobile panels follow keyboard visual viewport geometry, ignore pinch zoom, clean up listeners, and make hidden retained panels inert. Terminal prevents duplicate dispatch, cancels on close/workspace change/unmount, ignores stale cwd updates, and bounds successful command history to 20 entries.
- Right sidebar allocates remaining height after error banners instead of clipping the active panel. Existing mixed tab ordering and editable previews preserved.

## Evidence / decisions
- Started at 278b410 with clean tree; integrated remote formatting-only f428862 before final checks.
- Astryx MCP search/get plus CLI manifest/build discovery completed; installed Stack source confirms styling hook.
- ios_system pinned header: https://raw.githubusercontent.com/holzschu/ios_system/v3.0.2/ios_system/ios_system.h
- No local build/dev/Cargo commands. Remote CI handles native checks.

## Verification / CI
- pnpm check passed; pnpm lint passed after normalizing Windows checkout line endings.
- pnpm test:non-native: 1115/1116 passed; only failure was the obsolete tray assertion. Corrected assertion; pnpm test:release then passed all 19 tests. Architecture and diff hygiene passed.
- Push, GitHub workflow tracking and rendered verification pending.

## Remaining
- Verify CI on the repair commit and inspect its actual rendered wide/narrow output.
- Android/iOS device startup, cancellation and shell smoke tests still require native target execution; no claim that every crash is fixed.
- Real CSGO/Dota wins, Blender modeling, Unity development and AE animation remain unverified. These require task-level app/asset/postcondition evidence, not mocked clicks.

## Touched files
CI workflow; native CUA registration/component; CUA tool/adapter and tests; test loader/release assertion; App/mobileViewport; mobile panel/terminal; right-sidebar component/CSS; Android RootfsInstaller; iOS MobileExecutionPlugin; history.md.
