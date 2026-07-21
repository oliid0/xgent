# CI/CD 与发布

当前自动化只包含统一 CI 与 Tauri 桌面 Release。Gateway 是纯 Go 服务；仓库不包含 Dockerfile、Railway 配置、Gateway 内嵌前端或容器镜像发布流程。

## 自动化入口

| 入口 | Workflow | 动作 |
|---|---|---|
| PR / `main` push | `.github/workflows/ci.yml` | Gateway proto/lint/test、统一前端 Web build/lint/test、Tauri Rust check/test、架构守卫与 diff 检查。 |
| `v*` tag | `.github/workflows/desktop-release.yml` | 构建并发布 macOS Intel/Apple Silicon、Windows x64、Linux x64 安装包与 updater manifest。 |
| 手动指定 tag | `.github/workflows/desktop-release.yml` | 默认只验证并上传 Actions 构建产物；只有显式设置 `publish=true` 才创建或更新 GitHub Release。 |

CI 使用并发组取消同一 ref 的旧运行，避免连续提交重复消耗 Runner。

## 不可变 Release 源

Release Metadata 会先解析版本，再确定唯一 `release_sha`：

- tag 已存在时，解析到该 tag 的 commit；
- 手动输入尚不存在的 tag 时，解析到 workflow 所选 ref 的 HEAD；
- macOS、Windows、Linux 和 publish job 全部 checkout 同一个 `release_sha`。

因此手动打包不会因 tag 尚不存在而在 checkout 阶段失败，也不会让不同平台构建不同源码。`publish=true` 时，新 tag/Release 精确创建在该 SHA 上。

## 统一前端与 Gateway 部署

Web、PC 和移动端共享 `crates/fronted`：

```bash
make web
```

Web 静态产物位于 `crates/fronted/dist`。Gateway 单独构建：

```bash
make gateway-build
```

Gateway 二进制位于 `crates/gateway/bin/xagent-gateway`，只提供 HTTP API、WebSocket 与健康检查，不提供 SPA/static fallback。生产环境由静态服务器提供 `fronted/dist`，并把 `/api/*`、`/ws/*` 与 `/t/*` 代理到 Gateway。

关键运行时变量：

| 变量 | 必填 | 说明 |
|---|---|---|
| `XAGENT_GATEWAY_TOKEN` | 是 | 浏览器运行时、HTTP API 与桌面端 v2 WebSocket 的共享访问 token。 |
| `PORT` | 否 | Gateway HTTP/WebSocket 监听端口。 |
| `XAGENT_GATEWAY_CHAT_PREPARE_TIMEOUT` | 否 | `chat.prepare` 关联等待时间，默认 `2s`。 |
| `XAGENT_GATEWAY_CHAT_DELIVERY_TIMEOUT` | 否 | accepted 后投递桌面 stream 的等待上限，默认 `5s`。 |
| `XAGENT_GATEWAY_CHAT_START_TIMEOUT` | 否 | 远程 command 启动 watchdog 第一阶段，默认 `5s`。 |
| `XAGENT_GATEWAY_CHAT_RENDER_START_TIMEOUT` | 否 | 启动 watchdog 附加阶段，默认 `10s`。 |

## Release Secrets

| Secret | 说明 |
|---|---|
| `APPLE_CERTIFICATE_P12_BASE64` | Developer ID Application `.p12` 的 base64。 |
| `APPLE_CERTIFICATE_PASSWORD` | `.p12` 密码。 |
| `APPLE_SIGNING_IDENTITY` | Developer ID Application identity。 |
| `APPLE_ID` | Apple Developer 账号邮箱。 |
| `APPLE_TEAM_ID` | Apple Team ID。 |
| `APPLE_APP_SPECIFIC_PASSWORD` | Apple app-specific password。 |
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri updater 私钥。 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | updater 私钥密码；无密码时可为空。 |
| `TAURI_UPDATER_PUBLIC_KEY` | 编译进客户端的 updater 公钥。 |

macOS 正式包要求 Developer ID 签名与 Apple 公证；所有 updater 产物要求 Tauri updater 签名。缺少 secret 时 workflow 应在对应签名步骤明确失败，不发布不完整 Release。

## 桌面产物

| 平台 | Runner | 产物 |
|---|---|---|
| macOS Intel | `macos-15-intel` | DMG、`.app.tar.gz` 与签名。 |
| macOS Apple Silicon | `macos-14` | DMG、`.app.tar.gz` 与签名。 |
| Windows x64 | `windows-latest` | MSI、Setup EXE、portable ZIP 与 updater 签名。 |
| Linux x64 | `ubuntu-latest` | AppImage、DEB、RPM 与 updater 签名。 |

平台包全部成功后，publish job 生成 `latest.json` 并上传 GitHub Release。正式版本号以 `vX.Y.Z` tag/input 为事实来源；`prepare-app-version-from-tag.mjs` 将同一版本注入 Vite、Rust 与 Tauri config overlay。
