# Native Apple parity — current progress

- Objective: manually implement native SwiftUI parity: iOS/Android and macOS/desktop, with shared business actions.
- Starting evidence: clean b72a443; CI 36896256532 macOS passed, iOS secure-input interaction/AX failed, Rust dependency installation timed out before Cargo.
- Completed: configuration-secret AutoFill behavior and field identity; retained AX failure diagnostics; native sidebar pin/rename/move/delete through SidebarStore with confirmations, running/pending restrictions, rollback and runtime callbacks; handwritten SwiftUI rows with independent selection/menu controls and large-text layouts. Corrected stale architecture README and slow CI APT mirror preference.
- Research: GitHub MCP, Swift MCP, Swift Package Index, Astryx MCP/CLI, yy provider forms, supplied references and native CI artifacts. Existing packages cover these changes; no speculative dependencies.
- Remaining: broad feature/behavior parity audit, complex CUA/browser/app workflows, rendered Apple verification. Full platform equivalence is not established.
- Touched: Apple controls/sidebar/renderers and tests; NativeChatPage, nativeConversationActions, ChatPage and adapter tests; presentation README; CI.
- Verification: TypeScript, lint, native contract and architecture passed. Full non-Cargo suite has one new dialog-test failure: desktop sidebar was not opened; corrected test setup, rerunning that test. Swift compilation/rendering and remote CI pending.
- Verification update: all 1,526 other non-Cargo tests passed; corrected desktop setup test now passes. Final diff reviewed; no local build/dev/Cargo commands used. Remote CI remains pending.
