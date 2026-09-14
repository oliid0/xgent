# Current objective
Make the iPhone SwiftUI application preserve the Astryx mobile hierarchy, sizing, entry routes, and functional states instead of substituting system navigation/form layouts.

## Completed
- Removed iOS `NavigationStack`, toolbar reparenting, `Form`, and `List` substitutions. Chat, browser, file tools, root hubs, and settings now retain serialized Astryx order with custom 68pt headers.
- Corrected axis-aware `fill`: horizontal fields expand in width without claiming infinite height; flexible vertical browser/editor/transcript regions still consume remaining height.
- Restored MobileNav behavior (320pt/85vw drawer, scrim, fixed header/footer), capped list sheets at 62%, and kept long settings/detail sheets tall.
- Routed Plugins and More to functional root Skills/MCP pages, with the shared native drawer available from both. MCP add/edit/delete/toggle and Skills search/refresh/preview/toggle remain wired to shared settings/state.
- Matched browser hierarchy (header, tabs, address controls, viewport) and file hierarchy (header/location, search/refresh, four touch actions, tree); moved hidden-file control out of the search row.

## Evidence and decisions
- Inspected the clean baseline, prior history, SwiftUI host/adapters/tests, Web mobile sources, Astryx 0.6 installed source, Astryx MCP results, and CLI `manifest`/intent discovery before implementation.
- WebKit remains a noninteractive transport and browser-content viewport only; all application chrome uses SwiftUI.
- No build/dev/Cargo command was run. Windows cannot render or compile the iOS target, so Apple SDK compilation and device rendering remain CI/device responsibilities.

## Remaining
- Track the pushed GitHub workflows through completion; repair any Apple compile or workflow failure with concrete logs.
- Validate final wide/narrow iPhone rendering and interactions on an Apple simulator/device when available.
- Bluetooth connection/read/write, broader system capabilities, mailbox integration, and device shell installation verification remain outside this UI correction.

## Touched files
- Apple SwiftUI compact root/workspace/page/sheet/node renderers and root selection.
- Native chat/browser/files/Skills/MCP adapters, route wiring, presentation contract/docs, and regression tests.

## Verification/CI
- `pnpm check`, `pnpm native:check`, and `pnpm lint` pass.
- `pnpm test:non-native`: 1,208 passed, 0 failed, 0 skipped.
- GitHub CI: pending push.
