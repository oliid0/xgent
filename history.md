# Current objective
Finish iOS/mobile and PC repairs using yy/xx evidence, then align mobile/narrow layouts without importing xx/yy UI or gateway code. Mobile trajectory viewing/persistence is removed. Push only after the full goal and final checks succeed.

## Completed
- Earlier local commits: mobile SSH proxy transport, PC Skill backup/STT registration, mobile trajectory removal, and shared command safety/workspace resource persistence. Local main is ahead of origin/main; no push.
- This turn: isolated desktop trajectory in a lazy component so iOS no longer subscribes or loads it. HealthKit status failure no longer blocks other personal permission states.
- iOS More uses a sheet menu. Opening the sidebar hides the covered chat/store root to prevent floating Liquid Glass controls from painting over the drawer.
- Settings, Skills, MCP, SSH, Cron, Hooks and Soul routes and their detail forms reuse one native sheet session with ordered revisions. Added a lifecycle regression test.
- Ported existing WebDAV backup snapshot/config/test/upload/download core to mobile and registered six commands. Mobile shows WebDAV actions; desktop rfd file dialogs and background auto-sync are excluded.
- Native provider model discovery now activates fetched models, matching desktop behavior and preserving other providers. The settings flow test covers this path.

## Remaining
- Provider/model/chat failure and roughly three-second blank startup need device error/timing evidence; no speculative network/startup edit. A question about the exact model-fetch error and blank API key is pending.
- HealthKit signing, SwiftUI layer behavior, settings navigation, WebDAV backup and Android/iOS builds require device/CI verification. Mobile local backup file picker/export and background sync remain unimplemented.
- Continue broader yy mobile and xx PC functional review, Android shell and visual parity with narrow PC. Do not push until full acceptance.

## Evidence and decisions
- Screenshots 1133–1141 show blank startup, full-page More, floating composer/store cards over sidebar, HealthKit entitlement error, backup command missing and empty provider model list.
- NativeSettingsPage swapped NativeSurface owners on section changes; SwiftUI sheet identity followed surface ID. Session sharing keeps it stable. Astryx MCP/CLI and Apple Swift docs informed drawer/sheet behavior.
- Backup WebDAV functions existed only behind desktop cfg; rfd 0.17.2 officially supports desktop platforms, so mobile local file actions were omitted instead of left dead.

## Verification and CI
- 1,275 non-Cargo tests, pnpm check, pnpm lint and pnpm native:check passed for the sheet/backup change. The later provider activation edit passed its focused settings test, pnpm check and pnpm lint. No Cargo/build tools per instructions. git diff --check passed during review.
- Prior revision: 1,274 non-Cargo tests and check/lint/native:check passed. Remote release run 36030128646 succeeded on ea5f4e0, before current local changes. No push until full goal complete.
