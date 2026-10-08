# Current objective
Converge Astryx and SwiftUI desktop/mobile UI and actions against the 14 supplied references; repair Apple CI and packaged interactions. No local build/dev/Cargo. Push and package-only CI are authorized after local checks; complete visual/task parity remains unverified.

## Completed / evidence
- Prior pushed commits through 54144302 cover guarded Office/PDF editing, native composer/files/Skills, browser/terminal panels, text measurement, provider and sidebar layouts. Preserve those repairs.
- Exact 54144302 CI #336 (37701201119): frontend/Rust/device/architecture/workflow/diff pass; PDF regressions pass. macOS drawer AX hit instead selects the full-window backdrop (10 failures); iOS category selected tab is outside the viewport (28 failures); find undo restores immediately then gets overwritten after 200 ms (3 failures).
- Release #150 (37701209821): Windows/Linux/Android succeed, both macOS binaries compile but packaged settings clicks fail. Native evidence downloaded to ignored .ci-artifacts/latest-{arm,intel,ios}; two exported Intel crash attachments are system Spotlight crashes.
- Drawer dismissal button now occupies only the uncovered pane. Category selection uses documented ScrollViewReader after layout, restarting for width/font/RTL changes. All original native bounds, AX, pointer and undo assertions retained.
- Retained editor mounts read the live shared draft Binding at installation, avoiding delayed String snapshots overwriting native undo; genuine disk reload behavior is unchanged.
- Both desktop settings renderers use the existing native shell discovery lifecycle through a shared hook; failure/empty/loading preserve a disabled selector, preferences and real retry. Renderer-level regression passes in both interfaces.
- Actual packaged screenshot confirms monochrome Anthropic/generic Gemini. Astryx uses existing GeminiIcon; native keeps Anthropic SVG colors and reuses the exact Gemini shape/color/blur layers with SwiftUI blur because pinned SwiftDraw 0.29 ignores Gaussian SVG filters. Removed unused sparkles fallback. Actual native 17/32pt light/dark pixel/color assertions and image attachments added.
- All 14 images inspected. Astryx MCP, installed CLI 0.6.3 manifest/composition discovery, Swift MCP, GitHub source/CI MCP and Swift Package Index reviewed; no dependency changes.

## Touched files
- Apple PresentationLayout, PresentationProviderCategoryTabs, PresentationRetainedCodeEditor, PresentationTextArea, PresentationControlStyle, PresentationProviderGlyphs; new PresentationGeminiGlyph and Tests/ProviderBrandRenderingTests.
- Frontend ProvidersSection, SystemSettingsForm, nativeDesktopSystem; new terminal/useTerminalShellDiscovery and settings/terminal-shell-discovery.test.mjs; history.md.

## Verification / CI
- Current pnpm check, lint (692 files), native:check (55 kinds/46 properties), architecture and diff checks pass. Shell renderer regression: 2/2 pass.
- Full pnpm test:non-native: 2024/2024 pass, no failures/skips/cancellations, 404.6 seconds; .ci-artifacts/final-local-tests.log. Relevant settings/provider follow-up: 8/8 pass. No local native compilation/build/dev. New exact-SHA native and package verification pending push.

## Remaining
- Verify these repairs on both native platforms and packaged applications, fixing failures without relaxing assertions; then continue settings/component/mobile and complex task parity audits.
- Broader task completion parity, full visual parity and measured startup/terminal performance are not established. Existing Office fidelity/structured-reference renaming, legacy DOC editing and browser extension gaps remain; do not claim future bugs eliminated.
