# 当前目标与进度

整体目标：self-hosted 自主 Agent、多设备协作、持续主动关注及离线交付，仍未完成。用户最新授权现在推送构建。OAuth 注册暂缓；禁止本地 build／Cargo／安装继续遵守，原生验证在 Actions 执行。

## 已完成

- 666 个文件已提交推送 main：02486c7cd56883cdd19fa803f60c602e92a30f6d。参考 ll／本地日志未上传；起始 646 项和后续更改保留，提交路径见 push-staged-paths.json。此前检查点在 autonomy-review.md 和 `.ci-artifacts/autonomy-research/pre-new-project-history.md`。
- 已接实际 peer 聊天 RPC／SSE 恢复、原请求时间与时区、子任务独立需求、原 DAG 依赖等待、只读失败恢复、OS 登录失败重启开关、原手机规划 broker 与健康只读 SDK 汇合；均有专项回归，TS／SQL 替身不证明原生／真机成功。
- 原 Goal 事件观察／监督已接：同事务冻结原快照及关联、原 store／incarnation／outbox 绑定、实际接收轮转、原工作状态／取消／防重、活动成果分页与下载。去重及取消关联 tombstone，历史保留，不自动打勾或取消独立任务。172 项联动＋1 项实际 TS worker／checkpoint 回归通过，两项新增 Rust 测试未运行。涉及 goals.sql／store.rs／goal_event_context／goal_prompt／goal_launch／goals／proactive_remote 及测试；证据 goal-event-evidence.json。
- 新增 o～o (5) 清单 1,618 文件；正文完整 78＋局部 1／17,439 行，未声称全部 ll 已读完。另读完 ll/1 (5)/shared/goal-followup.ts 59 行；GitHub MCP 读取 checkpoint 元数据及固定 SDK／russh manifest，保留阅读边界。

## 当前构建阻断与修复

- CI 38584005371、打包 38584053181 针对 02486c7c，publish=false／sign=false／smoke=true，v0.1.0-autonomy.1，没有正式 Release。
- 真实日志证实统一解析阻断：GeiserX SDK eabd2cf2 要求 argon2 ^0.6，SSH lock 为 0.6.0-rc.8。CI／Android／Linux／Windows／macOS Apple Silicon 日志均同因，尚未进入应用 Rust 编译；其余 Apple 作业持续观察。旧“锁文件非已证实必败”结论被新日志替代。
- d2eb8bc5 已推送，CI 38585347036 的定向 argon2 更新成功，Rust 已进入编译；等待 artifact 领取真实 Cargo.lock，不手编依赖图，未升级 SSH API。核对官方 manifests／Cargo update 文档，锁更新由 runner 执行。
- Apple 原生编译另证实 PresentationDesktopContent.swift:182 跨文件读取 private palette。已改用现有 presentationTheme.palette(for: colorScheme)，相同环境／颜色，无样式或组件更改；相关原生契约回归即将复验，Swift 编译由下一轮 CI 验证。
- CI 实际原生编译报告 lib 158／含测试 173 错误。领取并核对 runner Cargo.lock ZIP digest b11bf964a49e05a10c6378575effaaf02149aec4ca31de7296b34eb1011cca3a，唯一成员 Cargo.lock 原样导入。按已发布 crate 源码启用 rusqlite fallible_uint、reqwest form／query，新增 hex 0.4.3，替换 31 文件的 53 处实际 SHA-256 十六进制调用，保持算法／字节／大小写；修正 AppImage OsString→PathBuf、CronApplyResponse.cron.tasks、测试连接可见范围及 receipt 借用。投递／peer 探测使用 owned Send boxed futures，保留 2／2／4 并发及 LAN 优先。418 项后端非 Cargo、17 项原生界面及原生协议通过；即将提交推送并全平台复验，未宣称 Rust 编译通过。
- xcresult 四处导出要求 Info.plist，保留原 Apple smoke 门槛；旧 provider/cancel 布局修复仍需新 smoke 验证。
- 942ba8ff 已推送，CI 38587660615／打包 38587677744。Swift device 静态库已成功；Rust 前述兼容错误消除，剩余 33 条均来自 worker_inventory.observe 的同一 Stream map FnOnce 生命周期。已按同一 owned boxed Send 路径改为先收集探测 future 再并发，保留原 4 并发、工具清单／政策／超时／缓存。相关路由回归随后验证，继续领取该轮最终锁文件再提交推送。
- 工具链／模型路由 22 项通过。领取 942ba8ff 的完整锁 artifact 11906695814，ZIP SHA-256 a4a0f31fd062789bfca2c41a2f43683bf877ea97f8ab31d88133f2feeeed0037，确认含实际 SDK 和直接 hex 依赖后原样导入；移除已经完成使命的临时 CI cargo update 步骤，后续直接从真实锁文件构建。即将提交这三处及本记录并复验。

## 最新验证

- pnpm test（排除 Cargo）3444/3444，0 失败／跳过／取消，802836.4692ms，会话 42864 已退出 0；日志 autonomy-goal-events-full-suite.log。check／lint 退出 0（808 文件）、architecture／native protocol／diff 通过，55 kinds／46 properties。
- source 新测试初次无消息 fixture 已修正并通过，不改产品消息；SQL hash fixture／旧查询前缀断言已修正。证据 goal-event-evidence.json，旧 health／planner／compound 日志保留；不将这些当作打包成功。
- 当前修改只有 CI 定向解析及本记录；相关 release workflow 回归即将复验，随后提交推送。无本地构建／Cargo／安装。

## 整体剩余

1. 原目标实时远程读取／控制与真实成果步骤对账、分布式记忆纠正删除、完整主动关注／打扰控制与持续交付真实验收。
2. 独立 PC headless 宿主、手机离线通知、所有权安全迁移、Tailscale 移动端／五 PC 真机；手机关机不能采集或执行本机 SDK。
3. Android Home／外部账户、共享 token／金额／精确 HTTP 预算、部分媒体／大输入；文档→方案→真实 PPT／DOCX＋明日行程＋每晚健身实际模型／SDK／产物验收。

目标 active；继续处理构建失败，不宣称完整自主智能已完成。
