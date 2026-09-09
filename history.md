# Current objective
Improve CUA latency/control, match the supplied desktop/mobile references, add Astryx appearance settings, and repair Windows/iOS releases.

## Completed in source
- Windows UIA observations cache properties/patterns during bounded tree traversal; live document text is limited to editors/documents/focused controls. Observations report capture/accessibility/total milliseconds. Prior nonactivating, exact-window and semantic targeting fixes remain.
- Settings persist Current/Stone/Matcha themes and optional light/dark accent/sidebar colors and corner radius through Astryx defineTheme. Sidebar brand dropdown owns XChat/XGent switching on desktop/mobile; duplicate chat header tabs removed; expanded sidebar settings restored.
- Mobile composer keeps footer controls on one row, uses an icon permission menu and truncates long model labels while retaining reasoning and full title.
- Windows date/named prereleases use the bounded GitHub run revision. iOS embeds freetype, lua_ios, harfbuzz and libpng; release validation inspects the arm64 Mach-O dependency graph, including transitive dependencies.

## Evidence / remaining
- GitHub MCP searched computer-use projects and Microsoft UFO UIA caching code; Microsoft UIA caching docs and installed windows-rs 0.62.2 APIs support the implementation. Astryx MCP theme/component docs plus CLI manifest/build/docs and installed 0.5.0 source grounded UI/theme APIs.
- Release run 34274194162 failed Windows version preparation on 0.0.0-cua-activity-20260908. Its actual IPA lacks freetype (ffmpeg/ffprobe) and lua_ios (vim). Downloaded checksum-verified upstream frameworks close the 79-binary device dependency graph; Swift core is system-provided on iOS 12.2+.
- Native latency/control, final rendered wide/narrow UI and iOS 27 physical launch need verification; missing libraries explain a pre-UI crash but are not proof that all device issues are resolved. Android Linux-in-PRoot GUI work remains separate.

## Verification / CI
- pnpm check PASS; pnpm lint PASS (523 files); pnpm test:non-native PASS (1141 tests). No local build/dev/Cargo commands. git diff --check PASS.
- Touched computer-use Windows/desktop; frontend themes/settings/sidebar/header/composer/i18n/tests; iOS framework manifest; release version/dependency scripts/workflow.
- Push, GitHub MCP workflow checks, and rendered CI artifact verification are next.
