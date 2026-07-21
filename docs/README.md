# XAgent 架构文档

本文档树从当前实现出发，系统梳理 XAgent 的统一 React 前端、Tauri 系统层与纯 Go Gateway。Web、PC、移动端共享 `crates/fronted`，平台差异由 runtime adapter 表达。

## 项目一句话

XAgent 是一个由单份 React 源码覆盖 Web、PC 和移动端的 Agent 应用：Tauri/Rust 负责本地系统能力与持久化，Go Gateway 只负责远程 API/WebSocket 中继。

## 文档目录

| 文档 | 覆盖范围 | 推荐读者 |
|---|---|---|
| [architecture/overview.md](architecture/overview.md) | 系统总览、进程边界、数据流、持久化地图 | 新接手项目者 |
| [architecture/frontend.md](architecture/frontend.md) | 单前端目录、Web/Tauri runtime adapter、跨平台边界 | 前端开发 |
| [architecture/gui.md](architecture/gui.md) | Tauri commands/services、设置与本地执行 | Tauri 开发 |
| [architecture/gateway.md](architecture/gateway.md) | Go Gateway 的 HTTP/WebSocket（v2）、Session Manager、缓冲与认证 | Gateway 开发与排障 |
| [architecture/protocols.md](architecture/protocols.md) | 浏览器/Tauri runtime 与 Gateway 的协议合同 | 联调与协议改造 |
| [features/chat-runtime.md](features/chat-runtime.md) | 对话运行时、模型层、流式、压缩、hooks、上传与重发 | Chat 功能开发 |
| [features/tools.md](features/tools.md) | builtin tools、MCP 动态工具、subagent（Agent/SendMessage）、工具执行边界 | 工具系统开发 |
| [features/memory.md](features/memory.md) | MemoryStore、MemoryManager、Settings Memory、自动学习与召回 | 记忆系统开发 |
| [features/skills-and-mcp.md](features/skills-and-mcp.md) | Skills root/builtin/ClawHub 与 MCP Hub/registry/runtime | Skills/MCP 开发 |
| [features/history-compaction.md](features/history-compaction.md) | V3 历史分段、FTS、分享、上下文压缩 checkpoint | 历史与上下文开发 |
| [operations/development.md](operations/development.md) | 本地开发、构建、测试、端口、运行路径 | 日常开发 |
| [operations/deployment.md](operations/deployment.md) | CI/CD、纯 Go Gateway/Web 分离部署、桌面 Release | 发布维护 |
| [reference/source-map.md](reference/source-map.md) | 按功能域列出的源码路径索引 | 快速定位源码 |

## 架构阅读顺序

| 顺序 | 目标 | 文档 |
|---:|---|---|
| 1 | 先建立整体进程和边界模型 | [architecture/overview.md](architecture/overview.md) |
| 2 | 理解单前端与 runtime adapter | [architecture/frontend.md](architecture/frontend.md) |
| 3 | 理解远程访问如何转发到桌面端 | [architecture/gateway.md](architecture/gateway.md)、[architecture/protocols.md](architecture/protocols.md) |
| 4 | 理解 Tauri 为什么是本地执行真相源 | [architecture/gui.md](architecture/gui.md) |
| 5 | 按功能域深入 Chat、Tools、Memory、Skills/MCP、History/Compaction | `features/` |
| 6 | 需要动手时查运行命令和源码索引 | [operations/development.md](operations/development.md)、[reference/source-map.md](reference/source-map.md) |

## 当前实现的核心边界

| 边界 | 当前结论 |
|---|---|
| Agent 执行位置 | Tauri 本地执行模型请求、工具调用、文件系统、Shell、MCP、Skills、Memory、Cron prompt。 |
| Gateway 职责 | 认证、连接保持、请求路由、事件广播、有界 Chat relay window；不承载前端静态资源。 |
| 浏览器职责 | 运行与 PC/移动端相同的 React 源码，通过 browser runtime 和 Gateway 请求本地 Agent。 |
| 设置同步 | Tauri 是真实设置来源；浏览器只保存脱敏快照和用户显式输入的新值。 |
| 历史同步 | Tauri 写 SQLite 历史，Gateway 只转发 history request 与 sync event。 |
| 文档来源 | 本文档基于当前 checkout 的源码路径、入口文件、协议定义与运行脚本整理。 |

## 与 `doc/` 的关系

| 目录 | 定位 |
|---|---|
| `docs/` | 当前实现的全局架构说明、模块地图、运行说明和源码索引。 |
| `doc/` | 既有专项文档与历史设计资料，例如 memory 方案、Gateway 协议草案、上下文压缩策略等。 |

后续如果某个专项文档已经稳定成为当前实现的一部分，可以在 `docs/` 中建立摘要与导航，但不建议把 `doc/` 直接重命名为 `docs/`，以免丢失历史上下文。
