# Astryx to SwiftUI presentation contract

Xgent has one application model and two presentation engines:

- Android, Windows, Linux, and Web render the shared React tree with Astryx.
- iOS and macOS serialize the same state and actions into `PresentationDocument`
  values and render them with SwiftUI.

The Apple `WKWebView` remains alive only as the Tauri JavaScript/action
transport. While a native root exists it is noninteractive and hidden from the
accessibility tree; application chrome, chat, settings, tools, files, and
dialogs are SwiftUI. WebKit is visible only inside the browser feature.

## Generated executable mapping

[`astryx-swiftui.json`](./astryx-swiftui.json) is the source of truth for:

- Astryx 0.6 component/export to SwiftUI semantic renderer mapping;
- every serialized property and typed event payload;
- native, SwiftUI-polyfill, and system-framework rendering strategies;
- light/dark colors, accent, spacing, control size, typography, motion,
  material, and corner-radius token transfer;
- compound templates such as chat, sidebar, activity/todo strip, settings,
  browser, and workspace-file preview;
- mobile/desktop feature boundaries; and
- Apple-framework ownership for native capabilities.

`pnpm native:generate` validates every Astryx module and export against the
installed exact version, requires every wire property and semantic kind to have
one mapping, verifies referenced Swift renderers, then emits the Swift
enum/switch/strategy/event tables plus TypeScript kind, contract, and token
tables. `pnpm native:check` fails if generated files drift. Runtime validation
rejects unknown properties, missing actions, invalid geometry, and unmapped
interactive components before a document crosses the native boundary. Stable
node IDs keep SwiftUI identity across streaming updates.

The mapping is semantic rather than a JSX source transformer. Shared feature
adapters emit nodes such as `ChatMessage`, `Thinking`, `ToolCall`,
`ActivityPreview`, `TaskProgress`, `Composer`, and `MediaPreview`. SwiftUI owns
their native layout and interaction, while callbacks remain in a
surface-scoped TypeScript registry. Native input cannot invoke an unregistered,
disabled, stale, or malformed action.

## Platform and rendering rules

- iOS is always the mobile form factor. It does not receive split chat,
  desktop shortcut, tray, or desktop-only window controls.
- macOS is the desktop form factor, but uses the same semantic document and
  Astryx-derived theme tokens.
- iOS 26+ and macOS 26+ use SwiftUI Liquid Glass and `GlassEffectContainer`.
  macOS 15-25 uses `regularMaterial` with the same Astryx tint, edge, radius,
  highlight, and shadow tokens. Reduced Transparency switches to a solid
  tokenized surface.
- Reduced Motion removes sidebar motion. Dynamic Type and the app's Astryx
  font-scale setting both participate in native typography.
- Browser pages use WebKit; PDF, image, audio, and video previews use PDFKit,
  SwiftUI Image, and AVKit. Application UI must never be implemented as a
  webpage inside WebKit.
- The native file editor uses the same scoped Rust read/write commands,
  expected mtime/hash checks, and conflict handling as the Astryx editor.

## Native capability boundaries

The Apple implementation follows the corresponding Apple framework instead of
assuming that a similarly named web API exists:

- [EventKit calendar access](https://developer.apple.com/documentation/eventkit/accessing-calendar-using-eventkit-and-eventkitui)
  distinguishes write-only and full access and requires purpose strings.
- [HealthKit authorization](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data)
  is fine-grained per data type; read denial is intentionally privacy-preserving.
- [Speech authorization](https://developer.apple.com/documentation/speech/sfspeechrecognizer/requestauthorization(_:))
  and microphone authorization are separate asynchronous states.
- [SwiftUI photo selection](https://developer.apple.com/documentation/swiftui/view/photospicker(ispresented:selection:matching:preferreditemencoding:))
  and [file importing](https://developer.apple.com/documentation/swiftui/view/fileimporter(ispresented:allowedcontenttypes:allowsmultipleselection:oncompletion:))
  provide user-mediated attachment access.
- [UserNotifications](https://developer.apple.com/documentation/usernotifications/unusernotificationcenter)
  owns notification authorization and scheduling.
- [CloudKit containers](https://developer.apple.com/documentation/cloudkit/ckcontainer)
  own private Apple-cloud records when the required entitlement is provisioned.
- [MessageUI](https://developer.apple.com/documentation/messageui/mfmailcomposeviewcontroller)
  permits user-approved composition; it does not grant arbitrary inbox access.

Every unavailable entitlement, denied permission, unsupported platform, empty
result, and backend failure remains a real state in the shared business layer.
No UI action reports success unless its underlying Tauri/plugin operation has
completed.

## Verification contract

Static tests cover registry generation, native-only Apple entry points,
semantic chat/settings flows, theme transfer, action validation, and the rule
that WebKit is limited to browser content. Release workflows remain responsible
for compiling the Swift sources with Apple SDKs and smoke-testing packaged
Windows/Android artifacts.

### Mobile composer and navigation details

The compact Selector renders as a SwiftUI Menu containing a Picker, with an
explicit selected-label fallback. It stays beside attachments in the composer
footer even when no models are configured; its disabled state must not erase
the control. The no-model state offers the shared providers route and never
opens settings automatically or discards a draft.

The semantic icon `xgent.sidebar` maps to the same two unequal strokes as
`MobileMenu` (24-unit view box, segments (4,8) to (20,8) and (4,16) to (14,16), round caps).
It is a native SwiftUI Path on Apple and an SVG through Astryx Icon elsewhere.
This custom glyph follows IMG_0388 rather than substituting a three-line symbol.
