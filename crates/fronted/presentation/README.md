# Apple presentation migration

The requested destination is SwiftUI on iOS/macOS and Astryx on Android,
Windows, Linux and Web. Application state, persistence, provider execution,
tool approvals and actions stay in the existing TypeScript/Rust runtime.

## Current implementation

`astryx-swiftui.json` defines the primitive component declarations verified
against Astryx 0.5.4. `pnpm native:generate` emits the SwiftUI switch and the
TypeScript kind union; `pnpm native:check` checks for drift without building
the application. These primitives are a renderer foundation, **not an
automatic conversion of all existing JSX pages**. JSX layout extraction,
complete component/prop coverage and the Apple entry-point switch remain
unfinished.

`NativeSurface` publishes versioned documents. Stable node IDs preserve
SwiftUI control identity. Each surface has at most one invocation in flight;
streaming updates replace intermediate queued snapshots. Removal follows the
last sent document. Action callbacks remain in a surface-scoped registry:
native requests cannot invoke arbitrary backend commands. Disabled, removed
or malformed actions fail, and in-flight request IDs remain deduplicated.
Native errors are visible through a system alert. Native input values stay
optimistic until the acknowledged shared value reaches the native document.

The macOS build script links the native source using the existing in-process
Swift linkage pattern. The iOS project template includes the same source in
its app target. WKWebView is intended to retain the shared JavaScript engine;
when a native root is mounted, its view and accessibility elements are hidden.
No SwiftUI activation marker is currently installed, so the existing app is
still the active renderer. `NativeChatPage` is an unfinished adapter and is
not connected to `ChatPage`.

## Remaining integration and verification

- Generate shared layouts and cover all used Astryx props, actions and
  navigation, including compound controls and custom editor surfaces.
- Complete chat, settings, pairing, projects, search, attachments, previews,
  tools, terminals, approvals, notifications and lifecycle/error screens.
- Implement native file/selection/focus behavior and reconcile transformed
  input values, surface removal and full WebView reloads.
- Select the native renderer from the actual Apple build target; do not use
  browser user-agent inference to select it.
- Verify Apple builds and behavior with native SDKs, system appearance,
  Dynamic Type, VoiceOver, reduced transparency/motion and the supplied
  references. SwiftUI has not yet been compiled or rendered in this workspace.
- Verify Astryx wide/narrow layouts, overlays and accessibility. The new
  default material is a 90% opaque surface with a blurred backdrop; reduced
  transparency, increased contrast and forced colors use solid surfaces.
- Pass consolidated non-Cargo tests, check and lint before the single
  authorized GitHub push and workflow verification.
