# 源码索引

## 根目录

| 路径 | 说明 |
|---|---|
| `README.md` | 项目根说明。 |
| `Makefile` | 统一前端、Tauri、Gateway、proto、release 常用命令。 |
| `Cargo.toml` | Rust workspace。 |
| `doc/` | 历史专项文档。 |
| `docs/` | 当前架构总览文档。 |

## Unified Frontend

| 功能 | 路径 |
|---|---|
| App shell | `crates/fronted/src/App.tsx` |
| React entry | `crates/fronted/src/main.tsx` |
| Chat page | `crates/fronted/src/pages/ChatPage.tsx` |
| Chat turn | `crates/fronted/src/pages/chat/runTextConversationTurn.ts`、`runAgentConversationTurn.ts` |
| Chat transcript | `crates/fronted/src/pages/chat/ChatTranscript.tsx`、`AssistantBubble.tsx` |
| Composer/header | `crates/fronted/src/pages/chat/ChatComposerBar.tsx`、`ChatHeader.tsx` |
| History sidebar | `crates/fronted/src/components/chat/ChatHistorySidebar.tsx` |
| Gateway bridge hooks | `crates/fronted/src/pages/chat/useGatewayBridgeListeners.ts`、`useGatewayBridgeBatcher.ts` |
| Context builders | `crates/fronted/src/pages/chat/conversationContextBuilders.ts` |
| Settings page | `crates/fronted/src/pages/SettingsPage.tsx`、`src/pages/settings/*` |
| Skills Hub | `crates/fronted/src/pages/skills-hub/*` |
| MCP Hub | `crates/fronted/src/pages/mcp-hub/*` |
| Shared hub chrome | `crates/fronted/src/components/hub/HubChrome.tsx` |
| i18n | `crates/fronted/src/i18n/*` |

## Shared Frontend Libraries

| 功能 | 路径 |
|---|---|
| Model provider layer | `crates/fronted/src/lib/providers/llm.ts` |
| Provider proxy helpers | `crates/fronted/src/lib/providers/proxy.ts` |
| Settings defaults/storage/sync | `crates/fronted/src/lib/settings/*` |
| Builtin tool registry | `crates/fronted/src/lib/tools/builtinRegistry.ts` |
| FS tools | `crates/fronted/src/lib/tools/fsTools.ts` |
| Shell tools | `crates/fronted/src/lib/tools/shellTools.ts` |
| MCP tools | `crates/fronted/src/lib/tools/mcpTools.ts`、`mcpManagerTools.ts` |
| Skills tools | `crates/fronted/src/lib/tools/skillTools.ts` |
| Memory tools | `crates/fronted/src/lib/tools/memoryTools.ts` |
| Cron tools | `crates/fronted/src/lib/tools/cronTools.ts` |
| Subagent tools（Agent/SendMessage） | `crates/fronted/src/lib/subagents/*` |
| Conversation state | `crates/fronted/src/lib/chat/conversation/*` |
| Memory prompt/policy | `crates/fronted/src/lib/chat/memory/*` |
| Skills discovery | `crates/fronted/src/lib/skills/*` |
| MCP registry | `crates/fronted/src/lib/mcpRegistry/*` |

## Tauri Rust

| 功能 | 路径 |
|---|---|
| Tauri entry | `crates/fronted/src-tauri/src/main.rs` |
| App builder/invoke handler | `crates/fronted/src-tauri/src/lib.rs` |
| Chat history commands | `crates/fronted/src-tauri/src/commands/chat_history.rs` |
| Settings commands | `crates/fronted/src-tauri/src/commands/settings.rs` |
| Memory commands | `crates/fronted/src-tauri/src/commands/memory.rs` |
| MCP commands/runtime | `crates/fronted/src-tauri/src/commands/mcp.rs` |
| File commands | `crates/fronted/src-tauri/src/commands/fs.rs` |
| Shell/process commands | `crates/fronted/src-tauri/src/commands/shell.rs`、`process.rs` |
| System commands | `crates/fronted/src-tauri/src/commands/system.rs`、`system_tools.rs` |
| Gateway commands | `crates/fronted/src-tauri/src/commands/gateway.rs` |
| Subagent worktree commands | `crates/fronted/src-tauri/src/commands/workspace/subagent_worktree.rs` |
| Subagent store | `crates/fronted/src-tauri/src/commands/history/subagent_store.rs` |
| MemoryStore | `crates/fronted/src-tauri/src/services/memory.rs` |
| Skills service | `crates/fronted/src-tauri/src/services/skills.rs` |
| Gateway service | `crates/fronted/src-tauri/src/services/gateway.rs`、`gateway_bridge.rs` |
| Cron service | `crates/fronted/src-tauri/src/services/cron.rs` |
| Runtime shell/process | `crates/fronted/src-tauri/src/runtime/*` |

## Gateway

| 功能 | 路径 |
|---|---|
| Gateway entry | `crates/gateway/cmd/gateway/main.go` |
| Config | `crates/gateway/internal/config/config.go` |
| v2 协议层（WebSocket+Protobuf） | `crates/gateway/internal/protocol/pbws/*`（browser/agent/terminal 三链路、guard 白名单、seam 映射） |
| WS 连接运行时 | `crates/gateway/internal/transport/wscore/*` |
| 协议共用域逻辑 | `crates/gateway/internal/protocol/shared/*`（Origin 校验、终端门控/后处理、终端兴趣跟踪） |
| Chat 命令编排 | `crates/gateway/internal/chatcmd/chatcmd.go` |
| 可观测性 | `crates/gateway/internal/observability/*`（slog 初始化、v2 使用计数） |
| HTTP routes | `crates/gateway/internal/server/http.go`（proto→JSON 塑形：`proto_json.go`） |
| Session manager | `crates/gateway/internal/session/manager.go`、`agent_session.go`、`manager_state.go`、`manager_registry.go`、`manager_*_sync.go`、`manager_terminal.go`、`manager_chat_runs.go` |
| Auth | `crates/gateway/internal/auth/*` |
| Handlers | `crates/gateway/internal/handler/*` |
| Proto source | `crates/gateway/proto/v1/gateway.proto`（业务消息）、`proto/v2/gateway_ws.proto`（v2 帧壳） |
| Generated proto | `crates/gateway/internal/proto/v1/*`、`internal/proto/v2/*` |

## Runtime Boundary

| 功能 | 路径 |
|---|---|
| Runtime interface | `crates/fronted/src/runtime/types.ts` |
| Runtime selection | `crates/fronted/src/runtime/index.ts` |
| Tauri adapter | `crates/fronted/src/runtime/tauri.ts` |
| Browser adapter | `crates/fronted/src/runtime/browser.ts` |
| Web build | `crates/fronted/package.json` 的 `build:web` |

## 资料与设计

| 路径 | 说明 |
|---|---|
| `doc/README.md` | 旧文档入口。 |
| `doc/webui-gateway-spec.md` | WebUI/Gateway 协议专项资料。 |
| `doc/memory/README.md` | Memory 设计资料入口。 |
| `doc/memory/schema.sql` | Memory SQLite index schema 参考。 |
| `docs/architecture/*` | 当前总览架构文档。 |
| `docs/features/*` | 当前功能域架构文档。 |
