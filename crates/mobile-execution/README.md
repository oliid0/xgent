# Xgent mobile execution plugin

This local Tauri 2 plugin keeps the React and Rust call sites platform-neutral:

- Android installs a bundled, verified Alpine minirootfs through the separately
  shipped PRoot executable, then adds audited toolchain profiles on demand.
- iOS/iPadOS runs sandboxed BSD utilities through the a-Shell-derived backend. Arbitrary WASI execution remains disabled until a runtime can enforce timeout and cancellation; WasmKit is not linked in the current production package.
- Desktop returns `Unavailable`; desktop execution remains owned by Xgent's native runner.

The plugin does not read from the repository-local `yy` reference directory.
All incorporated or downloaded components are pinned and documented in
`THIRD_PARTY_NOTICES.md`.

Android toolchain profiles are deliberately separate from the base image:
`essentials`, `python`, `node`, `go`, `rust`, `cpp`, `media`, and `documents`.
Project-level `pip`, `npm`, Go module, and Cargo dependencies remain inside the
installed PRoot environment and the selected workspace.

The iOS backend is intentionally a native command catalog rather than a Linux
virtual machine. It includes shell/file/text tools, JavaScriptCore (`jsc`),
curl, SSH/SCP/SFTP, Vim, lg2, ffmpeg, and ffprobe. Apple platform restrictions
mean Node.js/npm, Linux package managers, and arbitrary downloaded native
executables are not advertised as supported.

## Where the environment comes from

The release preparation steps in `.github/workflows/desktop-release.yml` are
required inputs to packaging; the install button cannot replace missing native
libraries in an already-installed application.

| Platform | Prepared before packaging | Installed on the device |
| --- | --- | --- |
| Android | `scripts/mobile/prepare-proot-android.sh` obtains the Termux PRoot executable, loader and dependencies (with a source fallback). `prepare-alpine-rootfs-android.sh` downloads verified Alpine minirootfs archives for arm64-v8a and x86_64. | `RootfsInstaller` selects the device ABI from the bundled manifest, verifies the archive checksum, extracts to staging and runs an execution probe before keeping the activated environment. Base installation uses APK assets. Additional toolchain profiles use Alpine packages over the network. |
| iOS | `ios/Package.swift` pins the ios_system, Unix command, curl, SSH, Vim, Git and media XCFramework downloads. `scripts/mobile/prepare-ios-shell-resources.sh` prepares pinned a-Shell resources and the verified CPython archive/frameworks. The release workflow links and embeds these dependencies. | `MobileExecutionPlugin.install` initializes the bundled command environment and sandbox resources. It cannot fetch and link a missing XCFramework into the installed app. |

Inspect `available`, `installed`, `detail` and individual `capabilities` from
the plugin status. On Android, missing PRoot libraries or a missing bundled
rootfs require a correctly packaged application. A successful file extraction
alone is not proof that PRoot can execute on the device.

Chat/provider requests and native sandbox file operations do not require this
plugin to be installed. The shared tool registry also supports Skills and
network MCP independently of Shell. Local stdio MCP requires a persistent
process transport that the current mobile runner does not expose. Native SDK
compilation and device tests are still needed to establish that a particular
release package works; frontend tests cannot verify native installation.
