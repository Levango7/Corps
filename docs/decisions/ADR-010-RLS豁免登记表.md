# ADR-010: RLS 豁免登记表与只允许收缩门禁

> 状态：已采纳  
> 日期：2026-10-01  
> 关联：ADR-006（D3 身份域豁免）、ADR-009、`scripts/check_rls_coverage.py`、`scripts/check_rls_exemptions.py`、`db/rls-activate.sql`、`README.md:56`

## 背景

引擎层 RLS 覆盖 `db/rls-activate.sql` 里的 **79** 张表，而 `schema.prisma` 有 **99** 张表 ⇒ **20 张未覆盖**。

此前两份门禁都有同一个盲区：

- `check_rls_coverage.py` 的判据集合是"含 `workspaceId` 的模型"，**没这个字段的表根本不进比较**；
- `check_schema_migration_drift.py` 只管表在不在，不管防不防。

结果：任何人新增一张不带 `workspaceId` 的表，只要它有 `CREATE TABLE` 迁移，CI 三项门禁全部沉默——豁免是**默认拿到**的，不需要任何人评审。

另外，`README.md:56` 对这 20 张的**成因分类是错的**（数字 20 对，构成错）：它把 3 张有 `userId` 的用户级表和 1 张无任何归属键的审计表算进"仅带父级外键的子表（13 张）"，又把其中真正的子表 `yjs_persistence` 单列。这正是本仓库的老毛病——数字对、定性错。

## 取证方法（可复现，三条都是硬要求）

1. **表名只认 `@@map`**。99/99 个模型都显式写了 map；"模型名小写加 s"这个猜测会把表判错（曾经把 3 张漂移表误报成 17 张）。缺 `@@map` 直接判红，不许回退到猜。
2. **覆盖集 = `FOREACH … IN ARRAY ARRAY[…] LOOP` 批量段 ∪ 独立 `ALTER TABLE … ENABLE ROW LEVEL SECURITY`**，解析前先剥 `--` 与 `/* */` 注释——注释里出现过表名，不剥就能被伪造成"已覆盖"。
3. **父级关联用 Prisma 自己的 `@relation(fields: [...Id])` 判**，即"该模型是否连到一个含 `workspaceId` 的模型"，不做表名/列名匹配猜谜。

## 决定

### 1. 20 张表冻结为基线，只允许收缩

`scripts/check_rls_exemptions.py` 的 `BASELINE`。两类不闭合都判红：

- `EXEMPT_NEW`：出现基线外的未覆盖表 ⇒ 新表未经评审就拿到豁免；
- `EXEMPT_STALE`：基线里的名字已不在未覆盖集合 ⇒ 那行必须删，否则基线虚胖、下轮看不出退化。

另加一条**不进基线**的硬约束 `HARD_GAP`：含 `workspaceId` 却不 ENABLE RLS = 真越权面，不接受任何登记豁免。

### 2. 分类与各自风险（这才是需要写清楚的部分）

**P 类 · 有租户父级，靠同事务回滚兜底（10 张）**
`ai_messages`、`assistant_messages`、`database_fields`、`database_records`、`database_views`、`decision_action_items`、`file_versions`、`key_results`、`meeting_participants`、`yjs_persistence`

父表已 ENABLE + FORCE RLS，因此在同一事务里跨租户写入会被父表策略拒绝而整体回滚。但这是**纵深防御少一层**，不是等价保护：独立事务写入、或父表行已存在而只改子表的路径，不会被父表策略拦住。

**G1 · 身份域（4 张，永久豁免）** `users`、`sessions`、`accounts`、`verifications`
Better Auth 自管，无租户键。见 ADR-006 D3。

**G2 · 支付幂等（2 张，永久豁免）** `processed_payment_events`、`processed_stripe_events`
webhook 处理发生在租户上下文之外，必须能跨租户读写才能判重。

**G3 · 用户级，有主表（3 张）——最便宜的可收编项**
`notification_preferences`、`push_tokens`、`ai_voice_preferences`，三张都有 `userId` → `users`。

> 关键事实：**引擎层按用户隔离的机制已经存在**，不需要新建。`db/rls-activate.sql` 里 `current_setting('app.user_id')` 出现 27 次、`app.user_id` 相关判定 31 处，注入点在 `web/lib/auth.ts:177`（`set_config('app.user_id', $1, true)`），`workspaces` 表策略已按成员资格用过它。所以给这三张加 `USING (userId = current_setting('app.user_id'))` 是**策略级改动 + 回归**，不是架构改动。

> 佐证机制已在生产用的另一条事实：受引擎层保护的 **79** 张表里，有 **8 张并不含 `workspaceId`** ——`workspaces`（按成员资格）、`conversation_members`、`chat_presences`、`message_reads`、`calendar_connections`、`task_calendar_events`、`task_labels`、`push_subscriptions`。也就是说"非租户键表也能上 RLS"这件事本仓库已经做过 8 次，G3/G4 不是首例。（此前 `README.md` 把"79 张"写成"71 个租户模型对应 79 张表"，读起来像模型与表一对多，且完全没提这 8 张——已一并更正。）

**G4 · 无任何归属键（1 张）——20 张里最不该裸奔的**
`share_access_logs`：列只有 `entityType` / `entityId` / `ip` / `userAgent` / `accessedAt`。里面是分享链接的访问审计（含 IP 与 UA，属个人数据），既无租户键也无用户键 ⇒ 拿到 `corps_app` 连接凭据即可通读全库分享访问记录。收编需要先决定归属：写入时反查 `entityId` 对应的 `workspaceId` 存成列（推荐，代价是多一次查询），或永远只在父表事务内写。

### 3. 门禁自己也要被门禁

CI 的 `rls-coverage` job 同时跑 `--self-test`：五类注入变异各自断言"因正确的红因变红"。这条不是装饰——写这份脚本时第一版 fixture 把 `@@map` 误写成 `@map`，四条变异全部因同一个 `NO_MAP` 变红，输出看着"变异都被抓"实则一次没测到。**只要求"变红"的自检是假的自检，必须断言红因。**

## 后果

- 新增无租户键的表时，必须同时改 `BASELINE` 并说明其读路径，否则 CI 红。评审成本从 0 变成 1 次显式改动。
- `README.md:56` 的分类同步改成 P=10 / G1=4 / G2=2 / G3=3 / G4=1。
- **本 ADR 不改变任何运行时行为**：不动 SQL、不动策略、不加迁移。所以越权面大小与采纳前完全一致，风险敞口未增未减。这是刻意划界——把"要不要真收编"留给一次带迁移与完整回归的独立变更，不和"加判据"混在一个提交里。

## 取向与裁决（2026-10-01 三项均已落定，实施结果见文末实施记录）

1. **G3 三张是否立刻收编**：机制现成，代价是必须验证"所有读写这三张的路径都注入了 `app.user_id`"，尤其 cron 与分享态（`app.public_token` 有 4 处）下会拿不到 user_id ⇒ 需要 `NOBYPASSRLS` 加固模式回归跑一遍才知道会不会静默变空。**裁决：先以 `push_tokens` 单表试点（已实施，加固回归两腿跑绿），`notification_preferences` / `ai_voice_preferences` 观察试点在加固 CI 的表现后按同法逐张收编。**
2. **G4 `share_access_logs` 的归属键**：写入时反查 `workspaceId`（多一次查询）还是改成只记哈希化标识以缩小个人面。**裁决：反查落列——`workspace_id` 可空，历史孤儿行落 NULL（不匹配任何 GUC、对应用不可见），已实施（迁移 `20261001000001`）。**
3. **P 类 10 张是否逐张补独立策略**：现在只有"同事务回滚"这一层；要不要给它们也上 `workspaceId` 派生策略，取决于是否接受"跨表批量写/独立事务写"这类路径的残余风险。**裁决：不补独立策略，维持"同事务回滚"兜底，登记为已接受残余风险（见实施记录 3）。**

## 实施记录（2026-10-01 起，按推荐组合逐项独立提交）

1. **G3 · 单表试点已实施（`push_tokens`）**——受保护表 79→80、策略 264→268、基线 20→19。四处改动：
   - `db/rls-activate.sql`：增四条用户级策略（SELECT/INSERT/UPDATE/DELETE）。**无 cron 逃生口**——唯一跨用户读路径 `sendPushToUser` 以【目标用户】身份 `withGuc({user_id})` 查库，不存在"以系统身份跨用户读"的时刻；
   - `web/app/api/v1/push/register/route.ts`（upsert / deleteMany）与 `web/lib/push/unified.ts`（findMany）：裸 prisma 直调改为 `withGuc` 注入 `app.user_id`；
   - `db/rls-smoke.sh`：新增引擎级断言四条（自可见=1 / 跨用户读=0 / 跨用户 UPDATE=0 行 / 未注入 GUC=0）；
   - `web/tests/integration/push-tokens.test.ts`：写入注册/注销/鉴权/幂等路径，随 `NOBYPASSRLS` 加固回归两腿都跑。
   `notification_preferences` / `ai_voice_preferences` 暂留基线，观察单表试点在加固 CI 的表现后按同法逐张收编。
2. **G4 · 已实施（`share_access_logs`，反查落列方案）**——受保护表 80→81、策略 268→272、基线 19→18，"无任何归属键"一类清零。改动：
   - `web/prisma/migrations/20261001000001_add_share_access_logs_workspace_id/`：加可空 `workspace_id` 列 + 按 `entity_type` 从 `tasks`/`documents` 回填存量行 + 索引 + `ON DELETE CASCADE` 外键。可空是设计：历史孤儿行（实体已删）反查不到归属，落 NULL 后不匹配任何 GUC，对应用与公开路径均不可见——宁可审计行不可读，也不放错行；
   - `web/prisma/schema.prisma`：`ShareAccessLog.workspaceId String?` + 关系 + `@@index`，Workspace 补反向关系；
   - 三个写入/读取点：两条 workspace 版 verify 路由创建时直接落 `workspaceId: wid`；公开路径 `/api/documents/share/[token]/verify` 凭 token 读出文档行后，用 `setTxGuc(tx, "workspace_id", doc.workspaceId)` 临时放行本事务日志写入（`runWithShareToken` 只有 `public_token`，不能靠它写租户表）；`share/logs` 读取路由本就跑在 `runWithWorkspace` 下，零改动；
   - `db/rls-activate.sql`：批量数组登记 + 四条工作区级策略（无 `auth_op` 逃生口）；`db/rls-smoke.sh` 增至 8 步（自可见=1 含孤儿行不可见 / 跨租户读=0 / 跨租户 UPDATE=0 行 / 孤儿行 UPDATE=0 行 / 未注入 GUC=0）。
3. **P 类 10 张 · 已登记为"已接受残余"（维持兜底，不再实施）**：
   - 残余敞口形态：这 10 张比其余 81 张少一层引擎层网——应用层若有一条漏了 `workspaceId` 过滤的读/写路径，RLS 不会兜住。当前事实是现有写入路径都在父表/主事务内（父表 FORCE RLS 拒绝即整体回滚，这正是"同事务回滚"兜底成立的前提），无"独立事务写子表"或"只改子表"的在用路径；
   - 不补策略的理由：逐张补需从父级反查归属（多一跳）或写派生策略（复杂易错），换来的是纵深防御补一层，而非关闭一个当前可达的越权面；与 G4 不同——那张装 IP/UA 审计且完全无归属键（谁拿到 `corps_app` 凭据就能通读全库），属"最不该裸奔"，已单独收编；
   - 重审触发条件：一旦出现对子表的独立事务写、跨表批量写、或只改子表不改父表的 API，本裁决作废须重审；届时做法即"G4 式反查落列"或"事务内联查父表"。
