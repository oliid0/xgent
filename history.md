# 当前目标与进度

整体目标：self-hosted 自主 Agent、多设备协作及离线交付，仍未完成。用户最新明确要求现在推送、通过构建验证；准备提交当前实现并启动 CI／全平台打包，不发布正式 Release。OAuth 应用注册继续暂缓，不执行本地构建／Cargo／安装，不把检查或构建通过等同于完整自主验收。

## 已完成及证据

- 起始 646 项暂存及后续更改保留。用户最新推送指示后现场确认当前暂存 666 项、无未跟踪路径；仅 .github／Cargo.lock／crates／history.md，参考 ll／本地日志不上传。前检查点在 `.ci-artifacts/autonomy-research/pre-new-project-history.md`；提交范围记录 push-staged-paths.json。
- 既有 GeiserX/tailscale-rs 修复保留：固定 eabd2cf2b810d18881c9cf305000d6f42aacbd19、注册失败退避重建、SDK Axum 原路由／真实对端、LAN 优先、Stronghold 身份及惰性代理。源码依据仍在 geiser-engine/repair-evidence-20261013.json。
- 聊天 RPC 捕获实际 peerId，经已有配对 registry 选择同一物理设备；SSE 补订阅所属流、取消／退休清理、握手和空闲超时、原设备重连及服务器撤销处理。未知写入不重放，发现地址不复制凭据。原生路由对照固定 Axum SSE 源码，尚未编译。
- 复合需求 covered=true 必须引用覆盖原请求所有实质文字／限制，修复漏掉行程或“每晚”仍通过。来源协议 v2 独立保留原用户文字并核对宿主版本；输入映射不充当用户需求，旧任务／v1 路径保留。词句覆盖不是语义或成果验收。
- 新增 o～o (5) 全量清单 1,618 文件。当前正文记录 78 个完整、1 个局部文件，共 17,439 行；新增读完 o (3) attention.ts 120 行和 scheduler.ts 922 行；此前 inbound.ts 186 行及 o (2)/opendots 全部 Python／测试／部署阅读保留。其他目录仅已记录链路，不声称全部 ll 已读完。路径／哈希／区间／未读状态在 `.ci-artifacts/autonomy-research/new-project-{file-index,read-ranges}.json`；具体正文发现见 new-project-reading.md 和 autonomy-review.md。
- 2026-10-14 已实现原请求时间基准：消息保存发送时区，source v2 冻结原发送时间／时区，PC 与手机规划读取同一时钟；旧任务缺失时区保留未知。补齐全部 9 个原生 source 构造点（含此前漏 original_request 的 2 个测试构造点）。163 项相关、110 项兼容回归及 check／lint 通过，原生未编译。
- 只读失败恢复补齐：host 现有只读分类的工具抛出异常时，先保存真实失败回执，允许模型改查其他输入；同 call 不重放。42 项 journal、1 项实际 worker 路径回归通过。写操作未知、回执保存失败和取消仍停止；任意 shell 失败未解除未知效果保护。

- 子任务来源隔离已接入：PC 按实际子任务 brief 规划，root graph／手机分支仍归根任务；native 从原父任务生成来源，网络发送这份实际保存的输入。同机模型子任务只继承 brief／原时钟及既有文件快照；旧子任务保留原输入，规划时只把父图当历史数据。缺失旧时钟不能用子任务接受时间代替。既有已接受计划不静默裁剪；190 项相关／全量 3420 项通过，Rust 未编译。
- 三平台登录后台 OS 失败重启注册已接入现有桌面开关，首次安装不自动启用：Windows 原用户 SID／本安装标记计划任务（255 次／1 分钟）；macOS launchd SuccessfulExit=false；Linux graphical-session.target 用户服务。新注册确认后才撤销旧注册，关闭不终止当前任务，正常退出不重启；下一次登录生效，不接管已运行 GUI。27 项相关通过，Windows 真实只读 CIM 构造核对策略，但未实际注册；Unix／Rust／真实登录重启仍待验收，不是完整独立 headless 宿主。
- 复合任务依赖等待已接入执行核心：原 DAG 的 pending 下游被实际 waiting 前置阻塞时只读投影为等待，独立分支继续；native parking 使用同一状态，不写假证据或改已接受计划，前置验收后下游重新 pending。81 项相关／全量 3427 项通过；“文档→方案→PPT＋行程＋提醒”三阶段恢复用模型／原生状态／文件／设备回执替身，两项新增 Rust 回归未执行，不能当真实成果交付。

健康事件只读分支汇合已接入：source routing v2 冻结指标／区间／数量，实际 SDK 回传与原手机通道／当前 scope／原 intent 匹配后释放下游；写计划、替代查询和重复读取被拒绝。手机不需要模型，完成读取后主模型仍可分块取实际数据；空／有限／截断不能当正常健康或动作成功。最终 230 项联动／全量 3439 项／check／lint 通过，新增两项 Rust 断言未编译。原生 device_observations／source_context／device_planning／proactive_remote、协议入口、TS 类型／validator／路由／工具及回归已修改，证据 health-observation-evidence.json。

原设备规划 broker 已接入：PC 主模型沿原任务／租约发起读取与方案请求，手机按已有权限调用 SDK，持久保存响应后沿私有通道回传、唤醒同一任务。队列／原生回执同事务保存，拒绝无效果、分块分页、新 writer 原 intent 恢复已接，ScopeKey 递归排序避免跨平台 JSON 顺序差异。手机按 planningVersion 切到主模型协同，不要求本机供应商／模型；旧主机保留本地路径，只在原设备 root 分支安装新工具。最终 183 项专项／3436 项全量通过；4 项新增 Rust 核心／提前观察唤醒回归未运行。涉及 store/device_planning、desktop/mobile commands、私有 RPC、journal/waiting、TS 工具／执行器与测试；真实 SDK／模型交付仍待验收。

## 剩余工作

跨设备事件的原 Goal 观察／工作监督已接：原生同事务保存原快照／关联，经原 source context 给 PC；实际接收且原 follow-up 仍有效才推进轮转。原 store／目标 incarnation／本机 outbox 绑定、详情状态／原取消入口／防重、活动／成果分页和下载已接；手动／自动去重，明确取消关联不重现，历史不删除。172 项联动、1 项实际 TS worker 原上下文／checkpoint 回归及 check／lint 通过；新增两项 Rust 回归未编译。新测试首次为空 messages 的无效 fixture 已修正，产品原消息未改。全量非 Cargo 测试运行中（会话 42864，autonomy-goal-events-full-suite.log）。不自动打勾或新增定时器，不代表完整跨设备 Goal 控制完成。

回复时钟小修补继续暂停。PC 规划→手机 SDK 的本地模型依赖已解除，但全示例和主动关注没有真实整链验收。手机原设备执行器仍只在应用可见时运行；手机关机期间不能执行本机 SDK／采集传感器。PC 当前依赖图形应用／后台 WebView，登录失败重启注册不等于独立 headless 服务。

1. 原 Goal 事件观察已接，但当前状态读取／跨设备控制及真实成果驱动的步骤对账仍待完成。继续逐文件阅读 ll 并核对未审阅更改；完成分布式纠正删除／主动关注闭环、持续 Goal 监督、可信失败修复／未知效果对账。后续用户回复的时钟、真实模型理解和日历写入仍待验收；旧任务过宽计划不宣称自动修复。
2. 独立 PC 常驻宿主、手机离线通知、Android Home／外部账户、共享 token／金额／精确 HTTP 预算、部分媒体及大输入路径；完整文档／PPT／行程／健身实际交付与失败恢复验收。
3. 聊天断线事件快照补收、Tailscale 移动端／SDK 原生验证、五 PC 和真机验收。地址切换不等于任务所有权安全转移；Cargo.lock 尚未解析新增 SDK 图。遵守禁止本地 Cargo／构建的约束，原生验证不能用源码断言代替。

## 最新验证（2026-10-14）

- 最新 pnpm test（排除 Cargo）：3439/3439，0 失败／跳过／取消，711 秒；本轮 230 项专项通过。check／lint 退出 0（808 文件），diff／cached diff --check 通过，暂存仍 646 项。架构检查及原生状态／动作协议检查通过（55 kinds／46 properties）。Rust 单测未运行，不能据此宣称原生跨设备执行或五设备交付。
- 最新日志 `.ci-artifacts/autonomy-health-observation-{full-suite,final-focused,final-check,final-lint}.log`；依据／边界在 `.ci-artifacts/autonomy-research/health-observation-evidence.json`。此前 device-planner 3436 项、compound-frontier 3427 项、PC-supervision 3425 项、delegated-source 3420 项及证据保留。此次健康读取修改未改 UI 组件／样式或新增依赖。
- 推送前审查：新增命令的 desktop/mobile 注册与 SDK helper 调用已核对；新增 Tailscale SDK 尚不在 Cargo.lock，现有 CI cargo check 不带 --locked，允许实际解析并上传锁文件，故不是已证实的锁文件必败。SDK 固定版本 Cargo.toml 已由 GitHub MCP 读取，实际跨平台依赖解析／编译仍未知。GitHub MCP 确认最近发布 37772901600（2026-10-08，旧 HEAD）失败在 macOS／iOS smoke；其包构建步骤成功，但不能用于证明当前 646 项暂存＋后续改动可打包。
- 对照旧失败日志：macOS 的 provider-editor-cancel 与 iOS 的 cancel 点击不可达，当前暂存区已经分别修改桌面 footer 和终端动作布局，本轮保留，不重复修补，也不宣称真机已通过。已修复仍存在的 CI 二次失败：ci.yml／desktop-release.yml 导出 xcresult 前要求 Info.plist 文件存在，避免中断留下空目录时再次失败；原 smoke 失败依然会阻止发布，不放宽验收。修补后相关 pnpm test:release 41/41、check／lint 退出 0（808 文件），diff 检查通过；日志 autonomy-prepush-{release-test,check,lint}.log。
- Rust／Swift／Kotlin、SDK 锁文件、配置模型、手机关机和真实成果交付未验证。参考项目测试只读源码，未运行；CI/release 未触发，整体目标 active。
