# Current objective
Ship one shared Xgent behavior and one Astryx-aligned visual contract across Web/Linux/Windows/Android and native SwiftUI iOS/macOS; verify every release target.

## Completed / current changes
- Upgraded Astryx core/themes/CLI to 0.6.0, applied its migration, regenerated the theme, and retained an exact-version layer geometry patch still required by older WebViews.
- Expanded the executable Astryx-to-SwiftUI contract to 46 rendered kinds, 39 wire properties, the installed Astryx catalog, platform strategies, events, tokens, themes, and strict document/action validation.
- Apple application chrome is native SwiftUI; WebKit is limited to browser content and a hidden noninteractive shared-state transport. Native chat, sidebar/more routes, settings, files, browser, SSH, attachments, activities/todos, messages, reasoning, tools, diffs and previews use shared TypeScript/Tauri state.
- Calibrated IMG_0386-0406 as visual references only: mobile settings use continuous grouped surfaces with inset separators; menus/dialogs/composer use a distinct floating material; normal buttons use continuous rounded rectangles instead of blanket capsules. Astryx and SwiftUI resolve the same radius/material tokens, including user appearance overrides.
- Added real least-privilege HealthKit/Health Connect steps and mobile voice settings; prepared Android PRoot/talloc linkage and Windows persisted-window restoration diagnostics/fixes.

## Decisions / evidence
- Apple Swift MCP confirmed explicit Liquid Glass shapes, continuous button borders, and system-owned sheet/popover geometry; Astryx MCP/CLI confirmed 0.6.0 component contracts and canonical `popover` theme target.
- `npx astryx upgrade --apply`, theme build, design discovery, and `astryx doctor` completed; doctor reports 0 failures and aligned 0.6.0 packages.
- Final local verification: `pnpm check`, `pnpm native:check`, and `pnpm lint` pass; all 1190 non-Cargo tests pass. No local build/dev/Cargo command was used.
- Release 34720747496 proved both PRoot ABIs compile/link; its x86_64 post-build guard used GNU's `i386:x86-64` label against NDK LLVM output. The guard now checks LLVM's canonical `architecture: x86_64` and prints the actual header on mismatch.
- The same release reached native Apple compilation and exposed an invalid mixed fixed-width/max-height SwiftUI `frame` overload; the settings sidebar now composes the two supported frame modifiers.
- Release 34721118824 then isolated the remaining platform failures: the Swift build script still targeted iOS 16/macOS 14, the macOS compiler exhausted diagnostics on the generated-content modifier chain, Android coroutines 1.10.2 carried Kotlin 2.1 metadata into a Kotlin 1.9 host, and a post-hide Windows resize could overwrite the just-saved client size.
- Native Swift now targets iOS 26/macOS 15 as required; the heterogeneous generated node is type-erased once and layout/state work is divided among small `ViewModifier` types after swiftc still failed on one combined modifier. Android pins the JetBrains artifact published against Kotlin 1.9.21 and release .916 compiled its APK. Windows ignores hidden resize events and reapplies the persisted client size once after the first HWND show; .916 proved the post-exit file stayed correct while show/placement had replaced the earlier hidden-window resize.
- Release .916 installed and cold-launched the Android APK and exposed a real interaction defect rather than a missing route: the settings sheet's full-width 24px drag-handle layer covered the center of its unpadded 44px close button. The settings content again reserves its documented top inset so the header remains visible and tappable below that layer.

## Remaining
- Require GitHub CI plus a new unsigned release build for Windows, Android, Linux, iOS and macOS to finish successfully; inspect the resulting native screenshots/artifacts.
- Provisioning-dependent health, inbox, CloudKit and similar system integrations remain gated by platform entitlements and user authorization rather than fake fallback UI.

## Touched areas
Astryx dependencies/themes/patch; presentation mapping/generator/validators; native Apple layouts and bridges; shared chat/settings/mobile panels; Android/iOS mobile-assistant services; release tests/configuration.
