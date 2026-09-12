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

## Remaining
- Push this state and require GitHub CI plus unsigned release builds for Windows, Android, Linux, iOS and macOS to finish successfully; inspect any resulting native screenshots/artifacts.
- Provisioning-dependent health, inbox, CloudKit and similar system integrations remain gated by platform entitlements and user authorization rather than fake fallback UI.

## Touched areas
Astryx dependencies/themes/patch; presentation mapping/generator/validators; native Apple layouts and bridges; shared chat/settings/mobile panels; Android/iOS mobile-assistant services; release tests/configuration.
