# XAgent 总体架构

## 系统分层

| 层 | 路径 | 职责 |
|---|---|---|
| React 应用 | `crates/fronted/src` | Web、桌面和移动端共用页面、Agent loop、工具与设置 |
| Runtime 边界 | `crates/fronted/src/runtime` | Tauri IPC 与配对浏览器 HTTP RPC/SSE |
| Tauri 系统层 | `crates/fronted/src-tauri` | SQLite、文件、Shell、Git、MCP、Memory、Skills、WebUI、云端任务 |
| 移动执行插件 | `crates/mobile-execution` | Android PRoot/Alpine 与 iOS a-Shell 命令执行 |
| GitHub Actions | 用户 `agent-temp` | 可选跨平台构建与 artifact 生成 |

仓库只有一个前端和一个 Rust workspace，不包含独立网关或第二份 WebUI。

## 运行环境

| 目标 | 入口 | 系统能力 |
|---|---|---|
| Windows/macOS/Linux | `main.tsx` + `tauriRuntime` | 完整桌面能力 |
| 配对浏览器 | 同一 `main.tsx` + `browserRuntime` | 经 `28367` 桌面宿主授权的能力 |
| Android | 同一 React/Tauri 应用 | App sandbox + 可选 PRoot |
| iOS/iPadOS | 同一 React/Tauri 应用 | App sandbox + a-Shell/ios_system |

## 数据所有权

- 设置、历史、Memory、Skills metadata 与设备会话由原生 SQLite/文件存储持有。
- 模型和 SSH 凭据不返回浏览器。
- GitHub PAT 只存入 Stronghold 加密保险库。
- 云端 task 源码和输入属于公开仓库内容；Actions Secret/Variable 承载运行时环境值。
- Release artifact 由 GitHub Actions 生成并发布。

## 设计原则

- 页面、Agent loop 和工具协议跨平台复用。
- 能力必须由运行时清单明确声明，不能静默伪造成功。
- LAN 桌面能力优先于移动端有限环境；云端执行必须由用户开启。
- 所有远程输入经过认证、allowlist、大小限制与权限开关。
