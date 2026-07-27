# 发布与运行

## GitHub Release

`.github/workflows/desktop-release.yml` 支持 `v*` tag 和手动触发，并构建五个平台：

| Job | Runner | 主要产物 |
|---|---|---|
| macOS | Intel + Apple Silicon runner | 两种架构 DMG；签名模式附 updater 产物 |
| Windows | `windows-latest` | MSI、安装 EXE、便携 ZIP |
| Linux | `ubuntu-latest` | AppImage、DEB、RPM |
| Android | `ubuntu-latest` | 可安装的 universal APK、PRoot 对应源码 |
| iOS | `macos-15` | arm64 未签名 IPA |

Tag push 默认发布 GitHub Release。手动运行可只构建 Actions artifacts，也可以选择发布。所有平台 job 成功后 publish job 才公开 Release，避免发布半成品。

未配置 Apple 证书时，macOS 使用 ad-hoc/无公证包；用户仍可通过 Finder 的“打开”或系统“隐私与安全性”授权运行。未签名 IPA 必须使用 Apple Developer 身份或兼容侧载工具重新签名。

Android 未配置仓库签名 Secret 时使用临时 CI keystore，因此 APK 可安装但不能保证后续版本直接覆盖更新。正式持续更新需要同时配置：

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_PASSWORD`

macOS 签名与公证配置见 [macos-release-signing.md](macos-release-signing.md)。

## 本地 WebUI

WebUI 不需要部署服务器或容器。桌面客户端在用户明确开启后，通过内置 Axum 服务在 `28367` 端口提供同一份 React 应用。

1. 在桌面端设置中开启 WebUI。
2. 选择 LAN 或 loopback 范围。
3. 生成六位配对码。
4. 在其他设备打开界面显示的 URL 并完成配对。

桌面端必须保持运行。普通 HTTP 仅适合可信局域网；会话可撤销，终端、SSH、Git 和文件写入分别受权限开关控制。

## 云端任务

云端执行使用用户自有公开 `agent-temp` 仓库。XAgent 原子写入一个不可变任务目录和统一 workflow，触发后等待 run，成功时下载 Actions artifact，失败时返回经过裁剪的失败日志。

任务源码和输入在公开仓库中可读。敏感运行时值应配置在仓库 **Settings → Secrets and variables → Actions** 的 `XAGENT_CLOUD_ENV` 中，每行一个 `NAME=value`；Secret 覆盖同名 Variable。GitHub PAT 本身不得进入 workflow。
