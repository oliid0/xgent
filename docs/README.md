# XAgent 文档

XAgent 使用一份 React/Tauri 源码覆盖 Web、桌面和移动端。Rust/Tauri 负责本地持久化与系统能力；桌面端可在 `28367` 端口托管同一份 WebUI，移动端还可以选择本机执行或 GitHub Actions 云端执行。

## 架构

| 文档 | 内容 |
|---|---|
| [architecture/overview.md](architecture/overview.md) | 总体分层、运行环境和数据所有权 |
| [architecture/frontend.md](architecture/frontend.md) | 单前端边界与运行时适配 |
| [architecture/gui.md](architecture/gui.md) | React 与 Tauri 模块边界 |
| [architecture/local-access.md](architecture/local-access.md) | WebUI 配对、RPC/SSE、安全与移动/云端后端 |

## 功能

| 文档 | 内容 |
|---|---|
| [features/chat-runtime.md](features/chat-runtime.md) | 对话运行时与上下文构造 |
| [features/history-compaction.md](features/history-compaction.md) | SQLite 历史、Segment 与 Summary Checkpoint |
| [features/memory.md](features/memory.md) | Memory 存储、召回与整理 |
| [features/skills-and-mcp.md](features/skills-and-mcp.md) | Skills、MCP 与动态工具 |
| [features/tools.md](features/tools.md) | 内置工具和执行边界 |

## 开发与发布

| 文档 | 内容 |
|---|---|
| [operations/development.md](operations/development.md) | 目录、命令与 GitHub Actions 门禁 |
| [operations/deployment.md](operations/deployment.md) | 五平台 Release 与本地 WebUI |
| [operations/macos-release-signing.md](operations/macos-release-signing.md) | 可选 macOS 签名与公证 |
| [reference/source-map.md](reference/source-map.md) | 当前源码入口索引 |

仓库不包含第二套前端、独立网关或容器部署链。WebUI 是桌面 Tauri 宿主的本地能力。
