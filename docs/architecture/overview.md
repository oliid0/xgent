# XAgent 总体架构

## 系统分层

| 层级 | 主要路径 | 技术栈 | 核心职责 |
|---|---|---|---|
| 统一前端 | `crates/fronted/src` | React 19、TypeScript 7、Vite 8、Tauri 2 | Web/PC/移动端共享 UI、Chat runtime、Settings、Skills/MCP/Memory。 |
| 平台运行时 | `crates/fronted/src/runtime` | TypeScript adapters | 将共享业务代码映射到 Tauri 或浏览器能力。 |
| Tauri 系统层 | `crates/fronted/src-tauri` | Rust、Tokio、SQLite | 文件/Shell/进程、MCP、Memory、Cron、历史、Gateway Agent bridge。 |
| Gateway | `crates/gateway` | Go、HTTP、WebSocket、Protobuf | 认证、连接与会话路由、远程请求中继、有界事件恢复。 |

Gateway 不执行本地工具、不保存真实 provider key、不包含前端源码、不 serve SPA，也不参与 Web 静态资源构建。

## 运行环境

| 环境 | React 入口 | 系统能力 | 网络角色 |
|---|---|---|---|
| Web | `crates/fronted/src/main.tsx` | `browserRuntime` | 通过 Gateway API/WebSocket 请求在线 Tauri Agent。 |
| Desktop | 同一入口 | `tauriRuntime` + Rust | 本地执行真相源，也可连接 Gateway。 |
| Mobile | 同一入口 | `tauriRuntime` + Android/iOS Tauri | 使用移动平台可用的 Tauri command/plugin。 |
| Gateway | 无 React 入口 | 纯 Go | 在浏览器与 Tauri Agent 之间路由。 |

## 核心数据流

```text
Shared React UI
  ├─ browserRuntime ── HTTP/WebSocket ──┐
  └─ tauriRuntime ── invoke/event ── Tauri Rust
                                       │
                                       └── Agent WebSocket ── Go Gateway
```

桌面和移动端的本地能力由 Tauri Rust 实现。浏览器对同一业务动作使用 Gateway transport；权限不足的能力必须明确返回 unsupported/permission error，不能静默伪造成功。

## 持久化所有权

| 数据 | 所有者 | 位置 |
|---|---|---|
| 应用设置 | Tauri Rust | `~/.xagent/config.sqlite` |
| Chat 历史 | Tauri Rust | `~/.xagent/chat-history.sqlite3` |
| Memory | Tauri Rust | `~/.xagent/memory` 与索引 SQLite |
| Skills | Tauri Rust + shared frontend | `~/.xagent/skills` |
| 浏览器连接/UI 状态 | browser runtime | localStorage |
| relay window/幂等记录 | Gateway | 进程内有界状态 |

## 设计原则

- 单份 React 业务源码，adapter 表达平台差异。
- Tauri 是本地执行和持久化真相源。
- Gateway 是 API/WebSocket 中继，不是前端宿主。
- 协议编号只增不改；恢复依赖桌面历史 snapshot 与 Gateway 有界 seq window。
- CI 的 architecture guard 防止旧目录、镜像脚本、静态资源嵌入与越界 Tauri imports 回归。
