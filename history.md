# Current objective
Finish the shared desktop menu/window fixes and make the iOS 26 SwiftUI client compile and match the compact Astryx mobile behavior, including usable native mobile execution settings.

## Completed
- Standard Astryx selectors, menus and popovers now share measured placement, compact width, glass material, checkmark selection, and a single ready-state transform animation that is no longer masked by the popover polyfill; rerender cleanup no longer tears down an active layer.
- Desktop trajectory uses one closeable header, the cron editor header contains only Back, and every matching legacy semantic icon now resolves through the Astryx icon registry.
- Fresh desktop windows remain 1360x850 (15% below 1600x1000); final exit saves geometry, and compact/desktop transitions preserve saved left/right sidebar visibility.
- The iOS application surface remains handwritten SwiftUI with no WebView/generated-root escape hatch. Chat and workspace navigation now use native `NavigationStack` and toolbar controls, the more action is an anchored `Menu`, settings use native `Form`, `Picker`, toolbar and sheet presentation, and the drawer footer uses the iOS 26 scroll-edge bar.
- Split the large iOS sheet expression that failed GitHub compilation and added user-controlled transcript following with reduced-motion handling.
- Native mobile execution settings now expose base-environment installation, optional toolchain installation/cancellation, status refresh, and external-folder mount/removal through the existing verified mobile runtime APIs.
- Release jobs target Xcode 26.3 on `macos-26` and `macos-26-intel`.
- The first Xcode 26.3 run exposed eight Swift 6.2 overload ambiguities from legacy `Optional.map(CGFloat.init)` expressions; all now use typed conversion closures, and the same log’s deprecated Photos `onChange` callback uses the current two-parameter signature.

## Evidence and decisions
- Apple’s current Liquid Glass guidance says standard bars, sheets, popovers and controls adopt the system material automatically and recommends removing custom navigation backgrounds.
- The checked-in Astryx 0.6.0 layer implementation owns all standard menus/selectors/popovers; the compatibility bridge retains custom-positioned consumer layers.
- Existing iOS a-Shell and Android PRoot installers use bundled, pinned resources and verify their runtime before enabling shell tools; no-shell personal-assistant tools stay independently registered.

## Remaining
- None for this repair set.

## Touched files
- Release workflow; Astryx patch/lockfile; shared layer/theme CSS; desktop window/layout persistence; trajectory/cron/icon chrome; handwritten iOS presentation; native mobile settings; focused regression contracts.

## Verification
- `pnpm check`, `pnpm native:check`, and `pnpm lint` pass.
- The full non-Cargo suite ran 1,202 tests: 1,199 passed immediately; three new source-contract assertions had incorrect source/segment patterns. After correcting those assertions, the affected final set passed 25/25 with no remaining local failure.
- CI runs 34797753942 and 34798639664 passed all five jobs.
- Release run 34798645826 passed the complete Xcode 26.3 matrix: iOS arm64 IPA, iOS 26 simulator build and live SwiftUI-root launch evidence, Apple Silicon `macos-26`, Intel `macos-26-intel`, Android, Windows, and Linux.
