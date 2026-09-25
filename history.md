# Current objective
Repair desktop and mobile function paths using xx/yy evidence. Keep existing UI and gateway architecture; mobile has no trajectory viewer or trajectory persistence. Complete distinct functional gaps, verify once, then push only when the full goal is ready.

## Completed
- Mobile native SSH reuses the existing desktop direct, HTTP CONNECT and SOCKS5 transport. PC Skill settings now seed and mark automatic backup; desktop STT commands are registered. Commits: 2c2e71b and c32e3e6.
- Earlier mobile Shell DNS/proxy, MCP cwd/store, Skill discovery, files and permission fixes remain in history before ea5f4e0.
- Current change: removed the uncommitted mobile trajectory command registration and gated manual compaction trajectory recording to the existing desktop bridge. The native composer model selector now uses the general model label; desktop trajectory remains available.
- Restored persistence of command safety mode and per-workspace Skill/MCP resource selection in the shared system settings writer; added a round-trip regression test and refreshed stale settings fixtures. The save transaction previously deleted both fields and omitted them from its insert list, although defaults and the runtime read them.

## Remaining
- Native Rust/Swift/Kotlin compilation, packaged app and Android/iOS device acceptance remain open. Validate SSH proxy, Skill backup, STT and mobile work process on devices.
- Continue broad yy mobile and xx PC functional review. Do not add a mobile trajectory viewer or persistence path. UI alignment waits until function paths work.

## Decisions/evidence
- NativeChatPage trajectory controls already require desktop form factor and ChatPage passes trajectoryAvailable=false on native mobile. Normal chat trajectory recording already requires desktopBridgeEnabled; manual compaction was the exception and is now gated the same way.
- The upstream russh connect_stream API and existing desktop SSH handshake justified transport reuse. The xx desktop handler contains the six STT registrations; Xgent implementations were already present.

## Touched files
- Current change: crates/fronted/src/pages/ChatPage.tsx, crates/fronted/src/pages/chat/runtime/useManualCompaction.ts, crates/fronted/src/presentation/NativeChatPage.tsx, crates/fronted/test/presentation/native-chat.test.mjs, history.md. The pending mobile handler edit was reverted.
- Current turn: crates/fronted/src-tauri/src/commands/config/settings/system.rs and tests.rs, history.md.

## Verification/CI
- Current local revision: 1,274 non-Cargo tests passed; `pnpm check`, `pnpm lint` and `pnpm native:check` passed. Rust tests and native builds were not run locally because project instructions prohibit Cargo and build tools. `git diff --check` passed.
- GitHub release run 36030128646 on remote ea5f4e0 completed successfully for Android APK, iOS IPA, Windows, Linux and both macOS architectures. It predates the local trajectory and settings changes, so it does not validate this revision. Device acceptance remains open. Full goal is incomplete; no push by this agent.
