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
| 质量基线 | 零覆盖 **602**（10-03 为 643，−41）/ T3 **147**（−10）/ 契约未声明 **186**（205 → 201 → 196 → 191 → 186，10-25 清偿 AI agents 5 条 + activity/announcements/contacts 5 条，10-26 清偿 calendar/objectives/key-results 5 条）——burn-down 计划见 §2 |
| **已知短板**（非退步，存量欠账） | **API 层 8.00（Silver）**：契约覆盖率 32.2%（目标 60%），`tests/api` 路由级测试 1/20 为测试维度最大短板；**RED-Rate/Duration** 包装器就绪但零调用点（BATCH2 §4 有据可查的取舍）；**SLO/SLI 文档 0 份**（正式实例前按负面清单不做承诺）；渗透测试三件套停留在 2026-08-27，未覆盖十月新增暴露面 |
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
- 401/403 语义统一（choke point 拒绝走 401）——需要统一错误出口设计。
- lint 的 40 条 warning 清零（React hooks 依赖缺失等）。

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
| `zero-coverage-baseline.txt` | 602 | **550** | 每周清 ≥8 个文件；优先 permissions/orchestrator/payments/im |
| `permission-gate` T3 | 133 | **80** | 运行时已被 choke point 保护；静态数字每周 ≥6 收敛 |
| `api-contract` undeclared | 186 | **150** | 每周契约化 ≥5 条路由 |
| `write-access-registry` | 28 条 | 不缩量，按 `review_by` 到期复核 | 过期即 CI 红（机制已有） |

> **「当前」列只写纯数字。** `scripts/check_burndown.py` 的 doc-drift 校验（以及它的自测注入）
> 是按 `doc_row` 定位行后取该列**第一个数字**，掺进措辞会让承诺轨迹不可读——10-05 就把 643
> 写成过 "641（…10-03 记为 643）"，实测门禁照样 PASS，但自测的字面注入落空、Burndown workflow 变红。
> 历史值记在这里：zero-coverage 10-03 起算 **643** → 10-05 **641** → 10-06 **633 → 632 → 629 → 628**（633 补上多维表格入口的组件测试，连带把编辑器组件图与 query-engine 跑出覆盖；632 是 IM 挂上在线成员条后 IMClient 首次有了行覆盖；629 清掉三个安全面文件——文档权限判定、AI 上下文聚合、过期授权回收 cron，各带一组反向变异自测；628 是离线同步队列（syncUp 的删队列时机、冲突重入队、串行锁、destroy 清定时器）；**627 是 stripe-provider**——补了 apiVersion 钉版用例，把这个此前零覆盖的支付文件跑出覆盖，棘轮按「已修未删即红」要求同步摘除基线行；**626 是 payments/types**——它被 stripe-provider 的用例连带 import 而有了行覆盖，但基线行没跟着删，于是棘轮以 STALE_COVERED 判红（CI 实测：被统计 713 / 零覆盖 626 / 基线登记 627）。**613 是 12 个 AI assistant prompt builder 契约测试**（57 例：JSON 输出约束、前序上下文/历史注入两侧、summarizeHistory/formatPreviousOutput 截断边界，并钉死 orchestrator 白名单与 builder 映射的双源一致）；**612 是 context-builder**（7 例：taskId/任务不存在的降级、字段拼装、phaseTransitionAdvice 的 !result 前置）；**609 是计费域 webhook**——`billing/webhook-handler` 与微信支付通道此前单元覆盖为零，补了 49 例（幂等 P2002 分流、非 P2002 不得伪装 duplicate 200、TypeError/ReferenceError/SyntaxError 三类编程错误 fail-fast、checkout 开通 / synced 降级 / past_due / 只打点 / 取消不回落 seatLimit、$transaction 选项钉到具体数值），连带把 `payments/alipay-provider`、`payments/wechat-provider` 跑出覆盖，一次摘除三行基线。**606 是协同孤儿摘除**（ADR-017）：`components/{CollaborationProvider,CollaborationCursor,PresenceIndicator}.tsx` 三个零挂载组件与 `server/collab/` 整个目录一并删除——它们从未运行、从未接线，但都各自占着一行零覆盖豁免额度，删文件的同时按内容匹配删掉那三行基线。**604 是 i18n 原始 key 修复**——`CommandPalette`（命名空间双前缀）与 `SemanticSearchPanel`（scope 标签缺键）补了真实渲染回归测试（3 例，以 `NextIntlClientProvider` + 真实 zh.json 渲染组件取值），两个此前零覆盖的组件跑出行覆盖，棘轮以 STALE_COVERED 判红后按内容摘除两行基线（CI 实测：被统计 714 / 零覆盖 604 / 基线登记 606）。同 PR 顺带更新了视觉基线 `cmd-palette-chromium-linux.png`：旧快照里烙着的是「nav.nav.menu.* 原始 key」的像素，修复后面板渲染真实译文，属设计性变化，新基线取自 CI 失败 run 的 actual 产物且两次重试逐字节一致。**603 是邮件/导出调色板去重**——`lib/{email,ai/push-email,notification/offline-push}.ts` 与 `batch-export/route.ts` 里复制粘贴的三份调色板收敛到 `lib/html-palette.ts`，新单测 import 了 `push-email` 并真实渲染，把这个此前零覆盖的文件跑出行覆盖，棘轮以 STALE_COVERED 判红后按内容摘除该行基线。注意这次**不是**清偿了零覆盖文件，而是「读源码」变成了「真 import 并渲染」——覆盖是接线方式变的副产品。**602 是批量改状态的事件真源收口**——`tasks/batch` 路由原先一条服务端事件都不发，批量状态变更只有 board 页那条客户端聚合事件（`{batch:true, count}`，**没有 taskId**）；改成服务端逐条发 `{taskId, to, via:"batch"}`（与单条 PATCH 同口径）并删掉客户端那条——同一动作留两个真源会让批量路径的计数翻倍，而客户端那条既给不出"任务何时进入 done"所需的 taskId，也不算权威（页面在 flush 前关掉就丢）。新单测 `tests/unit/tasks-batch-status-event.test.ts`（5 例，含"update 有影响行数但读回为空 ⇒ 一条都不发"这条防按 validIds 虚报的守卫）把这个此前零覆盖的路由跑到 **91/123 行 = 73.98%**；棘轮以 STALE_COVERED 要求摘除该行基线，burndown 随即按「路线图数字须等于实测」把本节「当前」603→602（本机实测：被统计 719 / 零覆盖 602 / 基线登记 602，`check_zero_coverage_ratchet.py` PASS）。复跑命令：`npx vitest run tests/unit --coverage` 后 `python scripts/check_zero_coverage_ratchet.py`）。

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
