# Native Apple parity — current progress

- Objective: manually implement SwiftUI parity (iOS/Android, macOS/desktop) with shared business actions and native application UI.
- Evidence: starting b72a443 was clean; baseline CI 36896256532 failed iOS secure-field AX/input and timed out installing Rust dependencies before Cargo. yy provider form grounds configuration-secret AutoFill behavior.
- Completed: native sidebar pin/rename/move/delete with shared SidebarStore, confirmation, rollback, running/pending/busy restrictions and post-success runtime callbacks; independent SwiftUI selection/menu controls, large-text and context menus. Changes to secure-field identity/AutoFill and realistic UIKit editing events await Apple verification.
- Completed: reachable macOS appearance/colors/radius/reset/zone sizes/window behavior on the default system route. Fixed shared custom accent inheritance across all three Astryx presets; verified real native theme results in compact/desktop and light/dark modes.
- Research: GitHub MCP, Swift MCP, Swift Package Index, Astryx MCP/CLI, installed Astryx 0.6.3 code, yy and supplied images/native artifacts. Existing packages cover current changes.
- Remaining: inspect final native screenshots/AX and achieve green CI; macOS font families/Shell/proxy/tray controls remain missing. Broad feature/CUA/browser/app workflow parity remains unproven and requires further work.
- Touched: Apple controls/sidebar/renderers/tests; NativeChatPage/NativeSettingsPage and action/appearance helpers, ChatPage; shared appearanceTheme; regression tests; presentation README; CI mirror preference.
- Verification: local pnpm test:non-native 1,529/1,529 passed; pnpm check/lint, native contract and architecture passed. No local build/dev/Cargo used. a3ba631 pushed, GitHub MCP dispatched CI 36916238529: frontend, Rust, workflow/architecture/diff and macOS package passed; iOS still running. Follow-up 8dc2510 committed locally, pending push after current Apple diagnostics.
