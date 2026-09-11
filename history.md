# 当前目标（未完成）

Apple 使用真正的 SwiftUI；Android/Windows/Linux/Web 保留 Astryx，默认增加约 10% 磨砂通透感。共享全部业务，完成布局/组件生成映射、移动端模型/工具/设置/系统权限与可选 Shell 的实际可用性，最终验证后仅推送一次并跟踪 GitHub CI。

## 工作区进度

- 继续补充无 Shell 行为测试：挂起的环境探测不阻塞工具目录、实际 List/MCP 调用；已安装/失败/乱序响应/重装和桌面及 LAN 回归。测试使用模拟 IPC，不代表设备端已验证；待运行本轮检查。
- 本轮类型检查通过；lint 发现先前新增代码的五处格式问题，已用 Biome 对对应文件修正。非 Cargo 测试进程仍在运行，尚未记录结果。
- 用户确认最新构建无 Shell 无法工作且安装出现“vaild”。本轮优先继续移动可用性：核对 yy 的直接 FileManager 文件工具及当前调用链；发现移动工具目录无条件暴露 Bash，现改为仅已验证可用时提供，其他原生/网络工具保持独立。Shell 状态后台读取不阻塞模型发送；安装期间撤销旧能力，补充无 Shell 模型指令。验证待执行。
- Tauri 2.11.5 官方 mobile.rs 证实 run_mobile_plugin 使用同步 recv；当前 async 插件命令直接调用它会占用模型代理共用的 executor。mobile-execution 的八个 IPC 命令现通过 spawn_blocking 等待，保留后端同步 API；未运行原生编译。
- 安装页面补充中英文的无 Shell 能力与 Android/iOS 资源来源；iOS 状态/安装前列出实际缺失资源，修正 unavailable 时仍显示“环境可用”的错误说明。GitHub latest release MCP 返回 404，不能据此确认是否发布了可下载包，尚未推送。
- 本轮核实移动端设置读取 2.5 秒超时会永久丢弃迟到的成功响应；改为慢加载提示并保留原始读取，组件卸载后忽略结果，服务状态变化不再取消/重启读取。加载失败时禁止以默认设置写回并返回错误，重新读取成功后恢复保存。新增 hydration 控制器及迟到成功/真实错误/卸载/快速读取四项行为回归测试，全部通过。
- 工作区已有移动存储初始化修复：在 setup 同步确定沙盒根目录后才启动后台可选服务，移动端未初始化时不回退桌面路径；本轮保留此改动，尚未进行原生编译。
- 已核对 Shell 资源准备、设备安装和工具注册代码；mobile-execution/README.md 补充打包前依赖/设备安装边界。Android 基础资源来自 APK，iOS 框架需打包时链接；未发现可仅靠前端修改证明设备安装成功的依据，仍需设备日志与原生验证。
- 已查看 yy 原生参考与用户列出的 19 张截图，完成 Astryx MCP search/get 和 CLI manifest/build/docs/component 发现；依据安装的 Astryx 0.5.4、Tauri 2.11.5 源码及 Apple 官方文档实施。
- 默认主题通过 neutralTheme → glassTheme → xgentTheme 扩展；使用正式 localTokens 命名空间，90% 不透明表面配合 backdrop blur，减少透明度/高对比度/强制颜色退回实色。默认跟随系统，保留显式浅色/深色选择。
- 新增 SwiftUI 宿主、原生控件渲染、Rust 双向通道及 16 种原语声明生成器；尚未编译或启用 Apple 默认入口。
- 原生动作按 surface 校验、禁用与去重；进行中的请求不会被已完成记录挤掉。每个 surface 单次发送、合并流式快照；补充系统错误 Alert、关闭动作确认、乐观输入回写及草稿引用保留。
- NativeChatPage 仍为未接入的适配稿；useConfirmDialog 原生分支仅在 SwiftUI 标记启用后生效。

## 验证（2026-09-11）

- 最新批次：pnpm test:non-native 1167/1167 通过（112.7 秒），包括无 Shell 挂起探测期间 List/MCP 的实际前端分发；pnpm check 通过；lint 五处格式修正后通过。用户明确授权“推送这一批修改我实际测试”，因此本批按实机测试版本提交/推送，不代表完整目标完成。CI/测试包工作流待推送后触发跟踪。
- 本轮 pnpm test:non-native：1164/1164 通过（104.8 秒），Cargo 套件按脚本过滤；包含生成一致性、主题解析和新增设置读取行为测试。日志：系统临时目录 xgent-mobile-tests.log。
- 本轮 pnpm check、pnpm lint 均一次通过；lint 检查 542 个文件。git diff --check 通过。未运行 build/dev/Cargo，未提交 Git commit、未推送、未触发 CI。
- 尚无 SwiftUI SDK 编译、Apple 真机/模拟器或最终宽窄布局与交互验证；本地检查不能证明这些项目完成。

## 下一步 / 剩余

1. 完成自动 Astryx JSX 布局转换和实际使用的复合组件/props 覆盖。当前生成器只有原语声明，不能称为完整页面转换。
2. 接通 ChatPage/App 的共享状态；补齐设置、配对、项目、历史搜索与修改、附件原生选择/预览、工具/终端、审批、通知及启动/错误界面，然后按实际 Apple 编译目标切换入口。
3. 原生生命周期仍需处理 WebView 整页重载、输入值经业务规范化后的回写、焦点与选择、流式滚动；检查当前 iOS 最低版本 16 的 API 依据。不得把试验适配页视为全部功能完成。
4. 完成平台编译、系统字体/深色/VoiceOver/减少动态效果/透明度及视觉交互验证。本批按用户最新授权先推送用于实际测试；完整目标依然未完成，不得把本批推送当作原生迁移完成。
5. 移动端仍需端到端验证模型发送/流式展示、无 Shell 文件/Skill/网络 MCP、设置保存、系统权限与助手动作，以及 Shell 安装/执行。当前未检测到 adb/Apple SDK 命令；已异步请求手机安装包版本/来源和发送/安装的第一条错误原文。未获得设备证据前不得宣称移动端已可用。

涉及文件：src/presentation、src/runtime/applePresentation.ts、src/theme、src/index.css、settings/index.ts、i18n/config.ts、useConfirmDialog.tsx；src-tauri/native/apple-ui、commands/app/apple_ui.rs、lib.rs、services/app_paths.rs、build.rs、iOS 配置；presentation/astryx-swiftui.json 与 README、scripts/generate-native-ui.mjs、package.json、test/presentation、mobile-reference-ui.test.mjs；本轮新增 App.tsx、settings/hydration.ts、test/settings/settings-hydration.test.mjs、mobile-execution/README.md。history.md 当前被仓库忽略，最终提交时需显式纳入。
