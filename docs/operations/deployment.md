# CI/CD 与发布

当前自动化只包含统一 CI 与 Tauri 桌面 Release。Gateway 是纯 Go 服务；仓库不包含 Dockerfile、Railway 配置、Gateway 内嵌前端或容器镜像发布流程。

## 自动化入口

| 入口 | Workflow | 动作 |
|---|---|---|
| PR / `main` push | `.github/workflows/ci.yml` | actionlint workflow 校验、Gateway proto/lint/test、统一前端 Web build/lint/test、Tauri Rust check/test、架构守卫与 diff 检查。 |
| `v*` tag | `.github/workflows/desktop-release.yml` | 默认构建并发布无证书安装包；仅当 Repository variable `RELEASE_SIGNED=true` 时执行签名发布。 |
| 手动指定 tag，`publish=false`、`sign=false` | `.github/workflows/desktop-release.yml` | 无需任何发布配置；构建安装包并上传为 Actions artifacts，不创建 GitHub Release。 |
| 手动指定 tag，`publish=true`、`sign=false` | `.github/workflows/desktop-release.yml` | 无需 Apple/Tauri 密钥；构建安装包并创建或更新 GitHub Release，不生成 updater manifest。 |
| 手动指定 tag，`sign=true` | `.github/workflows/desktop-release.yml` | 校验 Apple 签名/公证与 Tauri updater 配置，生成签名包；是否公开 Release 仍由 `publish` 决定。 |

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

## 可选的签名 Release 配置

无证书打包和发布不需要配置仓库环境变量。macOS 包使用 ad-hoc identity `-`，用户可以在“系统设置 → 隐私与安全性”中授权打开。只有需要 Apple 已验证开发者体验、公证和 Tauri 自动更新时，才在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 添加下列 Secrets 与 Variables，并设置 `sign=true`。

Apple 证书的申请、`.p12` 导出和仓库配置步骤见 [macOS 可选签名与公证配置](./macos-release-signing.md)。

| Repository secret | 说明 |
|---|---|
| `APPLE_CERTIFICATE_P12_BASE64` | Developer ID Application `.p12` 的 base64。 |
| `APPLE_CERTIFICATE_PASSWORD` | `.p12` 密码。 |
| `APPLE_APP_SPECIFIC_PASSWORD` | Apple app-specific password。 |
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri updater 私钥。 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | updater 私钥密码；无密码时可为空。 |

| Repository variable | 说明 |
|---|---|
| `APPLE_ID` | Apple Developer 账号邮箱。 |
| `APPLE_TEAM_ID` | Apple Developer Membership details 中的 10 位 Team ID。 |
| `TAURI_UPDATER_PUBLIC_KEY` | 与 updater 私钥成对的公钥，会编译进客户端。 |
| `RELEASE_SIGNED` | 可选；设为 `true` 后，`v*` tag push 自动走签名发布，否则 tag 默认无证书发布。 |

Workflow 从导入的 `.p12` 自动识别唯一的 `Developer ID Application: … (TEAMID)` identity，无需配置 `APPLE_SIGNING_IDENTITY`。`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 仅在私钥设置了密码时必填。AI release notes 的 `PACKYCODE_API_KEY` 或 `AI_RELEASE_NOTES_API_KEY` 是可选 Secret；未配置时自动使用 GitHub 生成的 release notes。`AI_RELEASE_NOTES_BASE_URL` 与 `AI_RELEASE_NOTES_MODEL` 是可选 Repository variables，不影响打包与发布。

签名模式下，macOS 包使用 Developer ID 与 Apple 公证，updater 产物使用 Tauri updater 签名；Release Preflight 会在任何平台开始构建前汇总报告缺失配置。无签名模式仍发布普通安装包，但不生成 `latest.json`，避免客户端接收到不可验证的更新。新 Release 先创建为 draft，全部应有资产上传成功后才转为公开状态，不会暴露半成品 Release。

## 桌面产物

| 平台 | Runner | 产物 |
|---|---|---|
| macOS Intel | `macos-15-intel` | DMG；签名模式额外提供 `.app.tar.gz` 与 updater 签名。 |
| macOS Apple Silicon | `macos-14` | DMG；签名模式额外提供 `.app.tar.gz` 与 updater 签名。 |
| Windows x64 | `windows-latest` | MSI、Setup EXE、portable ZIP；签名模式额外提供 updater 签名。 |
| Linux x64 | `ubuntu-latest` | AppImage、DEB、RPM；签名模式额外提供 updater 签名。 |

平台包全部成功后，publish job 上传 GitHub Release；只有签名模式生成 `latest.json`。正式版本号以 `vX.Y.Z` tag/input 为事实来源；`prepare-app-version-from-tag.mjs` 将同一版本注入 Vite、Rust 与 Tauri config overlay。
