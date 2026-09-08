# Current objective
Finish native CUA, mobile startup, live computer viewing and browser repairs against the supplied five references. Do not claim native or visual completion from unit tests.

## Completed in source
- Local CUA is part of the executable: Windows/Linux Rust dependency and macOS static Swift linkage. Removed dynamic loading, component downloads, standalone release/staging. External services remain integrations.
- Dedicated Settings > Computer use entry with persisted enable state, platform/app version, macOS permission guidance, loading/error/unavailable states.
- Composer uses normal flow: bounded task/queue area, compact live thumbnail strip, input. Desktop opens right activity tab; mobile opens a returnable page with background inertness and focus restoration.
- Independent bounded screenshot monitoring bypasses input serialization; inactive/hidden views stop captures. Known Windows/Linux sequences defer intermediate screenshots/tree traversal, retain state/geometry checks and final observation.
- Browser geometry coalesces independently of navigation; previews are independent and deduplicated. Desktop user-agent request is honored, native devtools/F12 and F11 pane presentation work through shared events; popup links create tabs. Failed post-action snapshots preserve tab ownership.
- Splash uses centered logo and pale glows without a spinner. Startup failure exposes recovery.
- Fixed Release #37 iOS WKNavigation? return mismatch. Android logs bounded DOM/geometry diagnostics; smoke now requires visible input and actual text entry, saves screenshot/log/XML evidence.

## Evidence and remaining
- Release #37 Android job passed while artifact screenshot was entirely white: prior process-only smoke was invalid. Actual Android cause and usable startup must be verified from new CI evidence.
- Local app discovery/control, performance under games, all desktop platforms, browser context-menu crashes and native mobile startup remain to be verified/fixed. WebView engine defaults provide actual runtime identity; a WebView is not a complete Chrome installation.
- Read yy/pi-cua scheduling/state/observation design, yy/cua native input and xx external driver paths. Astryx MCP and CLI discovery completed. Tauri 2.11.5 source confirms user_agent/devtools/on_new_window APIs; Swift compiler static archive/link behavior researched.
- Existing document/file/mobile shell repairs preserved. No local build/dev/Cargo commands run.

## Verification / touched
- pnpm check PASS; pnpm lint PASS (517 files); pnpm test:non-native PASS (1129 tests). Logs: %TEMP%/xgent-integrated-*.log. git diff --check PASS.
- Touched native CUA/link configuration, browser desktop/iOS, mobile diagnostics/smoke, composer/activity/settings/splash, controller regression tests and release workflow. Native/rendered checks and GitHub workflows pending.
