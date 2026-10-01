# Handwritten Apple presentation

Xgent shares business state, execution, persistence and registered actions across
platforms. Android, Windows, Linux and Web use React/Astryx. iOS and macOS render
their application interface in handwritten SwiftUI.

There is no executable Astryx-to-SwiftUI component mapping or generation command.
`src/presentation/protocol.ts` and `native/apple-ui/PresentationProtocol.swift`
define only the serializable state/action vocabulary. `pnpm native:check` checks
compatibility; it does not generate code or choose controls, styles or layouts.

## Ownership

- Feature adapters publish business state and surface-scoped callbacks through
  `NativeSurface`. Swift never invokes arbitrary Rust commands by name.
- Native actions reject malformed values, disabled controls and retired surfaces.
  A backend failure remains a failure; confirmation is not successful execution.
- SwiftUI owns chat, composer, navigation, settings, terminals, files, dialogs,
  notifications and work evidence. Screen compositions and control selection are
  written and reviewed by hand.
- The Tauri WKWebView remains the shared JavaScript/action transport. It is
  noninteractive and absent from the accessibility tree while the native root is
  present. It does not display application UI. Browser webpages use WebKit only
  inside the browser feature.

## Native behavior

iOS always uses mobile features. macOS uses desktop features, including split
conversations and workspace panels. Settings use grouped native Forms on iOS and
handwritten sidebar/detail cards on macOS, with a compact navigation alternative.
Field labels, switches, segmented controls, menus and numeric/time inputs retain
their native semantics and adapt to available width and Dynamic Type.

Configuration secrets use SecureField with an explicit non-login content type on
iOS, avoiding Password AutoFill pairing with preceding provider/name fields.
Conversation rows expose separate selection and action controls plus native
context menus. Rename, pin, move and confirmed deletion use the same SidebarStore
as Astryx, including pending/busy/running restrictions and backend rollback.
Move/delete update the active runtime only after the store confirms success.

Theme values share colors, accent, typography scale and spacing with Astryx.
SwiftUI chooses geometry and layout. Reduced Motion removes navigation animation;
Reduced Transparency uses solid surfaces. Glass is used where available, with
native material on older macOS versions.

Package dependencies have actual consumers: MarkdownUI/Splash for text and code,
Flow for wrapping, Nuke/SwiftDraw for images, CodeEditorView for editing, SwiftTerm
for terminals, and SystemNotification for notifications. Apple PDFKit, AVKit and
Quick Look own document/media previews. Application chrome and settings must
never be rendered as a webpage.

## Verification and remaining parity

Run non-Cargo tests, TypeScript check, lint and native contract/architecture checks
without a local build or development server. GitHub CI runs Apple SDK tests and
exports native screenshots and accessibility trees for rendered review. Mounted
tests cover narrow/wide sizes, Dynamic Type, input, action lifecycle and terminals.
Shared-store tests verify persistence, failures and runtime callbacks.

Existing feature entry points alone do not prove platform parity. Complex combined
browser/CUA/application/document/animation workflows require end-to-end execution
on the actual platforms. `history.md` records current objectives, verified progress,
remaining gaps and exact CI evidence; do not infer completion from the number of
Swift source files or package dependencies.
