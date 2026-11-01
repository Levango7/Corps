# corps 项目路线图 · 2026Q4（2026-10-03 制定，同日按用户方向修订）

> 制定依据：2026-10-03 全仓体检 + 当日收口批次（default-deny / MemberPermission /
> 合规文案 / 5 个 Actions PR / burn-down 表均已合入 main）。
> **用户拍板的方向（2026-10-03）**：暂不找真实团队试点——**先把产品打磨成熟，
> 再小范围试用，再推广。** 本路线图按此组织。
> 原则：以可验证的产出物为准，不以"做了多少东西"为准。

---

## 0. 当前状态快照（2026-10-25 实测 · 第二批交付后）

| 项 | 状态 |
|---|---|
| **成熟度评分** | **综合 9.04（Gold，第二批对账口径 8.47 → 9.04）；10-25 晚本机实跑 9.20（其中 2 项因本机环境 SKIP 不计入）—— 档位 Bronze → Silver → Gold**<br>可复现评分器：`scripts/score_maturity.py`；对账报告：`docs/audit/MATURITY-2026Q4-BATCH1.md` / `MATURITY-2026Q4-BATCH2.md` |
| 第一批四项交付 | **全部落地**：①正式部署能力（`deploy/` 从无到有 + `deploy.sh` 五修经 PR #161 合入）②协同孤儿摘除 ③401/403 语义统一 + shellcheck 门禁 ④TS6/Prisma7/Stripe22 三个 major 升级 |
| 第二批四处缺口 | **全部关闭**（BATCH2）：`.gitignore` 收紧为 `.env*` + `!.env.example`；`db/schema.sql` 追平最新迁移并新增快照陈旧门禁；RED-Errors 按路由接通（Rate/Duration 未接且未假装接）；OpenAPI 自述漂移修正（声明数 = 实测数） |
| CI | 12 job 全绿；写权限 default-deny + MemberPermission 覆盖已上线并有单测/门禁钉住 |
| 部署 | `deploy/` 一键脚本 + 回滚脚本 + 部署包真跑验证（PASS=11 FAIL=0）；正式实例仍为 **0**；定时 Smoke 目标已从临时隧道切至 Vercel 实例（2026-10-25 连续 success，库曾一度 down 后自愈，疑免费档冷启动待定论） |
| 合规 | 隐私政策已披露 AI 子处理方与跨境传输；支付口径对齐事实（官方实例仅 Stripe） |
| 供应链 | 三个 major 已升级（TS 6.0.3 / Prisma 7.10.1 / Stripe 22.6.2），原 issue #32 已关闭；v0.8.2 修复容器镜像源单点（`ARG NODE_IMAGE` 回 Docker Hub） |
| 质量基线 | 零覆盖 **455**（10-03 为 643，−188；10-29 清算波达 90 天目标，同日 lib 域 b1 再清 11 个文件；10-30/11-01 lib 域 b2–b11 + components 线 c1–c8 共清 88 个文件）/ T3 **54**（10-29 AI 域收敛批 134→94；10-30 收敛批 A 94→69、批 B 69→54，两批均「member=crud 与 choke point 逐条等价」零运行时变化）/ 契约未声明 **0**（10-30 九批共 154 条 + #204 的 16 条 = 170→0 全部清偿，覆盖率 100%、openapi 288 paths；**基线已空，新增路由必须当场入契约**；另有悬空 $ref 守门 check_openapi_refs.py 入 CI）——burn-down 计划见 §2 |
| **已知短板**（非退步，存量欠账） | **API 层**：契约覆盖率 **100%**（10-30 清零，40.8%→100%，目标 60% 大幅超额），`tests/api` 路由级测试 **22/20**（对方会话并行扩充后已超额）；**RED-Rate/Duration** 全量接线完成（2026-10-29：第十一批补齐 uid 面 v1 域 / cron / share / uploads / health 等收尾域并含 `/api/metrics` 自身，448 / 448 个 handler；达标线自 #191 起即「全量」、由 `score_maturity` 运行时计算）；**SLO/SLI 内部口径文档 1 份**（`docs/SLI-internal-definition.md`，只定义 SLI 与盲区，正式实例前按负面清单不做对外 SLO 承诺）；渗透测试三件套停留在 2026-08-27，未覆盖十月新增暴露面 |
| 用户 | 0。打磨期的验收标准由本图定义，不以外部用户数据为准 |

---

## 1. 十月：成熟度冲刺（打磨到"自己愿意天天用"）

### 1.1 自用吃狗粮（最高优先）

把自己的日常工作放进 corps 管一周，记录所有"不顺手"的清单（卡顿、跳转多、
术语不一致、AI 结果不可用、文档协同断线……）。**自用发现的痛点 = 打磨的 backlog，
比任何外部反馈都便宜。**

已知的功能性缺口（体检实测确认，都是"做成熟"的必做项）：

- ~~**文档实时协同服务端从未部署**：……收编它或明确降级，二选一。~~
  **已决策（2026-10-04，ADR-012）**：降级为"本地编辑 + 版本历史"，`server/collab/`
  保留但不收编——该 WS 服务端零鉴权，先收编等于用一个卖点换 P0 跨租户漏洞。
  收编前置条件（含令牌鉴权）见 ADR-012 末节；本条不再作为待办。
- ~~401/403 语义统一（choke point 拒绝走 401）——需要统一错误出口设计。~~
  **已完成（2026-10-30 对树核对）**：统一出口 = `web/lib/auth-response.ts` 的 `authFailure()`
  （`DenialReason → 401/403` 一一对应：`unauthenticated`→401，`workspace_mismatch` /
  `not_a_member` / `write_policy`→403）；`web/app` 下 **239** 个文件走
  `getWorkspaceContextV2`（拒绝带 `status:403, reason:"write_policy"`），旧 V1
  `getWorkspaceContext` 的 `null→401` 路径 **0 个生产调用点**（仅存定义与注释），
  该历史权衡不再有实际影响。
- ~~lint 的 40 条 warning 清零（React hooks 依赖缺失等）。~~
  **已完成（2026-10-07 实测；2026-10-30 复测）**：CI Lint job 以
  `npx eslint . --max-warnings 0` 关死闸门（error/warning 都判红）；全仓 1029 文件
  实测 **0 error / 0 warning**，新增 warning 只能真修或写带理由的 disable。

### 1.2 体验打磨清单（每次自用后更新）

- 核心三场景走通无断点：任务看板、决策记录（讨论→固化→回链）、任务内轻沟通
- **整合（方向已定：不做减法）**：第一层已落地——侧栏 28 项归 5 组 + Cmd+K 全功能
  直达；第二层按自用痛点排队（AI 五页并一、通知中心、会议-日历-纪要贯通、
  任务面包屑链），见 `docs/design/INFORMATION-ARCHITECTURE-2026Q4.md`
- 中英双语在真实使用里过一遍（3841 词条逐域抽查）

### 1.3 正式部署（试用与推广的前置条件）

试用需要一个别人能访问的实例。**VPS 采购清单（替你把决策做完，照着买即可）**：

| 项 | 推荐 | 价位 | 说明 |
|---|---|---|---|
| 云服务器 | 腾讯云/阿里云 **轻量应用服务器 2C4G** | 约 100–200 元/年（活动价） | "VPS"就是租一台云上的服务器，国内一般叫云服务器/ECS/CVM；2C4G 跑 compose 全栈（app+PG+Redis）足够 |
| 域名 | 一个 .com 或 .cn | 约 30–60 元/年 | 备案要求域名实名 |
| ICP 备案 | **个人备案**（不需要公司） | 免费，约 2–4 周 | 国内服务器对外提供网站服务必须备案；个人可办，备案期间实例先内部/隧道过渡 |
| HTTPS | Caddy 或 Nginx + Let's Encrypt | 免费 | compose 前加一层反代 |

一次性动作：买服务器 → 提备案 → 备案期间继续打磨 → 批下来部署 compose →
`gh variable set SMOKE_TARGET_URL` 指向正式域名 → README 回填 URL。
**注意**：在正式实例上线前，本机临时隧道 + cloudflared 进程需保持存活，否则
每 15 分钟 Smoke 报红；且临时隧道域名（`trycloudflare.com` 等）会被 `config-check`
直接判红为配置缺陷——监控目标必须是固定域名。撑不到那天就先
`gh variable delete SMOKE_TARGET_URL`，此时工作流在所有触发上统一判红
（这是"当前没有线上监控"的诚实信号），嫌每 15 分钟一封邮件吵就
`gh workflow disable smoke.yml` 关掉 schedule。

### 1.4 shadow 灰度（部署后立即）

`WRITE_POLICY_MODE=shadow` 跑一轮真实流量，看 `[write-policy] shadow-deny`
日志有没有意料之外的路径，无误杀再切 enforce。

---

## 2. 质量基线 burn-down（90 天，2026-12-31 验收）

> 门禁现状是"只防变坏"。本表给每条基线一个变好承诺，每周固定一个清偿提交。

| 基线 | 当前（2026-10-12） | 90 天目标 | 每周节奏 |
|---|---|---|---|
| `zero-coverage-baseline.txt` | 455 | **550** | 每周清 ≥8 个文件；优先 permissions/orchestrator/payments/im（10-29 清算波 592→550，提前达成 90 天目标；10-29 lib 域 b1：11 个 lib 文件补 207 例单测，550→539；10-30 lib 域 b2：7 个 lib 文件补 52 例单测——csv-export/default-layouts/dashboard-layout-helpers/favorites/livekit-utils/i18n-routing/webrtc-remote-control-events，539→532，同时把「12 列网格布局项不重叠」的用户反馈回归钉进 default-layouts 测试；同日 lib 域 b3：web-push/calendar-oauth/uploads-cleanup/ai-stream 4 文件补 35 例（VAPID 410-Gone 判定与惰性配置、OAuth PKCE/续期/撤销错误面、附件清理「被引用绝不删/不确定一律保留」双红线、AI 三阶段进度时序），532→528；同日 lib 域 b4：workspace-events/analytics-server/shutdown/mail-transporter 4 文件补 25 例（事件总线隔离与幂等退订、埋点终态签名与失败必记日志、优雅关闭只注册 SIGTERM/SIGINT 且幂等+超时兜底、credential AES-GCM 往返与 nodemailer 即用即关），528→524；同日 lib 域 b5：google-client/outlook-client/usage-middleware/behavior-tracker 4 文件补 31 例（全天事件「end 排他次日」与 UTC 归一、多提醒取最早、删除 404 幂等、配额断言先于模型调用、行为聚合接受率分母与未知 action 边界），524→520；同日 lib 域 b6：calendar-reconcile/workflow-triggers/ai-push-runner 3 文件补 25 例（对账三阶段「error 重置/过期只告警/孤儿映射清理」与单条失败不炸批、事件触发器匹配与「不向调用方抛」、safeSlice 代理对截断与 LLM 输出防御性解析），520→517；同日 lib 域 b7：sync/offline-cache/use-long-press 2 文件补 26 例（IndexedDB 缓存 SSR 退化/TTL 过期即删/LWW 冲突解决三分支，最小内存 IDB fake；长按手势的取消路径/重置计时/卸载清计时器/contextmenu 等效），517→515；同日 lib 域 b8：push/unified、webrtc/signaling、ai/assistant/orchestrator 3 文件补 40 例（三平台推送的未配置静默跳过/FCM 200-含-error/APNs ES256 JWT/华为两步 code 非 0、信令客户端幂等连接与指数退避重连、助理能力表与阶段流程四分支），515→512；同日 lib 域 b9：workflow/executor、webrtc/peer-connection 2 文件补 24 例（执行引擎状态机/跨租户防御/单动作失败即止/取消检查/占位符解析/成员校验/updateMany 限定工作区，并注记「cancelled 被终态覆写为 completed」的既有行为（**已修：cancelled 作为终态不再被终态判定覆写**）；远程控制输入事件四类形状与 button 映射），512→510；同日 lib 域 b10：im/ws-server 补 18 例（**并顺带把 im/types 带出零覆盖**）——单用户连接上限 5（第 6 条 close 1008，auth 路径同判）、认证闸门（认证前只放行 auth）、订阅三重防护（成员资格 + 跨工作区隔离 + 无绑定拒绝）、广播排除本人与跳过非 OPEN、onerror 30s 兜底清理；如实注记一处缺口：单连接用户断开时 presence offline 实际发不出去（broadcastPresence 依赖的表在调用前已清空）**（已修：断开时先快照会话集作为广播种子）**，510→508；同日 lib 域 b11（终章）：calendar/sync、account-deletion 2 文件补 32 例（四落点同步/debounce 时钟回拨/S5 刷新并发锁/S4 外部事件补偿删除与 syncError 脱敏截断/重试退避/断开清理；账户删除预览分类与分批化删除——撤销 token 尽力而为/单租户失败不卡死/S-03 残留强制清理），508→506；同日 **components 线试点波 c1**：ai/ProgressSteps、task/ConfirmDialog 两个组件补 16 例（阶段图标语义/动画无障碍/当前消息归属；弹窗文案两级覆盖/确认顺序/遮罩/删除中禁用与 Escape/焦点移入恢复与 Tab 环），506→504；同日 c2：DueTag/TaskLabels/ViewToggle(+Client)/LanguageSwitcherClient 4 组件补 19 例（到期色调三档与 inline/block 形态、标签溢出 +N 与 color-mix 染色、视图切换 aria-pressed 与回调、语言切换 aria-current 与 router.replace 语义），504→499；同日 c3：dashboard/widgets/WidgetStates（含 WidgetError）、web-vitals-reporter 3 文件补 11 例（骨架行数/宽度错落/aria-busy、WidgetEmpty 图标文案、WidgetError 条件 message 与重试回调、vitals dev 详细 vs prod 简洁格式），499→496；同日 c4：files/previews 家族 9 文件（Audio/Video/Markdown/Pdf/Office/Code/Image + 旧位置 Pdf/Video 两处）补 11 例（原生媒体元素与 controls、Office 降级提示+下载、代码行号 aria-hidden 与 data-language、图片加载态与滚轮缩放 0.2~5 钳制），496→487；同日 c5：Logo/ThemeToggle(+read/apply)/members-helpers(Avatar/formatExpiry/durationKey)/SettingsOverview/IMBadge 5 组件补 25 例（主题偏好读写与 data-theme 持久化、到期相对文案四档、徽标 30s 轮询与 99+ 与失败静默、概况五要素），487→482；同日 c6：FilePreviewDialog/WhiteboardToolbar/CalendarSyncBadge/TaskStatsWidget 4 组件补 15 例（对话框开关门控与属性透传、工具栏七工具 aria-pressed 与分隔线、同步徽标四态与 provider 映射、统计 Widget 的 loading/error/数据三态与四卡片+总数），482→478；同日 c7：dashboard 族 15 文件（DashboardGrid/WidgetCard/WidgetConfigPanel/AddWidgetDialog 四个容器 + widgets/ 注册表与 10 个 Widget）补 91 例（加载成功/失败回退角色默认布局与空态、RGL 参数随编辑态与断点切换、脏标记只在初次加载后生效且退出编辑 PUT 一次并带 widgetConfigs/freeMode/density、命令式 addWidget 去重与未知 id 忽略 / getLayoutIds / exportLayout / importLayout 失败返回 false、F7 双击循环尺寸走 SIZE_PRESETS 与拖拽释放磁吸弹簧（移动端/自由模式直接 snap）、卡片编辑态三控件与配置面板 portal 的四条关闭通道、四档负载色阶与 SVG 图表 bar/line/pie 三分支及整圆特例），478→463；同日 c8：files 族 8 文件（FileBrowser/FileListItem/FileGridItem/FilePreview/FileUploader/FileVersionList/FileVersionRestore/TextPreview）补 69 例（搜索筛选大小写不敏感 + 有/无 query 的空态分叉（search vs folder）、视图切换 aria-pressed 双向翻转与 viewMode 初值、选中集合与删除同步移除（复选框回弹）、FileUploader 用 XHR fake 钉真实进度百分比/HTTP JSON message/非 JSON 回退/网络错误三分支与多文件并行 onUploadComplete 只在全部结束调一次、预览七分类分发与 Office Viewer url 编码、版本列表倒序与当前版本无还原按钮、文本预览 100KB 截断与 AbortError 静默丢弃），463→455——**lib 域实质全清（余 i18n-navigation 14 行包装层，裸 vitest 解析 next-intl 受限已记录取舍）；其后为大头 components/**（~500 文件，UI 测试线）**） |
| `permission-gate` T3 | 54 | **80** | 运行时已被 choke point 保护；静态数字每周 ≥6 收敛（2026-10-28 检测器按 handler 精确切分，POST /ai/feedback 的真实无门禁状态自 T4 暴露迁移至此，总盲区守恒；2026-10-29 RED 第十一批接线后检测器再次按 handler 精确切分，POST /api/v1/remote-control 同类自 T4 迁移至此，T3 +1 / T4 −1，总盲区 164 不变；2026-10-29 AI 域收敛批：40 个 handler 接 `requirePermission(ctx,"ai",*)`（2026-10-22 用户拍板 viewer 只读），T3 134→94，总盲区 164→124；**2026-10-30 T3 收敛批 A：forms/objectives/projectTemplates/workflows/wiki 五模块入矩阵（owner/admin/member 可写、viewer 只读；member=crud 与 choke point 现状逐条等价=零运行时行为变化），25 个 handler 接线，T3 94→69（达 90 天目标）；同日 T3 收敛批 B：meetings（含 meeting-minutes）/files/calendar/dashboard/recycleBin 五模块同口径入矩阵，15 个 handler 接线，T3 69→54**；留 T3 诚实登记：chat/completion/format/summarize/translate/feedback 六条会话级自助工具 + push/schedules(本人日程)/templates/{id}(公共模板混合语义) 两条定制口径 + task-breakdown/voice/preferences(无工作区 ctx) + orchestrate(动态 actionPerms，静态检测器看不见) + 用户级/回调面（auth、webhooks、favorites、mail、push、notifications、users/me、/api/{path}）待后续批次或维持诚实挂账） |
| `api-contract` undeclared | 0 | **150** | 每周契约化 ≥5 条路由（2026-10-29/30 **九批共 154 条契约化，基线清零**：ai 切片 35 + 单条 20 + documents/databases/recycle-bin 20 + push/mail/files 17 + workflows/spaces/meetings/project-templates/forms 19 + ai 收尾 13 + 顶层零星 15 + wid 下零星 14 与 `/api/{path}` 兜底 1，**90 天目标 150 大幅超额、覆盖率 100%**，openapi 133→288 paths；此后新增路由必须同步契约（基线已空，无法再挂账）；另有悬空 $ref 守门 check_openapi_refs.py 入 CI） |
| `write-access-registry` | 28 条 | 不缩量，按 `review_by` 到期复核 | 过期即 CI 红（机制已有） |

> **「当前」列只写纯数字。** `scripts/check_burndown.py` 的 doc-drift 校验（以及它的自测注入）
> 是按 `doc_row` 定位行后取该列**第一个数字**，掺进措辞会让承诺轨迹不可读——10-05 就把 643
> 写成过 "641（…10-03 记为 643）"，实测门禁照样 PASS，但自测的字面注入落空、Burndown workflow 变红。
> 历史值记在这里：zero-coverage 10-03 起算 **643** → 10-05 **641** → 10-06 **633 → 632 → 629 → 628**（633 补上多维表格入口的组件测试，连带把编辑器组件图与 query-engine 跑出覆盖；632 是 IM 挂上在线成员条后 IMClient 首次有了行覆盖；629 清掉三个安全面文件——文档权限判定、AI 上下文聚合、过期授权回收 cron，各带一组反向变异自测；628 是离线同步队列（syncUp 的删队列时机、冲突重入队、串行锁、destroy 清定时器）；**627 是 stripe-provider**——补了 apiVersion 钉版用例，把这个此前零覆盖的支付文件跑出覆盖，棘轮按「已修未删即红」要求同步摘除基线行；**626 是 payments/types**——它被 stripe-provider 的用例连带 import 而有了行覆盖，但基线行没跟着删，于是棘轮以 STALE_COVERED 判红（CI 实测：被统计 713 / 零覆盖 626 / 基线登记 627）。**613 是 12 个 AI assistant prompt builder 契约测试**（57 例：JSON 输出约束、前序上下文/历史注入两侧、summarizeHistory/formatPreviousOutput 截断边界，并钉死 orchestrator 白名单与 builder 映射的双源一致）；**612 是 context-builder**（7 例：taskId/任务不存在的降级、字段拼装、phaseTransitionAdvice 的 !result 前置）；**609 是计费域 webhook**——`billing/webhook-handler` 与微信支付通道此前单元覆盖为零，补了 49 例（幂等 P2002 分流、非 P2002 不得伪装 duplicate 200、TypeError/ReferenceError/SyntaxError 三类编程错误 fail-fast、checkout 开通 / synced 降级 / past_due / 只打点 / 取消不回落 seatLimit、$transaction 选项钉到具体数值），连带把 `payments/alipay-provider`、`payments/wechat-provider` 跑出覆盖，一次摘除三行基线。**606 是协同孤儿摘除**（ADR-017）：`components/{CollaborationProvider,CollaborationCursor,PresenceIndicator}.tsx` 三个零挂载组件与 `server/collab/` 整个目录一并删除——它们从未运行、从未接线，但都各自占着一行零覆盖豁免额度，删文件的同时按内容匹配删掉那三行基线。**604 是 i18n 原始 key 修复**——`CommandPalette`（命名空间双前缀）与 `SemanticSearchPanel`（scope 标签缺键）补了真实渲染回归测试（3 例，以 `NextIntlClientProvider` + 真实 zh.json 渲染组件取值），两个此前零覆盖的组件跑出行覆盖，棘轮以 STALE_COVERED 判红后按内容摘除两行基线（CI 实测：被统计 714 / 零覆盖 604 / 基线登记 606）。同 PR 顺带更新了视觉基线 `cmd-palette-chromium-linux.png`：旧快照里烙着的是「nav.nav.menu.* 原始 key」的像素，修复后面板渲染真实译文，属设计性变化，新基线取自 CI 失败 run 的 actual 产物且两次重试逐字节一致。**603 是邮件/导出调色板去重**——`lib/{email,ai/push-email,notification/offline-push}.ts` 与 `batch-export/route.ts` 里复制粘贴的三份调色板收敛到 `lib/html-palette.ts`，新单测 import 了 `push-email` 并真实渲染，把这个此前零覆盖的文件跑出行覆盖，棘轮以 STALE_COVERED 判红后按内容摘除该行基线。注意这次**不是**清偿了零覆盖文件，而是「读源码」变成了「真 import 并渲染」——覆盖是接线方式变的副产品。**602 是批量改状态的事件真源收口**——`tasks/batch` 路由原先一条服务端事件都不发，批量状态变更只有 board 页那条客户端聚合事件（`{batch:true, count}`，**没有 taskId**）；改成服务端逐条发 `{taskId, to, via:"batch"}`（与单条 PATCH 同口径）并删掉客户端那条——同一动作留两个真源会让批量路径的计数翻倍，而客户端那条既给不出"任务何时进入 done"所需的 taskId，也不算权威（页面在 flush 前关掉就丢）。新单测 `tests/unit/tasks-batch-status-event.test.ts`（5 例，含"update 有影响行数但读回为空 ⇒ 一条都不发"这条防按 validIds 虚报的守卫）把这个此前零覆盖的路由跑到 **91/123 行 = 73.98%**；棘轮以 STALE_COVERED 要求摘除该行基线，burndown 随即按「路线图数字须等于实测」把本节「当前」603→602（本机实测：被统计 719 / 零覆盖 602 / 基线登记 602，`check_zero_coverage_ratchet.py` PASS）。复跑命令：`npx vitest run tests/unit --coverage` 后 `python scripts/check_zero_coverage_ratchet.py`）。 **550 是 10-29 零覆盖清算波**——新增 9 个单测文件共 173 例（b1：orchestration/capabilities/orchestrator-plan/payments-provider；b2：analytics 与 knowledge-mail 两域 prompt builder；b3：agent-collaboration/bottleneck/burndown/progress-anomaly/risk-alert/team-performance 与 search/voice/weekly/wiki/workflow；b4：seed-templates/ToolRegistry/builtins/shared/usage-limit 等 AI 基建），把 `lib/ai/prompts/` 整目录零行文件 24→0；基线经 `--emit` 从全量 unit 覆盖跑重生成（被统计/零覆盖/基线登记三数对齐），`check_burndown.py` 随即按「路线图数字须等于实测」把本节「当前」592→550。**539 是 10-29 lib 域 b1 清算**——11 个 lib 零覆盖文件各补一份契约级单测（format/slug/prisma-error/calendar-config、billing 的 seat-policy 与 subscription-expiry、approval 的 builtin-templates/condition-engine/permission-linkage、database 的 formula-engine/relation-resolver，共 207 例），全部文件行覆盖非零（8 个 100%、condition-engine 98.86%、formula-engine 90.36%、relation-resolver 96.72%、format 95.93%、calendar/config 98.24%），棘轮 STALE_COVERED 判红后 `--emit` 摘除 11 行（被统计 730 / 零覆盖 539 / 基线登记 539，`check_zero_coverage_ratchet.py` PASS），`check_burndown.py` 随即按「路线图数字须等于实测」把本节「当前」550→539。

---

## 3. 十一月起：试用 → 推广

**冻结宣告**：90 天内不新增能力域（不新增表 / route 域 / AI 能力）。
例外：修 bug、安全收口、自用点名的缺口。

**宽度策略（用户拍板：功能上不做减法，做整合）**：产品功能域全部保留，
通过信息架构整合把"33 个并列工具"重组为"一个有结构的工作台"——
第一层（侧栏归组 + Cmd+K 全功能直达）已落地；第二层提案见
`docs/design/INFORMATION-ARCHITECTURE-2026Q4.md`，按自用痛点排队执行。
"确定没用"的判定标准 = 代码零引用且无部署链路（2026-10-03 已核实：
server/collab **不满足**删除条件——它是协同功能的服务端，属"待收编"而非"待删除"；
真正的死负载已清理：mobile-matrix.yml 的每周自动构建已撤销，改手动触发）。

### 3.1 试用（正式实例就绪后）

- 从身边可触达的 2–3 个小团队开始"邀请式试用"（不是公开推广）：
  建工作区 → 迁 1 个真实项目进来 → 用两周
- 打开埋点，看注册→建区→邀人→首个任务→7 日回访漏斗
- 每周收集一次试用反馈，打磨 backlog 按此排序

### 3.2 推广（试用留存站得住之后）

- 公开页（LANDING + 定价）与实例状态对齐
- 写 2–3 篇技术内容（RLS 多租户加固、default-deny 门禁设计——本仓库
  最稀缺的工程差异化），带链接推广
- 届时再评估：多租户 SaaS 继续收订阅，或转开源"多租户安全脚手架"扬名

---

## 4. major 升级批次（issue #32，独立会话执行）

按 #32 实测结论的顺序：**Prisma 7 → TypeScript 6 → Stripe 22**，
各自独立提交独立 revert（TS6 单独升级已被实测否决：Prisma 6 client interop 破坏）。

---

## 5. 不做什么（负面清单）

- 不新增能力域，不接新的第三方 SaaS 集成
- 不做"再造一个 IM"（进 Slack/飞书/企微的进入侧集成除外）
- 无正式实例时不对外承诺 SLO
- 试用数据没站住之前不做公开推广
