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

Configuration secrets use a secure UITextField inside SwiftUI on iOS and
SecureField on macOS. iOS has explicit editing/focus/teardown callbacks and a
non-login content type, avoiding Password AutoFill pairing with preceding fields.
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
for terminals, SystemNotification for notifications, and KeyboardShortcuts for
physical-key display and system conflict checks. Hotkey registration and storage
remain in the shared shortcut service. Apple PDFKit, AVKit and
Quick Look own document/media previews. Application chrome and settings must
never be rendered as a webpage.

Automation forms share validation, request drafts and operation lifetimes with
the Astryx forms. Native HTTP request rows keep URL/method editable while headers
and body are collapsed. Cron history uses one polling/clear controller on both
clients; route retirement and log clearing invalidate older reads. SwiftUI owns
the native task rows, detail columns, mobile tabs and expandable run output.

macOS computer-use permission status reads the actual Accessibility and screen
capture grants through the Swift/Rust bridge. Only explicit permission actions
request consent; status reads never prompt. The native card refreshes on AppKit
application activation. The shared controller also owns MCP driver discovery,
installation preview, confirmation, progress and probe validation.

## Verification and remaining parity

Run non-Cargo tests, TypeScript check, lint and native contract/architecture checks
without a local build or development server. GitHub CI runs Apple SDK tests and
exports native screenshots and accessibility trees for rendered review. Mounted
tests cover narrow/wide sizes, Dynamic Type, input, action lifecycle and terminals.
Shared-store tests verify persistence, failures and runtime callbacks.

iOS tests run in the minimal `native/apple-ui/TestHost` application. CI generates
its Xcode project from the documented XcodeGen spec and runs
`XgentNativeHostedTests`, using the existing test sources and exact package versions.
The bare SwiftPM iOS runner does not execute UIApplicationMain: UIKit reports
`UIApp is nil` and cannot dispatch control events. Rendering/AX tests must use the
application host. macOS tests and the production device archive still use SwiftPM;
the test host is excluded from the shipped library.

Existing feature entry points alone do not prove platform parity. Complex combined
browser/CUA/application/document/animation workflows require end-to-end execution
on the actual platforms. `history.md` records current objectives, verified progress,
remaining gaps and exact CI evidence; do not infer completion from the number of
Swift source files or package dependencies.

The handwritten MCP server editor uses `mcpServerDraft` alongside the Astryx
editor, including per-line arguments, working directory, environment variables,
SSE message URL, request headers and timeout. Both editors save by server identity
through the existing MCP operations reducer. Renaming preserves server policy,
selection and the configured computer-use driver reference; deletion removes the
matching policy. Native server rows show configuration counts and real group and
server policy controls. macOS selects the desktop layout and adds the shared
external-config/file import workflow. Config files use a single-document system
picker; scanning, parsing and persistence remain in the shared functional layer.

`MCPSettingsRenderingTests` prepares Apple SDK snapshots and accessibility checks
for narrow/wide and large-text layouts. It does not establish measured visual
parity until Actions and device results have been reviewed. The
[official MCP Swift package](https://swiftpackageindex.com/modelcontextprotocol/swift-sdk)
and its GitHub transport source were researched; this app continues to execute
MCP through its shared backend. Apple documentation retrieved through Swift MCP was consulted for
[adaptive field layouts](https://developer.apple.com/documentation/swiftui/viewthatfits)
and [JSON file types](https://developer.apple.com/documentation/uniformtypeidentifiers/uttype-swift.struct/json).

The handwritten Skills hub uses `SkillsHubPage`'s existing desktop controller on
macOS, including category counts, stored sorting, batch selection, undo, deletion,
background install jobs, store pagination, external scans and local bundle imports.
`NativeSkillsHub` publishes the state to purpose-built Swift layouts for the
toolbar, filters, installed rows, store cards, import rows and previews. Narrow
windows and large accessibility text collapse the preview into one column.
Markdown and code previews retain actual read failures and truncation notices;
the metadata cleaner and install progress formatting are shared with Astryx.

The native folder picker preserves relative paths for `SKILL.md`, scripts and
binary assets. Security-scoped coordinated reads run off the main actor, with
the same 512-file/32-MiB limits as the existing shared `import_bundle` action.
Cancelling or changing the destination retires the result. The shared controller
also guards repeated imports/deletes and obsolete discoveries; batch undo retains
unrelated selections made after the batch. Active backend installation jobs are
recovered when the hub is reopened.

`SkillBundleTests` and `SkillsHubRenderingTests` prepare Apple SDK coverage for
folder hierarchy, binary files, limits, narrow layouts and accessibility text.
They still require Actions execution and rendered review. The implementation uses
the existing [MarkdownUI package](https://swiftpackageindex.com/gonzalezreal/swift-markdown-ui)
and Flow dependency. Swift MCP was consulted for the
[system file importer](https://developer.apple.com/documentation/swiftui/view/fileimporter(ispresented:allowedcontenttypes:allowsmultipleselection:oncompletion:oncancellation:))
and [coordinated file reads](https://developer.apple.com/documentation/foundation/nsfilecoordinator/coordinate(readingitemat:options:error:byaccessor:));
GitHub MCP supplied MarkdownUI source references, and Astryx MCP documented the
file input's controls and folder-upload limitation.

Browser chrome is now handwritten in separate Swift address, navigation, tab,
header, error and layout views. The address field submits its actual native draft
on Return; action callbacks also read the latest shared edit before a new document
arrives. Tab identity prevents draft leakage, and stale viewport/navigation actions
cannot operate on a newly selected tab. Desktop history, reload, devtools and the
existing workspace expansion are reachable with native controls and shortcuts.
Narrow widths and large accessibility text move address and navigation controls
onto separate rows; tabs remain horizontally scrollable with selection announced.

The browser settings form shares home-page normalization and session cleanup with
Astryx, preserving other current settings and reporting actual partial failures.
Cleanup closes its original session snapshot, deduplicates concurrent requests,
removes each successfully closed tab and retains failed or newly created tabs.
Native browser errors preserve usable chrome instead of throwing away the panel.
Blank pages and retired mobile chrome hide the underlying browser viewport.

`BrowserControlsRenderingTests` prepares narrow/wide/large-text Apple SDK captures
and address draft isolation checks; it still requires Actions execution. Swift MCP
was consulted for [Return submission](https://developer.apple.com/documentation/swiftui/view/onsubmit(of:_:))
and [focused keyboard input](https://developer.apple.com/documentation/swiftui/view/onkeypress(_:action:)).
The existing [Flow package](https://swiftpackageindex.com/tevelee/SwiftUI-Flow) was
verified through its pinned GitHub source and is used for wrapping navigation.

Terminal sessions have handwritten scrolling tabs instead of a dropdown, with
selected accessibility traits, actual running/exited metadata and keyboard
navigation. Connection fields adapt their shell/SSH selectors to width and text
size. The handwritten rename editor submits its current native text; shared
callbacks read synchronous title/shell/host drafts before a document rerender.
Failed renames remain editable, duplicate submissions are locked, and explicit
host changes cancel the old authentication flow without a normal rerender
retiring the newly selected host's connection.

`XgentTerminalColors` manually matches XTermViewport's light/dark foreground,
background, cursor, selection and 16 ANSI colors. The pinned
[SwiftTerm 1.20 source](https://github.com/migueldeicaza/SwiftTerm/blob/v1.20.0/Sources/SwiftTerm/Terminal.swift)
was checked because its default extended palette uses LAB interpolation. The
native terminal selects the public xterm strategy to match indices 16–255.
Palette installation happens on appearance changes, preserving terminal programs'
color updates during streaming. TerminalRenderingTests prepares narrow, large-text,
rename/authentication and actual palette assertions for Apple CI.

Workspace XLSX previews now use a handwritten SwiftUI spreadsheet, scrolling
worksheet tabs and a dedicated file layout/toolbar. The `SpreadsheetGrid` wire
kind carries formatted cell data and typed cell edits; it contains no Astryx
rendering rules. Lazy rows keep the 250-by-80 view within the existing 20,000-node
document limit. Readonly XLS/ODS files use the same grid without write actions.

Native and Astryx editors share `workspaceSpreadsheet.ts` for parsing and guarded
XLSX writes. Native binary drafts participate in dirty-close/reload confirmation,
workspace-scoped restoration and in-flight save rebasing. Newer values, including
typing back to the old disk value while saving, survive acknowledgements. Writes
use the real `fs_write_binary` command with both expected file metadata guards.
The shared writer edits the original XLSX package using existing JSZip and real
XML APIs. It replaces target cell values with inline strings while retaining cell
style attributes, charts, images, relationships, untouched worksheet bytes and
other package entries. It expands used ranges when inserting cells and requests
recalculation after removing the optional calculation-chain cache. Shared/array
formula groups reject single-cell replacement to avoid invalidating their members.
Astryx and native saves both read synchronous drafts, rebase acknowledged cells,
retire old file callbacks and wait for background writes before reopening. Native
and shared entry enforce Excel's 32,767 UTF16-unit cell limit without splitting emoji.

The grid uses Apple's [LazyVStack](https://developer.apple.com/documentation/swiftui/lazyvstack)
and native text fields. Existing Flow handles file toolbar wrapping. CoreXLSX was
researched through GitHub MCP and [Swift Package Index](https://swiftpackageindex.com/CoreOffice/CoreXLSX);
this batch keeps the shared functional parser to maintain identical cell values
and saves on both interfaces. `SpreadsheetGridTests` and
`WorkspaceSpreadsheetRenderingTests` prepare Apple SDK coordinate, action and
narrow/wide/accessibility-text rendering checks. SDK execution and measured
visual parity remain outstanding.

PDF/PPTX annotations use handwritten native editor, integer page controls,
UTF16-bounded text entry and file save buttons. Native Save/Cmd-S and save-before-close
carry the current native text and page, including edits awaiting a shared document
update. The existing production `annotateDocument` implementation creates a PDF
comment or editable PowerPoint shape. `fs_write_binary` retains file metadata
guards, draft recovery and acknowledgements that preserve later notes/page changes.
Converted document MIME types expose preview while keeping the original Office
path out of an incompatible writer.

The Astryx editor uses the same annotation limits, MIME policy and localized labels
with its actual NumberInput component. Its annotation save now reads synchronous
drafts, locks repeated submission, preserves later text/page edits, retires old
callbacks and waits for pending writes before reopening. Saved binary bytes refresh
the actual document preview without clearing another note.

Real-DOM tests execute production annotation code with installed JSZip/pdf-lib in
an isolated headless browser. They check prefixed package relationships, escaped
slide names, Unicode text, repeated unique shape IDs and unchanged unrelated
slides/media/theme parts. CI requires these browser tests rather than silently
skipping them; the standard runner's Chrome inventory was verified via GitHub MCP.
No local application build or package installation is involved.

`DocumentAnnotationTests` and `DocumentAnnotationRenderingTests` prepare native
payload/Unicode checks and narrow/wide/accessibility-text captures for Apple
Actions. These SDK checks have not run locally. XLSX retention tests compare actual
package-part contents; they do not establish full Excel rendering or calculation
equivalence. Grouped formula editing, additional native file/image commands, full
workflow parity and measured visual similarity remain open requirements.

Workspace image previews now use eight handwritten Swift files for the canvas,
adaptive toolbar, quarter-turn draft, rotation/save buttons and desktop file menu.
Both Apple renderers dispatch the explicit image variants directly. Nuke handles
actual image bytes; SwiftUI owns zoom, magnification and scrolling. Quarter-turn
layout exchanges the unrotated fitting box's axes before drawing, because
`rotationEffect` changes rendered output without changing its layout frame.
The Astryx preview applies the same fitting rule to its measured viewport.

Both interfaces call `rotateWorkspaceImage` and guarded `fs_write_binary`.
Drafts keep an absolute target angle and the angle already represented by saved
bytes, so an acknowledgement preserves a later rotation without applying the
earlier turn twice. Cache recovery, pending-write barriers, conflict guards and
retired callbacks cover image saves and group navigation. Switching an edited
image offers Save, Discard and Cancel. Desktop open/chooser/reveal uses the real
scoped Rust command; mobile does not expose the unsupported desktop chooser.

PNG/JPEG/WebP edits require matching original extension and MIME. An unsupported
device encoder returning PNG is rejected before writing another extension.
This prevents corrupt output but leaves Apple WebP encoding parity unresolved.
Animated GIF/SVG/other formats retain preview-only rotation. Image metadata,
color-profile retention and animation editing remain to be audited.

Image regressions execute the actual raster implementation in an isolated
headless browser and compare independently decoded PNG pixels and format headers.
The image fixture waits for its own navigation/load and encoding completion
through DevTools, using Node's built-in WebSocket and an owned temporary profile.
ImageRotationTests and WorkspaceImageRenderingTests prepare native current-draft
actions and narrow/wide/accessibility-text captures. Apple SDK execution and
measured 90% visual similarity remain unverified.

Shared Markdown/text/HTML and DOCX source saves now read synchronous drafts,
reserve their actual guarded write and preserve edits made after submission.
Text previews refresh their bytes in place; DOCX refreshes the saved document's
preview without resetting the source tab or input. Acknowledged metadata rebases
cached drafts even when later input arrives during DOCX refresh. Background saves
retire their view callbacks while the existing pending-write barrier protects
reopening. Source copying uses current input and retires clipboard-result feedback
and timers when another file takes over. Production callback regressions cover
immediate/duplicate saves, later/old-baseline edits, recovery, conflicts, DOCX
refresh and retired copying.

The tabbed Monaco editor now keeps synchronous tab drafts and per-session write
reservations. Save/Run/close confirmation waits for the real guarded write and
does not treat a pending write as a successful save. Later edits, including a
return to the old disk value, remain dirty against acknowledged metadata. Save
All rechecks every current tab after its sequential writes; Cancel retires its
close continuation. Reload checks the edit version before replacing content,
and conflicts require explicit discard. Per-workdir tab keys isolate same-named
files, while pending-write barriers protect reopening. Retired file/dialog/model
callbacks and out-of-order reads cannot target another tab. Exit animation checks
new input again, and StrictMode replay retries a retired initial read.

Two handwritten Swift files add code-reference selection and scrolling through
the existing CodeEditorView and Introspect packages. Both controllers normalize
one-based UTF-16 line/column requests. Native ranges handle LF/CRLF/CR and avoid
splitting a surrogate pair. A location request on the current file retains its
session and draft; opening an existing editor tab now retains its cached source.
Explicit Reload reads the disk. Navigation
runs once per request so a shared acknowledgement does not repeatedly reset the
caret. CodeLocationTests and iOS/macOS editor navigation tests prepare actual
selection, scrolling and acknowledgement checks; Apple SDK execution remains
unverified. Broader syntax language coverage remains a separate functionality gap.

Six additional handwritten Swift files provide code editing commands, adaptive
editing controls, current source draft actions and a native run output sheet.
Find/Replace uses the mounted UITextView/NSTextView's actual system interface;
Copy/Undo/Redo operate on that same editable, visible view. macOS Find/Replace
keyboard shortcuts are scoped to the editor. Labels come from the shared locale,
and the editing toolbar respects the appearance font and wraps at narrow widths.
This does not yet provide Monaco's complete regex/options or identical find UI.
Prepared UIKit/AppKit interaction tests have not run against an Apple SDK.

Native Save, Cmd-S, save-before-close and Run carry the current optimistic source
text, including input not yet acknowledged by the shared controller. Save remains
visually disabled for a clean native draft while its handler can accept immediate
input. Run awaits the actual guarded write, retains later edits and refuses to
launch an obsolete saved snapshot. Both presentations share one filename policy,
command builder and Python/Node eligibility; native execution calls the existing
Rust shell_run/shell_cancel commands with the same workdir, cwd, timeouts and
sandbox parameters. Cancellation is synchronously reserved, supports the backend's
early-registration response and reports retryable failures. Native output exposes
stdout/stderr, command, exit code, timeout and cancellation state. Execution now
belongs to the workspace editor rather than an individual file view. Switching
or hiding a file retains its process and output, including switching while the
authorized guarded save is pending. Output identifies the actual originating
workdir/path. Single-process reservation matches the shared editor; preparation
reserves before accepting native input so duplicate Run callbacks cannot replace
the first submission. Origin session and saved draft are checked again before
launch. Editor unmount/effect replay retires results without implicitly cancelling
a process. Run sheet and toolbar actions include run/phase identity, preventing
old native controls from stopping or dismissing another run. Both presentations
retire a preceding result while preparing a new execution.

Discard-close in the shared editor now retires outstanding read-only requests so
they cannot block dismissal or reopen the discarded file. Ten additional Node
regressions cover actual production controllers and their Rust command arguments.
The complete non-Cargo suite passed 1,735/1,735 with zero skips; type checking,
whole-source lint and native contract/architecture checks passed. These checks do
not establish Apple compilation, rendered visual parity or complete multi-app
CUA/browser/Office/Remotion task equivalence.

Three more handwritten Swift files now compose a scrolling native editor tab
strip, file tab and tab action on both Apple form factors. Selected tabs scroll
into view and expose separate selection/close actions, full path hints, dirty
indicators and arrow-key navigation. The strip measures its content height so
horizontal scrolling does not claim the editor's vertical space, including at
large text sizes. WorkspaceEditorTabsTests prepares actual mounted-height and
immediate-source/retired-action checks; Apple SDK execution remains outstanding.

The shared controller now owns all open native editor tab identities and caches
their loaded source separately from media previews. Project/workdir/path keys
isolate same-named files. Switching tabs or reopening an existing tab keeps its
content and guarded metadata; a pending write remains a barrier before returning
to that file. Background acknowledgements rebase cached drafts and notify the tab
strip. Closing a dirty background tab selects its real file for confirmation,
then saves/discards that file and selects a surviving neighbor. Closing the last
tab dismisses the editor. Hide retains all tabs and drafts. Close, Reload, Hide,
tab selection/close, Cmd-W and document dismissal carry current native source
input so unacknowledged edits participate in confirmation and caching. Source
reference requests also use their current request ID for panel focus.

Both presentations use one running/stopped/timeout/failure/success classifier;
missing exit status does not establish success. Shared cancellation now reserves
its actual request, supports retry after errors and rejects obsolete StrictMode
run results. Native Save All and Close All now use real guarded filesystem writes,
wait for individual saves, retain input entered during saving and show failures
by file. Closing checks the actual tab session set again; a newly opened tab
requires fresh confirmation. Cancel retires unstarted writes and the close
continuation while preserving a filesystem write already requested. Old dialog
callbacks cannot replace source even before the next render. Cmd-Shift-S and
Cmd-Shift-W carry current native input. The handwritten confirmation sheet wraps
its actions with existing pinned Flow and scrolls its file list and failure
details, with separate Save/Discard/Cancel ownership.

Reload keeps visible source while reading. Source edits retire its result and
error, preserving the original metadata guard. A read failure without new input
retains the prior content; explicit Discard then failed Reload retains only the
saved baseline. Shared run result callbacks are owned by their actual result and
cannot dismiss or cancel a later run. `WorkspaceEditorBulkTests` prepares native
optimistic-input, background-only drafts, stale-action and narrow/wide/large-font
rendering checks for Apple SDK execution. Those SDK tests have not run locally.

Five handwritten Swift files now retain code selection and viewport positions by
workspace scope and file session. The presentation model owns that storage; view
replacement retains positions, explicitly reopened tabs use new identities,
closed sessions are pruned on subsequent session preparation, and model
invalidation retires the store. Old view owners cannot overwrite a current
session. Positions clamp to the current source and complete UTF16 scalars. A
consumed source-reference request is retained so returning to a tab does not
reselect old references; a new request still selects and scrolls.

The pinned CodeEditorView UIKit scroll setter clamps against viewport height
minus content height. A native text-view adapter restores the actual offset
after layout, preserving horizontal position too. Native Undo/Redo still uses
the mounted text view; its undo history is not yet retained across view
replacement. `CodeEditorSessionTests` prepares UIKit/AppKit mounted restoration,
old/new references, source clamps, owner retirement and pruning checks;
`WorkspaceExecutionActionTests` prepares model-level old-action rejection. These
Apple SDK tests have not run locally. Remaining editor work includes undo history
retention, complete find options and broad language coverage. These changes do
not establish full platform or visual/workflow parity.

macOS file applications now use AppKit's installed handlers for the actual scoped
file, preserving their suitability order and opaque, case-sensitive file URLs.
Rust still resolves the workspace path before the Swift adapter queries or opens
it. Selected handlers are checked again immediately before launch, and the actual
NSWorkspace completion determines success. The blocking worker never waits on
the main thread; a timed-out requested launch reports uncertainty without retry.
The C bridge returns owned UTF-8 JSON which Rust copies and frees through the
matching Swift export.

Native and Astryx file menus share the discovery/open controller, including
synchronous reservations, separate scan/open states, malformed-result rejection,
last-good handler retention and retired callback/result guards. Returning to the
same path does not revive an earlier session. Native macOS preloads on file
change and offers explicit Refresh; Astryx additionally queries when opening its
menu. The differing menu-open refresh interaction remains to be reconciled.
Mobile continues to omit this desktop application chooser. Linux handler
discovery and selected-handler opening remain incomplete.

WorkspaceFileApplicationTests prepares actual installed-handler ordering,
Unicode file/worker queries, invalid selection rejection and bridge ownership
checks for macOS, including native preload across two workspaces containing the
same filename. Apple SDK compilation and real external-application launch
have not been verified locally. These changes do not establish full platform or
visual parity. Existing package versions remain pinned; platform APIs are used
directly rather than adding a package solely for application discovery.

Native code search now calls the same installed Monaco 0.56 search and
replacement modules used by the shared editor. SwiftUI renders a handwritten
find/replace panel with case, whole-word, regex, selection and preserve-case
controls, match counts, navigation and replace-one/all actions. Its UTF-16
adapter preserves untouched CRLF/CR source, merges overlapping scopes and
searches beyond the highlighted-count limit when navigating or replacing all.
Queries carry the actual native text view's latest source and selection; state
belongs to an open tab session and survives hidden/reconstructed file views.

Five new production Swift files implement configuration, actions, the panel,
native exact replacement and owned selection/edit requests. The replacement
mutates UITextView/NSTextView storage, reports through the real editor delegate
and registers an inverse on that view's undo manager. It checks the expected
source and consumes each request once; a stale request cannot be retried after
undo or affect a retired view. An acknowledgement advances replace-one to the
next match and never reinstalls older source. Platform tests prepare mounted
replacement/undo/redo, stale-source rejection and request replay checks.

Production Node focused tests pass 83/83, with the installed Monaco engine
executed directly and all-match/source/scope decoration metadata checked.
Full non-Cargo regression passes 1,772/1,772 with zero failures/skips in
`.ci-artifacts/native-find-highlights-batch-tests.log`.
These tests do not execute Swift or establish device visual parity. Broader
language support and Apple SDK/device verification remain pending; retained
native editor hosts below address undo retention across file switches, but
their runtime behavior still needs Apple execution.
Existing Swift package pins are unchanged; no WebKit UI or generated mapping
was introduced for code search.

Six further handwritten Swift production files add match/scope decoration
indexing, bounded TextKit UTF-16 conversion, rendering callback ownership and
the native highlighting adapter/modifier and light/dark paint styles. The latter
use the shared editor's pinned Monaco `vs`/`vs-dark` registry defaults. The
adapter preserves CodeEditorView's syntax
validator before adding render-only backgrounds and current-match emphasis.
Source changes synchronously retire stale decorations; closing search removes
its painting. The index clips merged paint ranges to visible layout fragments,
while exact matches remain separate for current selection. This avoids both
attributed-source/undo changes and scanning every match for each visible line.
CodeFindHighlightingTests prepares mounted UIKit/AppKit checks for syntax/source
preservation, undo/action invariance, typing invalidation, closure ownership,
cleanup, surrogate bounds and large/offscreen range lookup. Apple execution and
actual visual appearance remain unverified; minimap and zero-width background
details still require evaluation.

Workspace editors now use seven handwritten Swift production files to retain
each open file's actual native text view and hosting graph across hiding and
switching. Session hosts provide independent undo managers and refresh bindings,
find actions, theme, locale, layout direction and text-size environment when
shown again. Read-only state updates the existing native text view. Cached
source state is independent of removed presentation surfaces; callbacks capture
the presentation model weakly, and mount leases reject retired owners.

The native workspace controller reports monotonic open-session lists through
existing ChatLayout metadata, including final-file and close-all transitions.
The native model prunes closed host/viewport records, while hide retains them.
Removed scopes retain revision tombstones that reject cache resurrection by
late notifications. Save, tab/bulk/close actions and dismissal commit the current
native input before assembling their guarded source payload. Delayed source
values that disagree with native storage cannot replace newer input.

Three production Node tests exercise these lifecycle transitions and metadata
through the actual native controller; the focused batch passes 116/116.
CodeHostTests prepares actual UIKit/AppKit view-identity, independent undo/redo,
action routing, hidden-source preservation, lease and stale-event checks.
The Swift tests remain unexecuted locally; these changes do not yet prove
native runtime, full workflow or visual parity. Full non-Cargo verification for
this batch passes 1,775/1,775 with zero failures/skips in
`.ci-artifacts/native-editor-hosts-batch-tests.log`. Authoritative open-session
lists also prevent retired viewport callbacks from recreating closed records;
the associated SDK ownership test remains prepared for Apple execution.

Native workspace syntax now uses the installed Monaco 0.56 lexical engines and
the same file-language resolver as the shared editor. Canonical language IDs,
exact source, compact UTF-16 runs and light/dark appearance tables travel through
the existing editor metadata envelope. Twenty-five language IDs use actual
Monarch grammars or the shared JSON scanner, including HTML and Markdown nested
languages and multiline/template states. A separate registration namespace
preserves existing Monaco editor/worker providers. Per-session controllers reuse
unchanged lines only when incoming lexical state agrees, and retain original
CRLF/CR offsets. Palette and font flags use pinned `vs`/`vs-dark` TokenTheme rules.

Five handwritten Swift production files validate/index runs, preserve platform
font traits and source-prefix eligibility, and paint native TextKit fragments.
One owned callback composes syntax with find backgrounds after upstream syntax
validation. Painting changes no text, source attributes or undo history. During
input, only complete unchanged lines before the edit retain their old painting;
later lines wait for the new shared lexical result. Source, overflow, style
references, surrogate boundaries and interval overlap are checked.

Seven production Node regressions execute the real lexer/scanner/theme engine
and the native file controller; the focused batch passes 103/103 and full
non-Cargo regression passes 1,782/1,782 with zero failures/skips in
`.ci-artifacts/native-syntax-batch-tests.log`. A Node-only
import hook substitutes the exact common IndentAction enum for grammar config
imports of the browser API, without substituting lexical or theme results.
CodeSyntaxTests prepares actual UIKit/AppKit color/source/undo/action, cleanup,
font and range/source-prefix checks. Apple execution remains unverified; these
changes do not provide full diagnostics/completion/formatting or prove device
visual parity. Makefile/TOML have no grammar in this installed shared editor,
and additional embedded grammars still require evaluation. Existing package
pins and native wire kinds/properties remain unchanged.

Native read-only chat code now uses the shared 12-line disclosure boundary and
60%-of-viewport/576-point body limit; tool input/output/previews use the shared
160/256/224-point limits. Existing node values carry content policy and localized
labels for main chat, side chat and activity. Full source and existing actions
remain intact. Ten handwritten Swift production files provide headers, measured
dual-axis scrolling, keyboard navigation, copy confirmation, metrics/configuration
and document-owned interaction state. Clipboard confirmation follows a successful
write, restarts on repeated copying and posts a low-priority announcement.

The pinned MarkdownUI parser removes a final newline and hashes inner block
identity by content. A document-scoped cache reuses parsed MarkdownContent and
reads its escaped code-node HTML as data, preserving native rendering. Unique
fences retain collapse state, measured height and scroll offset when content grows
or rolls back along a prefix. Identical fences keep independent local state
because the upstream configuration lacks an ordinal; their streamed state
persistence is still incomplete. Collapsed bodies stay mounted and inaccessible
to input/VoiceOver. Restoration waits for real content/viewport geometry.

Four new Node regressions execute the installed Astryx/Streamdown renderers and
actual native transcript controller; the focused batch passes 45/45. Type checking,
lint and protocol/architecture/whitespace checks pass. Full non-Cargo regression
passes 1,786/1,786 with zero failures/skips in
`.ci-artifacts/native-read-only-code-batch-tests.log`. Five prepared CodeBlockRenderingTests
cover actual native sizing/clipboard and state/source/bounds, but have not been
compiled/executed on Apple. Math/Mermaid and complete device behavior/appearance
remain pending.

Native main/side chat and activity code highlighting now queries the actual
installed Astryx CodeBlock tokenizer through an explicitly registered read-only
handler. This is separate from the workspace's Monaco lexer. It preserves all
25 shared language names/aliases, case-sensitive unsupported-language behavior,
the 2,000-unit sync/async boundary and original UTF-16 source. Per-line runs clip
multiline regex tokens to their visible line, as the shared range/span renderer
does. Real current/stone/matcha light/dark syntax slots supply text, background,
header comment and token colors; configured fonts and Dynamic Type remain native.
Swift/Rust do not acquire extra highlighting when the shared chat tokenizer
does not support them. Splash remains a fallback outside queried chat content.

Four handwritten production Swift files implement validated read-only syntax,
native attributed text, source/theme-keyed tasks and single-use reply ownership.
Cancellation, timeout, removed/replaced/disabled source nodes, retired surfaces
and model invalidation end native waits quietly. Native syntax is accepted only
for the exact UTF-16 source, language and theme; surrogate splits, overlapping
or out-of-bounds ranges and invalid colors are rejected. The Markdown cache also
uses exact UTF-16 equality/prefixes instead of canonical Unicode String equality.
Identical code fences still have the previously documented ordinal limitation.

Explicit resultValue handlers return primitive replies through the existing
action registry; ordinary backend action outputs remain ignored. A separate
32-entry read-only reply cache prevents highlight traffic from evicting ordinary
256-entry replay protection. These requests create no native edits, busy controls
or user-facing error alerts. The 55-kind/40-property protocol is unchanged in
shape; Markdown/CodeBlock document the highlightCode event. No new Rust command,
WebKit code UI, generated UI mapping or package/pin change was introduced.

Six production Node syntax regressions and one native chat integration regression
execute the real tokenizer, theme resolver and action dispatch. The focused batch
passes 56/56; type checking, lint (653 files), native contract, architecture and
Windows-aware whitespace checks pass. Full non-Cargo regression passes
1,793/1,793 with zero failures/skips in
`.ci-artifacts/native-chat-syntax-final-batch-tests.log`.
ReadOnlySyntaxTests prepares four Apple tests for attributed colors/source/fonts,
UTF-16 validation and real presentation-model query lifecycle; one additional
CodeBlockRenderingTests case covers canonical Unicode cache replacement. These
Swift tests have not been compiled/executed. Native cancellation discards stale
results but does not yet abort the shared JavaScript tokenizer's work. This batch
does not prove Apple rendering, full Markdown behavior, complete cross-platform
tasks or measured visual parity. No local build/dev/install/Cargo/Swift compile,
push or Actions trigger was performed.

Native settings numeric controls now use a handwritten draft editor with native
IME tracking rather than a visible Stepper. Integer-only and nullable numeric
fields are explicit protocol policies (55 kinds/42 properties). SSH ports have
integer bounds; Cron remaining counts support clearing and have no artificial
upper UI limit. Draft parsing and grid stepping follow the installed Astryx
NumberInput, including blur/Enter commits, clamping and English numeric symbols.
Ordinary save actions commit pending drafts and await numeric acknowledgements;
failed or retired batches cannot invoke the queued action. Shared numeric handlers
flush form state before acknowledgement so save sees the latest handler state.

A 35-case shared parser corpus runs against the installed Astryx implementation
and is copied into SwiftPM and the hosted iOS test bundle. Eight new prepared
Apple SDK tests cover drafts, steps, acknowledgements and ownership. Final focused
checks pass 33/33; type checking, lint, protocol and architecture checks pass.
The full non-Cargo suite passes 1,797/1,797 with zero failures/skips in
`.ci-artifacts/native-number-input-batch-tests.log`. Apple compilation and execution
remain pending; these Node results do not establish device behavior or appearance.

The user has now authorized pushing accumulated work to trigger Actions before
the complete parity objective is finished, and requested Windows/Linux iteration
alongside Apple work. This supersedes the earlier push-after-completion schedule.
The overall goal remains active, with complete complex workflows and measured
visual parity still unproven. No local build/dev/install/Cargo/Swift compile was run.

The accumulated 416-file batch was pushed as `8d3c6e8`. [CI #242](https://github.com/oliid0/xgent/actions/runs/37127949415)
passed frontend build/lint, 1,755 frontend tests and 33 release tests with zero
failures/skips, workflow validation, architecture and diff hygiene. The production
macOS computer permission bridge compiled. Native package module emission failed
because the code host omitted NSHostingView's required `init(rootView:)`; the host
now implements that initializer and delegates its empty convenience initializer.
No native test or screenshot result is claimed from this failed build. The runner's
resolved Cargo.lock has been reviewed and incorporated for existing mobile git2
dependencies and bridge test serialization. Native validation continues in Actions.

The downloaded native verification artifact also supplies the complete Swift
dependency lock for the package's existing test dependencies and SwiftTerm.
Its KeyboardShortcuts 3.0.1 revision matches the upstream tag checked with GitHub
MCP; the previously recorded revision was incorrect. No declared package version
was upgraded. CI #242's exported screenshot manifest was empty because compilation
stopped before tests, so it supplies no visual parity evidence.

[CI #243](https://github.com/oliid0/xgent/actions/runs/37128424036) compiled beyond
the host initializer and exposed a typed FormFactor/string comparison in Cron
detail layout. Review found the same mistake across 18 native layout/control
files. These now compare `.mobile`/`.desktop` enum cases consistently in backup,
MCP, skills, speech/tool settings, browser/terminal/workspace tabs and task details.
The shared serialized formFactor strings remain unchanged. This concentrated SDK
repair and lockfile update require renewed Actions compilation; no native test
execution or screenshot success is inferred from the previous failed runs.

[CI #244](https://github.com/oliid0/xgent/actions/runs/37128874376) passed frontend,
workflow, architecture and diff checks, and the complete Rust job: 77 history
tests and one mobile execution bridge test passed. Native compilation advanced
to the retained editor root and rejected writing SwiftUI's read-only undoManager
environment value. That injection and unused root parameter are removed. The
native hosting responder still supplies a per-session undo manager; disk reload
and retirement now also clear the actual text control's manager through a weak
callback, covering UIKit controls with their own manager. The mounted CodeHost
test additionally checks retained editor identity, reloaded source, cleared local
undo and preservation of the other file's undo history. Apple execution is pending.

CI native verification now uses independent macos/ios/device matrix jobs with
fail-fast disabled. A macOS failure no longer skips iOS compilation and hosted
tests, and device release archive errors are captured in native-device.log.
Each job retains its failure status and uploads an individually named verification
artifact. This collects both platforms' failures from one batch; it does not turn
failed checks into successes. The workflow change follows GitHub's documented
matrix failure handling. Local release checks pass 33/33, native contract remains
55 kinds/42 properties, and architecture/whitespace checks pass. No local Apple,
Cargo, install, dev or build command was executed. Overall parity remains active.

[CI #245](https://github.com/oliid0/xgent/actions/runs/37129570454) ran all three
Apple jobs independently and preserved separate failures. macOS, hosted iOS and
the production device archive reported the same two remaining enum/string
comparisons in SkillRow and SkillsHubLayout; both now use their actual enum cases.
The previous undo environment compilation error did not recur. No native test
execution or visual result is claimed from these failed builds.

Source review also corrected 23 SDK test files whose document fixtures omitted
the required appearance field, including editor/find/undo, browser, MCP/skills,
question/progress, spreadsheet, image, annotation and workspace action tests.
The removed-surface editor fixture additionally supplies its required title.
Fixtures now follow the real strict document contract; production decoding and
test assertions were not relaxed. These repairs allow the existing SDK tests to
reach their actual controls after compilation succeeds. Shared frontend sources
are unchanged in this batch, so unchanged full Node suites were not rerun.

[CI #246](https://github.com/oliid0/xgent/actions/runs/37130132493) successfully
built the production arm64 iOS static archive (207.87 seconds), and its device
symbol checks passed. The downloaded device log records archiving libXgentNativeUI.a;
this is concrete production Swift compilation evidence, not device interaction
or visual evidence. macOS/iOS package production sources compiled, but their test
sources failed at six result initializers omitting the required error parameter.
NumberCommitBatchTests and ReadOnlySyntaxTests now supply explicit nil errors;
the production result type and assertions remain unchanged. The terminal teardown
also explicitly discards the first-responder method's return value.

CI now verifies reset/update as defined exported symbols, alongside font family
allocation/free, and records these exact shared Rust FFI exports in a compact log.
The computer permission export is likewise logged. Raw symbol tables were not
present in the downloaded #246 device artifact, so these uploaded logs improve
direct inspection of the interface after compilation. Native test execution,
rendered screenshots and complete task/visual parity remain pending.

[CI #247](https://github.com/oliid0/xgent/actions/runs/37130804350) again passed the
device production archive and defined export checks (248.54 seconds). The six
missing test initializer arguments no longer blocked compilation. Both hosted
test targets then reported implicit self in five recursive native view lookup
closures. Those helpers now capture their XCTest instance explicitly, following
LazySequenceProtocol.compactMap's escaping transform requirement confirmed through
Swift MCP and the Swift standard-library source. The remaining lazy lookups were
reviewed: local recursive functions need no instance capture, and other instance
helpers already use explicit self. Assertions and production views are unchanged
by this test compilation repair; actual SDK test execution remains pending.

[CI #248](https://github.com/oliid0/xgent/actions/runs/37131298736) reached real
test execution: macOS ran 158 tests with 23 failed assertions, and hosted iOS ran
162 tests with 20 failed assertions. The frontend, Rust check/history migrations,
mobile status serialization, architecture, workflow, and production iOS archive
jobs passed. Downloaded device evidence contains four defined Rust-facing exports;
both native rendering artifacts now contain actual screenshots. These results
are a failure baseline, not a claim of complete interaction or visual parity.

The next handwritten repair batch aligns finite business numeric ranges with
the shared validator, enabling the Int32 PDF/Office annotation page contract;
out-of-range numeric values and screen dimension limits remain rejected. Native
editor hosting now installs its root once and publishes configuration changes
through retained state, addressing text view/undo replacement on remount. Common
buttons expose their own identifiers, question options explicitly retain button
traits, desktop switches fill their row, and the close-all file list can shrink
inside its fixed presentation height. Save tests now return the same numeric
commit acknowledgements as the real bridge. Find tests exclude AppKit field
editors, and syntax tests inspect stored attributes beneath rendering overrides.

macOS in-process accessibility tests explicitly enable the documented SwiftUI
accessibility environment, matching the hosted test pattern researched through
GitHub MCP. Button press, size, ordering and enabled-state assertions remain in
place. Accessibility trees are attached before assertions for subsequent diagnosis.
Editor selection/scroll restoration and the iOS HTML preview cold-load timeout
remain under investigation; this batch requires SDK execution before its effect
on the #248 failure baseline can be established. No local build/install/dev or
Cargo/Swift compile command was run.

[CI #249](https://github.com/oliid0/xgent/actions/runs/37132851336) compiled and
executed both SDK suites: macOS ran 158 tests with 16 failed assertions, and
iOS ran 162 tests with 14 failed assertions. Annotation decoding/rendering,
image save acknowledgement, syntax restoration, iOS question button traits and
automation controls passed. The HTML preview passed on this run, so the earlier
cold-load failure remains a reliability observation rather than a proven fix.
The production device archive, frontend and Rust jobs passed again. Downloaded
screenshots confirm the desktop switches now occupy the trailing edge of rows.

The following batch addresses the remaining native editor lifetime, viewport
restoration, macOS find target, and iOS close-all sizing failures together. Open
editors are parked in a hidden container in their application window, captured
before their mount leaves that window, and resumed with their native undo stack.
Parked editors cannot accept edits or appear in the accessibility tree. The
editor selector resolves the text input inside its own AppKit scroll view and
excludes field editors/minimaps. Initial native callbacks cannot erase a saved
viewport while restoration is in progress. Hosting state/source notifications
are deferred beyond render transactions. The close-all layout takes its actual
available height from GeometryReader while the file list scrolls within it.

Hosted macOS accessibility fixtures now also request AXEnhancedUserInterface
from NSApplication, matching the actual GitHub reference fixture; setting the
SwiftUI environment alone yielded only empty native view identifiers in #249.
All press, bounds and enabled-state assertions remain. Closing source draft
tests compare complete decoded JSON payloads, since dictionary key order is not
a contract. These repairs still require the next remote SDK run; passing static
checks cannot establish full functional or visual parity.
