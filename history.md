# Current objective
Repair desktop and mobile function paths using xx/yy evidence. Keep existing UI and gateway architecture; mobile has no trajectory viewer or trajectory persistence. Complete distinct functional gaps, verify once, then push only when the full goal is ready.

## Completed
- Mobile native SSH reuses the existing desktop direct, HTTP CONNECT and SOCKS5 transport. PC Skill settings now seed and mark automatic backup; desktop STT commands are registered. Commits: 2c2e71b and c32e3e6.
- Earlier mobile Shell DNS/proxy, MCP cwd/store, Skill discovery, files and permission fixes remain in history before ea5f4e0.
- Current change: removed the uncommitted mobile trajectory command registration and gated manual compaction trajectory recording to the existing desktop bridge. The native composer model selector now uses the general model label; desktop trajectory remains available.

## Remaining
- Native Rust/Swift/Kotlin compilation, packaged app and Android/iOS device acceptance remain open. Validate SSH proxy, Skill backup, STT and mobile work process on devices.
- Continue broad yy mobile and xx PC functional review. Do not add a mobile trajectory viewer or persistence path. UI alignment waits until function paths work.

## Decisions/evidence
- NativeChatPage trajectory controls already require desktop form factor and ChatPage passes trajectoryAvailable=false on native mobile. Normal chat trajectory recording already requires desktopBridgeEnabled; manual compaction was the exception and is now gated the same way.
- The upstream russh connect_stream API and existing desktop SSH handshake justified transport reuse. The xx desktop handler contains the six STT registrations; Xgent implementations were already present.

## Touched files
- Current change: crates/fronted/src/pages/ChatPage.tsx, crates/fronted/src/pages/chat/runtime/useManualCompaction.ts, crates/fronted/src/presentation/NativeChatPage.tsx, crates/fronted/test/presentation/native-chat.test.mjs, history.md. The pending mobile handler edit was reverted.

## Verification/CI
- Before the current change: 1,274 non-Cargo tests passed. The trajectory removal passed 30 focused compaction/native-chat/trajectory tests, pnpm check, pnpm lint and pnpm native:check. After adding a mobile assertion, native-chat tests passed 16/16. Static review confirms no trajectory commands in the mobile handler, mobile recorder/viewer routes disabled, desktop routes retained, and no whitespace errors. Native builds are prohibited locally. Full goal is not complete; no push by this agent.
