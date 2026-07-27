# 源码索引

## 根目录

| 路径 | 职责 |
|---|---|
| `Cargo.toml` | Rust workspace：Tauri 应用与移动执行插件 |
| `Makefile` | 前端、桌面与 Release 常用命令 |
| `.github/workflows/ci.yml` | 权威 CI 验证 |
| `.github/workflows/desktop-release.yml` | macOS、Windows、Linux、Android、iOS 打包发布 |
| `scripts/check-architecture.mjs` | 单前端、无独立网关与运行时导入边界 |

## 统一前端

| 路径 | 职责 |
|---|---|
| `crates/fronted/src/main.tsx` | React 入口与本地访问配对门禁 |
| `crates/fronted/src/App.tsx` | 设置加载、平台判定和本地访问宿主桥 |
| `crates/fronted/src/pages/ChatPage.tsx` | 对话、历史、工具和运行快照编排 |
| `crates/fronted/src/pages/settings/AccessSection.tsx` | WebUI、配对、权限与云端保险库设置 |
| `crates/fronted/src/pages/settings/MobileExecutionSection.tsx` | 移动端执行环境与能力包 |
| `crates/fronted/src/runtime/tauri.ts` | 原生 Tauri 运行时 |
| `crates/fronted/src/runtime/browser.ts` | 配对浏览器 HTTP RPC/SSE 运行时 |
| `crates/fronted/src/runtime/localAccessHostBridge.ts` | 已授权浏览器调用与 Tauri 命令/事件桥 |

## Tauri Rust

| 路径 | 职责 |
|---|---|
| `crates/fronted/src-tauri/src/lib.rs` | 插件、状态和命令注册 |
| `crates/fronted/src-tauri/src/services/local_access.rs` | `28367` 静态资源、配对、会话、RPC/SSE 和权限 |
| `crates/fronted/src-tauri/src/services/cloud_execution.rs` | `agent-temp` 仓库、workflow、run 和 artifact 协议 |
| `crates/fronted/src-tauri/src/services/cloud_secret_vault.rs` | Stronghold 加密 PAT 保险库 |
| `crates/fronted/src-tauri/src/commands/config/settings/local_access_snapshot.rs` | 浏览器可见的脱敏设置投影 |
| `crates/fronted/src-tauri/src/commands/integration` | 本地访问与云端任务 Tauri 命令 |

## 移动端

| 路径 | 职责 |
|---|---|
| `crates/mobile-execution/android` | PRoot/Alpine 安装、执行、取消和能力清单 |
| `crates/mobile-execution/ios` | a-Shell/ios_system 命令执行适配 |
| `crates/mobile-execution/src` | 跨平台 Tauri 插件接口与桌面占位实现 |
| `scripts/mobile` | 固定来源、校验、资源准备与第三方声明 |

## Skills 与工具

| 路径 | 职责 |
|---|---|
| `crates/fronted/src/lib/tools/builtinRegistry.ts` | 内置工具注册 |
| `crates/fronted/src/lib/tools/cloudTaskTools.ts` | Agent 可调用的云端任务工具 |
| `crates/fronted/src-tauri/prompt/skills/xagent-cloud-execution` | 云端任务决策与 artifact 返回协议 |
