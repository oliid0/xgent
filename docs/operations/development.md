# 开发与验证

## 目录

| 路径 | 职责 |
|---|---|
| `crates/fronted/src` | Web、桌面、Android、iOS 共用的 React 源码 |
| `crates/fronted/src/runtime` | Tauri 与配对浏览器的运行时边界 |
| `crates/fronted/src-tauri` | Rust 命令、SQLite、工具、WebUI 与云端执行服务 |
| `crates/mobile-execution` | Android PRoot 与 iOS a-Shell Tauri 插件 |
| `scripts/mobile` | CI 中准备经过固定版本校验的移动端资源 |
| `.github/workflows` | CI 与五平台 Release |

## 常用命令

| 命令 | 作用 |
|---|---|
| `make dev` | 启动 Tauri 开发模式 |
| `make dev-web` | 从同一份源码启动 Web 开发模式 |
| `make build` | 构建桌面应用 |
| `make web` | 构建 Web 静态资源 |
| `make desktop-build-windows` | 构建 Windows 桌面包 |
| `make desktop-build-linux` | 构建 Linux 桌面包 |
| `make desktop-build-macos` | 构建当前 macOS 架构 |

本项目的权威验证环境是 GitHub Actions。不要为了本地验证安装或修改系统级 Go、Rust、Node、Android、Xcode 环境；提交后由 workflow 执行依赖安装、检查和打包。

## CI 门禁

`.github/workflows/ci.yml` 负责：

- 校验 Actions workflow；
- 检查单前端与无独立网关边界；
- 安装锁定版本的前端依赖并执行类型检查、Lint 和测试；
- 检查 Rust workspace、SQLite 迁移与格式；
- 验证 release 脚本和工作区无意外生成差异。

移动端本地运行资源不提交生成物。PRoot、Alpine rootfs、a-Shell 资源和第三方声明由 `scripts/mobile` 在 Actions runner 中从固定版本准备，并由 Release workflow 检查产物内容。

## 架构约束

- 不创建第二份 React 页面树。
- 不恢复独立 Go 网关、Remote 设置、公网隧道或公开历史分享。
- 浏览器访问只走桌面端内置的 `28367` WebUI。
- 平台差异放在运行时边界、Tauri 命令或 `crates/mobile-execution` 中。
- GitHub PAT 只进入原生加密保险库，不进入设置 JSON、日志、任务源码或 workflow。
