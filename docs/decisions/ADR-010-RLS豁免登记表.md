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

## 待决（需要产品/安全取向，非技术障碍）

1. **G3 三张是否立刻收编**：机制现成，代价是必须验证"所有读写这三张的路径都注入了 `app.user_id`"，尤其 cron 与分享态（`app.public_token` 有 4 处）下会拿不到 user_id ⇒ 需要 `NOBYPASSRLS` 加固模式回归跑一遍才知道会不会静默变空。
2. **G4 `share_access_logs` 的归属键**：写入时反查 `workspaceId`（多一次查询）还是改成只记哈希化标识以缩小个人面。
3. **P 类 10 张是否逐张补独立策略**：现在只有"同事务回滚"这一层；要不要给它们也上 `workspaceId` 派生策略，取决于是否接受"跨表批量写/独立事务写"这类路径的残余风险。
