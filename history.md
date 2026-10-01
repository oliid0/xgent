# Native Apple parity — current progress

- Objective: manually implement native SwiftUI parity: iOS/Android and macOS/desktop, with shared business actions.
- Starting evidence: clean b72a443; CI 36896256532 macOS passed, iOS secure-input interaction/AX failed, Rust dependency installation timed out before Cargo.
- Completed: configuration-secret AutoFill behavior and field identity; retained AX failure diagnostics; native sidebar pin/rename/move/delete through SidebarStore with confirmations, running/pending restrictions, rollback and runtime callbacks; handwritten SwiftUI rows with independent selection/menu controls and large-text layouts. Corrected stale architecture README and slow CI APT mirror preference.
- Research: GitHub MCP, Swift MCP, Swift Package Index, Astryx MCP/CLI, yy provider forms, supplied references and native CI artifacts. Existing packages cover these changes; no speculative dependencies.
- Remaining: broad feature/behavior parity audit, complex CUA/browser/app workflows, rendered Apple verification. Full platform equivalence is not established.
- Touched: Apple controls/sidebar/renderers and tests; NativeChatPage, nativeConversationActions, ChatPage and adapter tests; presentation README; CI.
- Verification: TypeScript, lint, native contract and architecture passed. Full non-Cargo suite has one new dialog-test failure: desktop sidebar was not opened; corrected test setup, rerunning that test. Swift compilation/rendering and remote CI pending.
- Verification update: all 1,526 other non-Cargo tests passed; corrected desktop setup test now passes. Final diff reviewed; no local build/dev/Cargo commands used. Remote CI remains pending.
- Next evidence/fix: default macOS system route omitted the desktop appearance/size/window controls. Added reachable native groups using the existing appearance reducer, color validation, preset/reset rules and persisted close-window setting; font families, Shell/proxy/tray remain open gaps.
- Added mounted settings-route and real reducer/theme tests for desktop appearance, invalid input rejection, reset/preset transitions, stale controls and persistence. Unusual existing font scale values display their actual percentage.
- Applied repository formatting and import order to the changed settings adapter/helper immediately after editing.
- Removed the new helper's non-null assertion; current percentage labels have an explicit fallback.
- Recorded formatting of the appearance helper; preparing consolidated checks for this new settings change.
- New real-theme test found custom accents remained Matcha's default (#3e481d). Installed Astryx 0.6.3 defineTheme preserves inherited __inputTokens; its resolver reapplies them after the custom generated scale. Explicit accent token tuples now override that inherited preset value for both native and Astryx clients, using the documented API.
- Added regression across all three presets, compact/desktop and light/dark, including native resolved colors and inherited token tuples.
- Extended desktop mounted screenshots with actual appearance control kinds (colors, switches, preset/radius/size/window pickers and reset) at narrow/wide and accessibility sizes. Shared frontend/ Rust checks passed at a3ba631; macOS tests passed, iOS tests are running.
- Corrected screenshot fixture navigation to show General appearance controls directly; provider interaction fixture remains separate. New desktop route and all affected theme tests pass; TypeScript and lint pass.
