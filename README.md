<p align="center">
  <img src="docs/images/banner.webp" alt="Xgent" />
</p>

<h1 align="center">Xgent</h1>

<p align="center">
  <strong>Your Local-First AI Agent Desktop</strong><br/>
  Multi-model access · Local tool execution · MCP & Skills · Web/PC/mobile
</p>

<p align="center">
  English | <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img alt="Platform" src="https://img.shields.io/badge/platform-Web%20%7C%20macOS%20%7C%20Windows%20%7C%20Linux%20%7C%20Android%20%7C%20iOS-blueviolet" />
  <img alt="Tauri" src="https://img.shields.io/badge/built%20with-Tauri%202-FFC131?logo=tauri&logoColor=white" />
  <img alt="React" src="https://img.shields.io/badge/React-19-087EA4?logo=react&logoColor=white" />
  <img alt="Rust" src="https://img.shields.io/badge/Rust-stable-B7410E?logo=rust&logoColor=white" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green" />
</p>

<p align="center">
  <a href="#core-features">Core Features</a> •
  <a href="#download--deployment">Download & Deployment</a> •
  <a href="#faq">FAQ</a> •
  <a href="docs/">Docs</a>
</p>

---

## 🌟 Special Thanks

<p align="center">
  <a href="https://linux.do">
    <img src="docs/images/linuxdo.png" alt="LINUX DO" width="420" />
  </a>
</p>
<p align="center"><b>For all things AI, head to LINUX DO! Wishing the community ever greater success~</b></p>

---

## ❤️ Sponsor

<table>
<tr>
<td width="200" align="center" valign="middle"><a href="https://www.packyapi.com/register"><img src="docs/images/partners/packycode.png" alt="PackyCode" width="160"></a></td>
<td valign="middle">PackyCode is a reliable, efficient, and professional API relay service provider, offering relay services for Claude Code, Codex, Gemini, Chinese domestic models, and more — a long-established, top-tier relay. <b>The vast majority of the model resources used to develop this software were provided by PackyCode — thank you, Laonong!</b> Register <a href="https://www.packyapi.com/register">here</a> to get started!</td>
</tr>
<tr>
<td width="200" align="center" valign="middle"><a href="https://www.right.codes/register"><img src="docs/images/partners/rightcode.jpg" alt="RightCode" width="160"></a></td>
<td valign="middle">Right Code provides stable relay services for Claude Code, Codex, Gemini, Chinese domestic models, and more. Invoices are available upon top-up, and enterprise and team users receive dedicated one-on-one support. <b>The remaining model resources used to develop this software were provided by RightCode — thanks to the RC site owner and the support team!</b> Register <a href="https://www.right.codes/register">here</a> to get started!</td>
</tr>
<tr>
<td width="200" align="center" valign="middle"><a href="https://cubence.com/signup"><img src="docs/images/partners/cubence.png" alt="Cubence" width="160"></a></td>
<td valign="middle">Cubence is a reliable and efficient API relay service provider, offering relay services for Claude Code, Codex, Gemini, and more, with pay-as-you-go billing. <b>Thanks to Cubence for supporting this project!</b> Register <a href="https://cubence.com/signup">here</a> to get started!</td>
</tr>
</table>


---

## 🤝 Come Build With Us!

<p align="center">
  <img src="docs/images/QQ.png" alt="Xgent QQ Group" width="300" />
</p>

<p align="center">
  Scan the QR code to join our QQ group and help drive Xgent development!<br/>
  (Why a QQ group? It just packs a few more features than a WeChat group~)
</p>


---

## Why Xgent?

Xgent is a **local-first** AI agent for Web, desktop, and mobile. It deeply integrates large language model reasoning with local system tools, so the AI can genuinely operate files, run commands, use MCP servers and Skills, and manage scheduled tasks.

- **An agent that actually gets things done** — beyond chat: read and write files, make precise edits, run Bash, and supervise long-running processes
- **A fully open ecosystem** — bridge any external tool via the MCP protocol, and load Skills packages on demand
- **One frontend everywhere** — the same React/Tauri source powers Web, macOS, Windows, Linux, Android, and iOS
- **LAN control and portable execution** — pair a browser or phone with the desktop on port `28367`, or use the mobile and GitHub Actions execution backends when the computer is unavailable

---

## Core Features

![](docs/images/product.webp)

### 🧠 Multi-Model & Chat

- **Multi-model routing** — Claude (Anthropic), Codex (OpenAI), and Gemini protocols, with custom Base URL support for third-party compatible services
- **Rich rendering** — streaming Markdown with built-in KaTeX math, Mermaid diagrams, and Monaco code preview
- **History compaction** — dual-layer Segment + Summary Checkpoint persistence keeps long conversations from losing context
- **Internationalization** — built-in i18n multi-language framework

### 🔧 Local Tool Execution

- **Full file-system capabilities** — precise `Read` / `Write` / `Edit` / `Delete`, plus `Glob` / `Grep` pattern and regex search
- **Bash & long-running processes** — non-interactive command execution (cwd / timeout), with `ManagedProcess` supervising dev servers and other resident tasks
- **Sub-agent delegation** — independent sub-agents execute in parallel with worktree isolation and automatic merging
- **Cross-platform execution** — desktop system tools, Android PRoot, iOS a-Shell commands, and opt-in GitHub Actions jobs share one capability model

### 🧩 MCP & Skills Ecosystem

- **MCP protocol bridging** — the Tauri side natively bridges any stdio / http MCP server for unlimited tool extension
- **Skills packages** — progressive disclosure and on-demand loading, with install / create / package support and the ClawHub ecosystem

### 💾 Memory & Automation

- **Persistent memory** — Markdown + SQLite FTS full-text search for cross-session knowledge management
- **Scheduled tasks** — bash / http / prompt cron job types, executed automatically in the background

### 🌐 Local WebUI & Mobile

- **Paired LAN access** — enable WebUI in the desktop settings and open the displayed `http://<desktop-ip>:28367` address from another device
- **No second frontend or server deployment** — the Tauri desktop host serves the same bundled React application and exposes an authenticated, permission-gated local API
- **Mobile standalone mode** — Android and iOS can run supported tasks locally; cloud execution can produce cross-platform artifacts when explicitly enabled

---

## Download & Deployment

Installers are automatically built and published by GitHub Actions — grab the latest version from [**GitHub Releases**](https://github.com/oliid0/xgent/releases/latest). Developer ID signing and notarization are release-specific; unsigned releases remain installable.

### System Requirements

| Platform | Requirements |
|---|---|
| macOS | Both Intel (x64) and Apple Silicon (aarch64) architectures |
| Windows | x64; requires the WebView2 runtime (bundled with Windows 11) |
| Linux | x86_64; requires WebKitGTK 4.1 (Ubuntu 22.04+ / Debian 12+, etc.) |
| Android | arm64 or x86_64; optional PRoot environment is prepared on first use |
| iOS / iPadOS | arm64; unsigned IPA releases must be re-signed before installation |

### macOS

Download the DMG matching your chip from [Releases](https://github.com/oliid0/xgent/releases/latest), open it, and drag Xgent into Applications:

- Apple Silicon (M-series): `Xgent-<version>-macOS-aarch64.dmg`
- Intel: `Xgent-<version>-macOS-x64.dmg`

> For a release without Developer ID signing, macOS blocks the first direct launch. Control-click Xgent in Finder and choose Open, or allow it under System Settings → Privacy & Security. Once approved, the app runs normally. Signed and notarized releases do not need this override.

### Windows

Pick an installation method from [Releases](https://github.com/oliid0/xgent/releases/latest):

| Method | File | Best for |
|---|---|---|
| Setup wizard | `Xgent-<version>-Windows-x64-Setup.exe` | Most users |
| MSI package | `Xgent-<version>-Windows-x64.msi` | Enterprise distribution / silent install |
| Portable | `Xgent-<version>-Windows-x64-portable.zip` | No install — unzip and run |

### Linux

Choose by distribution from [Releases](https://github.com/oliid0/xgent/releases/latest):

| Format | Distributions | Install |
|---|---|---|
| AppImage | Any distribution | `chmod +x`, then run directly |
| DEB | Debian / Ubuntu family | `sudo dpkg -i Xgent-<version>-Linux-x86_64.deb` |
| RPM | Fedora / openSUSE family | `sudo rpm -i Xgent-<version>-Linux-x86_64.rpm` |

### Use the WebUI on a Local Network

1. Open **Settings → Access** in the desktop application.
2. Enable **WebUI**, keep the default port `28367`, and choose LAN or loopback scope.
3. Generate a six-digit pairing code.
4. Open the displayed URL on the phone, tablet, or browser and enter the pairing code.

The desktop must remain running. Sessions are revocable, privileged tool groups have separate permission switches, and provider/SSH/GitHub credentials are never returned to the browser. Plain HTTP should only be used on a trusted local network.





### Build from Source

Expand the Development Guide below for the full set of Make commands.

![](docs/images/architecture.webp)

<details>
<summary><b>Architecture Overview</b> — diagram & tech stack</summary>

```
┌──────────────────────────────────────────────────────────────┐
│                  Shared Xgent React Source                  │
│              Web · Desktop · Android · iOS                   │
└────────────────────────────┬─────────────────────────────────┘
                             │ Tauri IPC or paired HTTP/SSE
┌────────────────────────────▼─────────────────────────────────┐
│                    Tauri 2 System Runtime                    │
│                          Rust                                │
├──────────┬────────────┬───────────┬────────────┬─────────────┤
│ Models   │ Runtime    │ Tools     │ Skills     │ Memory/Cron │
│ pi-ai    │ multi-turn │ FS/Bash/  │ progressive│ SQLite+MD   │
│ + Codex  │ + SubAgent │ MCP bridge│ + Hub      │ FTS index   │
└──────────┴────────────┴───────────┴────────────┴─────────────┘
                             │ optional execution providers
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        Android PRoot    iOS a-Shell   GitHub Actions
```

**Tech Stack**

| Component | Technology |
|---|---|
| **Unified frontend** · Framework | Tauri 2 + React 19 + TypeScript 7 |
| **Unified frontend** · Build | Vite 8 + pnpm (shared by Web/PC/mobile) |
| **Unified frontend** · Styling | Tailwind CSS 4 + Base UI |
| **Unified frontend** · Rendering | streamdown + KaTeX + Mermaid + Monaco Editor |
| **Tauri** · Backend | Rust + Tokio + SQLite (rusqlite) + local Axum WebUI |
| **Agent** · LLM | @earendil-works/pi-ai |
| **Mobile execution** | Android PRoot + Alpine; iOS a-Shell command runtime |
| **Cloud execution** | User-owned public `agent-temp` repository + GitHub Actions |

</details>

<details>
<summary><b>Development Guide</b> — common Make commands (run <code>make help</code> for the full list)</summary>

| Command | Description |
|---|---|
| `make dev` | Start the Tauri development environment |
| `make build` | Build the desktop app |
| `make dev-web` | Start Web development from the unified frontend |
| `make web` | Build Web assets from the unified frontend |
| `make desktop-build-macos-release` | macOS signed release build |
| `make clean` | Clean build artifacts |

</details>

<details>
<summary><b>Project Structure</b> — directory tree</summary>

```
Xgent/
├── crates/
│   ├── fronted/                  # Unified Web/PC/mobile application
│   │   ├── src/                  # React frontend
│   │   │   ├── components/       #   UI components
│   │   │   ├── lib/              #   Core logic (chat, tools, skills, memory)
│   │   │   ├── pages/            #   Pages (Chat, Settings)
│   │   │   ├── i18n/             #   Internationalization
│   │   │   └── prompt/           #   System prompt templates
│   │   └── src-tauri/            # Rust backend (Tauri)
│   │
│   └── mobile-execution/         # Android PRoot and iOS a-Shell plugin
│
├── docs/                         # Project docs
│   ├── architecture/             #   Architecture design
│   ├── features/                 #   Feature guides
│   └── operations/               #   Operations & deployment
│
├── scripts/release/              # Release automation
├── .github/workflows/            # CI/CD (CI + Desktop Release)
├── Makefile                      # Build commands
└── Cargo.toml                    # Rust workspace
```

</details>

---

## FAQ

<details>
<summary><b>Does my API key ever leave my machine?</b></summary>

No. Model and SSH credentials remain in the native host. Paired browsers receive redacted settings and use the authenticated local provider proxy. The GitHub PAT for cloud execution is stored in the native encrypted vault.

</details>

<details>
<summary><b>Do I have to deploy a server for browser access?</b></summary>

No. Enable WebUI in the desktop application; the embedded Tauri service hosts the same React frontend on port `28367`.

</details>

<details>
<summary><b>Which models are supported?</b></summary>

Claude (Anthropic), Codex (OpenAI), and Gemini protocols are built in, plus custom Base URL support for any compatible third-party service.

</details>

<details>
<summary><b>Will long conversations / disconnects lose context?</b></summary>

No. The native host persists history with Segment + Summary Checkpoints. Paired clients read the same SQLite-backed history and subscribe to allowed runtime events.

</details>

---

## Contributing

Issues and pull requests are welcome! See the [Development Guide](docs/operations/development.md) for setting up a dev environment.

Before submitting a PR, make sure all of the following checks pass (they match the CI gates):

**Desktop client · `crates/fronted`**

1. Type check & build pass: `pnpm build`
2. Lint passes: `pnpm lint`
3. Frontend unit tests pass: `pnpm test:frontend` (also run `pnpm test:release` when touching release scripts)
4. Rust backend check passes: `cargo check --manifest-path crates/fronted/src-tauri/Cargo.toml --tests` (run from the repo root)

**Single-frontend boundary**

- Web, PC, and mobile builds all come from `crates/fronted`; platform differences belong in `src/runtime` or the Tauri system boundary.
- Local browser access is owned by the Tauri host. Do not add a second frontend or a standalone gateway.
- Keep the diff clean (no trailing whitespace): `git diff --check`

---

## 👥 Contributors

Thanks to everyone who has contributed to Xgent!

<a href="https://github.com/oliid0/xgent/graphs/contributors">
  <img src="docs/images/contributors.svg" alt="Contributors" />
</a>

---

## Star History

<a href="https://www.star-history.com/?repos=oliid0%2Fxgent&type=date&legend=top-left">

 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="docs/images/star-history-dark.svg" />
   <source media="(prefers-color-scheme: light)" srcset="docs/images/star-history-light.svg" />
   <img alt="Star History Chart" src="docs/images/star-history-light.svg" />
 </picture>
</a>

---

## License

MIT © Oliid0
