# Changelog

本文件记录 corps 的版本变更，遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 惯例，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Fixed

- **任何一个 404 都会渲染成全局错误页而非 404 页**：`app/[locale]/not-found.tsx:20` 写的是
  `const { locale } = await params`，但 **Next.js 不给 `not-found.tsx` 传 props**（App Router 固定限制），
  于是 `params` 为 undefined → `TypeError: Cannot destructure property 'locale' of ... undefined`
  （dev 栈直接指向该文件行号，digest 恒定）。后果不是"日志脏"而是**用户看到的 404 页其实是
  ErrorBoundary 的"页面出错了 + 重试/刷新页面"**——E2E 的 DOM 快照实测到这一点。
  改为 `const locale = await getLocale()`（从 [locale] 段已配置的 next-intl request 取），
  并删掉不再适用的 `setRequestLocale`。全仓同类文件已扫：`app/**/{not-found,error,global-error}.tsx`
  中只有这一处依赖 params。
  验证：dev 下单测 404 路径返回含"页面不存在"文案的正常 404 页、`Cannot destructure` 计数不再增长；
  重建生产包后 `next start` 跑 E2E 期间该错误 0 次。
- **访客中断一个请求就能把整个实例打掉**：`lib/observability.ts` 的 uncaughtException 处理器
  无条件 `process.exit(1)`（延时 500ms 上报后），而客户端在响应写完前断连时 Node HTTP server 会
  把 `Error: aborted` / ECONNRESET 冒到 uncaughtException —— 这属正常流量，不代表进程状态不可信。
  另 `lib/shutdown.ts:57-65` 还注册了**第二套**处理器，对 uncaughtException 与 unhandledRejection
  都直接 `exit(1)`，与 observability 文档里"rejection 仅上报、不改变进程行为"的声明互相矛盾，
  且真正杀掉进程的是它。
  实测证据：本机 dev 服务在 Playwright 跑用例中途消失，日志正是
  `[shutdown] uncaughtException: Error: aborted (code: 'ECONNRESET')`，随后 `netstat` 端口无人监听，
  后续用例全以 `net::ERR_CONNECTION_REFUSED` 失败——即"测试假红"的直接来源。
  修法：新增 `isBenignTransportError()`（ECONNRESET/ECONNABORTED/ETIMEDOUT/EPIPE/
  ERR_STREAM_PREMATURE_CLOSE 与 aborted、socket hang up、premature close 文案），命中则
  **不上报不退出**（降为 debug 级，保留可见性）；真异常仍按原 fail-fast 语义退出。
  `shutdown.ts` 删除第二套处理器，进程级异常策略由 `installProcessErrorHandlers()` 单一持有。
  验证：`tests/unit/observability.test.ts` 22 例全绿（新增 3 例：断连类识别、
  真异常与畸形输入不误判、断连不 exit 而真异常仍延时 `exit(1)`）。
- **`viewer` 角色在 API 上根本无法赋予，前端"只读成员"点了直接 400（P0 级功能不可达）**：
  `lib/permissions.ts:56` 的 `ROLES`、`schema.prisma` 的 role 注释、前端角色下拉
  （`components/members/MemberList.tsx:170/293` 的 `roleViewer`）都承认 viewer，
  唯独 `app/api/v1/workspaces/[wid]/members/[userId]/route.ts:16` 的
  `role: z.enum(["admin", "member"])` 不含它 → 改角色为只读返回 400。
  `f2f926ed` 落 viewer 只读时补的集成测试（`rbac.test.ts:130`）正是因此是红的——
  该用例当时本机跑不了、留给 CI 首跑，而 CI 已连续三周没跑到这一步。
  现已把 `viewer` 加入枚举并同步契约（`api/openapi.yaml` 的 PATCH 请求/响应枚举、
  工作区详情 `role` 枚举与说明）。**验证**：`tests/integration/rbac.test.ts` 由
  24 例扩至 34 例（本条 + 下条安全项），实跑 **34 passed / 退出 0**。
  注：邀请端 `members/invite/route.ts:15` 的枚举仍不含 viewer——当前邀请 UI 不提供该选项，
  未臆造需求，留作待决项。
- **在途多维表格 UI 引用 26 个中英双缺的 i18n 键，单测腿因此恒红**：
  新增的 `app/[locale]/w/[wid]/databases/`（列表页 + 详情页 + shared.ts）使用
  `database.list.*` 21 键、`database.detail.*` 4 键与侧边栏 `nav.menu.databases`，
  而 `messages/zh.json` 的 `database` 命名空间只有 `editor`。触发的是
  `f5018f09` 自己加的守卫 `tests/unit/i18n-usage.test.ts:117`——门禁按设计抓住了未完成的功能。
  已按各调用点语义补齐全 26 键（含 `openAria {title}` / `lastUpdated {date}` 插值，zh/en 对称）。
  **验证**：`npx vitest run tests/unit` → **46 文件 / 560 例全绿，退出 0**（此前 2 failed）。
- **覆盖率门禁在 CI 里根本没被执行到（P0，"有覆盖率关卡"这句宣称此前不成立）**：两条独立成因，
  都取到了实测证据。① `ci.yml` 的 Test job 把 `npx vitest run --coverage` 排在
  `bash db/rls-smoke.sh` **之后**，smoke 一失败整个 job 即终止——拉取失败运行 36481491352 的
  全量日志，搜不到任何覆盖率表；② Vitest 的 `coverage.reportOnFailure` 默认 **false**，
  任一测试变红就跳过覆盖率评估。而真实覆盖率实测只有
  **lines 3.98% / statements 3.98% / functions 58.6% / branches 73.7%**（unit-only，
  706 个被统计文件中 646 个行覆盖率为 0），配置阈值却是 20/15/20/20。
  修法：`vitest.config.ts` 置 `coverage.reportOnFailure: true`；`ci.yml` 新增**不依赖数据库**的
  `coverage` job（unit-only 棘轮 3.5/3.5/55/70，注释写明"只允许上调，为变绿而下调需单独说明并经确认"），
  Test job 的合并腿阈值保持不动。
  **变异验证**：棘轮命令本地实跑退出 0（3.98% > 3.5%）；抬高到 4.5% 与 99% → 均退出 1 并报
  "does not meet global threshold"，证明这道门真的会咬。
  注：该 job 定义在并发会话中被 `064b6e23` 一并提交，本条为追记。
- **API 契约基线的"只允许收缩"是单向假象**：`check_api_contract.py` 只对"基线外的新未声明路由"
  失败，对"已声明/已删除却仍留在基线里的条目"只 print 不 fail（`:167-170`），
  与 docstring 第 16 行的承诺相反；失败提示的第 2 个选项还直接教人"append it to baseline"。
  实测契约覆盖率 26.0%（277 条可纳入路由中声明 81 条，205 条全压在基线里）。
  已把"已修未删"改为 **FAIL** 并同步 docstring 与退出码说明。
  **变异验证**：正常态退出 0（当前 stale=0，不引入红灯）；注入一条伪基线 → **退出 1** 并列出"豁免腐烂"，
  随后按 md5 逐字节还原基线文件。
- **数据库迁移漂移（P0，一条根因同时导致加固模式 CI 连红、部署两条路不通、引擎层 RLS 实际未生效）**：
  `schema.prisma` 有 3 个模型（`ai_conversations` / `ai_messages` / `push_tokens`）从未进过迁移链，
  只靠 `db push` 之类的旁路存在于开发库里。`prisma migrate deploy` 建出的新库因此缺表 →
  `db/rls-activate.sql:71` 的 FOREACH 块在 `ALTER TABLE ai_conversations FORCE RLS` 处
  `relation does not exist` 报错；该 DO 块是原子的，**79 张表的 ENABLE/FORCE 与 264 条策略一条都不会落地**。
  后果链：CI 的 `rls-smoke` 步骤先于 `vitest` 失败（单测关卡根本没执行到）、`e2e`/`build`/`docker-publish`
  因 `needs` 长期 skipped、`web/docker/entrypoint.sh`（`set -e` + `ON_ERROR_STOP=1`）在 `RLS_ACTIVATE=true`
  时容器直接中断。新增迁移 `20260929000000_add_missing_ai_conversation_and_push_tables`，
  DDL 由 `prisma migrate diff --from-migrations ... --shadow-database-url ...` 生成而非手写。
- **5 个字段漏写 `@map` 导致新库列名对不上（P0）**：`AiMeetingActionItem.extractedBy`、
  `AiMeetingSession.participantCount`、`AiVoicePreference.wakeWord`、`Favorite.targetType`、
  `Mail.toAddr` 的库内真实列名是 snake_case，但字段未标 `@map`，Prisma 按 camelCase 查列 →
  新部署库上运行期 P2022。已补 `@map`（与同文件内既有约定一致）。
  刻意**未**按 `migrate diff` 的全量输出重建库：其中包含删除 `messages.body_tsv` /
  `wiki_pages.content_tsv` 的语句，这两列是裸 SQL 建的 tsvector，被 `v1/search` 与 `v1/im/search` 真实使用。
- **`db/rls-activate.sql` 不幂等（P0 运维）**：24 条 `CREATE POLICY` 缺前置 `DROP POLICY IF EXISTS`，
  第二次执行即 `policy already exists` 报错；而 entrypoint 每次容器启动都会跑它，等于
  **首次成功之后任何一次重启都会让容器起不来**。文件头原本自称"幂等可重复执行"。
- **`docker compose` 文档路径断在 env**：`.env.example` 完全没有 `JWT_ACCESS_SECRET` 的赋值行
  （只在注释里提到该变量名），而 `docker-compose.yml:119` 以 `${JWT_ACCESS_SECRET:?}` 硬必填；
  `CORPS_APP_PASSWORD=` 值为空同样触发 `:?` 失败。按 README 的 `cp .env.example .env` 走会在
  compose 解析阶段中止。实测口径：`docker compose --env-file <example副本> config`。
- **看板长按菜单三个 i18n 键两侧皆缺**：`task.complete` / `task.copy` / `task.share` 在 `zh.json`
  与 `en.json` 中都不存在，`dev.log` 里每条各抛 164 次 `MISSING_MESSAGE`。原 `i18n-keys` 测试
  只比对 zh↔en 键集合相等，因此对这种"两边都缺"完全无感。
- **审批评论路由未入契约门禁**：`c7d2247c` 新增 `approvals/instances/{aid}/comment` 后
  `api-contract` job 恒红，已补入基线。
- **仪表盘 widget 测试文件格式化不合规**使 `lint` job 的 `prettier --check` 失败，已修正。
- **两处文档失实（审计文档自身的事实错误）**：
  ① `docs/audit/FULL-AUDIT-2026-09-27.md` 称 `desktop/` 是 Electron 且与 `tauri-build`/`mobile-*`
  构成"两套桌面/移动方案"、建议"停用冗余流水线"——实测 `desktop/package.json:7-15` 是
  `tauri dev` / `tauri build` + `@tauri-apps/cli ^2`，全仓无 Electron 实现（`electron` 仅命中
  `desktop/README.md` 的对比表述、`pnpm-lock.yaml` 与法务文案），`mobile-matrix.yml` 是测试矩阵而非打包方案，
  该建议已作废并在其"审核修正记录"附录留痕。
  ② `README.md` 同篇并存"Free 可用 17 项"与"Free 21 项"两个数字而无口径说明：前者是
  `PRICING_MATRIX` 功能对比表（22 功能行 = Free 全量 14 + 受限 3 + 不可用 5），
  后者是 `PRICING_PLANS.free.features` 套餐卡要点（21 条，`pricing.features.free.f01–f21`，中英齐备）。
  已改为分别标注来源与构成，避免读者当成矛盾数字。

### Security

- **只读成员（viewer）可经"多维表格记录面"与"AI 落位面"写入业务数据**：矩阵一直声明 viewer 对
  tasks/documents/decisions/announcements 只有 `r`，但这两条链路只做**成员资格**校验、不看角色。
  ① `…/databases/[dbid]/records/route.ts:210` 与 `…/records/[rid]/route.ts:25,97`
  的 POST/PATCH/DELETE 只调 `getWorkspaceContext`（注释本身写着"member 可写"，viewer 一并放过），
  前端 `canManageDatabases` 只隐藏按钮、不构成执行边界；
  ② `ai/tools/execute`（`create_task` → `tx.task.create`）与 `ai/orchestrate` PATCH
  （createTask/createDocument/createDecision/sendAnnouncement）同样无角色判断——
  "AI 建议需用户确认后落位"约束的是幻觉，不是授权。
  修法按本仓既有口径走矩阵而非 ad-hoc：`lib/permissions.ts` 新增 `databases`（容器：owner/admin `crud`、
  member `r`、viewer `r`）与 `databaseRecords`（member `crud`、viewer `r`）两个模块，
  语义与既有实现等价（不放宽也不额外收紧），5 个写 handler 接 `requirePermission`；
  AI 侧按 action→模块映射接矩阵（`tasks`/`documents`/`decisions`/`announcements`，
  与对应手工路由用同一规则；`scheduleMeeting`/`notify`/`linkToOkr` 矩阵里尚无模块，不臆断）。
  另把 `ai/orchestrate` 的 `isAiConfigured()` 检查**移到鉴权之后**——原顺序在无 AI key 的环境
  （含 CI）会先返回 503，使鉴权分支永远测不到。
  **验证**（隔离环境：自建 PG18 + 生产构建，非静态推断）：新增 10 条集成断言——viewer 读放行、
  建/改/删记录 403、member 未被一并锁死、容器级 owner/admin 门禁未被放宽、
  viewer 经两条 AI 链路 403、member 侧 `not.toBe(403)` 锚点；
  `rbac.test.ts` 34 例全绿，全量集成+api **16 文件 / 175 例全绿，退出 0**。
  `scripts/check_permission_gates.py` 的 T3 基线同步删除已收口的 5 条（170 → **165**），门禁退出 0。
- **公开分享链接的密码与有效期此前只在服务端"不管"**：`GET /api/documents/share/{token}` 的
  `select` 不含 `sharePassword` / `shareExpiresAt`，因此无条件返回 `publishedMarkdown` 全文；
  带密码校验的 verify 路由只存在于 workspace 版（需登录），其自身注释即写明公开路径"此处不覆盖"；
  前端 POST 的 `/api/documents/share/{token}/verify` 路径**根本不存在**，且 `hasPassword`
  永远拿不到值 → 密码门是死代码。现改为服务端强制：未过期且（无密码或密码校验通过）才下发正文，
  并新增公开 `POST /api/documents/share/{token}/verify`（scrypt 比对 + IP 锁定 + 访问日志），
  契约同步入 `api/openapi.yaml`。响应体仍不含密码哈希本身。
- **Stripe 价格可由请求体指定**：`billing/checkout` 把 `body.priceId` 原样作为 `priceOverride`
  透传进 `line_items`，无服务端白名单 → 具备 billing 权限的成员可绑定账户内任意价格
  （含测试价、超低价）。现只允许服务端自己配置的 `STRIPE_PRICE_ID` / `STRIPE_PRICE_ID_YEARLY`，
  越界返回 400。
- **`scripts/check_permission_gates.py` 的判定口径双向失真，且扫描范围只覆盖三成写面**：
  旧版"是否已接门禁"的正则只认 `requirePermission(` / `checkPermission(` / `role ===`，
  于是把 `if (!["owner","admin"].includes(ctx.member.role))` 这类**真实有效的 ad-hoc 角色判断**
  误记成零缺口——旧基线 44 条里 11 条属此类（证据：`tasks/[id]/comments/route.ts:229-231`
  判"作者本人或 owner/admin"）。反向问题更大：扫描根写死 `v1/workspaces/[wid]`，
  矩阵域外的写 handler 一个都不看。现按"矩阵域内零判断 / 矩阵域内仅 ad-hoc / 矩阵外零判断 / 矩阵外仅 ad-hoc"
  分四档，各持一份只允许收缩的基线（T1 33 / T2 20 / T3 170 / T4 33，共 256 个写 handler 待收敛），
  扫描根扩到 `web/app/api/**`（沿用 `check_api_contract.py` 的 `INTERNAL_PREFIXES` 排除 cron/健康检查/auth/uploads，
  并跳过路由组 `(group)` 段）。四档均已做**注入式变异验证**：探针落位后各自正确变红、
  已接 `requirePermission` 的探针与 cron 探针不被误报、删基线一行能报"豁免腐烂"。
  口径修正过程本身也被变异测试抓出一个 bug：`[wid]` 与路由组都不进 `static_core`，
  资源段索引取 3 会让深层路由按**叶子段**误判档位（首轮实测的 T1=9/T3=194 即为此错），现固定取 2。

### Added

- `scripts/check_schema_migration_drift.py` — schema ↔ 迁移/已部署库 的**单向**漂移门禁。
  权威模式直连 `information_schema`（零 SQL 文本解析、零假阳性），静态回退模式只比表名。
  刻意不做双向相等断言：库里存在、schema 未声明的列（tsvector 等）是有意的。
  新增 `schema-drift` CI job 并挂进 `build` 的 `needs`。
- `scripts/check_rls_coverage.py` 从"表名集合求差"升级为三态断言（ENABLE + FORCE + 至少一条策略），
  并在解析前剥离 SQL 注释——旧版会把 `-- '某表名'` 注释内容当表名，既能造成恒红误报、
  也能被用来伪造覆盖；旧版亦完全不查 FORCE 与策略是否存在。
- `web/tests/unit/i18n-usage.test.ts` + `web/tests/i18n-usage-baseline.txt` — 校验"代码引用的 i18n 键
  必须真的存在于两份词条"，现存 27 处历史缺口入"只允许收缩"基线，只挡新增。
  静态解析按**变量名**绑定命名空间（同文件多个 `useTranslations` 时否则会成批假阳性），
  并跳过 `t("diagram" + k)` 这类动态拼接。
- `README.md` 页首加 CI 徽章。此前长红三周无人发现，直接原因之一就是仓库里没有任何 CI 状态出口。

### Changed

- `README.md` 若干宣称与代码对齐：RLS 覆盖 `26/99` → 71 个含 `workspaceId` 的模型（79 张表、264 策略）
  并注明 20 张子表仍在引擎层之外；"CI 七道关卡" → 按 `ci.yml` 实际 job 列表述；
  Free 项数 `21` → 17（22 个功能行中 14 全量 + 3 受限），并把逐项归属指向
  `web/lib/pricing.ts` 单一事实源而非在 README 重复罗列；"AI 使用量…计量与限额" → 只宣称计量
  （限额判定此前在生产的调用点为零）；仓库结构里的 `e2e/` 路径修正为 `web/e2e/`。

## [0.7.1] - 2026-09-24

全栈审查修复版本：6 波次审查-修复循环覆盖 UI 响应式、后端安全、组件视觉一致性、cron 时间计算、API 行为优化，累计 40 文件 +945/-421 行。

### Fixed

- **UI 响应式修复（8 高严重度 + 16 中 + 23 低）**：
  - 日历月/周视图手机单列布局 + 工具栏两行 + i18n 日期格式。
  - Wiki/会议/工作流侧边栏移动端抽屉 + 操作按钮下拉菜单。
  - 核心工作区分页触摸目标 + md 断点 + 编辑模式工具栏折叠 + 单列选择器 2×2 网格。
  - 审批/通知/设置/计费 flex-wrap + overflow-x-auto + 水平 padding + grid 断点。
- **后端安全修复（2 高 + 4 中 + 7 低）**：
  - documents/[id] PATCH/DELETE 缺权限检查（viewer 可删除任何文档）→ 添加 checkDocumentPermission。
  - members/invite role 硬编码 → 从请求体读取 role 参数。
  - tasks/batch 附件清理 + webhook data:null + activity code:200 + description maxLength。
- **cron DST 时间计算修复**：recycle-cleanup 和 weekly-digest 使用毫秒运算在夏令时切换日偏差 1 小时 → 改用 Date 构造器按年/月/日进位。
- **notifications PATCH all=true 性能保护**：updateMany 无 take 限制 → 改为 findMany(take:500)+updateMany，返回 updatedCount。
- **组件层视觉一致性（1 高 + 12 中 + 3 低）**：
  - Toast.tsx emoji ⏸ → lucide-react Pause 图标（违反"禁 emoji"规则）。
  - 20+ 处图标尺寸统一为 size={14}（12/13/15 → 14，36 → 32）。
  - 30+ 处硬编码 Tailwind 间距类 → var(--space-*) token。
  - WidgetCard perspective "1000px" → var(--perspective-card)。
  - DocumentEditor 工具栏窄屏折叠低频操作到"更多"菜单。
  - board-parts h-64 → min-h-[16rem]，DocumentListView pr-24 → pr-[6rem]。

### Changed

- openapi.yaml notifications PATCH 响应新增 `updatedCount` 字段，描述更新为"最多 500 条/请求"。

## [0.7.0] - 2026-09-15

AI 原生办公平台升级版本：从"项目管理工具"升级为 AI 原生办公平台，新增 17 个核心 AI 能力，完成 8 方向深化，补齐反馈循环与使用量统计基础设施，并拆分三个千行级页面。

### Added

- **AI 原生办公平台升级**：
  - **17 个核心 AI 能力**：文档续写 / 格式化 / 摘要 / 翻译、智能问答、Wiki 搜索、任务拆解、工作流构建、项目洞察、日报生成、IM 回复建议、公告起草、审批建议、会议流程、追问建议、日程排程、跨能力编排——贯穿讨论→决策→执行全流程。
  - **8 方向深化**：
    - **A 上下文聚合深化**：scope 13 → 20 种，AI 上下文更完整。
    - **B AI 执行引擎扩展**：action 3 → 8 种，AI 建议可直接落位为任务/文档/日程等结构化对象。
    - **C 多轮对话与追问**：上下文内连续对话，追问建议引导深入。
    - **D AI 结果反馈循环**：每条 AI 结果可点赞 / 点踩 / 修正反馈，闭环优化（新增 `AiFeedback` 模型）。
    - **E 流式进度阶段反馈**：长任务分阶段实时回传进度。
    - **F 跨能力联动**：一次请求可串联多个能力完成复合意图。
    - **G AI 使用统计与限额**：Token / 调用次数 / 成本三维计量，按工作区限额（新增 `AiUsageLog` / `AiUsageLimit` 模型，18 个 AI 路由集成使用量跟踪）。
    - **H Prompt 工程优化**：few-shot + 思维链（CoT）+ 输出格式校验，结果更稳更可控。
  - **AI 反馈组件集成**：11 个 AI 组件集成 FeedbackButtons，用户可对每条 AI 结果反馈。
  - **AI 安全约束**：所有 AI 建议均需用户确认后才落位，AI 不直接修改业务数据。

### Changed

- **千行级页面拆分**：`task/[id]` 1229 → 288 行、`settings` 1071 → 189 行、`members` 1010 → 384 行——可维护性与可读性显著提升。

## [0.6.0] - 2026-09-07

编辑体验与全栈双语收口版本：API 报错信息完成 i18n（此前英文用户拿到中文错误提示），Markdown 编辑器补齐 Typora 式肌肉记忆与图表能力入口。

### Added

- **Markdown 编辑器大升级**：
  - **图表模板下拉**：mermaid 引擎此前已支持 15+ 种图但只暴露流程图一种模板——补齐入口：思维导图/流程图/时序图/甘特图/饼图/四象限六种可运行模板一键插入（决策/文档/评论三处编辑器共用）。
  - **Typora 式快捷键层**：Ctrl/⌘+B/I/K 包裹（链接光标落 `[]` 内）、Tab/Shift+Tab 列表缩进、Enter 无序/有序列表自动续行（有序自动 +1 编号）、空列表项 Enter/Backspace 退出、引用行尾续行——纯 textarea 实现，零新依赖。
  - **分屏实时预览**（Obsidian 式）：编辑与渲染并排，宽屏双栏、窄屏堆叠；与单页切换互斥。
  - 字数统计（去 Markdown 标记近似计数）与链接按钮（此前工具栏无链接入口）。
- **API 路由 message 双语**：新增 `lib/api-messages.ts`（51 键 zh/en 常量表），38 个 route 文件 97 处中文 message 全部键化；语言协商与 next-intl 同源（NEXT_LOCALE cookie > Accept-Language > 默认中文）。英文用户报错提示不再是中文。

### Fixed

- **SSE 单用户并发连接硬上限**：此前只有 20 次/分钟的建立限流，单用户理论上可累积约百条长连接占句柄。补 per-user 计数（上限 5，多端登录正常 1-3），超限返回 429；额度获取放在最后一个可能抛错的 await 之后，无泄漏路径。
- **编辑器模板 i18n bug**：表格模板硬编码"列A|列B"、三个决策模板（方案对比/事故复盘/立项决议）硬编码中文——`/en` 用户插入的是中文模板。改为 i18n 键，zh/en 双端对称。
- notifications PATCH 的 zod refine 校验移入 handler（模块级 schema 无法按请求语言本地化，校验语义不变）。

## [0.5.0] - 2026-09-07

协作体验与响应式质量版本：成员治理（RBAC 修补 + 所有权转让）、个人效率入口（星标/通知细分/AI 提炼草稿）、顶栏信息架构收口、三引擎响应式基线。

### Added

- **成员角色管理 + 所有权转让**：成员页支持修改角色（admin/member，owner 不可改）、移除成员；工作区所有权可转让给其他成员（owner only，转让者降为 admin）——退出/解散场景不再需要联系支持。历史遗留的 `[uid]` 路由已删除合并进 `[userId]`（Next.js 同路径双 slug 冲突）。
- **星标收藏（favorites v1）**：任务详情星标按钮 + 侧栏"我的星标"分组，本地存储（localStorage `corps_favorites_v1`），跨设备同步留待 v2（届时引入 task_favorites 表 + RLS + 迁移）。
- **AI 决策提炼（规则版 v1）**：决策页"提炼"按钮——粘贴会议记录/长讨论，返回四段式结构化 markdown 草稿（关键结论/原始讨论节选/AI 提醒），不接真 LLM（端点形状已稳定，后续可换 DashScope/DeepSeek）。
- **通知中心收件箱 tabs**：All / Unread / @我 / 分配给我四个 tab，每个 tab 独立空状态——邮箱式的细分过滤。
- **顶栏搜索框显眼化**：accent ring + 独立 ⌘K chip，搜索从"能用"变"想用"。
- **响应式布局审计脚本（scripts/layout-audit.mjs）**：程序化布局崩点检测（横向溢出/元素重叠/触控目标 <20px），chromium + firefox + webkit 三引擎 × 3 视口 × 6 页 = 54 组合基线全零；替代人眼看截图的回归方式。

### Changed

- **顶栏头像升级为统一 UserMenu dropdown**：主题切换/语言切换/退出整合进头像下拉菜单，移除三个独立按钮——顶栏从 5 个交互元素收敛到 2 个（工作区下拉 + 头像菜单）。
- **Free 功能清单 14 → 21 项**：v0.4.0 新功能（子任务/文档中心/Mermaid/PDF 导出等）诚实列入 Free 清单。
- README 首屏重写：一句话定位 + 21 项亮点 + 快速开始；新增 issue 模板。

### Fixed

- **RBAC 三处修正**：runWithWorkspace 已内包 prisma.$transaction，transfer 内再嵌事务会被 Prisma 6 拒绝（改为直接在 tx 内顺序 update，原子性不变）；成员 PATCH 顺序改为先 self 后 ownerImmutable（owner 改自己曾被误拦为 403）；admin 改 member 角色放行。
- **SSE 单用户并发连接硬上限**：连接建立限流（20 次/分钟）只约束建立频率不约束存活数，单用户理论上可累积约百条长连接占句柄。补 per-user 计数（上限 5，多端登录正常值 1-3），超限返回 429；额度获取放在最后一个可能抛错的 await 之后，不留泄漏路径。
- 概览页"全部 →"链接触控目标 20px → 28px（负 margin 补偿，视觉不变）。
- 迁移幂等化：invitations 部分唯一索引加 IF NOT EXISTS（prisma migrate deploy 不校验已应用迁移 checksum，编辑对 deploy 安全）。

### 已知遗留

- API 路由 JSON message 中文残留约百处（英文用户报错提示仍中文，分批收口中）。

## [0.4.0] - 2026-09-03

任务执行与知识沉淀大版本：7 项功能全部围绕"决策→任务"闭环，Free 用户即可用。

### Added

- **子任务 + 阻塞标记**：大任务拆子任务（仅一层），父任务看板卡显示 done/total 进度条；被问题/依赖卡住的任务可标 blocked + 原因（hover 看原因，看板红色角标）。
- **文档中心**：工作区级 Markdown 文档（与决策记录正交——决策绑任务，文档解绑任务沉淀团队公约/手册/方案）；草稿/发布两态、发布快照、公开只读分享链接（192 位熵 token、草稿永不外泄）。
- **Mermaid 图表渲染**：决策/文档/评论中 ```mermaid 代码块渲染流程图、时序图、甘特图、mindmap 思维导图；动态加载不拖慢首屏；语法错误自动降级为代码块。
- **PDF 导出**：任务决策记录与文档一键导出 PDF（window.print + 打印 CSS 方案，零依赖）；深色主题打印自动浅色，表格/代码块防分页截断。
- **Markdown 编辑器工具栏 + 模板库**：粗体/斜体/行内代码（选中文本包裹）、标题/列表/引用/代码块/表格/Mermaid 一键插入；三个决策模板（方案对比/事故复盘/立项决议）。
- **附件内联预览**：点 IM 附件弹模态——图片放大、PDF 内嵌渲染、其余类型下载兜底，免跳转免下载。
- **任务公开只读分享**：任务属性栏生成只读外链给工作区外的人（客户/外包/顾问）看实时视图——标题/描述/状态/优先级/截止日/负责人名/子任务列表；可复制可撤销；脱敏不含 email/评论/聊天/附件。

### Fixed

- **任务分享与文档分享的加固模式 RLS 缺陷**：公开读接口曾用裸 prisma 查询，corps_app + FORCE RLS 下恒返 null。修复为 `p_tasks_share_select`/`p_documents_share_select` 策略（share_token = app.public_token GUC 放行）+ runWithShareToken 分步关联读。
- E2E 回归：PDF 打印容器常驻 DOM 导致 getByText 命中 2 元素（strict violation）——改条件渲染（点导出才挂载，afterprint 自动卸载）。
- documents POST 创建缺 `{ status: 201 }` 第二参（返回 200）。

## [0.3.0] - 2026-09-02

定价与功能包装再设计（v2 定价方案，用户 2026-09-02 拍板）。

### Changed

- **Pro 定价 ¥59 → ¥29.9/人/月、¥590 → ¥299/人/年**：国内锚点下重新定价（Teambition ¥25 / 飞书 ¥50），起步期渗透优先。年付维持"付 10 个月用 12 个月"结构。
- **Free 功能清单 7 → 14 项**：将已建成但未列出的能力诚实纳入（任务内 IM、日历连接、通知中心、标签/里程碑、批量操作、中英双语、深色模式、移动端响应式、降级不锁数据）——全部有代码支撑，非画饼。
- **Pro 清单 6 → 8 项**：无限席位提为首位卖点；新增附件扩容与每周任务摘要两个真实功能（见 Added）；基础邮件通知归回 Free（遵循"绝不偷偷降级免费功能"红线）。
- 定价页与对比表全量 i18n 化（pricing.features.* / pricing.matrix.* 翻译键，zh/en 双语渲染；此前对比表与功能清单仅中文）。

### Added

- **附件存储按套餐门控**：免费版单文件 10MB / Pro 50MB（attachments 路由按 active 订阅判定，免费超限提示升级路径）。
- **每周任务摘要邮件（Pro）**：`/api/cron/weekly-digest` 每周一 02:00 UTC 执行（北京时间周一 10:00），向 Pro 工作区每位成员发送其负责任务的逾期 + 未来 7 天到期摘要；corps-cron 调度容器内置计划表。
- 定价决策文档 `docs/market/pricing-redesign-v2.md`（ACCEPTED，含现状诊断、锚点论证、ROI 叙事与红线校验）。

## [0.2.1] - 2026-09-02

关键修复版本：解决 0.2.0 生产镜像全站无样式的问题。

### Fixed

- **生产构建全站样式缺失（0.2.0 最严重缺陷）**：`next build` 生产路径不自动接入 `@tailwindcss/postcss`（dev 会），导致镜像内 CSS 仅剩 ~6.5KB design-tokens 变量、所有 Tailwind 工具类缺失，UI 布局崩坏。补 `postcss.config.mjs` 显式接入后产物 CSS ~60KB（fecc6ca）。
- **生产构建登录页中英混排**：0.2.0 镜像打包时 i18n 提取尚未完成，登录表单 label 为"翻译 + 硬编码中文"残留（如 "Email密码"式混排）。0.2.1 打包自 i18n 收口后的完整源码（94ebdad）。
- **E2E 假阳性暴露并修复**：CSS 修复让 `md:hidden` 真正生效后，BoardView 移动/桌面双渲染中 `.first()` 命中隐藏移动副本的 7 处定位器失效——统一加 `filter({ visible: true })`（b8d4030）；登录导航超时 20s→30s 抗抖动。
- **entrypoint 生产兼容**：prisma 6 移除 `--url` 参数改环境变量注入；psql 缺失时降级告警而非启动失败（6a0c0bd）。
- **compose app 服务显式 ENTRYPOINT** 覆盖 0.2.0 镜像破损元数据（2f7a6ac 前后修复）。

### Added

- 完成上一批 UI 半成品接线：ClientLayout（Toast 容器 + 入场动画）挂载、顶栏 Logo 组件化、看板拖放目标高亮（2e7c808）。
- CI workflow_dispatch 手动触发、GitHub Pages 展示页配置（178a894/2d587dd）。

## [0.2.0] - 2026-08-31

首个对外发布版本。相对 0.1.0（内部开发版），聚焦三件事：双语国际化、商业化闭环（国内支付 + 筛选/视图 Pro 功能 + 账户删除）、安全加固收口。

### Added

- **中英双语界面**：全站 UI 文案接入 next-intl（zh/en 683 键级对称，`i18n-keys` 测试守护）；`/en` 前缀路由 + 语言切换器；时间格式化、状态/优先级/角色标签、邮件模板等随 locale 渲染。
- **国内支付通道**：微信 Native 扫码（二维码轮询确认）与支付宝网页支付接入，与 Stripe 并列可选；计费页支持月付/年付切换（年付 ¥590/席）。
- **任务筛选与自定义视图（Pro）**：后端 5 维筛选（状态/优先级/标签多选/指派人/关键词），筛选栏组件 + 保存视图（按用户隔离）+ Pro 门控 + `filter_applied`/`view_saved` 埋点。
- **账户删除**：设置页三步流程（展开 → 数据预览 → 邮箱确认），撤销 OAuth 授权、清理会话/账户、schema 级联删除；`runWithAuthOp("provision")` 逃生口 + 端到端 DB 实证。
- **数据埋点看板**：获客/激活漏斗、D1/D7/D30 留存、WAW 周活跃北极星指标（Asia/Shanghai 日界分桶），仅拥有者/管理员可见。
- **compose cron 调度容器**：`cron` 服务复用 app 镜像跑 busybox crond，定时调用 due-reminders（每日）与 cleanup-uploads（每周一），CRON_SECRET 鉴权 + CRON_TZ 时区可配。
- **CHANGELOG**（本文件）与版本号管理；CI 支持 `v*` tag 触发发版流水线。

### Security

- **RLS 全表收编**：chat_presences / message_reads / calendar_connections / task_calendar_events 四表纳入行级安全（19 张业务表全覆盖，FORCE RLS + corps_app 最小权限角色）。
- **防复发静态检查**：RLS 裸查询守卫（禁 `prisma.$queryRaw` 直查业务表，表清单同步）与 compose env 覆盖检查（代码 env 引用 ⊆ compose 透传），均已实证拦截力。
- **CI 加固模式回归**：test-hardened job 以 corps_app 角色连接 + FORCE RLS 激活后跑全量集成测试，与生产同构。

### Fixed

- IM 附件孤儿文件清理落地（cron 化，磁盘不再单调增长）。
- 日历同步在 RLS 加固模式下的跨工作区扫描修复（`calendar` op 逃生口）。
- E2E 回归：session cookie 名按 NODE_ENV 动态检测、Playwright 受控输入回滚、strict locator 违规等 CI 稳定性问题。
- i18n 键化系统性 bug：labelKey 曾带命名空间前缀导致 `tStatus("status.todo")` 查找 `status.status.todo`（生产会显示键名）。

### 遗留（下一版本）

- 法务文档（隐私政策/服务条款）已填入真实联系邮箱（winger35@163.com）并如实标注个人开发者运营；后续注册公司/个体主体后，需更新运营主体表述与增值税发票条款。

## [0.1.0] - 2026-08-24

内部开发版：多租户看板协作 MVP（任务/评论/决策记录/IM 聊天/成员/邀请）、Better Auth 认证、PostgreSQL RLS 租户隔离、Stripe 订阅、日历集成（Google/Outlook）、E2E/集成/单元测试基线与 CI 流水线。
