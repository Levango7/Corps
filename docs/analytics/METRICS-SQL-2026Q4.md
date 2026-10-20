# 固定 SQL：北极星 WAW 与决策闭环率（H4 提案）

**状态**：WAW 是 `docs/analytics/FUNNEL-METRICS.md` §2.1 **已批准**的北极星；H4「决策闭环率」
是 `docs/design/PRODUCT-DESIGN-2026Q4.md` §9.1 里的**提案**，尚未被批准为正式护栏。
本文只是把两者的取数**固化成可复跑的 SQL**——试点期要一个数，不需要为它先建一块产品面
（设计方案 §9.1.1 的路径 B）。

**为什么不是端点**：WAW 是跨租户指标，产品从路由到权限都是租户内闭环，没有平台运营方视角；
临时加一个跨租户端点等于引入一个没有权限模型支撑的数据出口。所以试点期用固定 SQL，
真有多租户运营需求时再走「跨工作区端点 + 平台权限模型」。

---

## 0. 公共参数

每段 SQL 顶部都有一段 `params`，改这两行即可（所有时间窗、工作区都从这里来，
避免同一个数在不同人手里有不同口径）：

（片段，不是可独立执行的查询——各段 SQL 自己带 `params`，复制时整段带走即可）

```text
WITH params AS (
  SELECT
    '00000000-0000-0000-0000-000000000000'::uuid AS wid,   -- 工作区；WAW 段不用它
    (now() - interval '14 days')                    AS since,
    now()                                            AS until
)
```

口径约定（与 `FUNNEL-METRICS.md` 附：口径速查卡一致）：

- 一切「日/周」边界 = `Asia/Shanghai`；物理存储是 `timestamptz`（UTC）。
- `CORE_EVENTS` = `session_start | create_task | task_status_change | create_comment | create_decision | invite_member`。
- 决策的「一条」= **同一个 `task_id` 的决策**（`decisions` 表里每个 task 有多行 = 版本历史，
  不是多条决议）。创建时刻取该 task 的 `min(created_at)`，当前版本取 `max(version)`。

---

## 1. 北极星：WAW（周活跃工作区数）

> 定义（已批）：一个自然周（周一 00:00 Asia/Shanghai 起）内产生 ≥1 次 `CORE_EVENTS` 的去重
> `workspace_id` 计数。

```sql
WITH params AS (
  SELECT (now() - interval '12 weeks') AS since
),
core AS (
  SELECT DISTINCT
    e.workspace_id,
    (date_trunc('week', e.created_at AT TIME ZONE 'Asia/Shanghai'))::date AS week_start
  FROM analytics_events e, params p
  WHERE e.workspace_id IS NOT NULL
    AND e.created_at >= p.since
    AND e.name IN ('session_start','create_task','task_status_change',
                   'create_comment','create_decision','invite_member')
)
SELECT week_start, count(*) AS waw
FROM core
GROUP BY week_start
ORDER BY week_start;
```

**读法**：`waw` 是"这一周有几个工作区真的发生了核心行为"，不是人数、不是事件数。
`page_view` / `workspace_switch` / `login_success` 已被刻意排除——"打开看一眼"不构成团队价值证据。

---

## 2. 决策闭环率（H4 提案）——口径 A：按当前状态

> 定义：窗口内产生的决策里，有多少「有关联任务」、有多少「至少一个关联任务当前 `status='done'`」。

```sql
WITH params AS (
  SELECT
    '00000000-0000-0000-0000-000000000000'::uuid AS wid,
    (now() - interval '14 days')                    AS since,
    now()                                            AS until
),
first_decision AS (          -- 每个 task 的决策第一次出现的时间
  SELECT task_id, workspace_id, min(created_at) AS created_at
  FROM decisions, params p
  WHERE decisions.workspace_id = p.wid
  GROUP BY task_id, workspace_id
),
current_decision AS (        -- 每个 task 的当前（最高版本）决策行
  SELECT DISTINCT ON (task_id) id, task_id
  FROM decisions, params p
  WHERE decisions.workspace_id = p.wid
  ORDER BY task_id, version DESC
),
base AS (                    -- 窗口内的决策
  SELECT f.task_id, f.created_at, c.id AS decision_id
  FROM first_decision f
  JOIN current_decision c USING (task_id)
  CROSS JOIN params p
  WHERE f.created_at >= p.since AND f.created_at < p.until
),
linked AS (
  SELECT
    b.task_id,
    count(a.task_id) FILTER (WHERE a.task_id IS NOT NULL AND NOT a.removed)                         AS linked_tasks,
    count(a.task_id) FILTER (WHERE a.task_id IS NOT NULL AND NOT a.removed AND t.status = 'done')   AS done_tasks
  FROM base b
  LEFT JOIN decision_action_items a ON a.decision_id = b.decision_id AND NOT a.removed
  LEFT JOIN tasks t                 ON t.id = a.task_id AND t.workspace_id = (SELECT wid FROM params)
                                   AND t.deleted_at IS NULL
  GROUP BY b.task_id
)
SELECT
  count(*)                                                          AS decisions,
  count(*) FILTER (WHERE linked_tasks > 0)                          AS landed,
  count(*) FILTER (WHERE done_tasks  > 0)                           AS closed_now,
  round(100.0 * count(*) FILTER (WHERE done_tasks > 0) / NULLIF(count(*),0), 1) AS closed_pct
FROM linked;
```

`decisions = 0` 时 `closed_pct` 是 **NULL**（`NULLIF` 的作用），不是 0——展示时别把 NULL 当 0%。

**必须标注口径**：`closed_now` 是"**现在**有任务完成了"，不是"14 天内完成"。
`Task` 表没有完成时间戳（`updatedAt` 会被后续任何编辑顶掉），所以按当前状态算不出时序；
需要时序时用下一节的写法，或给 `tasks` 加 `completed_at`（可空列 + 迁移，属 §6.1，未做）。

---

## 3. 决策闭环率——口径 B：事件流推导「14 天内完成」

> 用 `task_status_change` 事件的 `props.taskId` 回链行动项任务，取首次 `to="done"` 的时刻，
> 与决策创建时刻比较。

```sql
WITH params AS (
  SELECT
    '00000000-0000-0000-0000-000000000000'::uuid AS wid,
    (now() - interval '30 days')                    AS since,
    now()                                            AS until
),
first_decision AS (
  SELECT task_id, workspace_id, min(created_at) AS created_at
  FROM decisions, params p
  WHERE decisions.workspace_id = p.wid
  GROUP BY task_id, workspace_id
),
current_decision AS (
  SELECT DISTINCT ON (task_id) id, task_id
  FROM decisions, params p
  WHERE decisions.workspace_id = p.wid
  ORDER BY task_id, version DESC
),
base AS (
  SELECT f.task_id, f.created_at, c.id AS decision_id
  FROM first_decision f JOIN current_decision c USING (task_id) CROSS JOIN params p
  WHERE f.created_at >= p.since AND f.created_at < p.until
),
linked_tasks AS (
  SELECT DISTINCT b.task_id AS decision_task_id, a.task_id AS action_task_id, b.created_at AS decision_at
  FROM base b
  JOIN decision_action_items a ON a.decision_id = b.decision_id AND NOT a.removed
  WHERE a.task_id IS NOT NULL
),
done_events AS (               -- 每个任务首次进入 done 的时刻
  SELECT
    (e.props->>'taskId')::uuid AS task_id,
    min(e.created_at)           AS done_at
  FROM analytics_events e, params p
  WHERE e.workspace_id = p.wid
    AND e.name = 'task_status_change'
    AND e.props->>'to' = 'done'
    AND e.created_at >= p.since - interval '1 day'
    -- 该列是 json 不是 jsonb（不能用 `props ? 'k'`）；顺带挡住脏值，别让一行坏数据把整条查询打死
    AND (e.props->>'taskId') ~ '^[0-9a-fA-F-]{36}$'
  GROUP BY (e.props->>'taskId')::uuid
)
SELECT
  count(DISTINCT d.decision_task_id)                                                    AS decisions,
  count(DISTINCT d.decision_task_id) FILTER (WHERE de.done_at IS NOT NULL)              AS landed,
  count(DISTINCT d.decision_task_id) FILTER (
    WHERE de.done_at IS NOT NULL AND de.done_at <= d.decision_at + interval '14 days'
  )                                                                                     AS closed_within_14d,
  round(100.0 * count(DISTINCT d.decision_task_id) FILTER (
    WHERE de.done_at IS NOT NULL AND de.done_at <= d.decision_at + interval '14 days'
  ) / NULLIF(count(DISTINCT d.decision_task_id), 0), 1)                                 AS closed_pct
FROM linked_tasks d
LEFT JOIN done_events de ON de.task_id = d.action_task_id;
```

**三条限制必须与数字一起展示**（否则这个率会被当成完整真值）：

1. 埋点自 `94ab5456`（2026-08-24）起才存在 ⇒ 更早的历史任务不在真源里；
2. 只有**经 API** 的状态变更才有事件；直接改库 / 导入 / cron 写状态不产生事件；
3. 客户端事件可丢——批量路径已在 PR #141 收口到服务端逐条发，单条 PATCH 本来就在服务端，
   所以这条风险已收敛，但历史数据里仍有客户端时代的空洞。

---

## 4. 自检：用纯 CTE 夹具验证口径 A 的算术（不写库）

把夹具和算法放在同一条查询里，任何环境都能跑，**不插任何数据**。
预期输出：`decisions=2 landed=2 closed_now=1 closed_pct=50.0 pass=t`。

```sql
WITH fixture_decisions(task_id, version, created_at) AS (
  VALUES
    ('a0000000-0000-0000-0000-000000000001'::uuid, 1, timestamptz '2026-10-01 01:00+08'),
    ('a0000000-0000-0000-0000-000000000002'::uuid, 1, timestamptz '2026-10-02 01:00+08')
),
fixture_items(decision_id, task_id, removed) AS (
  VALUES
    ('a0000000-0000-0000-0000-000000000001'::uuid, 'b0000000-0000-0000-0000-000000000001'::uuid, false),
    ('a0000000-0000-0000-0000-000000000002'::uuid, 'b0000000-0000-0000-0000-000000000002'::uuid, false)
),
fixture_tasks(task_id, status, deleted_at) AS (
  VALUES
    ('b0000000-0000-0000-0000-000000000001'::uuid, 'done', NULL::timestamptz),
    ('b0000000-0000-0000-0000-000000000002'::uuid, 'todo', NULL::timestamptz)
),
linked AS (
  SELECT d.task_id,
         count(i.task_id) FILTER (WHERE i.task_id IS NOT NULL AND NOT i.removed)                       AS linked_tasks,
         count(i.task_id) FILTER (WHERE i.task_id IS NOT NULL AND NOT i.removed AND t.status = 'done') AS done_tasks
  FROM fixture_decisions d
  LEFT JOIN fixture_items i ON i.decision_id = d.task_id
  LEFT JOIN fixture_tasks t ON t.task_id = i.task_id AND t.deleted_at IS NULL
  GROUP BY d.task_id
),
agg AS (
  SELECT count(*) AS decisions,
         count(*) FILTER (WHERE linked_tasks > 0) AS landed,
         count(*) FILTER (WHERE done_tasks > 0)   AS closed_now,
         round(100.0 * count(*) FILTER (WHERE done_tasks > 0) / NULLIF(count(*),0), 1) AS closed_pct
  FROM linked
)
SELECT agg.*,
       (decisions = 2 AND landed = 2 AND closed_now = 1 AND closed_pct = 50.0) AS pass
FROM agg;
```

---

## 5. 运行方式与已知限制

```bash
# 仓库外取连接串（Vercel 上是 Config 类型，CLI 可读），用完立刻删
npx vercel env pull /tmp/corps-prod.env --environment production \
  --scope levango7s-projects --project corps
psql "$(grep '^DATABASE_URL=' /tmp/corps-prod.env | cut -d= -f2- | tr -d '"' | sed 's/?.*//')" \
     -f docs/analytics/METRICS-SQL-2026Q4.md   # 或把对应段落贴进任意客户端
rm -f /tmp/corps-prod.env
```

**限制一（要紧）：Vercel 上的实例没有开 RLS。**
2026-10-21 实测（`pg_class`）：`analytics_events` / `decisions` / `decision_action_items` / `tasks`
四张表 **`relrowsecurity=false`、`relforcerowsecurity=false`**，连接身份是 `neondb_owner`
（`rolbypassrls=true`）。原因是 RLS 激活只在 Docker 的 `docker/entrypoint.sh` 里做
（`RLS_ACTIVATE=true` → 跑 `rls-activate.sql`），**serverless 部署没有 entrypoint**。
⇒ 引擎层租户隔离在该实例上未生效，隔离只剩应用层 `workspaceId` 过滤。
试点若给多个团队用，这是一条需要先处置的安全项（建 `corps_app`（NOBYPASSRLS）+ 跑
`rls-activate.sql` + 把 `DATABASE_URL` 换成该角色），**我没有在生产库上执行任何 DDL**。

**限制二**：WAW 是跨租户查询。在一个**已加固**的实例上，应用角色
（`corps_app`，NOBYPASSRLS）查不到别的租户的行，WAW 会恒为 0——
这类查询必须用 `BYPASSRLS` 的运营连接（当前 Vercel 的 `neondb_owner` 正好是），
或者将来由专门的运营端点承担。**"能算出 WAW"本身就需要一个越权连接**，这正是它没有产品归属面的技术原因。

**限制三**：新库是空的（实测 `workspaces=0 / tasks=0`、`analytics_events=2`），
所以真实查询现在返回 0 —— 这是"还没有数据"，不是"口径坏了"。用 §4 的自检证明算术正确。

**限制四**：`decisions` 是版本表。任何"决策条数"口径都要先声明是按 `task_id` 去重（本文的做法）
还是按行数；按行数会把一次决策的多次修订算成多条，和计费/限额口径（`tasks/[id]/decisions`）
不是一回事。
