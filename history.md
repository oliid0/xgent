# Current objective
Complete Apple SwiftUI/mobile behavior against IMG_0385-0406 and yy; repair all platform releases.

## Completed / current changes
- SwiftUI root, sidebar, grouped settings, composer, native pickers and mobile device bridges use shared business state.
- Native plugins, scheduled-task forms/execution logs, SSH settings and command panel; wired missing Apple sidebar destinations and SSH panel.
- Android shmem TMPDIR fix passed its previous failure; new PRoot failure needs string.h, now patched against pinned upstream source.
- CI iOS screenshots inspected: native root renders, but default Xcode 16.4 excludes Liquid Glass. Apple release now selects installed Xcode 26.3 and iOS 26 simulator.
- Windows build succeeds but resize restoration still fails; smoke now reports saved native state to identify persistence vs restoration failure.

## Evidence / verification
- Release 34684408057: iOS IPA/simulator, both macOS and Linux pass; Android PRoot and Windows resize smoke fail.
- Astryx 0.5.4 CLI manifest/build and MCP search/get checked; yy OffloadPermissionSettingsView confirms List/Section/system confirmations.
- pnpm check/lint passed; full non-Cargo suite 1177/1177 passed, native mapping current; PRoot patch applies cleanly to pinned upstream.
- Inspected default/dark-large iOS screenshots; fixed overflowing toolbar glyphs and safe-area appearance. Swift changes validated by next native CI.
- No local build/dev/Cargo. Next: commit/push this patch and track GitHub MCP release v0.0.1-native.913.

## Remaining
- Complete CI and rendered wide/narrow interaction validation, including actual Liquid Glass compilation.
- Native library and remaining settings; full mobile device feature parity is not complete.
- Health, motion, Bluetooth, notifications and inbox integration require actual native/service implementations and provisioning.

## Touched areas
Native presentation adapters and mobile settings/SSH, Android PRoot patch, Apple release SDK selection, Windows smoke diagnostics, presentation tests.
