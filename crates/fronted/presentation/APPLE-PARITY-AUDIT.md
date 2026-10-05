# Apple UI / shared UI audit — 2026-10-04

This is a source and evidence checklist, not a declaration of complete parity.
Settings require matching detailed fields, persisted values, actions, availability,
navigation, and actual rendered layouts. A successful SDK fixture does not prove an
installed application works. A shared tool schema does not prove equal success on
a long task involving third-party applications.

## Settings and detail routes

| Area | Shared behavior checked | Apple implementation / remaining evidence |
| --- | --- | --- |
| System | Execution mode, discovered terminal shells, theme/language, thinking visibility, presets, custom colors/color format/radius/reset, interface/chat/code fonts, three font-size zones, proxy type/host/port/user/password, close-window behavior, tray title privacy/running count | `NativeSettingsPage`, `nativeDesktopSystem`, `nativeDesktopAppearance`, `nativeFontSettings`, `nativeDesktopProxy`; this batch fixes proxy expansion and blur/Return commits, custom-font commits and searchable font lists. Remote rendering and installed settings persistence must be checked on the new commit. |
| Providers | Vendor buckets, ordering, add/edit/delete, URL/API key/auth/OAuth accounts, model discovery/import/manual models; model context/output limits and four cost rates; request proxy/retries/cache retention/custom headers; usage API/JavaScript/secret/timeout/test; failover queue, thresholds, switches/cooldown; retry HTTP codes/patterns; title/commit models | `nativeProviderList`, `nativeProviderModels`, `nativeProviderImports`, `NativeProviderModelSettings`, `NativeProviderRequestSettings`, `NativeProviderRuntimeSettings`, `nativeOAuthAccounts`; model parsing and runtime reducers are shared. Live provider/OAuth requests and every detail route still need packaged-app evidence. |
| Shortcuts | Summon, toggle, new chat, pin; enabled state, recording/change/clear/defaults, conflict and registration failures | `GlobalShortcutsSection` native branch, `nativeGlobalShortcuts`, `PresentationShortcutRecorder`; real registration and macOS permission behavior require the packaged app. |
| Backup/sync | Local export/import, backup scope and automatic backup; WebDAV preset/URL/user/password/clear/remote directory/profile, save/test/upload/download, automatic sync and last-sync/dirty/errors | Both renderers call `useBackupSyncData`; Apple uses `NativeBackupSyncSection` and native confirmation dialogs. Local file round-trips and remote WebDAV are not established by rendering fixtures. |
| Computer use | Native/external driver choice, path/add/check/install/progress; enable; accessibility and screen-capture status/request/open-settings/refresh | Both renderers call `useComputerUseSettings`; macOS invokes the native Swift dispatcher through Rust. No complete browser → image generation → Word/Excel → HTML/PPTX → animation task has been verified. |
| Tool permissions | All shared tool categories, allow/ask/deny, category application/reset, tool descriptions, command safety mode and explanation | `createNativeToolPermissions` consumes the shared tool-policy catalog. Speech/policy rendering fixtures exist; installed approval and execution behavior must also be exercised. |
| Voice | Desktop provider enable/select, all `STT_PROVIDER_FIELDS`, saved-secret indication, connection test; mobile OS microphone/recognition permissions and settings route | Apple desktop and shared desktop use the same provider-field catalog and speech service. iOS must match Android mobile capability routes; actual device recording/network tests remain necessary. |
| Soul | Presets/list/select/new/delete/confirmation, identity/name/personality, language/style, counters, reload/save/status | Both renderers run `SoulSection` state and persistence; native editors use multiline fields. Packaged save/reopen is still required. |
| Memory | Global/project/daily lists, search/type/scope, quotas/status, create/slug/description/body, detail edit/append/review/accept/delete/wipe confirmations | `MemoryPanel` and `NativeMemoryPanel` share `useMemoryPanelData`; `MemorySettingsDrawer` also has a native branch with organizer/summary model, schedule/time/weekday/scope/mode, next run/history/run now and quota warnings. List and drawer routes both belong in installed validation. |
| Other | Hooks, cron and SSH, including their nested forms | This batch restores the three descriptions. Native hooks include type/lifecycle/sequential/timeout/bash/HTTP requests. Cron includes expression/remaining executions/timeout/workdir/model/reasoning/prompt/bash/HTTP and run history. SSH includes host/user/port/password/private key/passphrase/import/proxy/known-host reset. Shared form validators remain authoritative; all detail dialogs need visual checks. |
| Local/cloud | Desktop Web UI enable/scope/port/status/URLs/copy, pairing code/rotation/device revoke; mobile LAN address/code/device name/pair/check/disconnect/prefer/open; blocked terminal/browser/SSH/Git/file-write capabilities; cloud enable/repository owner/name, GitHub vault token/status/save/remove | `nativeAccessSettings` calls the same Rust services. Stale requests and secret handling have adapter tests; cross-device pairing and cloud execution still need integration evidence. |
| About | App name and current version | Native matches `AboutSection`'s current content. Update UI must not be invented as an About feature; it has its own shared flows. |

## Sidebars and workspaces

| Area | Finding / batch change | Follow-up evidence |
| --- | --- | --- |
| Left navigation | New chat, skills, MCP, files, workspace groups, workspace history, recent history/pagination/retry/search and settings already have shared callbacks. Mobile tools additionally route to shell, browser, SSH, Git and background tasks. | Actual installed navigation, empty/loading/error states, scrolling and large text. |
| Workspace operations | Source audit found that native project/group menus were absent. This batch connects project pin/rename/archive/restore/remove, project settings/new chat/file-tree/Finder, group create/rename/delete and move-to-group to existing `ChatPage` handlers. | Adapter tests cover real dispatch, default workspace protection, running-workspace removal, removal confirmation/cancel and retired targets. SDK snapshots must cover the newly reachable rows. |
| Project settings | `WorkspaceProjectSettingsDialog` was mounted only in the shared-renderer return branch. It is now mounted in the native return branch too and opens the existing native `ProjectRootsSection`. | Installed add/remove authorized roots and navigation back. |
| Workspace order/archive | Native previously displayed the raw project order. It now uses `sortWorkspaceProjectsByActivity` and displays archived projects separately with restore actions. | Compare pinned/running/recent ordering with shared desktop and Android; archived projects must not expand active history. |
| Right sidebar | Native lacked per-tab close buttons and keyboard navigation. The panel-level close incorrectly dismissed the active document. This batch separates hide from close, adds per-tab close, and implements arrows/Home/End/Delete with RTL parity. | Verify actual browser, terminal, file and side-chat sessions remain alive on hide; actual close must invoke the shared dismiss handler. |
| Terminal / Git / SSH | Desktop native terminal, Git review and SSH controllers are shared Rust-backed routes; SwiftTerm provides native terminal rendering. Mobile shell and SSH have separate capability-specific adapters. | Terminal input/resize/EOF/cancel, Git stage/commit/diff/conflicts, SSH authentication/host trust/SFTP need installed evidence; route presence alone is insufficient. |
| File previews | Native source editor, Markdown/math/Mermaid, image, PDF, Office/spreadsheet and HTML preview routes exist. | Test actual files, save/reopen, artifact download, annotations and open-in-application. Browser/HTML preview WebKit is distinct from using a WebView as the application UI. |

## Chat and task results

The follow-up comparison reads Astryx's actual `ChatComposerBar`, `SettingsPage`,
`SystemSettingsForm`, provider subpages and `RightSidebar`, rather than treating
the twelve native navigation destinations as sufficient coverage. It found a
functional omission in the composer: native context usage was read-only, while
Astryx's ring opens token details and offers confirmed manual compaction from
50% usage. Native now passes the existing `handleManualCompaction` and running
state, renders an Apple popover and scopes the confirmation to its conversation.
Dispatch tests cover both form factors, the threshold, concurrent-task disabling,
draft preservation and retired conversations. Native rendering remains subject
to the next remote Apple SDK checks; this does not establish complete parity.
Another concrete remaining difference is keyboard submission: Astryx's
`MentionComposer` handles Enter/send, Shift-Enter/newline and Ctrl/Cmd-Enter/steer,
whereas `XgentComposerInput` currently only reports native text and selection and
`NativeChatPage` does not receive `onSteer`. Matching buttons is therefore not
sufficient evidence of matching composer interaction. This requires a native
keyboard and IME-safe implementation and actual input verification.

`NativeChatPage` uses the existing composer store, transcript/live store, activity
store, approval controller and queued-turn handlers. The audit checked model
selection, execution mode, plan/web-search/thinking controls, context usage,
attachments/skills, stop, queued edit/run/reorder/remove, streamed work, tool
approval/question cards and file/diff/artifact actions. Adapter tests exercise
these actions. CI 274's mounted inline-math images were visually inspected;
the restored formula is actual ink, not just an accessibility label.

Remaining acceptance includes installed chat send/stop/reopen, actual tool
execution and streamed results, all settings detail pages in light/dark and
narrow/wide layouts, keyboard/navigation behavior, and a comparable cross-platform
task with identical provider/configuration/tool inputs. Model outputs themselves
are not deterministic equality evidence. The requested 90% visual similarity has
not been measured or established.

## Build and runtime evidence

- Baseline CI 274 / `33bf6b8`: all eight jobs passed; macOS 171 and iOS 176 SDK
  tests passed. These results precede this batch.
- Release 127 / `37160487134`: Windows, Linux and Android passed. The Android APK
  was installed and passed settings/environment/stdout/rootfs cwd/Bash/Python/pip/
  live stdin/EOF smoke checks. Its real screenshots were inspected as references.
- Release 127 macOS ARM and Intel: final Rust static linking failed on SwaTex
  `compress2`/`crc32`; this batch adds explicit zlib linking for the static consumer.
  The actual macOS application screenshot harness did not run.
- Release 127 iOS: device IPA construction succeeded; simulator construction failed
  when re-staging read-only SwiftPM font files over device resources. This batch
  makes only staged resources writable before/after copying. A real Python CLI
  regression covers repeated staging and unchanged source permissions.
- New Swift rendering/commit tests will run remotely. Installed iOS shell cancel,
  installer behavior, screenshots and actual macOS screenshots remain pending.
- CI 275 / `0610e27`: frontend, device archive and guards passed; macOS/iOS SDK
  test compilation failed because an untyped mixed-numeric array in the expanded
  sidebar fixture inferred `Any` and selected the wrong `flatMap` overload.
  The fixture now declares explicit tuple element types. No SDK pass is claimed
  for this failed run. The follow-up also matches the shared collapsed archive
  group and disables archived selection while preserving its restore menu;
  actual accessibility checks cover both controls at narrow/large-text sizes.
- Local checks for this batch: 512 shared/native presentation tests and five
  Apple resource CLI tests passed, with no skipped cases. TypeScript no-emit,
  architecture and the 55-kind/44-property native contract checks also passed.
  These checks did not compile Swift or run installed Apple applications.
- CI 276 / `8c4d449`: seven jobs passed, including all 176 macOS SDK tests.
  iOS ran all 182 SDK tests; four failures were the missing native font search
  accessibility label at the four width/text-size combinations. Secure-field
  blur/Return commits and archived workspace selection/menu bounds passed.
  The search field now declares its localized accessibility label; the original
  assertion remains. Inspected macOS font picker images also exposed an empty
  off-window List in the snapshot fixture. The fixture now mounts a real NSWindow
  and requires visible search/options bounds plus an actual option press before
  it can pass. New-head CI and installed application screenshots remain pending.
- CI 277 / `8b08dd7`: all eight jobs passed; macOS 176 and iOS 182 SDK tests
  passed. Inspected new macOS picker images contain the real font rows/checkmark.
  Release 128 / `37198073484` was dispatched for this exact SHA after its CI
  passed; all six application targets are running. Installed results are pending.
- Installed iOS coverage previously exercised only Shell. A new packaged-app
  test opens all 12 mobile settings destinations, verifies visible core controls
  and separate header bounds, enters Hooks/Cron/SSH and requires return to Other.
  A second test changes the voice flag, waits for the shared Saved status, then
  verifies Settings reopen and application relaunch before restoring the flag.
  The release harness repeats navigation at dark/accessibility maximum text size
  and exports both runs' images/hierarchies even on failure. These tests have not
  run yet; they do not establish provider/WebDAV/OS-permission service success.

Push this as one reviewed batch. Use the new commit's CI results, then trigger the
full release with smoke checks. Do not substitute an older green CI for the new
commit. No local build/dev/install/cargo or Swift compilation is permitted.

## Mobile reference pass and installed macOS startup

The reference pass compares IMG_0400/0403/0406 with the actual CI 276 native Form
attachment, rather than assuming matching wire nodes imply matching visuals.
The now-populated `yy/src/ios` reference was inspected: SettingsSheet,
SoulSettingsView, OffloadPermissionSettingsView, AboutView and ContentView's
native glass implementation. Its application/service code remains reference
material; Xgent settings continue to use Xgent's shared reducers and commands.

- Native navigation and picker close buttons use Apple's interactive Liquid
  Glass through the existing availability/reduced-transparency modifier.
  Mobile controls use 17-point body text, native green switches, 54-point grouped
  rows, semibold section labels and symmetric settings header columns.
- Native grouped fields no longer draw a second bordered box inside the card.
  Short form entries use a label/value row; accessibility and secure entry retain
  a full-width layout. Secondary section explanations move outside the card,
  while standalone notes and every original action remain in the document.
- Custom fonts use fixed-size SwiftUI fonts with explicit ScaledMetric at their
  owners, avoiding a second Dynamic Type scale. A real hosted measurement test
  compares installed custom/system font heights at standard/accessibility sizes.
  Native settings tests now require separate, in-bounds actual input/menu AX
  elements, rather than accepting a nonempty image alone.
- Both iOS system routes expose font families, per-area sizes, reasoning display
  and all detailed appearance options. Android's system form now exposes the
  same mobile preferences and rejects invalid custom font drafts. Desktop window
  behavior is omitted from both native mobile routes. Astryx compact groups now
  have one rounded card per group and circular header controls.
- CI 278 / `1e83171`: all eight jobs passed. These results precede this visual
  pass and do not establish its Swift compilation or screenshot appearance.
- Release 128 / `8b08dd7`: Windows, Linux and installed Android smoke passed.
  macOS ARM successfully linked and packaged, fixing the zlib failure. Its real
  application launch test failed: screenshot/AX show a running app with no
  visible window. Launch code awaited two WebKit frames before showing the
  initially hidden window. The native launch path now reveals immediately and
  finishes through a microtask; a regression never delivers an animation frame.
  The installed test assertion is retained for the next release. iOS device IPA
  construction passed and simulator construction was still running at inspection.

Research: Apple's [custom Liquid Glass guidance](https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views),
[fixed-size custom fonts](https://developer.apple.com/documentation/swiftui/font/custom(_:fixedsize:)),
WebKit's [inactive-page frame suspension](https://webkit.org/blog/8970/how-web-content-can-affect-power-usage/),
GitHub's EhPanda native interactive glass examples, Astryx Switch/List docs, and
Swift Package Index entries for [Introspect](https://swiftpackageindex.com/siteline/swiftui-introspect)
and [Flow](https://swiftpackageindex.com/tevelee/SwiftUI-Flow) were consulted.
Existing pinned packages provide those capabilities; no unneeded dependency was
added to simulate native glass.

- CI 279 / `834dbcc`: all eight jobs passed, including 177 macOS and 183 iOS
  SDK tests, the device archive and shared frontend. The exported 320-point
  standard/accessibility-dark native Form images were inspected against the
  references: nested field outlines are gone, long labels wrap, the selected
  authentication value is visible and controls do not overlap. These are hosted
  SDK images, not screenshots of the packaged Rust-backed app.
- Those images exposed section-edge separators outside rounded cards and a
  doubly subdued native section label. The follow-up hides only section/outer
  row edges, retains internal row dividers and uses Apple's adaptive secondary
  label color. It also separates navigation destination labels from explanatory
  accessibility hints, with a mounted 320-point standard/large-text AX test.
  The parser's pinned 0.13.1 `AccessibilityElement.hint` API was verified from
  its upstream source. Follow-up compilation and images remain pending.

- CI 280 / `58597d7`: all eight jobs passed, including the new mounted
  navigation label/hint test. Release 128 finished: Android/Windows/Linux passed;
  both macOS packaged launch tests failed before the composer appeared. iOS
  device/simulator packaging passed, but its actual Shell installation timed out
  at command verification. The exported screenshot/AX still show Verifying and
  Installing, rather than an error or a completed version.
- The pinned a-Shell AppDelegate explicitly sets `joinMainThread = false` before
  its own `ios_waitpid` calls. Xgent now follows that host-owned waiting model;
  the installed Shell test and its 180-second assertion are unchanged. Fixed-name
  probe lifecycle checkpoints use persisted notice-level diagnostics, verification
  reports actual progress, and the release harness exports a separate focused
  shell log. Sixteen release/resource checks passed locally. A new installed run
  is required to prove the initialization hang and cancellation are resolved.

Installed screenshots, dark/largest-text traversal, shell cancellation and
end-to-end service parity remain required. This pass does not claim 90% measured
visual similarity or identical complex task completion.

- CI 281 / `8fc544a`: seven jobs passed, but the macOS code-reference test
  exposed a lost first scroll and an old request resetting the caret after an
  edit acknowledgement. The initial SwiftUI selection and native reveal were
  independent; a single yielded native callback could miss window attachment.
  Reference selection now belongs to one native transaction, retried by window
  and layout lifecycle events. Its selection and actual scroll offset are saved
  to the package position binding before subsequent updates. The original
  assertions remain, with an additional delayed-window-attachment scenario.
  Remote compilation and runtime verification of this follow-up are pending.

Research: the pinned [CodeEditorView 0.16.0 binding updates](https://github.com/mchakravarty/CodeEditorView/blob/0.16.0/Sources/CodeEditorView/CodeEditor.swift)
and Apple's [TextKit layout requirement](https://developer.apple.com/documentation/appkit/nstextlayoutmanager/ensurelayout(for:)-3duae)
were inspected for the reference-navigation fix.

- CI 282 / `9be7fcb`: all eight jobs passed, including the unchanged caret/scroll
  assertions and the additional delayed-window scenario. This is the baseline
  for the following user-directed mobile composition pass, not its validation.
- Re-inspected IMG_0400/0401/0402/0403/0405/0406. The sidebar's brand now owns
  the XChat/XGent picker on both Apple platforms; chat chrome has no work-mode
  selector. The composer exposes the shared command safety preference, and
  Android's previously hidden compact command control is restored as well.
- The permanent @ button is removed. Native TextSelection reports trigger
  @file and /skill suggestions at the real caret, including edits in the middle
  of a draft. Selection ACKs are isolated from optimistic text. Choosing an item
  replaces its active query while preserving existing rich references and the
  suffix. File searches use the existing Rust fs_mention_list operation and
  discard late results from an old conversation/workspace. Slash with no enabled
  skills now shows the empty state on both renderers instead of ignoring input.
- Mobile settings use explicit 26-point cards, 54-point minimum rows, inset
  internal dividers and external section descriptions. Standalone input labels
  sit above their cards. Navigation current values use a separate trailing slot;
  read-only status rows do not masquerade as enabled navigation buttons.
  Existing 320-point/accessibility field-overlap and scrolling assertions remain.
  New native tests cover caret reporting and mention caret restoration.
- Remote compilation, these new native interaction tests and exported updated
  screenshots remain pending. Packaged shell installation and launch tests also
  remain mandatory before treating the build as usable.
- Local TypeScript checking, the 55-kind/45-property state/action contract and
  all 1,155 presentation/chat/settings behavior tests passed. No local build,
  package installation or native compilation was run. A new native geometry test
  checks that suggestions float above the draft and that execution/send controls
  remain at least 44 points tall at 320-point width and accessibility text sizes.

Research: Apple's [native text selection binding](https://developer.apple.com/documentation/swiftui/textfield/init(_:text:selection:prompt:axis:)-80y12),
[TextSelection](https://developer.apple.com/documentation/swiftui/textselection),
EhPanda's [native glass menu controls](https://github.com/EhPanda-Team/EhPanda/blob/main/EhPanda/View/Reading/Support/ControlPanel.swift),
Astryx List/ListItem documentation, and [Swift Package Index's Introspect entry](https://swiftpackageindex.com/siteline/swiftui-introspect)
were consulted. These changes use the existing pinned packages and native Apple
controls; no UI code was generated from Astryx.

- CI 283 / `0149efd`: iOS compilation found a selection event revision read
  from the node instead of its owning document. It now captures the current
  document alongside its node and records that document revision. Native runtime
  assertions and updated screenshot inspection are still pending.
- CI 284 / `61c5c25`: the settings navigation view exceeded Swift's expression
  type-checking limit. The native button/status composition and typed
  accessibility labels are now separate expressions. This is pending remote
  compilation; it is not a native layout pass.
- External iOS workspaces now retain the original FileProvider URL through an
  owned scope lease before canonicalizing or checking the directory. Replacement,
  failed bookmark refresh, failed persistence, removal and store destruction
  release exactly their acquired grants. Stale bookmarks and moved paths are
  saved, and mutations serialize across snapshot writes and rollback. A remote
  Foundation regression harness exercises these actual production store methods;
  device FileProvider behavior remains to be checked in the installed application.

Workspace research: [Apple's directory access guide](https://developer.apple.com/documentation/uikit/providing-access-to-directories),
[balanced security scope grants](https://developer.apple.com/documentation/foundation/url/startaccessingsecurityscopedresource()),
the local yy MountedFoldersManager, and the upstream a-Shell scope call sites
were inspected. The iOS bookmark options remain platform-compatible.

- CI 285 / `83eb984`: seven jobs passed, including 179 macOS native tests,
  the actual workspace store regression harness and the device archive build.
  iOS ran 187 tests with four failed assertions: two formula checks and the
  suggestion menu's standard/accessibility overlap checks. Actual exported
  screenshots showed the popup clipped into the composer, and an intermittent
  missing inline formula at wide widths. The existing assertions are retained.
- The popup now measures its content, supplies a bounded explicit scroll viewport
  and offsets that viewport above the input. The formerly unspecified viewport
  and alignment guide are removed. This is pending native geometry verification.
- The pinned MarkdownUI image task unconditionally assigns an empty dictionary
  after cancellation. A guarded compatibility patch prevents a retired task from
  overwriting active paragraph images. This is a source-based explanation of the
  intermittent formula loss; unchanged native pixel/accessibility checks must
  confirm it. Both SDK testing and production archive builds apply the same patch.
  The patch rejects upstream drift and incomplete application; no package was
  upgraded. Baseline prose screenshots are also retained for failure diagnosis.
- Shell workspace and absolute cwd validation now await external grant restoration
  before filesystem probes, then check canonical containment again. A delayed
  restore regression verifies that startup access waits for the owned grant.

Research: [MarkdownUI 2.4.1 InlineText image task](https://github.com/gonzalezreal/swift-markdown-ui/blob/2.4.1/Sources/MarkdownUI/Views/Inlines/InlineText.swift),
[Apple task cancellation checking](https://developer.apple.com/documentation/swift/task/checkcancellation()),
[content geometry observations](https://developer.apple.com/documentation/swiftui/view/ongeometrychange(for:of:action:)-36gt0)
and SwaTex 0.5.0's mutex-protected font provider/image renderer were inspected.

- Exported narrow settings screenshots also showed the details chevron moving
  below a long description. Navigation now keeps the chevron in a separate
  trailing column while the label, description and current value can wrap.
- Mobile chat fixtures now use a chat title and the real four-option execution
  selector. Desktop sidebar fixtures include the brand work-mode menu and check
  its visible bounds alongside navigation controls.
- Glass and switch rendering in layer screenshots needs separate visual
  verification. Mounted UIKit hierarchy captures are added to chat, settings and
  mention-menu evidence, without replacing the original pixel or geometry tests.
  The new layout and composited captures await native CI; these are component
  screenshots, not evidence that the packaged application passes installation.

Research: [SwiftUI adaptive layouts](https://developer.apple.com/documentation/swiftui/viewthatfits),
[UIKit complete hierarchy rendering](https://developer.apple.com/documentation/uikit/uiview/drawhierarchy(in:afterscreenupdates:))
and [SnapshotTesting 1.19.6 renderer](https://github.com/pointfreeco/swift-snapshot-testing/blob/1.19.6/Sources/SnapshotTesting/Common/View.swift)
were inspected through Swift/GitHub MCP.

- CI 286 / `ed1002e`: seven jobs passed. iOS executed 187 tests; mention
  geometry passed, while all four mounted-update formula pixel assertions failed.
  Its layer screenshots still do not establish that the floating menu or glass
  controls are visibly correct; the new composited evidence must confirm that.
- The pinned SnapshotTesting UIView strategy moves the hosted view into another
  window and removes it on disposal. Repeated pixel probes thus cancel image
  tasks during the mounted-update test. That test now renders the same UIView
  layers directly in the original window and asserts that mount identity stays
  intact. Its ink threshold, four sizes and deadline remain unchanged. This
  harness diagnosis and the actual formula rendering still await CI verification.

- CI 287 / `d28c108`: all eight jobs passed, with 179 macOS and 187 iOS native
  tests. The mounted-update formula pixel assertions passed at all four sizes.
  Composited screenshots visibly showed the floating file menu, native switch
  thumb, glass controls, the corrected details chevron and the wide formula.
  Full Release 129 was dispatched at this exact green commit with smoke enabled.
- Visual review still found a 320-point accessibility defect: the command-safety
  menu's current value was compressed away even though its outer bounds passed.
  Inline layouts now budget for the full current-mode label; when necessary the
  mode gets its own wrapping row above the attachment/voice/send/stop buttons.
  The narrow composer check now includes those four buttons, independent bounds
  and a minimum visible width for the actual current mode. This follow-up awaits
  a new CI pass and is not included in Release 129's pinned source.

- The user clarified the settings drawer reference with IMG_0400: its index has
  no separate page title or top grabber. The live mobile-theme index now starts
  with its first section heading and a 44-point glass close button in that row,
  preserving the section/card hierarchy and avoiding a second toolbar. Native
  grouped sheets request a 36-point corner radius. Detailed routes retain their
  Back/title navigation, matching the separate detail-page references.
- A mounted native-sheet check exercises the actual presentation host at narrow,
  regular and accessibility sizes, captures composited index/detail evidence and
  checks that the first value and Close do not overlap. The packaged settings
  harness now waits for the real index controls rather than the removed title.
  These changes await CI and a subsequent build; Release 129 retains `d28c108`.

Reference: [Apple native sheet corner radius](https://developer.apple.com/documentation/swiftui/view/presentationcornerradius(_:))
was checked through Swift MCP.

- The Astryx compact settings index now follows the same structure: no separate
  page title or decorative handle, Close beside Theme, inset gray section labels
  and rounded navigation groups. Its modal accessible name, selectors, every
  destination and detail Back/title remain available. The handle styling is
  scoped to the settings sheet and verified against installed Astryx 0.6.3 source;
  the public API has no handle-visibility property. Desktop layout is preserved.
- CI 288 / `82d6937`: all eight jobs passed. Its composited 320-point
  accessibility screenshot visibly retains the full Ask label and four action
  buttons on separate rows. This confirms the composer fix, not installed-app
  behavior. The new settings index changes require another CI and build.
- Release 129: Android, Windows and Linux completed successfully. The actual
  Apple Silicon macOS screenshot shows the native chat, but the composer
  hittability assertion failed; its accessibility tree still includes transport
  WebView descendants and marks the window Disabled. Intel timed out during
  accessibility queries. iOS simulator smoke compilation is still in progress.
  These failures are unresolved and the release is not reported as successful.

- The macOS host now owns accessibility children at the plain Tauri container,
  retaining native siblings and excluding the execution WebView before remote
  WebKit traversal. Detaching or removing the native root restores AppKit's
  computed children. The execution view remains mounted and visible underneath.
- A production-host integration check mounts a real WKWebView and calls the
  exported native update/reset entry points. It checks native pointer routing,
  the container's accessibility children, real JS execution and native action
  delivery/acknowledgement. The packaged test also rejects transport WebViews
  in the initial native chat; its hittability assertion remains unchanged.
  These checks require remote compilation and do not yet establish a release fix.
- Packaged macOS diagnostics additionally capture a process sample and runner
  screen when an application remains alive after a failed UI test. This is to
  diagnose Intel's unresponsive main thread, whose cause remains unconfirmed.

Research: [AppKit accessibility children](https://developer.apple.com/documentation/appkit/nsaccessibilityprotocol/setaccessibilitychildren(_:))
and [an upstream hidden WKWebView implementation](https://github.com/isaaclins/spotiglass/blob/main/Spotiglass/Playback/HiddenPlaybackWebView.swift)
were inspected through Swift/GitHub MCP. A local hidden flag alone does not
exclude the remote descendants observed in Release 129's actual hierarchy.

- Latest layout pass: desktop chat retains a real sidebar-open button after
  compact-to-wide transitions. Workspace labels now toggle in both directions,
  folder disclosure uses an appropriately sized IconButton, and the workspace
  More menu no longer repeats the project-folder switcher. File-tree click and
  keyboard expansion persist from current state, including rapid repeat input.
- Astryx settings detail routes now share balanced 44-point Back/title chrome;
  provider editing/advanced settings, imports, Hooks, Cron, SSH and memory
  nested routes use it. Compact section cards keep their internal padding;
  detail content has safe-area-aware horizontal margins. Organizer history
  stacks its columns on narrow screens. Cron's two tabs remain two columns.
- Successful auto-save badges are removed from both presentations. Actual save
  failures remain visible below the header, including the backend error text.
  Native settings details have one Back control and no top grabber; the index
  retains its section-first structure. Sidebar footer buttons have no bottom
  material bar, and their native action identifiers are explicitly preserved.
- Local behavior checks passed: 174 focused settings/presentation tests, 1,025
  chat/presentation tests, TypeScript checking and modified-source Biome checks.
  Another 19 release/backend checks cover the runtime packaging follow-up.
  New native live-window assertions cover footer visibility with a long history
  and accessibility text size, centered detail navigation and save failures.
  Native changes and actual Astryx visual results still require remote evidence.
- CI 290 / `0cc4b86`: seven jobs passed, including iOS. The new macOS host test
  could not locate its action identifier; compilation passed. Its fixture now
  has a containing VStack and captures the actual accessibility tree before the
  same pointer/action/JS assertions. This remains an unverified follow-up.
- Release 129 has finished unsuccessfully. Windows/Linux/Android passed; iOS
  compiled the IPA and simulator app but installed-app smoke failed. Its visible
  Settings button exposed `gearshape` rather than the stable `settings` action
  identifier. Shell initialization completed six commands, then stopped when
  ios_system reused dash slot zero for the seventh probe. No Shell success or
  whole-app functional parity is established by those artifacts.
- Packaging investigation found all six dash libraries in the app's linked
  product, whereas a-Shell embeds them without linking. The new runtime-only
  product explicitly embeds/signs them without app startup references; the
  plugin no longer autolinks dash. IPA verification rejects direct, transitive
  and weak startup references to dash while retaining ABI/dependency checks.
  All nine real installation probes remain required. This diagnosis is an
  inference from the logs/configuration; its fix awaits installed-app smoke.

Research: [a-Shell embedding configuration](https://github.com/holzschu/a-shell/blob/master/a-Shell.xcodeproj/project.pbxproj),
[ios_system 3.0.4 loading and cleanup](https://github.com/holzschu/ios_system/blob/v3.0.4/ios_system.m),
[XcodeGen dependency options](https://github.com/yonaskolb/XcodeGen/blob/master/Docs/ProjectSpec.md)
and [Apple dynamic library lifecycle](https://developer.apple.com/library/archive/documentation/DeveloperTools/Conceptual/DynamicLibraries/100-Articles/DynamicLibraryUsageGuidelines.html)
were inspected through GitHub/Swift MCP and official documentation.

- CI 291 / `2581326`: all three Apple jobs passed. Hosted iOS ran 189 tests
  with zero failures; macOS passed its real host accessibility, pointer/action
  round-trip and shared-JS checks. Composited iOS screenshots were reviewed for
  the index, centered detail header and long-history sidebar footer. These are
  live component hosts, not a substitute for packaged application smoke.
- CI 291's frontend built successfully but failed on the formatting of one CSS
  selector. That formatting is corrected; all 659 frontend source files pass
  the error-level Biome check. TypeScript and ten targeted checks also pass.
- Rendering the downloaded CI 289 bundle with real SettingsPage/Astryx controls
  exposed overflowing provider action buttons and unbounded toolbar tabs at
  320 points. Provider actions now wrap, and tabs have a shrinking scroll slot.
  The settings index uses semantic leading icons and borderless, adaptive
  current-value selectors. The browser fixture supplies settings data only;
  it establishes layout evidence, not backend functional parity. Updated bundle
  rendering and installed-app verification remain required.

- CI 293 / `25e201e`: frontend compilation/lint and all 1,779 frontend tests
  passed; Rust, device archive and macOS passed. iOS compiled but one of 189
  tests found a 16-point editor viewport drift after file switching. The UIKit
  restore now keeps intermediate callbacks suppressed until the final layout
  batch applies the saved viewport; the original three-point assertion remains.
- CI 293 bundle rendering verified all twelve settings entrances at 320/390:
  no runtime exceptions or horizontal content overflow, and real touch actions
  returned to the index. Screenshots were reviewed for index, providers, local/
  cloud and Other. The 768 run stalled in browser input dispatch; it is not a
  completed check. No backend is supplied by this layout fixture.
- The user's PC reference requires an in-window centered settings dialog. macOS
  now has a native backdrop that dispatches the actual close action, rounded
  content, blurred parent, an X close control, independent scrolling columns,
  matching 896/608 maximum geometry and accent navigation selection. The host
  and packaged smoke checks require real outside clicks. The old fixture's five
  entrances and Back-to-Chat button were replaced with all twelve PC destinations
  and the actual system-form order. Their screenshots still await the next CI.
- Provider detail chrome previously assumed an unscoped settings-close action,
  even though provider controls scope their action IDs. Nested detail close now
  reads the sidebar's actual action; a validated-document/action-dispatch test
  exercises that provider-scoped callback. This is a functional fix, separate
  from layout evidence. The complete parity audit remains open.
- Further image review found that Astryx Section's outer wrapper still escaped
  the compact page gutter even though LayoutContent had 16-point padding. The
  compact form now resets inherited bleed variables at its own boundary;
  sections retain their internal padding propagation. All twelve entrances at
  320/768 were navigated using the CI 293 bundle with this pending rule applied:
  26 captures, no runtime exceptions or horizontal overflow. Card edges in the
  four crowded pages are inset instead of touching the page edge. Computer-use
  setup actions also wrap their long labels. The unmodified next-CI bundle and
  installed applications still need validation for these changes.
- The desktop CI bundle also rendered all twelve destinations at 1040. Image
  review found that the global list theme removed PC group borders and squared
  the selected navigation row. Desktop settings now explicitly retain rounded
  navigation rows and outlined setting groups. The native pointer fixture queues
  mouse-up before dispatching mouse-down, because AppKit may track a control
  synchronously until release; the outside-click assertion remains mandatory.
- Release preflight found a remaining installed-iOS assertion that waited for
  the intentionally removed Saved badge. It now requires that badge to remain
  absent and verifies the changed voice flag through application relaunch.
  Restoring the original flag now has its own relaunch/value assertion too;
  persistence is checked from actual process restarts rather than a status label.
- CI 294's iOS rendering and device jobs passed, as did frontend and Rust. The
  macOS log stopped at the new mouse-down fixture until the newer push canceled
  it; that supports the event-tracking diagnosis above. It is not a green CI
  run and must not authorize release.
- CI 296 / `70f0d13`: seven jobs passed, including hosted iOS and device,
  frontend and Rust. macOS compiled and completed 180 tests, but both actual
  settings outside-click assertions failed. The downloaded host screenshots
  confirm the centered dialog and twelve destinations; they do not establish
  dismissal behavior. No release is authorized by this failed run.
- The dismissal background now receives initial mouse events through AppKit,
  including an inactive window's first click, and excludes the rounded settings
  panel from its hit region. The real-window test retains its close-action
  assertion and now diagnoses pointer routing and exclusion of panel content.
  Desktop descriptions can wrap beside the value menu, navigation text keeps
  its available width, and dialog sizing preserves gutters in short windows.
  These native follow-ups require the next remote compile and rendering tests.
- CI 297 / `40944a4` compiled the native backdrop and the packaged UI harness.
  The host's outside/inside hit-region and actual hierarchy routing assertions
  passed at both widths, but the window-event close assertions still failed.
  That narrows the failure to event delivery or callback execution. The pointer
  fixture had clicked the resizable window's lower-left corner; it now uses the
  centered left gutter and converts host coordinates into window coordinates.
  Packaged smoke also avoids the window's resize corner. The close-action
  requirement remains unchanged; the event-delivery diagnosis is still pending.
- The unmodified CI 296 frontend bundle completed all twelve settings entrances
  at 320, 390, 768 and 1040: 52 captures, no runtime exceptions or horizontal
  content overflow. The four crowded compact pages' cards start at an 18-point
  inset, and the long computer-use action label wraps fully. The first combined
  browser run timed out at its final 390-point touch; a separate complete run
  verified that width. This is real compiled layout with fixture settings data,
  not packaged backend or live-service evidence.
- CI 297 image review showed that label layout priority alone did not stop the
  Shell menu from stacking. Desktop setting rows now measure the value first
  and wrap the label within the remaining column, falling back to a vertical
  arrangement for insufficient width or accessibility text. The native host
  requires the Shell menu to retain its intrinsic width. Navigation labels use
  their complete remaining column instead of competing with a spacer. Remote
  layout and pointer verification remain required for these refinements.
- CI 299 / `cd21024` compiled the new row layout, but its host test did not
  compile: the accessibility-tree wrapper lacked the role getter used to select
  the actual menu rather than its containing group. The wrapper now reads the
  real role through its existing modern/legacy attribute mechanism, and the
  control selection is split into explicitly typed expressions. Neither the
  menu-width nor the outside-close assertions has been weakened or skipped.
- CI 300 / `2901685`: macOS compiled and ran 180 tests, with one failure before
  the pointer assertions: its new filter did not identify the Shell menu. Role
  inspection now accepts the native menu-button role and reads formally typed
  accessibility roles directly. Screenshots and role/frame diagnostics are
  attached before checking the menu, so a failure preserves the actual view.
  All other macOS tests passed; this remains an unsuccessful CI run.
- Reviewing terminal bounds found a 480-point minimum on a panel hosted in
  windows whose actual minimum height is 360. Its preferred 300-point PTY
  minimum could also overflow after allocating toolbar space. Terminal layout
  now owns the viewport directly, reserves output space within the available
  height and keeps connection forms in their bounded scroll area. The existing
  narrow/wide/authentication test additionally hosts 360-point layouts; all
  original 640-point frame and minimum-output assertions remain intact. Actual
  frame containment and rendered output must pass on both Apple platforms.
- CI 301 / `eeced13`: the macOS job passed, including all 180 package tests and
  both packaged-app harness compiles. The real settings host now passes its
  Shell menu-width check, inner-panel exclusion, hosting pointer routing and
  close-action assertions at 640/1040. The corrected click position avoids
  window resize chrome; the actual dismissal requirement was preserved. This
  does not validate the newer terminal follow-up or replace all-eight-job and
  installed-application checks on the final commit.
- CI 302 / `877a45a`: all Apple compiles stopped at the same terminal error:
  the reused accessibility modifier was file-private. It is now module-internal
  so the manually composed terminal viewport retains the exact existing label,
  hint and optional-value semantics without the generic minimum-height wrapper.
  No rendering assertions were removed; the short-window change still requires
  remote compilation and frame/output verification.
- CI 303 / `f643ab6`: seven jobs passed. macOS ran all 180 tests successfully,
  including settings outside clicks and all eight terminal width/height/auth
  captures. iOS ran all 189 tests; its two failures are the preserved normal
  terminal-height assertions (286.3 instead of at least 290). The percentage
  reservation reduced output prematurely in the available iOS content area.
  Sizing now retains 300 points whenever at least 140 points remain for controls,
  and adapts only when that arrangement cannot fit. The original assertions
  remain unchanged. All-eight-job validation is still required on the new SHA.
- CI 304 / `5a54ba3`: seven jobs passed; all terminal frame/output checks now
  pass on iOS as well. Hosted iOS completed 189 tests, with five assertions in
  the retained file editor's return/undo test failing. The returned native input
  is the same object, mounted and not parked. Source review found that an older
  representable configuration can overwrite the current mount's explicitly
  rebound edit destination. Native input now keeps that current binding across
  style updates. A real UIKit input test deliberately supplies a stale lease
  after rebinding and requires both typing and undo to reach the returning file.
  Original lifetime, content, selection and action assertions remain unchanged;
  the next remote run must establish whether this fixes the integration failure.
- CI 306 / `c56fd00`: all eight jobs passed, including all 180 macOS and 190
  hosted iOS tests. Both the deliberate stale-binding test and retained
  file-return undo/redo integration passed. Release 130 / `37245078895` was
  dispatched for this exact SHA. Windows and Linux built successfully; the
  installed Android reached Settings but its harness still sought the removed
  Back-to-Chat label. Its real close control is now the required Close label.
- Release 130 macOS packages built, but Apple Silicon's composer was not AX
  hittable and its hierarchy logged inconsistent parent/child relationships.
  The boundary now hides the covered transport for hit testing and exposes
  unignored native children. Its SDK test additionally requires the window's
  accessibility hit to identify the actual pointer target. Intel's sample shows
  application-wide AX queries waiting in the system Apple menu's IconServices;
  packaged queries and hierarchy captures now stay within the actual window.
  Composer hittability remains mandatory and real click/typing is added.
- Release 130 iOS archive failed while copying the nonexistent aggregate
  `XgentDashRuntime` product. The host now consumes six individually staged,
  checksum-verified XCFramework files with embed/sign enabled and linking
  disabled. Xcode selects the platform slice. Staging regressions cover both
  slices, repeated read-only output, checksum failure and unsafe archives. The
  actual device archive, startup dependency inspector and nine Shell probes
  still must pass remotely; these changes do not establish installed parity.
# Source audit follow-up: sidebar search, Soul and SSH

The Astryx implementations in `ChatHistorySidebar.tsx`, `WorkspaceSearchPalette.tsx`,
`OtherSettingsSection.tsx` and `SshSettingsSection.tsx` exposed additional differences:

- Sidebar search previously only filtered loaded titles. Native search now calls the
  same extracted search source as Astryx: persisted message history, workspace glob,
  settings and quick actions. Search retirement and workspace changes reject old
  result actions. A native bounded results viewport supports long paths, Dynamic Type,
  arrow/Return/Escape navigation and marked-text composition guards.
- Desktop Soul selection and mobile settings-button long press now use the actual
  shared Soul presets, selected state and creation route. The mobile picker uses a
  native material sheet. Real device long-press behavior still needs installed-app
  confirmation; layout fixtures and controller tests alone do not prove it.
- Native SSH now includes authentication/status metadata, confirmed known-host reset,
  scan import with duplicate constraints, single-key-file import, configured-secret
  hints, keyboard-interactive guidance and folded proxy settings. Operations use the
  same existing handlers/backend as Astryx. Host rows have a handwritten native card.
- Production settings surfaces have UUID suffixes. The iOS navigation now recognizes
  `settings:<UUID>` as a settings session, retaining one Back control on detail pages.
  Drawer tests now use that actual surface identity.
- CI 307 passed seven jobs but failed the iOS context-popover accessibility assertion:
  Cancel exposed a 20.67-point region. Its 44-point frame is now inside the button
  label. No full release was dispatched against that failing commit.

At this checkpoint, source differences included the native Other page's extra list-entry layer,
the missing sidebar application-update entry, and composer hardware Return/Shift-Return/
Control-Return behavior. These items are not counted as aligned. Native SDK checks and
installed-app smoke evidence for this follow-up are pending; all-platform parity and
90% visual similarity have not been demonstrated.
# Inline Other settings follow-up (2026-10-05)

The shared `OtherSettingsSection.tsx` renders Hooks, Cron and SSH lists inline,
and replaces all three areas when an editor opens. Native settings now mounts
the same three controllers together, publishes their primary content through
one retained settings session, and leaves confirmation alerts separate.
Detail node identities remain intact; area actions are scoped to their content
owner so hidden and retired editors cannot receive old actions. iOS renders
each area with its own inset and avoids wrapping its cards in another card.
Actual controller tests cover all three lists, hook mutation, editor entry and
return, hidden action rejection and confirmation ownership on both form factors.
Swift narrow-width and large-text rendering checks are pending remote CI.

CI 308 exposed a file-private search helper call at compile time. Search now
reads public child data directly; no access-control relaxation was needed.

The conditional update button from `ChatHistorySidebar.tsx` and
`AppUpdateButton.tsx` is now included in both native sidebar footers. It invokes
the same install/restart controller (including its running-task guard), shows
version and failure/retry labels, and reserves duplicate requests before render.
The shared `AboutSection.tsx` itself contains only the name and current version;
that native page was already aligned. New controller checks pass; footer geometry
and actual macOS button dispatch remain subject to the new remote SDK run.
