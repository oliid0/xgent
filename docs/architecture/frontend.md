# 统一前端架构

## 目录边界

| 路径 | 职责 |
|---|---|
| `src/App.tsx` | 应用设置、平台判定、宿主桥 |
| `src/pages` | 所有平台共用的页面 |
| `src/lib` | Chat、工具、设置、Skills、Memory 等业务逻辑 |
| `src/runtime/index.ts` | 延迟选择原生或浏览器运行时 |
| `src/runtime/tauri.ts` | Tauri IPC、事件与窗口能力 |
| `src/runtime/browser.ts` | 配对会话、HTTP RPC 与 SSE |

组件不得直接引入 Tauri 包；除原生标题栏等明确例外外，系统访问统一通过 `@xagent/runtime`。

## 构建目标

- `pnpm build`：桌面和移动端使用的 Vite bundle。
- `pnpm build:web`：同一源码的浏览器 bundle。
- Tauri desktop：Windows、macOS、Linux。
- Tauri mobile：Android、iOS。

不存在镜像、复制或同步第二份页面代码的步骤。

## 浏览器权限边界

浏览器不能直接访问 SQLite、系统文件、Shell、Keychain 或 Stronghold。它使用桌面端内置 `28367` 服务：

- 配对成功后获得 HttpOnly session；
- 改变状态的 RPC 必须带 CSRF；
- Rust command allowlist 与权限设置先于 Tauri invoke；
- Tauri 事件通过订阅 allowlist 和 SSE 转发；
- Provider API key 由桌面本地代理注入。

## 移动端边界

移动端仍运行完整 React/Tauri 应用，但桌面专属工具不会注册为可用能力。Android/iOS 通过 `tauri-plugin-mobile-execution` 上报真实命令、环境与能力包状态。
