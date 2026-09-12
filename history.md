# Current objective
Complete Apple SwiftUI/mobile behavior against IMG_0385-0406 and yy; repair all platform releases.

## Completed, awaiting native CI
- Enabled SwiftUI root, sidebar, grouped settings, Chat/Work, composer, project creation and terminal using shared business state.
- Native file/photo/camera pickers and voice; mobile clipboard, system settings link and permission refresh.
- Fixed missing location ACL and EventKit write-only authorization reporting.
- Validated Astryx mapping exports; aligned blue accent/rounding with the existing 10% translucent material theme.
- Patched libandroid-shmem against official v0.7 to use app TMPDIR; persist Windows dimensions during resize.

## Evidence / verification
- Previous release 34651086771: Android _PATH_TMP compilation failure; Windows size restoration smoke failure.
- pnpm check/lint passed. Non-Cargo suite: 1174/1175; obsolete radius assertion updated and passed targeted retest. Added native settings/attachment tests passed.
- No local build/dev/Cargo. Commit 228c503 pushed; GitHub MCP dispatched release v0.0.1-native.912 (publish/sign false).
- iOS smoke now requires a SwiftUI root render marker and captures default plus dark/large-text screenshots.

## Remaining
- Track every CI job to success and inspect rendered native/browser layouts and interactions.
- Continue native library, plugins, scheduled tasks, SSH and remaining settings; this is not a completed full migration.
- Health, motion, Bluetooth, notifications and inbox access still require native/integration implementations and appropriate provisioning.

## Touched areas
fronted presentation/native host, App/ChatPage/mobile panels, mobile-assistant, theme, mapping generator, Android preparation, release workflow and tests.
