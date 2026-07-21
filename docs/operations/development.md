# 开发与运行

## 仓库边界

| 目录 | 职责 |
|---|---|
| `crates/fronted` | 唯一 React 前端源码，以及 Tauri 2 Rust 系统层。Web、PC、移动端从这里构建。 |
| `crates/gateway` | 纯 Go API/WebSocket/proto 服务。不包含前端、静态资源嵌入或容器配置。 |

平台差异必须进入 `crates/fronted/src/runtime` 或 `src-tauri` 的系统能力边界，页面、组件、状态模型与 i18n 保持单份源码。

## 根目录命令

| 命令 | 作用 |
|---|---|
| `make dev` | 启动 Tauri 开发模式。 |
| `make build` | 构建当前桌面平台。 |
| `make dev-web` | 从统一前端源码启动 Web 开发服务。 |
| `make web` | 从统一前端源码构建 Web 静态文件。 |
| `make dev-gateway` | 启动纯 Go Gateway。 |
| `make gateway-build` | 生成 proto 并构建 Gateway 二进制。 |
| `make proto` | 生成 Gateway Go protobuf。 |
| `make proto-check` | 执行 buf lint 与 breaking-change 检查。 |
| `make desktop-build-macos-release` | macOS 签名、公证 release 打包。 |
| `make desktop-build-windows` | Windows 桌面构建。 |
| `make desktop-build-linux` | Linux 桌面构建。 |

## GitHub Actions 验证

当前项目以 GitHub Actions 为构建和测试事实来源。`.github/workflows/ci.yml` 包含：

| Job | 覆盖内容 |
|---|---|
| Gateway | buf lint/breaking、Go protobuf 生成一致性、golangci-lint、Go tests。 |
| Unified Frontend | TypeScript 7 + Web build、Biome、前端模块测试、release 脚本测试。 |
| Tauri Rust Check | Linux Tauri 依赖、Rust tests 编译、history migration tests。 |
| Architecture Guard | 单前端、纯 Go Gateway、无旧目录/镜像脚本/Docker 配置、运行时导入边界。 |
| Diff Hygiene | 行尾与空白检查。 |

## Gateway 分层

| 代码类型 | 位置 |
|---|---|
| 传输机制（写泵/背压/心跳） | `internal/transport/wscore` |
| v2 协议编解码/握手/直通/扇出 | `internal/protocol/pbws` |
| 跨协议域逻辑 | `internal/protocol/shared` |
| chat 命令编排 | `internal/chatcmd` |
| 会话状态与关联路由 | `internal/session` |
| 日志与协议使用观测 | `internal/observability` |
| HTTP/API/WebSocket 入口 | `internal/server` |

修改 proto 后只生成 Go 产物。浏览器运行时属于统一前端，不由 Gateway 的 buf 配置向另一个前端目录生成代码。

## 统一前端检查

- 不新增 `crates/gateway/web` 或其他第二前端目录。
- 不复制页面、组件、store、i18n 或测试来区分 Web/PC/移动端。
- 共享源码只通过 `@xagent/runtime` 使用 invoke/event/path/opener 等平台能力。
- 浏览器不支持的本地能力由明确的 runtime adapter 表达，不能通过 Vite alias 伪装 Tauri 包。
- Gateway 不 serve SPA、不 `go:embed` 前端、不参与 Web 静态资源构建。
