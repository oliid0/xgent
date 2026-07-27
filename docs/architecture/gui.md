# React 与 Tauri 架构

## React 编排

| 模块 | 职责 |
|---|---|
| `App.tsx` | 设置生命周期、平台选择、主题和本地访问宿主桥 |
| `ChatPage.tsx` | 会话、历史、运行快照、队列、上传和 Agent turn |
| `pages/chat/runtime` | per-conversation runtime cache 与模型选择 |
| `lib/chat/conversation` | Segment 状态、运行事件、持久化与压缩 |
| `lib/tools` | 内置工具注册、权限与动态 MCP 工具 |
| `pages/settings` | 原生设置、WebUI、移动执行和云端保险库 |

## Tauri 命令面

| 域 | 示例 |
|---|---|
| 设置 | `settings_load_all`、`settings_update_*` |
| 历史 | `chat_history_*` |
| 本地访问 | `local_access_*` |
| 云端执行 | `cloud_task_*`、`cloud_secret_vault_*` |
| 文件/Git/终端 | `fs_*`、`git_*`、`terminal_*`、`managed_process_*` |
| 移动端 | `mobile_execution_*` |

桌面专属命令使用 Rust `cfg` 隔离；移动端命令注册必须与对应插件能力一致。

## 本地 WebUI 桥

Rust 完成 Host/Origin、session、CSRF、命令 allowlist 和权限判断后，使用 Tauri event 把 RPC 请求交给 `localAccessHostBridge.ts`。宿主桥调用现有 Tauri command 并通过 request ID 返回结果。浏览器事件订阅反向复用同一宿主桥并经 SSE 投递。

这个桥接层复用原有业务命令，不复制文件、历史、MCP 或设置实现。

## 持久化

- SQLite schema 与迁移位于 `src-tauri/src/commands/config` 和 `commands/history`。
- Chat 使用 V3 Segment + Summary Checkpoint。
- 写入按 conversation 串行化，避免 WebUI 与桌面并发更新破坏增量基线。
- 浏览器设置使用脱敏 snapshot；secret 更新走独立字段。
