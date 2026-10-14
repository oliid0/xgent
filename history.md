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
- 核对官方 argon2 stable／RC、ssh-key／russh manifests 和 Cargo update 文档。CI 增加定向 cargo update -p argon2 --precise 0.6.0，在 runner 解析，由已有 artifact 保存真实锁文件；不手编依赖图、不盲目升级 SSH API。待 resolver 确认其他约束后领取并提交真实 Cargo.lock，全平台复验。
- xcresult 四处导出要求 Info.plist，保留原 Apple smoke 门槛；旧 provider/cancel 布局修复仍需新 smoke 验证。

## 最新验证

- pnpm test（排除 Cargo）3444/3444，0 失败／跳过／取消，802836.4692ms，会话 42864 已退出 0；日志 autonomy-goal-events-full-suite.log。check／lint 退出 0（808 文件）、architecture／native protocol／diff 通过，55 kinds／46 properties。
- source 新测试初次无消息 fixture 已修正并通过，不改产品消息；SQL hash fixture／旧查询前缀断言已修正。证据 goal-event-evidence.json，旧 health／planner／compound 日志保留；不将这些当作打包成功。
- 当前修改只有 CI 定向解析及本记录；相关 release workflow 回归即将复验，随后提交推送。无本地构建／Cargo／安装。

## 整体剩余

1. 原目标实时远程读取／控制与真实成果步骤对账、分布式记忆纠正删除、完整主动关注／打扰控制与持续交付真实验收。
2. 独立 PC headless 宿主、手机离线通知、所有权安全迁移、Tailscale 移动端／五 PC 真机；手机关机不能采集或执行本机 SDK。
3. Android Home／外部账户、共享 token／金额／精确 HTTP 预算、部分媒体／大输入；文档→方案→真实 PPT／DOCX＋明日行程＋每晚健身实际模型／SDK／产物验收。

目标 active；继续处理构建失败，不宣称完整自主智能已完成。
