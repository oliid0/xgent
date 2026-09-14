# Current objective
Restore mobile model/tool execution, installable PRoot/a-Shell, native assistant capabilities, and SwiftUI parity with Astryx WebUI.

## Completed
- Mobile More stays an anchored menu. iOS uses the existing sidebar glyph, Astryx drawer width, background interaction isolation and scrim; sidebar rows omit platform-default disclosure chrome.
- Bluetooth permissions and bounded BLE discovery connect Swift/CoreBluetooth and Kotlin/Android through typed Rust IPC to MobilePersonalData, without Shell. Includes denied/off/unavailable/error states and localized settings.
- iOS commands now use linked dash explicitly; installation probes cover POSIX variables, loops and conditionals. README documents exact resource sources and packaging/device installation responsibilities.

## Evidence and decisions
- Preserved the user's initial history reset; inspected status/diffs before edits.
- Astryx 0.6 CLI manifest/build, MCP and installed MobileNav source; Swift MCP CoreBluetooth docs; Android official BLE docs; pinned ios_system source (dispatcher versus legacy sh parser); yy RootfsManager and agent tool definitions.
- Existing no-shell registry already exposes filesystem, Skills, network MCP and personal assistant tools. No claim that device model traffic is repaired without reproduction evidence.

## Remaining
- Reproduce device model/tool/settings failures and complete all-screen Apple/Android visual and interaction parity.
- Bluetooth connection/read/write control, broader system capabilities, mailbox service integration and device shell installation verification remain outstanding.
- Push this verified increment; track CI and native packaging/device diagnostics.

## Touched files
- SwiftUI drawer, mobile menu, shared assistant client/tools/settings/translations and regressions.
- mobile-assistant native BLE discovery, Rust IPC/ACL, iOS usage description/linkage; mobile-execution command dispatch/probes/README.

## Verification/CI
- pnpm check, pnpm native:check and pnpm lint pass.
- Full non-Cargo run: 1,208 tests, 1,207 passed; sole failure was new Chinese text encoding. Fixed it; all four i18n tests pass on rerun. No other failures.
- Local builds/dev servers/Cargo not run. Native compilation and final rendered/device behavior not yet verified.
