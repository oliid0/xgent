# 本地访问、移动端与云端执行架构

## 产品边界

XAgent 只有一份 React 前端（`crates/fronted`）。桌面、配对浏览器、Android 与 iOS 使用同一套页面、对话逻辑、工具注册和设置模型；平台差异只存在于 `src/runtime`、Tauri 命令和 `crates/mobile-execution`。

桌面 Tauri 宿主持有 SQLite、模型凭据、MCP 进程、Skills 和完整电脑能力。独立网关、Remote 设置、公网隧道与公开历史分享不属于当前架构。

## `28367` WebUI

WebUI 默认关闭。用户开启后，`LocalAccessController` 绑定 LAN 或 loopback 地址，并通过 Tauri asset resolver 提供当前打包版本的 React 静态资源。

浏览器运行时使用：

- `POST /api/local-access/pair`：短时六位配对码换取 HttpOnly 设备会话；
- `POST /api/local-access/session`：刷新 CSRF 并验证会话；
- `POST /api/local-access/rpc`：经过命令 allowlist 与权限开关后调用桌面 Tauri 命令；
- `GET /api/local-access/events`：SSE 事件流；
- `/api/local-access/subscriptions`：订阅经过 allowlist 的 Tauri 事件；
- `/api/local-access/proxy/<provider>`：在不暴露 API key 的前提下访问模型服务。

`localAccessHostBridge.ts` 只执行 Rust 已经认证、授权的请求。Rust 生成请求 ID 并等待桥接结果，浏览器不能绕过命令 allowlist。

设置、Provider key 与 SSH secret 使用专用脱敏投影。浏览器写回设置时，原生端会把占位值合并回本地真实密钥，绝不把占位符当成新凭据落盘。

## 权限

基础历史、Memory、MCP、只读文件与安全事件可以在配对后使用。以下能力独立受设置控制：

- 终端、Shell、ManagedProcess 与自动化执行；
- SSH 与 SFTP；
- Git 写操作；
- 文件写入；
- 云端任务与 artifact 下载。

Host、Origin、Referer/Fetch-Site、会话 Cookie 和 CSRF 同时参与校验。普通 HTTP 不提供链路加密，因此 LAN 模式只适合可信网络。

## 执行后端

Agent 从统一能力清单中选择一个执行后端：

1. 桌面本地：完整文件、Shell、Git、MCP 与应用能力。
2. 配对桌面：浏览器/手机通过 LAN 使用桌面宿主能力。
3. Android PRoot：可选 Alpine rootfs 与按需能力包。
4. iOS a-Shell：基于 a-Shell/ios_system 的有限 Unix 命令与 WebAssembly 扩展。
5. GitHub Actions：明确启用后的跨平台和大型工具链后端。

移动端没有安装基础环境时不得假装具备完整 Linux；工具能力由插件库存动态上报。安装、取消、输出和 artifact 路径使用类型化命令，不通过拼接 Shell 模拟。

## 云端任务协议

GitHub PAT 保存在 Tauri Stronghold 保险库中，不进入 SQLite、React state、日志、聊天记录、task 文件或 workflow。默认目标是用户自有的公开 `agent-temp`：

- 仓库不存在时创建；存在时验证 marker、所有者与 public 可见性；
- 每次执行生成新的不可变 `tasks/<task-id>`；
- 任务脚本、输入和托管 workflow 通过 Git Data API 原子提交；
- Linux/macOS 使用 Bash，Windows 使用 PowerShell；
- 所有返回文件必须写入 `../output`；
- XAgent 轮询对应 workflow run，失败时提供裁剪后的日志，成功时流式下载 artifact 到临时文件后原子改名；
- 重试创建新 task，不修改失败 task。

公开仓库中的任务源码与输入对任何人可见。运行时凭据通过仓库 Actions Variable/Secret `XAGENT_CLOUD_ENV` 注入，格式为每行一个 `NAME=value`，Secret 覆盖 Variable。
