# XAgent mobile execution plugin

This local Tauri 2 plugin keeps the React and Rust call sites platform-neutral:

- Android installs a bundled, verified Alpine minirootfs through the separately
  shipped PRoot executable, then adds audited toolchain profiles on demand.
- iOS/iPadOS runs sandboxed BSD utilities through the a-Shell-derived backend. WasmKit is linked for a future verified-extension catalog, but arbitrary WASI execution remains disabled until it can enforce timeout and cancellation.
- Desktop returns `Unavailable`; desktop execution remains owned by XAgent's native runner.

The plugin does not read from the repository-local `xx` or `a-shell` reference directories.
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
