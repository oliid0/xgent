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
Native keyboard submission now routes Enter/send, Shift-Enter/newline and
Ctrl/Cmd-Enter/steer through the shared handlers, preserving IME composition.
History and atomic reference editing also have shared/native source coverage;
their new physical-keyboard SDK fixtures still require hosted execution.
The native editor now has handwritten SwiftUI inline reference badges hosted by
Apple TextKit, compatible with the macOS 15 deployment target. Exact reference
identities and UTF-16 projection preserve shared draft metadata across editing
and native undo; pending metadata-only edits also wait for their canonical
reference acknowledgement. New Apple SDK fixtures still require hosted
compilation/rendering and installed input acceptance before claiming input parity.

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

# Native input and real-control follow-up (2026-10-05)

CI 311 and 312 compiled the device archive and passed the frontend, Rust,
architecture and workflow jobs. Hosted iOS ran 195 tests with one search-input
identity failure. macOS 312 ran 185 tests with four Soul-menu frame failures;
its search bounds, native typing and real arrow/Return dispatch passed.
The captured iOS accessibility tree shows the search container identifier
overwriting the actual field identifier. The container now preserves child
identities. The desktop Soul footer now owns a handwritten 40-point native
button and popover instead of the generic Menu's 17-point text cell. Existing
bounds assertions remain, with added real preset activation checks.

The installed iOS settings harness now enters the actual inline Hook, Cron
and SSH editors, checks their fields and returns to Other with a real Back
button. Hook/Cron back actions retain their controller ownership and disabled
saving state. Installed-app results remain pending a green exact-HEAD release.

Reading `MentionComposer.tsx` and `ChatPage.tsx` found hardware Return behavior
missing from the native input. Native input now routes Return to shared send,
Shift-Return to native text insertion, and Control/Command-Return to the shared
steer callback. A floating candidate menu owns local selection, arrow movement,
Tab/Return activation, Escape dismissal and selected-row scrolling. Composition
and stale text/caret guards precede those actions. Submission reconciles the
native draft before calling existing business handlers, retaining unchanged rich
references and rejecting retired conversation/workspace operations. Node
controller checks pass; real macOS key events are required by new SDK tests.
Hardware behavior on a physical iPad and the installed macOS application is not
yet proved. The source's prompt-history recall and atomic mention-chip keyboard
behavior remain separate source-audit items, not demonstrated by this change.

CI 313's 188 macOS tests passed the actual Soul-button/preset press and bounds,
search typing/keys, Shift-Return newline, Return native-draft submission,
Command-Return steer and marked-text Return suppression. One keyboard-menu test
appears to have counted an asynchronous caret-placement report from its own setup
as an arrow action. Setup now settles that report before the unchanged no-action assertion;
the failure message records any later unexpected action names. This requires
confirmation on the next SHA. All 195 hosted iOS tests and six other CI jobs passed;
the real iOS search field now keeps its own accessibility identity.

Further source review found Soul's mobile close-only detail and Backup's visible
Back-to-Settings body button. Both now use the native header Back; desktop Backup
keeps shell close/outside-dismiss only. Saving exposes a disabled Back control,
checked in the real hosted drawer. Native typing actions also now carry their
conversation/workspace scope, allowing the native model to discard old optimistic
edits on target changes. Controller tests reject late and returned-old-scope edits;
a bridge test requires a restored next-conversation draft to survive old input
and its acknowledgement. Installed screenshots/persistence are still required.

# Mobile voice entry and native typography (2026-10-05)

CI 314 at `0a9166de75467954f6247b9a1b71f73482780ac5` passed all eight jobs.
Hosted macOS passed 189 tests and hosted iOS passed 196 tests, including the
previous keyboard-menu setup check and disabled drawer Back control. Full
Release 131 was dispatched only after that exact SHA passed; six platform
packages and installed application smoke tests are still in progress.

Source review of `SettingsPage.tsx`, `ChatComposerBar.tsx` and `NativeChatPage.tsx`
found Android's voice setting excluded by `desktopOnly`, although mobile
recording requires `stt.enabled` and the default is false. Android now has a
mobile voice page with the real enable setting, native recognition status,
permission entry, refresh/error feedback and a parent-aware Back route matching
iOS. The desktop STT provider form remains desktop-specific. The mobile enable
control preserves provider credentials; mobile descriptions no longer claim
that system recognition requires desktop cloud credentials.

Android voice and device permission pages share native-service observation with
operation ownership, queued resume refresh, synchronous duplicate-request
guards, supported permission aliases and aborting retired authorization requests.
Controller tests cover denied permission, retry, resumed OS grants and retired
status/request results. These checks do not prove recording on physical devices.

Native composer, workspace search input/results and desktop Soul controls now
honor their surface's font family/application scale, with Dynamic Type scaling
applied once. A new hosted test checks the fonts and sizes of actual native
composer/search fields; existing narrow/large-text accessibility bounds remain.
Swift compilation and installed font/layout evidence require the next exact-SHA
CI/release. Prompt history and atomic mention keyboard editing remain open.

# Release 134 installed evidence and current source follow-up (2026-10-05)

Release 134 tested de4a0130f7465b71c462c9e43d45bd79d6e6d307 and has finished.
The macOS packages, signed APK, device IPA and simulator builds succeeded;
macOS/Android/iOS installed interaction acceptance failed. Current uncommitted
source repairs were not exercised by that release. Evidence is SHA-256 verified
under .ci-artifacts/release134-*; detailed findings and digests are in history.md.

macOS source now uses a real native AppKit container as the hosting view's AX
ancestor rather than promoting SwiftUI proxies into the Tauri sibling list.
Intel runner recovery is bounded to the affected macOS 26 x86_64 CI environment
and must pass an actual AppKit icon-rendering probe after recovery. Android's
smoke input helper waits for focused, stable terminal bounds and verifies the
exact typed command before executing it. Neither change weakens command results.

iOS source now places transparent form-button hit bounds inside their labels,
identifies only the actual toggle/button control, and removes covered background
content from sheet accessibility navigation. The added hosted switch test checks
AX identity, physical UISwitch center hit testing and shared edit delivery; the
installed test still performs ordinary taps and preference/relaunch assertions.
Mobile voice copy describes device speech and omits unrelated HealthKit text.
These Swift changes require future hosted SDK and installed-app acceptance.

The pinned pkg script now resolves its bundled helper commands with a scoped
native-only PATH and bare names. This addresses both upstream's unquoted APPDIR
and ios_system's unquoted argv[0] serialization for pkg operations. The actual
registry probe remains mandatory. Source tests execute pkg list/help with spaced
environment/home paths, but do not execute iOS frameworks or install packages.
Arbitrary spaced executable paths remain a separate upstream bridge limitation.

Relevant source regression: 30/30 pass; TypeScript, Biome error checks, native
state contract and architecture checks pass. The earlier broad 853/853 source
run predates this iOS follow-up. Full installed acceptance, remaining detailed
component parity and measured 90% visual similarity remain open. No own push or
dispatch has occurred; final push follows the complete repair and source review.


# Astryx provider-list source follow-up (2026-10-05)

Provider rows now wrap full names, endpoints, active-model counts, quota feedback
and proxy state, with an independent action group that moves below details in a
narrow panel. Compact settings use rounded light cards and monochrome provider
glyphs. Larger Add/import/row actions and compact vendor tabs retain the original
editor, advanced settings, quota and import routes. Long import labels wrap.

The actual shared ordering callback now rejects foreign pointers, discards a
cancelled preview, and cancels on vendor changes. Regression cases also exercise
keyboard ordering, usage refresh, preserving saved secrets/headers/retry policy
through edit/save, and confirmation before deletion.

Real React/Astryx source browser evidence covers 32 provider fixtures per live
viewport at 240/320/390/768, in English/Chinese with 1x/1.5x controlled typography.
All final bounds, overlap, targets, cards and nonempty computed glyph-color checks
pass. The source screenshot was inspected. Relevant source regression: 30/30
pass, zero skips/cancellations; TypeScript, Biome error checks, native state and
architecture checks pass. Source fixtures do not prove installed application
acceptance or the overall visual similarity target.

Native ProviderList still places drag/menu beside text, omits its provided row
icon, and replaces endpoint/model metadata with quota text. Native list/detail
adaptation and editor request ownership remain open. No current push/dispatch;
finished Release 134 tested the earlier committed source, not these changes.


# Native provider-list source adaptation (2026-10-05)

This supersedes the earlier open provider-row note at the source level. Both
presentations now use the shared providerListDetails formatter, preserving
endpoint/model counts beside quota feedback. Native rows render the provided
monochrome symbol, proxy icon/state and independent refresh/edit/delete actions;
the reorder menu keeps accessible move commands and drag behavior.

The native row layout measures wrapped details within their actual available
width. It stacks the action flow below details at the same narrow threshold as
Astryx and retains side actions in wide rows, including right-to-left placement.
Cards use the current theme's rounded card surface and metadata uses the app's
font family/scale. Added hosted iOS width/large-text/RTL geometry and unique-AX
assertions; they require future SDK execution and are not installed evidence.

Real controller tests exposed and fixed a retired delete confirmation targeting
another newly opened confirmation. Ownership now also distinguishes reopening
the same provider. Native list/model/request/runtime plus actual Astryx browser
regression: 60/60 pass, zero skips/cancellations. TypeScript, Biome error checks,
native contract and architecture checks pass. No local Swift compilation or
push/dispatch occurred.

Native vendor tabs/header, provider add/draft/save behavior, detailed editor
layouts and Astryx model-fetch ownership remain open. Overall visual similarity
and current-source installed interaction acceptance remain unproven.


## Provider editor discovery ownership and compact controls (2026-10-05)

Actual ProviderEditor handler regressions reproduced three distinct failures before repair: an accepted credential edit could still admit the old catalog before the next render; repeated manual taps issued duplicate discovery and left the automatic timer active; leaving the editor allowed retired callbacks, replies and scheduled discovery to continue. Current source tracks editor lifetime, committed configuration, synchronous edit version and individual pending request ownership. Request-affecting edits invalidate before the next render, manual refresh cancels its automatic duplicate, and an obsolete success/error/finally cannot replace models, errors or a newer loading state. Successful save, back/cancel and effect cleanup retire requests. No transport, discovery endpoint or secret behavior was replaced.

Added eight actual-editor interaction tests through the public ProviderList edit handler, without exporting the private editor or mocking its merge logic. Cases cover credential changes before render, duplicate taps, close/save, current failure/manual retry, normalized-equivalent whitespace changes, models URL/proxy/header/auth changes, cleared/replaced credentials, preserving user model limits and manual activation during discovery, and effect cleanup/replay. All eight pass. The broader relevant native/provider/model/request/runtime source regression passes 64/64 with zero failures/skips/cancellations, log .ci-artifacts/astryx-narrow-20261005/provider-editor-source-regression.log.

Compact editor tabs/actions now request supported touch sizes. Secret inputs use their existing compact composition; field input surfaces and selectors retain a 44px minimum. Added scoped editor layout rules: constrained credentials/auth grids, wrapping model actions, full wrapped model IDs, adaptive model details and edit/delete controls, stacked narrow custom header fields with visible independent actions, header-count wrapping, bounded panel scrolling, and equal-width footer save/cancel controls. Removed the compact tab/footer decorative divider. Search positioning and footer width have explicit semantic source styles instead of relying on incidental utility layout. Screenshot inspection caught a too-narrow footer even after the earlier generic bounds checks passed; fixed the actual Toolbar content slot and added balanced width and content-not-covered assertions.

The real React/Astryx browser fixture opens the private editor using its public production handler, then renders all three actual panels. It checks 48 editor combinations per live viewport (EN/ZH, component widths 240/320/390/768, controlled 1x/1.5x typography, General/Request/Usage) at four live viewports, alongside existing provider/settings/access/sidebar/file-tree fixtures. Final 192 editor measurements and existing checks pass with zero failures. Source HTML/JSON and inspected General screenshot: .ci-artifacts/astryx-narrow-20261005/provider-editor-verified; log provider-editor-layout-verified.log. This fixture uses current source CSS and installed Astryx CSS; it does not execute the complete application's generated Tailwind output or an installed app, and cannot prove device keyboard/scroll behavior or overall visual similarity. Do not count its early baseline diagnostics as hundreds of installed application defects.

React's official useEffect cleanup guidance and Astryx MCP TabList documentation informed request lifetime and supported scrollable/lg tabs. TypeScript --noEmit, Biome error checks, native state contract (55 kinds/45 properties), architecture and normalized diff checks pass. No local build/dev/install/cargo/Swift compile, commit, push or dispatch occurred.

Goal remains active. The earlier Astryx model-discovery ownership open note is superseded at the source level. Usage-test reply ownership, native provider root tabs/header and immediate persistence of newly added native providers still require review; native detailed layouts, SDK compilation and installed parity remain open. No overall completion or 90% visual similarity claim. Release 134 tested the earlier committed source, not this dirty tree.


## Native provider drafts and macOS window toolbar (2026-10-06)

Read the updated user objective in C:/Users/ox_i/.codex/attachments/3dd9d266-c4a2-40ca-8ffa-f4e21516f8ac/goal-objective.md. Its full cross-platform repair scope remains active. The macOS titlebar reference is additional steering, with no authorization to push before the full source repair is complete.

Native provider general/model/request pages now share an unsaved editor draft. Adding no longer persists an unnamed placeholder; Save validates the latest accepted fields and updates the authoritative previous settings, preserving unrelated changes. Back/Cancel discard the draft; cleared names survive nested model/request normalization and remain invalid. Removed providers cannot be resurrected. Nested request and model Save update only the outer draft, and usage testing of a new unsaved provider is disabled with the existing save-first explanation. The separate runtime/failover settings remain global by design. Older catalog responses are rejected after a credential edit before repaint. Deletion confirmations are owned by both editor session and individual confirmation; two failing actual-handler cases reproduced stale confirmation reuse and pending deletion leaking into a reopened editor before repair. All 11 native editor interaction cases pass, using the actual parent and actual model/request child code.

Added a shared handwritten native provider footer with balanced Save/Cancel actions and no decorative divider. The iOS sheet and desktop detail scroll area reserve footer space and omit it from scrolling fields. Updated the earlier blanket safeAreaInset guard to keep the prohibition specifically on the iOS chat composer while allowing the new settings footer. Added an iOS actual-sheet layout fixture for widths 240/320/430/768 and larger Dynamic Type; it is not compiled or run locally, and no hit-test acceptance is claimed.

macOS now installs an actual NSToolbar through the native host. AppKit owns traffic lights, window dragging and overflow; SwiftUI renders titles and the tab area. Native buttons use the real shared actions for chat history and browser navigation, and the same observable workspace state as the right pane for expand/collapse/selection. Chat history retains at most 100 visited IDs, skips removed conversations, replaces the forward branch after a new selection and rejects repeated/retired callbacks. Conversation titles come from the authoritative sidebar store. Browser titles and full URLs, file names/paths and terminal session names come from existing documents; editor tab actions retain the existing code-host draft commit helper. Compact windows expose the tab list through a menu; the native toolbar has its own overflow representation. Current file/browser tab closing remains available after their content tab rows move into the titlebar. Browser status and whole-browser close remain available in the title menu.

The host reserves the real AppKit safe area instead of drawing content underneath the toolbar. Duplicate in-content toolbar/sidebar-close/panel-tab/browser-header rows are omitted only while window chrome is installed; the mobile path retains its original compact controls. Window reset/detach restores the original toolbar, style, title, appearance and separator. Forced light/dark appearance applies to the native titlebar as well, and refresh requests are coalesced. Settings/confirmation overlays own title/back navigation and block underlying sidebar/tab interactions. The installed macOS smoke source now targets the actual titlebar sidebar button and checks real bounds, overlap and enabled hit targets at full and narrow window widths.

Added three actual NativeChatPage handler regressions for history/title behavior, removed targets/failure retry and mobile separation. Added four executable macOS SDK fixtures for browser context, file/terminal actions, overlay ownership and actual public C-bridge host installation/reset; the latter checks widths 320/640/1156, traffic-light separation, native content placement, real forward dispatch and captures full window chrome. These Swift fixtures and the packaged UI checks have NOT been compiled/run on this Windows host. The existing CI native package test scheme discovers them automatically; no new dependency was installed.

Relevant combined source regression: 226/226 pass, zero failures/skips/cancellations; log .ci-artifacts/astryx-narrow-20261005/window-provider-combined-regression.log. After the final deletion URL-draft cleanup, the affected native editor/contract follow-up passes 16/16 (native-window-editor-final-regression.log), and macOS preparation/contract checks pass 6/6. TypeScript --noEmit, targeted Biome error checks, native schema (55 kinds/45 properties), architecture and normalized diff checks pass. The Swift/installed tests are pending and are not included in these counts.

Primary references read: Apple NSToolbarItem.view, NSToolbar.visibleItems/centeredItemIdentifiers, NSWindow.toolbarStyle/contentLayoutRect and NSView.safeAreaLayoutGuide documentation through Swift MCP; CodeEdit's real window-toolbar implementation through GitHub MCP. No local build/dev/install/cargo/Swift compilation, stage, commit, push or Actions dispatch occurred. HEAD remains de4a0130f7465b71c462c9e43d45bd79d6e6d307. Release 134 does not validate this dirty source tree.

Remaining scope includes native provider category/header layouts, usage-test reply ownership, narrow macOS body/sidebar sizing, the broader settings/component/function parity audit, platform build/installed acceptance, and measured overall visual comparison. This checkpoint does not establish 90% similarity or completion of the goal.

## Shared model configuration and native input follow-up (2026-10-06)

Read the current objective attachment at C:/Users/ox_i/.codex/attachments/70bff371-2011-4a3f-9cac-faf0cf4461b0/goal-objective.md. The full repair scope remains active. The current source includes native provider category/header wrapping, usage-test request ownership and narrow macOS sidebar placement repairs, superseding those three earlier source-level open notes. Their hosted Swift and packaged interaction assertions remain pending remote execution.

Both provider editors now persist model order and use it in the chat model picker, with adjacent move/reset actions. Search and bulk-edit states prevent ambiguous reordering; actions use the latest models, active selection and accepted order before repaint. Provider/model cache-hint choices reach the existing runtime, including inheritance and explicit clearing. Model input capability overrides reach real model construction and native image attachment payloads. DeepSeek's current image-rejecting adapter is excluded from this choice. Explicit text-only Anthropic aliases skip image/PDF reads while retaining text documents; automatic aliases retain their existing image-upload behavior, now accurately represented by their model input metadata.

Actual Astryx editor interactions also exposed model-edit changes being lost when Save preceded repaint, and Gemini user limits, costs and input capability being discarded on editor reopen. The final model and active-model snapshots are accepted synchronously. Gemini normalization now preserves saved configuration through reopen, catalog refresh and Save, while retaining newly fetched catalog metadata. Tests exercise the real editor through the public provider-list handler, not a second implementation of its merge logic.

Native prompt history uses the shared recall session, with scoped lazy history, logical-line boundaries, UTF-16 caret payloads and complete rich-draft restoration. Native reference arrows and deletion now use ranges from the authoritative rich draft; software-keyboard deletion crossing a reference removes its whole segment and retains neighboring metadata. Physical native key tests and malformed-range tests were added for future SDK execution. This fixes an interaction gap but does not yet render native inline references as the Astryx visual chips; that visual work remains open.

Compact memory/system/backup/provider controls now receive semantic monochrome glyphs, including independently mounted native details. Native workspace and group names wrap without the conversation-title line cap. Both workspace more menus omit the requested folder-browsing entries, retaining the direct Files route and existing workspace operations. Native mobile settings details show persistence errors without an extra healthy-save status row, matching the shared settings behavior; desktop chrome retains its own contextual state.

The real React/Astryx source-browser fixture covers Claude and Codex editor General/Request/Usage panels at EN/ZH, widths 240/320/390/768 and 1x/1.5x controlled typography: 96 combinations per live viewport, 384 editor measurements across four live viewports. Bounds, overlap, targets, card surfaces and existing settings/sidebar/file-tree checks pass. The expanded fixture page exceeded 262144px in height, where Chromium measured a computed 44px target as 43.984375px; touch-size assertions allow 1/32px numerical precision, without changing bounds/overlap checks or actual target styles. The provider and memory source screenshots were visually inspected. This is source-CSS evidence, not complete generated Tailwind output or installed-device acceptance.

Validation evidence: the broad frontend run passed 1886/1886 with no skips/cancellations (current-frontend-final-regression.log), before the final Anthropic/reference/settings-status changes. Subsequent affected suites pass 37/37 for model input/Anthropic/runtime/native model settings (alias-model-input-regression.log), 87/87 for Gemini configuration and editor/normalization flows (gemini-model-config-regression.log), 61/61 for settings/sidebar/native provider drafts (settings-sidebar-final-regression.log), and 127/127 for composer references/history/messages/native contract/localization (composer-atomic-regression.log). Release/platform helper regressions pass 49/49 (release-platform-source-regression.log); expanded source-browser checks pass with no skips (memory-icons-layout.log). Logs live under .ci-artifacts/astryx-narrow-20261005/. TypeScript --noEmit, Biome errors, native state contract (55 kinds/45 properties), architecture and normalized diff checks pass. These counts exclude Swift compilation, device execution, Cargo and actual application packaging.

Latest remote evidence still belongs to Release 134 on de4a0130f7465b71c462c9e43d45bd79d6e6d307: Windows/Linux succeeded; macOS Intel/ARM, iOS and Android failed installed smoke interactions after producing application packages. Current source repairs native AX ancestry/hit targets, iOS pkg command discovery, Android focused input and the bounded Intel runner IconServices probe. They have not been validated in a new installed application. No local build/dev/install/cargo/Swift compile, stage, commit, push or dispatch occurred in this follow-up.

Primary references consulted through available internet tools: Apple KeyEquivalent.delete/deleteForward, NSHostingView/ViewThatFits and Liquid Glass documentation; Astryx components/TabList; SwiftPackageIndex and the upstream SwiftTerm/SwiftUI-Flow repositories; Anthropic image/PDF request documentation; React useEffect cleanup. No callable GitHub/Swift/Astryx MCP tools were exposed during this follow-up; do not present web reads as MCP calls. Existing pinned packages remain in place, without adding packages merely to increase their count. Overall functional/installed parity, native inline-reference visuals and measured 90% visual similarity remain open. Goal is not complete.

## Per-model parameters and Astryx component correction (2026-10-06)

Read the active 70bff371 objective attachment again. The user clarified that provider configuration includes editing one model's parameters, and explicitly rejected extensive handwritten CSS. Compared the actual yy/PC-Desktop/agent-ui provider model draft and save handlers. Both editors now distinguish edited limits from untouched catalog limits: changing cost/input/cache settings does not freeze catalog limits as user overrides, and discovery completing during an open model edit retains fresh untouched limits. The Astryx outer Save commits a valid open model draft; switching models preserves its accepted edits, while invalid edits block Save/switch and explicit Cancel discards that draft. Tests exercise the real private editor through its public provider-list action. Claude model lookup and runtime construction now honor saved user context limits, rather than replacing them with catalog context. Actual pi-ai Anthropic request tests verify the saved output limit reaches the wire, including adaptive, long-context and custom aliases. Native numeric/decimal field variants request the matching iOS keyboard; their new UIKit SDK fixture has not run locally.

Removed the added provider-editor layout stylesheet and compact-access input overrides. Tabs, scroll ownership, authentication choices, credentials, model rows/fields, search/clear controls, header actions, input validation and footer sizing use documented Astryx Stack/StackItem/Grid/TextInput/Selector/Button/Banner props and the existing compact theme. Removed old fixed-height utility classes that would override mobile component sizes in the actual application's generated CSS. The index.css diff is now 46 additions / 8 removals, including formatting of existing rules; remaining provider rules handle its narrow ListItem action slot and monochrome legacy brand SVGs. The compact List surface now receives its card color from the Astryx theme instead of being forced transparent by a blanket rule. This supersedes the earlier scoped provider CSS approach.

Expanded the actual React/Astryx browser fixture to open model parameters through their real action, as well as General/Request/Usage. It covers EN/ZH, widths 240/320/390/768, controlled 1x/1.5x typography and Claude/Codex: 128 editor cases per live viewport, 512 measurements across four viewports. All existing bounds, overlap, touch-target, grouped surface, footer and other settings/sidebar/file-tree checks pass; the two limit and four cost fields also exist and remain scroll-reachable. Input hit targets measure Astryx's actual click-delegating wrapper, verified against installed TextInput/NumberInput/Selector source, retaining separate measurements for independent buttons. Screenshot inspection exposed unreliable Chromium crops on the hundred-page fixture: screenshots now optionally isolate the already-measured mounted case with its original theme ancestors, then wait for painting. All measurements finish on the full fixture before isolation. Inspected current general/provider screenshots; this remains source-CSS evidence, not complete generated CSS or installed device acceptance.

Validation: the expanded browser passes with zero failures/skips; .ci-artifacts/astryx-provider-components/astryx-layout.json records all four viewports. The broad frontend regression passes 1899/1899 with zero failures/skips/cancellations (.ci-artifacts/current-frontend-astryx-regression.log); it began before the final component-prop adjustments. Final affected editor/list/navigation/theme/native model/runtime/wire suites pass 45/45 (.ci-artifacts/astryx-model-component-final-regression.log), and release/platform helper regressions pass 49/49 (.ci-artifacts/astryx-provider-release-followup.log). TypeScript --noEmit, targeted Biome errors, native state/action contract and architecture checks pass. These counts exclude Apple SDK compilation and installed execution.

GitHub, Swift and Astryx MCP are callable again in this follow-up. GitHub MCP revalidated the latest release and retrieved all four failed jobs from Release 134 on de4a0130f7465b71c462c9e43d45bd79d6e6d307. Android failed Shell exit-status interaction; macOS ARM failed composer reachability; Intel timed out querying UI; iOS failed cron reachability, voice persistence and pkg registry verification with path_helper exit 127. Packages were produced before these failures. Current source contains corresponding repairs and helper coverage, but no new hosted/installed run proves them fixed. Primary component APIs and numeric keyboard documentation were read through Astryx/Swift MCP; GitHub code search and upstream STTextView attachment examples plus Apple's TextEditor/attachment documentation informed the remaining native inline-reference work. The SwiftUI attributed editor requires macOS 26, while this app supports macOS 15, so it cannot simply replace the shared native input without a compatible editor and selection mapping.

Goal remains active. Native inline reference visuals, complete installed function/interaction parity and measured 90% visual similarity remain open. No local build/dev/install/cargo/Swift compile, staging, commit, push or Actions dispatch occurred. The user has authorized pushing and triggering builds once the required repairs/checks are ready; no additional permission is required.

## Native composer inline references and editing (2026-10-06)

Re-read the requested 02ddd770 objective attachment and continued its full repair scope. Replaced the plain native composer field with a handwritten SwiftUI wrapper around Apple TextKit text views. Inline SwiftUI badges represent file/folder, Skill, commit, Git file, code and large-paste references. Their SF Symbols, selected font, application/Dynamic Type scale, semantic colors, bounded widths and rounded surfaces remain native. Badge hosting views let the text view own pointer placement and selection. The editor keeps its native view/coordinator, composition, focus requests, shared history/menu/submit shortcuts and one-to-six-line scrolling behavior; iOS retains a 44-point minimum editing target. No new stylesheet rules or package dependencies were introduced for this feature.

Native attachments occupy one UTF-16 unit. A separate immutable reference attribute retains their original prompt text, and the projection maps selection, copying and shared keyboard payloads to/from the complete prompt. Clipboard paste stays literal text and normalizes line endings; copying and cutting export original prompt text. Reference identifiers are scoped to the shared composer store and retain complete original draft metadata, including two same-named Skills from different paths. A bounded archive supports native undo without reassigning expired identifiers to unrelated objects. Whole native snapshots validate IDs, ordered ranges and exact original substrings before rebuilding shared draft segments; foreign, expired or malformed references cannot silently become another file or Skill.

Added a distinct checked `editAction` transport property, separate from literal text and caret reports. The native optimistic value and its ACK remain plain prompt text. Pending reference metadata also stays optimistic until matching canonical references arrive; equal text alone cannot acknowledge replacing a chip with the same literal label. Action ownership changes, rejected latest edits, disappearing fields, removed surfaces and invalidation retire this state. Hardware arrows/deletion use the native single-unit attachment when rendered; the previous shared atomic command remains available for legacy plain-text fields. New Swift fixtures cover UTF-16/grapheme boundaries, malformed descriptors, metadata-only acknowledgements, retired owners, actual native copy/cut/undo, narrow long badges, font scale and the current real NSTextView font control. These fixtures have not been compiled or executed locally.

Apple documentation was queried through Swift MCP for attributed TextEditor availability, TextKit attachment/view-provider APIs and typing attributes. GitHub MCP read STTextView's actual AppKit attachment examples and LiYanan2004/RichText's SwiftUI hosting implementation. The latter confirms that TextKit's nonisolated attachment overrides need explicit main-actor hosting rather than isolating the whole attachment subclass. Primary references: https://developer.apple.com/documentation/appkit/nstextattachmentlayout/viewprovider(for:location:textcontainer:), https://developer.apple.com/documentation/uikit/nstextattachmentviewprovider/attachmentbounds(for:location:textcontainer:proposedlinefragment:position:), https://developer.apple.com/documentation/uikit/uitextview/typingattributes and https://github.com/krzyzanowskim/STTextView/blob/main/TextEdit/Mac/TextAttachments.swift. Existing dependencies were retained instead of adding packages to increase their number.

Validation: complete frontend source regression passed 1905/1905, zero failures/skips/cancellations (.ci-artifacts/current-native-inline-frontend.log). This includes the new identity, deletion/undo, literal-label replacement, validation, desktop/mobile publication and owner checks. The subsequently added multiline large-paste case and all other composer cases passed 15/15 (.ci-artifacts/native-inline-large-paste-final.log); composer/document validation also passed 21/21 before that addition (.ci-artifacts/native-inline-core-final.log). TypeScript --noEmit, full Biome error checks across 680 source files, architecture, native state/action contract (55 kinds/46 properties) and diff checks pass. Full Biome exposed two compact CSS declarations requiring formatting only; the index.css diff is now 51 additions/8 removals, with no additional styling behavior in this follow-up. Source checks do not establish Apple SDK compilation, native attachment rendering/undo, installed interaction acceptance or measured visual similarity.

GitHub MCP confirms Release 134 / 37383846789 on de4a0130 remains the latest release failure; no newer build has tested this dirty tree. Its previously retrieved failed job logs remain the basis for the Android Shell, macOS ARM composer, Intel query timeout and iOS cron/voice/pkg repairs. Their new installed acceptance, all settings/sidebar/chat routes and cross-platform functional/visual acceptance are still pending. Goal remains active. No local build/dev/install/cargo/Swift compile, staging, commit, push or Actions dispatch occurred.

## Clipboard parity and push preparation (2026-10-06)

Large clipboard pastes now use shared 8000-UTF-16-unit/200-line thresholds, normalized line endings, numbering and previews in both frontends. Native snapshots declare new scoped paste IDs without duplicating their bodies. Validation rejects foreign, malformed, unused and undersized declarations; undo/redo retains reference identity and complete metadata. UIKit uses attributed fragment edits with reciprocal native undo registration. TextKit projection inserts semantic word boundaries around chips without creating editable native units; hidden paste line breaks do not block shared prompt history. Styling updates preserve native attachment positions and undo ranges. SDK fixtures cover clipboard expansion/collapse, native undo/redo, reference spacing and restyling; hosted SDK execution is required to establish their actual behavior.

Validation: complete frontend source regression passed 1911/1911 (.ci-artifacts/native-large-paste-frontend.log), with no failures/skips/cancellations. Final affected suites including desktop/mobile scoped paste publication passed 69/69 (.ci-artifacts/native-large-paste-final-affected.log). TypeScript --noEmit, full Biome errors across 681 files, architecture and native document contract (55 kinds/46 properties) passed. Release/platform helper regressions passed 49/49 again during push preparation (.ci-artifacts/push-release-preflight.log). No local build/dev/install/cargo/Swift compilation occurred. No stylesheet rules were added in this continuation.

The user's latest instruction is to prepare and push, then ensure CI and Release pass. The macOS packaged smoke now queries the real NSTextView accessibility role while retaining actual click/type/value assertions and every settings route. Remote main was fetched and matched the local base de4a0130 before preparation. These source checks do not replace hosted SDK compilation or packaged execution; the requested push and smoke-enabled manual Release will provide that evidence. Overall installed functional parity and measured visual similarity remain open.

Hosted follow-up: pushed 875467fe and triggered CI 317 / Release 135 with smoke=true, publish=false and sign=false. CI identified the iOS switch conditional-expression modifier chain, repaired in a75e9e87 using a Group. Stopped obsolete Release 135 and triggered CI 318 / Release 136. CI 318 passed Rust, workflow, architecture and hygiene checks. macOS tests failed to compile because DesktopSidebarPlacementTests tried setting the read-only accessibilityReduceMotion environment value; test transactions now disable animations without mutating system accessibility preferences or removing sidebar checks. Linux frontend passed 1911 tests and failed one browser-layout fixture with two request-panel control overflows at 240px. The cache group now uses Astryx Section padding and HStack/StackItem constraints, replacing those utility-only layout assumptions. Overflow diagnostics include locale, provider, role and measured bounds. The full four-viewport layout fixture and provider editor ownership regressions passed 23/23 locally after this repair; TypeScript --noEmit and affected Biome checks passed. Hosted acceptance remains pending; no local build/dev/install/cargo/Swift compile was run.

## Hosted Apple failures and installed evidence (2026-10-07)

CI 319 / 37538871220 on d18cc261 passed frontend, Rust, device Swift, architecture, workflow and hygiene jobs. macOS test compilation exposed a missing error argument in the sidebar action acknowledgement fixture; iOS hosted tests exposed real Unicode range acceptance and category/sidebar layout failures, plus an invalid Switch fixture kind and inaccessible numeric field identity. Darwin Foundation range conversion accepted partial emoji; composer ranges now explicitly require Character boundaries, with additional combining-mark, flag and family-emoji cases. Workspace conversation titles now use the same bounded two/three-line layout as recent conversations. Provider category screenshots showed zero-width text and an offscreen selected tab: native Layout measures intrinsic label width, wraps within the actual viewport and scrolls after updated bounds commit. Ordinary iOS text fields now share the native UITextField event/keyboard/AX bridge used by credentials.

Release 136 / 37537666220 on a75e9e87 completed Windows, Linux and Android packaging and smoke successfully. Both macOS packages and the iOS IPA compiled, but Apple installed smokes failed. Downloaded macOS ARM artifact 11448088240: draft TextView had positive visible bounds yet AXEnabled=false. Its editable/accessibility state now follows the wire disabled flag explicitly, and the actual-host fixture checks native enabled state, click, typing and shared JS delivery. Composer wrappers no longer inherit draft identity into placeholder text or disable editing while an earlier action awaits acknowledgement; packaged iOS checks address the actual TextView role. iOS artifact 11451359180 also showed Shell verification exiting 127 with wasm3 usage and simulator path_helper output. Replace the intentionally failing wasm3 usage invocation with a real WASI fd_write module returning success and a checked output marker. Installation verification version increases to v8; a Node fixture executes the actual checked-in module and validates its output. Package registry, Python modules, shell syntax, live stdin/cancellation and installed UI assertions remain required.

Primary sources read through Swift/GitHub MCP: Apple's NSAccessibilityProtocol.setAccessibilityEnabled, SwiftUI.Layout and ScrollViewReader; PowerBeef/Vocello MacScriptTextEditor explicitly enables its native NSTextView; holzschu/ios_system shell_cmds_ios/wasm3.c confirms no-argument invocation returns 1, whereas _start executes a WASI module. holzschu/dash_iOS options.c also confirms +l would enable login processing, so no such unsupported workaround was introduced. Affected release/iOS/backend/native-presentation source regressions passed 649/649, with zero failures/skips/cancellations (.ci-artifacts/apple-hosted-fixes-tests.log); architecture and native contract checks passed. Source validation does not establish these Apple repairs passing: new hosted and installed runs remain required. No new CSS or package dependencies and no local build/dev/install/cargo/Swift compilation. Full goal remains active, including clipboard file/image parity and installed/visual acceptance.


## Current UI regressions and CI 320 repairs (2026-10-07 UTC)

CI 320 / 37559206015 on 109ac484 passed workflow, Rust, architecture, frontend, diff hygiene and iOS device archive checks. Hosted native suites still failed: macOS attributed composer undo failed to notify the shared draft, initial pointer focus failed, the search glyph exposed a 17-point AX frame, workspace panel identity obscured its action, and the sidebar fixture lacked its enhanced AX session. iOS category labels still measured at zero width and selected categories could overlap the independent advanced control; the real switch exposed only a 28-point height. Preserve the actual assertions while repairing attributed undo/redo notifications, first-mouse focus and event tracking, semantic control identities, finite category label/viewport measurement with selected-tab scrolling, and the native UISwitch's 44-point target. Release 137 / 37559215776 was cancelled before packaging/smoke validation; cancellation is not evidence these repairs passed.

Workspace-group creation now belongs to the workspace More menu in both renderers. Provider and model ordering lives in the leading slot; trailing actions use Astryx/native menus with their existing refresh, edit, confirmed-delete and reorder handlers. Conversation titles remain a single truncated line at standard text size, actions reserve their width across hover/focus, and the running indicator remains visible. Remove the native selected-state fake activity dot. Provider names are single line and compact add/sync controls use labeled icon buttons.

Wide chat headers no longer duplicate the navigation rail's sidebar entry. Compact navigation reveals its sidebar behind a translated, rounded chat page, preserving page width and its visible close toggle; left swipes and outside taps close it. Native chat and auxiliary pages both retain the displaced page instead of fading it away or placing a full-window dimmer over it. Mobile settings retain Astryx Tall keyboard accommodation and expand above both corner actions. Desktop settings follow live window geometry: 86.6% of each dimension, approximately 75% of its area. MCP and Skill previews use centered floating presentation rather than a right-side drawer; native Skill previews retain their live close/install/copy handlers in a sheet. Context details show one usage sentence and one unlabeled accessible progress track, with light dismissal and no Cancel button. Astryx menu/popover/selector surfaces use their semantic opaque palette for readable text over HTML/images, retaining rounded edges and material chrome. Preview navigation buttons use IconButton's real sizing with 44-point coarse-pointer targets.

Native image/file paste now feeds the existing shared file importer, preserves original bytes/encoding, and retires asynchronous provider loads when the conversation, workspace or owner changes. Clipboard reads occur only on paste; text/link paste remains text. New SDK fixtures exercise a real composer PNG paste, text/link classification and cancellation/late callbacks. UIKit enables the supported paste types; unsupported/retired attachment pastes cannot insert an untracked native image into the draft.

Validation: the complete frontend source suite ran 1,914 cases, with 1,913 passing; its sole failure was the old expectation that every desktop chat header must also reopen the sidebar. Replace that expectation with actual navigation-rail entry and mobile open/close behavior; the revised test passed. Final targeted browser/theme/header checks passed 3/3: actual installed Astryx source components at 240/320/390/768 widths, fixed title geometry under forced hover and keyboard focus, retained running indicators, sidebar/page displacement and already-open settings resizing to approximately 75% of a 1440x1000 viewport. Source fixtures use explicit equivalent hover utilities; they do not substitute for packaged UI inspection. Preview/clipboard/native-chat regressions passed 16/16, release source checks 41/41, TypeScript --noEmit, Biome (681 files), architecture and native state/action checks passed. No local build/dev/install/cargo/Swift compilation. The new Apple SDK tests and installed release smokes require hosted validation after push. Full parity/visual goal remains active.

## Native MCP preview and compiler follow-up (2026-10-07 UTC)

Pushed 9b344b586ca9dfeb1d31dde0b11059be2967b269 and dispatched CI 321 / 37563834509 and unsigned, non-publishing Release 138 / 37563842795 with installed smoke enabled. The hosted frontend, workflow, architecture and hygiene jobs passed. Apple compilation found PresentationProviderList.swift:139 attaching `.disabled` after a conditional instead of to its concrete menu view. Move that modifier onto the menu without altering disabled or busy behavior. This compiler failure prevented native interaction tests from running; source validation alone cannot verify the preceding Apple fixes.

Inspection also found native MCP store cards lacked the Astryx detail-preview route. Card titles now open a separate native sheet with shared registry detail resolution, host-specific transport choice, install-preview metadata, configuration requirements, warnings and external links. Preserve the existing installer and live installed-state tracking. Extract the existing Astryx preview helpers for both renderers; no additional stylesheet or dependencies. Protect detail responses by card identity and effect lifetime, so switching or closing cannot overwrite another preview. Show credential key names rather than their values, matching the Astryx preview. The desktop preview follows the same viewport-sized dialog budget.

MCP preview, store integration, registry/settings and mobile-route source regressions pass 27/27 with no skips or cancellations (.ci-artifacts/mcp-preview-regression.log). Tests cover real preview handlers, separate-sheet routing, install state shared with the card, external-link deduplication, network-only transport selection, failed detail retrieval, busy/installed guards and late responses after switch/unmount. TypeScript --noEmit, affected Biome, architecture and native contract checks pass. Apple compilation, rendered screenshots and installed acceptance still require a new hosted run. Goal remains active; no local build/dev/install/cargo/Swift compilation was run.
