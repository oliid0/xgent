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
- Release #38: desktop builds and Android launch passed; iOS IPA/simulator builds passed but launch crashed because ssh_cmd requires missing openssl.framework. Added openssl/libssh2 binary product dependencies using pinned a-Shell checksums and IPA presence checks.
- Android #38 screenshot is no longer white, but WebView 124 leaves the composer behind the IME. Added native content insets with zeroed propagation to prevent double application on newer WebViews. Smoke now asserts composer bounds above the keyboard and saves before/open/closed screenshots.
- CUA now has bounded concurrent held-key/button and relative-motion input bursts with cancellation/focus checks and guaranteed release. Settings persist explicit native/external backend selection; selected MCP driver schemas are exposed directly without silently falling back. Embedded browser routing is explicit. Native/game/Blender performance remains unverified.
- Release #37 Android job passed while artifact screenshot was entirely white: prior process-only smoke was invalid. Actual Android cause and usable startup must be verified from new CI evidence.
- Local app discovery/control, performance under games, all desktop platforms, browser context-menu crashes and native mobile startup remain to be verified/fixed. WebView engine defaults provide actual runtime identity; a WebView is not a complete Chrome installation.
- Read yy/pi-cua scheduling/state/observation design, yy/cua native input and xx external driver paths. Astryx MCP and CLI discovery completed. Tauri 2.11.5 source confirms user_agent/devtools/on_new_window APIs; Swift compiler static archive/link behavior researched.
- Existing document/file/mobile shell repairs preserved. No local build/dev/Cargo commands run.

## Verification / touched
- Current pnpm check PASS; pnpm lint PASS (517 files); pnpm test:non-native PASS (1131 tests), plus selected registry suite PASS (8 tests including two new backend-selection cases). Logs: %TEMP%/xgent-current-*.log and xgent-driver-registry.log. git diff --check PASS. New native/rendered CI pending; no local build/dev/Cargo commands.
- Touched native CUA/link configuration, browser desktop/iOS, mobile diagnostics/smoke, composer/activity/settings/splash, controller regression tests and release workflow. Native/rendered checks and GitHub workflows pending.

## Release #39 continuation (in progress)
- Evidence: iOS pinned OpenSSL checksum differs from downloaded asset; Android smoke artifact shows Pixel Launcher ANR covering Xgent. Tauri multi-webview main windows cannot be resolved with get_webview_window.
- Source changes: corrected checksum and smoke fixture; native Windows clipboard, restored/focused CUA targets, Android accessibility CUA, secure-context-independent IDs, smaller desktop minimum sizes and mobile layout fixes.
- Remaining: review Android request/response/cancellation contracts, native platform API signatures, mobile capability paths; consolidated non-native checks and GitHub CI. These source changes are not yet validated.

- Follow-up: Android cancellation now reaches the accessibility service and prevents late observations from replacing current state; mobile resume uses the native window. Fixed typed Android tool schema.
- Added verified official external-driver installation link and Android-specific accessibility settings/retry guidance. Local stdio MCP remains unavailable on native mobile; HTTP/SSE uses existing mobile MCP runtime.
- Consolidated checks: TypeScript passes. Lint found only formatting/import order in three edited files, corrected; non-native tests running. Native CI still pending.
- Tests exposed one obsolete assertion requiring unconditional Homebrew linking; updated it to assert the guarded linking behavior. Added Android tool/cancellation contract regression coverage.
- Final local review: pnpm check PASS; pnpm lint PASS (517 files); complete non-native run 1132 passed, one obsolete Homebrew assertion failed, corrected and affected release/CUA suites PASS (16 tests, including Android regression). git diff --check PASS. No local build/dev/Cargo used. Preparing GitHub CI; native/rendered verification is not yet complete.
