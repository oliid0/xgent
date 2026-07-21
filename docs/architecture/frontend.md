# 统一前端架构

`crates/fronted` 是项目唯一的 React 前端。Web、桌面和移动端不拥有各自的页面树、组件树、store、i18n 或测试副本。

## 目录边界

| 路径 | 职责 |
|---|---|
| `src/main.tsx` | 所有前端目标共用的 React 入口。 |
| `src/App.tsx` | 共用应用壳、设置与 Chat 页面编排。 |
| `src/components`、`src/pages`、`src/lib`、`src/i18n` | 所有运行目标共用的 UI 与业务逻辑。 |
| `src/runtime/types.ts` | 平台能力接口。 |
| `src/runtime/index.ts` | 运行时检测和惰性 adapter 选择。 |
| `src/runtime/tauri.ts` | 桌面/移动 Tauri invoke、event、path、opener 与文件拖放。 |
| `src/runtime/browser.ts` | 浏览器存储、Gateway HTTP/WebSocket 与 Web 能力适配。 |
| `src-tauri` | Tauri 2 Rust 系统能力与桌面/移动平台工程。 |

业务源码通过 `@xagent/runtime` 请求平台能力，不直接依赖浏览器伪造的 Tauri 模块。架构守卫只允许 runtime adapter（以及必须直接操作窗口的 title bar 边界）导入 `@tauri-apps/*`。

## 构建目标

| 目标 | 入口 | 产物 |
|---|---|---|
| Web | `pnpm build:web` / `make web` | `crates/fronted/dist` 静态文件。 |
| Desktop | `pnpm tauri build` | macOS/Windows/Linux bundle。 |
| Mobile | Tauri 2 Android/iOS build | Android/iOS 原生工程与 bundle，共用同一 React build。 |

## 浏览器权限边界

浏览器运行时不能直接访问本地文件系统、Shell、SQLite、Keychain 或 native window。需要本地权限的调用必须通过认证后的 Gateway 协议转发到在线 Tauri Agent。浏览器本地只保存连接信息、脱敏设置和 UI 状态；真实 provider secret、历史与 Memory 的事实源仍在 Tauri 端。

## 禁止的回退结构

- 不允许恢复 `crates/gateway/web` 或其他第二前端目录。
- 不允许 mirror manifest、复制同步脚本或双份测试。
- 不允许 Gateway `go:embed`/FileServer 提供前端静态资源。
- 不允许通过 Vite alias 把 Tauri package 替换为一组散落 shims。
- 平台能力扩展先修改 `XAgentRuntime` 接口，再分别实现明确的 Tauri/browser adapter。
