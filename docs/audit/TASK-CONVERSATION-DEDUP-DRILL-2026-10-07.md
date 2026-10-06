# 任务会话去重迁移：演练记录与待批事项（#26）

日期：2026-10-07
状态：**迁移与 schema 改动已写好并在本机演练通过，未提交**——它会删数据，点头才落地
被测态：`main` = `80174c70`；演练全部在**我自己的临时库**上做，未写用户任何库

---

## 1. 要解决什么

`Conversation.taskId` 上没有唯一约束，而任务聊天的 get-or-create 曾有并发竞态：并发的两次
POST 各自 `findFirst` 都查不到，于是都走 create，一个任务被建出多条会话。API 层已用
`pg_advisory_xact_lock` 收口（`web/app/api/v1/workspaces/[wid]/tasks/[id]/conversation/route.ts:56-65`，
回归用例 `tests/integration/task-conversation-idempotent.test.ts`）。**剩下的历史数据没有收口**：
读取侧 `conversation.findFirst({ where: { taskId } })` 没有 orderBy，命中的会话与消息实际写入的
会话可能不是同一条 ⇒ 用户"发出去的消息自己看不到"。本迁移把这条不变量交给数据库。

## 2. 关键设计点（每条都对应一次实测）

| 点 | 处置 | 为什么 |
|---|---|---|
| survivor 选谁 | 同 task_id 组内 `created_at` 最早，并列取 `id` 字典序最小 | 确定性；换人重跑得到同一条幸存会话 |
| 子表顺序 | **先搬后删** | `messages`/`conversation_members`/`chat_presences` 对 `conversations` 的 FK 实测全是 `ON DELETE CASCADE`（`pg_constraint.confdeltype='c'` 三行），颠倒顺序等于删消息 |
| 撞唯一约束的成员行 | `INSERT … ON CONFLICT DO UPDATE` 并入，再整体删 loser | 直接 UPDATE 改址在"同一用户出现在多条重复会话"时撞 `@@unique(conversation_id,user_id)`；对 >2 条重复同样成立（GREATEST/LEAST/OR 满足结合律）|
| `last_read_at` 的 NULL | 用 CASE 保 NULL，不写 `GREATEST(COALESCE(...))` | 后者会把"从没读过"变成"1970 年已读"⇒ 未读数凭空归零 |
| 唯一索引形态 | `CREATE UNIQUE INDEX ON conversations(task_id)` | Postgres 唯一索引不约束 NULL ⇒ `task_id IS NULL` 的独立 IM 会话不受影响（实测两条可并存）|
| schema.prisma | 同步加 `@@unique([taskId], name: "uq_conversations_task_id")` | 不加则下次 `migrate dev` 会把这个索引 DROP 掉（迁移与声明必须同批）|

## 3. 演练结果（全部在本机 Docker 里的临时库）

| 演练 | 做法 | 结果 |
|---|---|---|
| 干净库全量部署 | 新建 `corps_drill` → `prisma migrate deploy`（含新迁移）| rc=0，`All migrations have been successfully applied` |
| 仓库自带漂移门禁 | `scripts/check_schema_migration_drift.py --database-url …`（权威模式，psql 走 `DRIFT_CHECK_PSQL` 包进容器）| **PASS**：`schema.prisma: 99 表 / 944 列`，实际 100/954，声明对象齐备 |
| **升级路径**（最贴近生产） | 新建 `corps_upg` → 先只部署旧迁移 → 造 3 条重复会话 + 3 条消息 + 4 条成员 + 3 条在线状态 → 放回新迁移 → `migrate deploy` | 只应用新迁移，rc=0 |
| 升级后语义核验 | 12 条断言 | 全部符合预期：每组剩 1 条且幸存的是最早那条；**消息 3 条一条没丢**且都指向 survivor，孤儿 0；成员并成 3 行（读标取大=10-06 02:00、入群取早=10-01、muted 取或=true、owner 身份保住、U3 的 NULL 读标仍是 NULL）；在线状态 2 行且 `last_seen` 取大=10-06 |
| 反向断言 | 再插一条同 task_id 的会话 | 被数据库拒绝（`uq_conversations_task_id`）|
| 对照断言 | 插两条 `task_id IS NULL` 的会话 | 成功并存（IM 不受影响）|
| 幂等 | 无重复时重跑映射 + `CREATE UNIQUE INDEX IF NOT EXISTS` | loser 数=0，索引已存在则 skip，全程 no-op 不报错 |
| 角色陷阱 | 以 `corps_app`（NOBYPASSRLS）跑同一迁移 | `SELECT 0` ⇒ 所有 DML 静默 no-op，最后 `CREATE UNIQUE INDEX` 因 `must be owner of table conversations` 终止（rc=3，**0 行被删**）。结论：本迁移必须用表属主跑；更一般地，**纯 DML 的迁移在这种角色下会"0 行生效却判成功"** |

## 4. 真实库里到底会删多少（本轮实测）

用只读事务（`BEGIN; SET LOCAL TRANSACTION READ ONLY; … ROLLBACK;`）查用户开发容器 `corps-postgres`：

| 库 | 受影响任务 | 待删会话行 | 需改址消息 | 需并入成员/在线状态 |
|---|---|---|---|---|
| `corps` | 0 | 0 | 0 | 0 |
| `corps_release_check` | 0 | 0 | 0 | 0 |
| `corps_test` | — | — | — | 该库**没有 conversations 表**（查询直接报错，未落到"0"这个结论上）|
| `corps_shadow` | — | — | — | 同上 |

也就是说：**在我能读到的库里，去重部分是 no-op，这笔迁移的实际净效果只有"加一个唯一索引"。**
历史"78 个任务带 >1 条会话"是 2026-10-05 在隔离演练库里测的（见路由注释 §1 出处），不是这些库。
**我看不到的库**（例如按 runbook 部署出去的那套）没有实测数据——那里可能真有重复行，
所以"要不要执行删除"这个决定权仍然在你，不能由我用"我这边的库是 0"替你担保。

## 5. 待你点头的三选一

1. **按原样落地**（迁移 + `@@unique`，同一 PR）：在我能读到的库上删 0 行；在生产同构库上若有重复，
   会先并子表再删多余会话。回滚方式：迁移文件 + `_prisma_migrations` 记录已在，回退需手写
   `DROP INDEX` + 恢复会话行（**删掉的会话行不可自动恢复**，所以演练里我把"消息不丢"做成硬断言）。
2. **只加约束、不删数据**：先 `CREATE UNIQUE INDEX` 会在有重复时直接失败 ⇒ 这条路等价于
   "先人工确认没有重复"。适合你想先看一下部署库的数（第 4 节那条只读 SQL 可直接复用）。
3. **带备份的落地**：迁移前先 `pg_dump --table=conversations --data-only` 留一份，再执行。
   这是我在第 1 项之上会推荐的加固，成本一次 dump。

需要顺带定的一件事：迁移与 schema 声明**必须同一笔提交**，否则下一次 `prisma migrate dev`
会把这个索引 DROP 掉（第 2 节最后一行）。

## 6. 落盘位置

迁移正文（含上面每条设计点的注释）已写好，未提交，路径：
`web/prisma/migrations/20261007000000_dedup_task_conversations/migration.sql`（在我的私有工作树
`F:/Nexus/corps-audit-wt`），配套的 `schema.prisma` 改动在同一工作树。点头后我把它带进 `main`
并按第 3 节的顺序重跑一遍（干净库部署 + 漂移门禁 + 升级演练）再推。
