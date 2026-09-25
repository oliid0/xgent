# Current objective
Finish iOS/mobile and PC repairs using yy/xx evidence, then align mobile/narrow layouts without importing xx/yy UI or gateway code. Mobile trajectory viewing/persistence is removed. Push only after the full goal and final checks succeed.

## Completed
- Earlier local commits: mobile SSH proxy transport, PC Skill backup/STT registration, mobile trajectory removal, and shared command safety/workspace resource persistence. Local main is ahead of origin/main; no push.
- This turn: isolated desktop trajectory in a lazy component so iOS no longer subscribes or loads it. HealthKit status failure no longer blocks other personal permission states.
- iOS More uses a sheet menu. Opening the sidebar hides the covered chat/store root to prevent floating Liquid Glass controls from painting over the drawer.
- Settings, Skills, MCP, SSH, Cron, Hooks and Soul routes and their detail forms reuse one native sheet session with ordered revisions. Added a lifecycle regression test.
- Ported existing WebDAV backup snapshot/config/test/upload/download core to mobile and registered six commands. Mobile shows WebDAV actions; desktop rfd file dialogs and background auto-sync are excluded.
- Native provider model discovery now activates fetched models, matching desktop behavior and preserving other providers. The settings flow test covers this path.
- First discovered or manually added iOS model now becomes the chat selection when none was selected; an empty discovery result reports the existing no-model message. Existing selections remain intact.
- Mobile native voice enablement now persists in the existing local UI settings instead of invoking desktop-only STT commands; a regression test covers the default-disabled state, enable/reload and desktop STT storage.
- Mobile assistant capability rows now render as soon as native status resolves in both settings views, even when the independent OS permission-state query fails; its error remains visible.
- SwiftUI action delivery now requires a synchronous receipt from the live React subscriber. Missing/invalid delivery clears the pending native control with an error instead of leaving it busy indefinitely; a transport regression test covers the receipt lifecycle.
- Mobile registers the local model proxy in Tauri setup before frontend IPC can request its state. Optional memory, vault, scheduler and Skill initialization remains on the background worker; proxy startup failures still reach mobile startup status.
- Memory create/edit errors now appear in the active form, list errors stay with the list, and the settings drawer shows wipe errors. Successful create/save/accept/delete/wipe actions give visible feedback; yy iOS memory save also shows success feedback.
- Memory success feedback is withheld if the required follow-up reload fails; the reload error remains visible instead of reporting a false success.

## Remaining
- Confirm provider/model/chat, action delivery, permission discovery and roughly three-second blank startup on a new iOS build with device timing/errors. The latest successful remote IPA predates all local fixes.
- Native memory management, settings coverage and local backup file operations still lag narrow desktop/yy. HealthKit signing, SwiftUI layer behavior, WebDAV backup, shell and Android/iOS builds need device/CI verification.
- Continue xx PC functional review and yy mobile functional review. After function paths work, fix desktop execution-mode picker clipping, angular containers, and mobile/narrow visual parity. Do not push until full acceptance.

## Evidence and decisions
- Screenshots 1133–1141 show blank startup, full-page More, floating composer/store cards over sidebar, HealthKit entitlement error, backup command missing and empty provider model list.
- NativeSettingsPage swapped NativeSurface owners on section changes; SwiftUI sheet identity followed surface ID. Session sharing keeps it stable. Astryx MCP/CLI and Apple Swift docs informed drawer/sheet behavior.
- Backup WebDAV functions existed only behind desktop cfg; rfd 0.17.2 officially supports desktop platforms, so mobile local file actions were omitted instead of left dead.
- Apple HealthKit authorization status is an independent asynchronous callback. The previous Promise.all withheld all permission rows until it resolved; the native iOS plugin always supplies capability aliases from status.
- Apple WebKit callAsyncJavaScript returns explicit JS values. The native event is cancelable; React cancels it only after validating the action payload, so Swift can distinguish a live receiver from a lost event without adding another bridge API.
- The previous mobile background worker registered ProxyServerState after setup returned, while both provider model discovery and chat call proxy_get_server_info immediately. Desktop setup already registers the same proxy synchronously; yy defers optional network work during cold launch.

## Verification and CI
- Current local revision: 1,277 non-Cargo tests passed; pnpm check/lint and native:check passed. Full diff against origin/main passed git diff --check. No Cargo/build tools per instructions.
- Remote release run 36030128646 succeeded on ea5f4e0, before current local changes. No push until full goal complete.
