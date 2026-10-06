# 跨用户站内通知在 FORCE RLS 下 500（notification.create × RETURNING）

日期：2026-10-06 ～ 2026-10-07
范围：`web/app/api/v1/workspaces/[wid]/approvals/**`（已修）、`tasks/**`（实测未受影响，见 §5）
发现方式：给 #32（审批抄送端点缺 GET）补集成测试，推上去后被 `Test (hardened RLS mode)` 腿判红

---

## 1. 结论

审批族的 6 个端点（cc / approve / reject / transfer / delegate / add-sign）在生产同构的
RLS 形态下**返回 500，动作完全不落地**。触发条件是两个前提同时成立：

1. 调用点给 `runWithWorkspace(wid, fn, userId)` 传了第三个参数 ⇒ 事务里
   `app.user_id = 操作者`；
2. 要写的通知**接收者不是这个操作者**。

机理：`tx.notification.create()` 发的是 `INSERT … RETURNING`，而 PostgreSQL 要求
RETURNING 出来的行**再过一遍该表的 SELECT 策略**。`notifications` 的 SELECT 策略是
`workspace_id = app.workspace_id AND (app.user_id 未设置 OR user_id = app.user_id)`
（`db/rls-activate.sql` DL-17 的拆分；它刻意不给 SELECT 放行他人行）。
于是"给他人发通知"在 `app.user_id` 被设成操作者时被 WITH CHECK 拒绝：

```
code: "42501"  message: new row violates row-level security policy for table "notifications"
```

异常发生在事务内的**最后一次写**之后 ⇒ 整个事务回滚 ⇒ 抄送记录/审批操作一起消失，
端点 500。这不是"通知没发出去"的静默降级，而是主流程失败。

## 2. 复现矩阵（同库、同角色、同事务、同 GUC）

在 hardened 容器（应用以 `corps_app` 连库，`127.0.0.1:34572`）内用应用自带的 Prisma
client 直接跑，逐条只改一个变量。脚本：`/tmp/repro_cc_mech.cjs`（仓库外，一次性）。

| # | 写法 | 接收者 | 结果 |
|---|---|---|---|
| 1 | 裸 SQL `INSERT … RETURNING` | ≠ `app.user_id` | **FAIL**（42501 同一条）|
| 2 | 裸 SQL `INSERT`（无 RETURNING）| ≠ `app.user_id` | OK |
| 3 | `notification.createMany` | ≠ `app.user_id` | OK |
| 4 | `notification.create` | = `app.user_id`（自己）| OK |
| 5 | `notification.create`（事务内先把 `app.user_id` 切成接收者）| ≠ 原操作者 | OK |

判读：#1 与 #4/#5 一起排除了"Prisma 的 bug"和"连接没带上 GUC"两种猜测——**决定性变量
只有 RETURNING 与 `app.user_id` 是否等于接收者**。修复面因此落在"怎么写"，不需要动策略强度。

HTTP 面复核（同一 hardened 容器，集成测试）：

| 端点 | hardened（修复前）| hardened（修复后）| owner 角色（RLS 被绕过）|
|---|---|---|---|
| `POST .../cc` | 500 | 200 | 200 |
| `POST .../approve` | 500 | 200 | 200 |
| `POST .../reject` | 500 | 200 | 200 |
| `POST .../transfer` | 500 | 200 | 200 |
| `POST .../delegate` | 500 | 200 | 200 |
| `POST .../add-sign` | 500 | 200 | 200 |

服务端日志逐条对应：`[POST approve] error` / `[POST reject] error` /
`[POST transfer] error` / `[POST delegate] error` / `[POST add-sign] error` /
`[POST approval-cc] error`，失败调用共 14 次，全部是
`Invalid 'prisma.notification.create()' invocation`。

## 3. 为什么这条洞能活到今天

两条独立原因叠加：

1. **CI 的 Test 腿看不见。** 非硬化的 `Test` job 用 `postgres` 连库（超级用户，
   隐含 BYPASSRLS），RLS 策略整个被绕过；只有 `Test (hardened RLS mode)` 腿以
   `corps_app` 起 `next dev`（ci.yml:366-385），策略才真实生效。
2. ** hardened 腿也看不见，因为旧用例从不走跨用户分支。** `approve/route.ts:152` 的
   通知写在 `if (instance.applicantId !== ctx.payload.sub)` 里，而既有审批用例把
   "申请人"与"审批人"设成同一个人 ⇒ 该分支从未执行过。新加的
   `approval-cross-user.test.ts` 就是专门走这条分支的。

附带一条自我更正：本轮我先在 **owner 角色**的 Docker 容器上验完了 #32/#33 才推代码
（`corps-audit-img:f617c046`，DATABASE_URL 用 postgres），所以本地"全绿"是
**RLS 被绕过的条件下的全绿**，对 hardened 腿没有任何证明力。把"生产同构"当成
验证前提，是这次付出的主要代价。

## 4. 修复

新增 `web/lib/notification/record.ts` 的 `notifyUsers(tx, rows)`，内部用
`createMany`（无 RETURNING，只过 INSERT 策略；INSERT 策略仅按 workspace 判定，
是 DL-17 明确允许的"系统给他人写通知"路径）。6 个审批站点全部改走它，机理注释只写在
helper 一处。

选择 `createMany` 而非"把 `app.user_id` 切成接收者"的理由：后者会在同一事务里改变后续
所有语句的可见行集，属于把安全作用域当参数传，风险面比"少一个 RETURNING"大得多。

## 5. 没改的相似站点，以及它们为什么现在是安全的

| 站点 | 状态 | 依据 |
|---|---|---|
| `tasks/[id]`、`tasks/[id]/comments`、`tasks/[id]/decisions` | 绿，未改 | 它们调 `runWithWorkspace(wid, fn)`（**不传 userId**）⇒ 容错分支放行。已用 `task-cross-user-notify.test.ts` 3 条钉住；**若将来给任务族补上 user 作用域，这三条会变红，届时必须改走 notifyUsers** |
| `lib/notification/offline-push.ts:239` | 绿，未改 | 它把事务作用域切到了接收者：`runWithWorkspace(opts.workspaceId, fn, opts.userId)` |
| `app/api/cron/*` 两处 | 未测 | cron 走 `runWithAuthOp("cron", fn)`，`app.user_id` 不设 ⇒ 同容错分支；但 cron 路径不在本轮测试覆盖内，未做实测不下"安全"结论 |
| `lib/ai/executor.ts:191`、`lib/workflow/executor.ts:318` | 未改 | 两处都**使用 create 的返回行**（`created.id`），换 createMany 要改调用契约；`workflow/executor` 还直接用全局 `prisma`（不带 GUC）。这两处是**已知待办**，不是已验证安全 |

## 6. 复跑方式

```bash
# hardened 容器（corps_app 连库，指向本轮审计库 127.0.0.1:55441）
cd web && TEST_BASE_URL=http://127.0.0.1:34574/api/v1 \
  npx vitest run tests/integration/approval-cross-user.test.ts \
                 tests/integration/task-cross-user-notify.test.ts \
                 tests/integration/approval-cc.test.ts
# 对照腿（owner 角色，RLS 被绕过）
TEST_BASE_URL=http://127.0.0.1:34573/api/v1 同上
```

### 6.1 本轮验证记录（数字都要带条件，否则下一次复算对不上）

被测态：`main` = `c38c9ae0`（含 `ff4be690` 通知修复、`ff52cb4e` 抄送用例修正、`509ab641` 排版）。
构件：`corps-audit-img:509ab641`（本机 `docker build` rc=0，Windows Docker Desktop / Linux 容器内构建）。
两个容器同一镜像、同一库（`corps-audit-pg-c6e90dfb`，100 表 / 272 策略 / conversations 为 ENABLE+FORCE RLS），
差别只在连接角色：34573=postgres（BYPASSRLS）、34574=corps_app（NOBYPASSRLS）。

| 腿 | 命令范围 | 结果 | 条件 |
|---|---|---|---|
| hardened | `vitest run tests/integration`（24 个文件）| **200 passed / 4 skipped，rc=0** | 热态（容器已 ready、路由已在内存）；`rls-engine` 因未注入 `RLS_SMOKE_*_URL` 退成 skip |
| hardened 补测 | 同上 + `RLS_SMOKE_OWNER_URL/APP_URL` | **4 passed** | 单独跑 `rls-engine.test.ts`，把上面那条 skip 补成实测 |
| owner | `vitest run`（全量：单测 + 集成）| **952 passed / 4 skipped，rc=0**（92 文件）| 与 CI 的 `Test` 腿同口径（不带 coverage 阈值）|
| 类型/lint | `tsc --noEmit`、`eslint` | rc=0 | 在**私有工作树** `F:/Nexus/corps-audit-wt`（detached 到被测 sha）上跑，避开共享树里他人未提交文件 |
| 排版 | `prettier --check` | clean | **必须**用 `git archive` 出 LF 净副本再跑：本机 `core.autocrlf=true` 会把工作树所有 `.ts` 落成 CRLF，直接在 Windows 工作树上 check 会把全仓都报成"不合规"（本轮据此误判过一次，净副本复测后确认只有我 3 个新文件真有超长行未折，已在 `509ab641` 修掉）|

CI 终判（比本机数字权威，条件不同：ubuntu + `next dev` + postgres:18 服务）：
`509ab641` 上 11/12 绿，唯一红的是 `Unit Coverage Ratchet`，报点 `[NEW_ZERO] lib/notification/record.ts`
——门禁自己给了处置口径"新代码要么带测试，要么显式进基线并说明理由"，选择带测试那条
（`e1c976cb`：3 条用例，其中一条把 `create` mock 成抛 42501，所以改回 create 必红）。
把新代码倒进零覆盖基线等于绕过它，没走那条。

一处必须自我更正的**先前验证无效**：#32/#33 我当时报"本机全绿"，用的是 **owner 角色**的容器，
即 RLS 被绕过条件下的全绿，对 hardened 腿没有证明力；真正暴露问题的是推上去之后的 CI
（`Test (hardened RLS mode)` 红）。教训：容器形态验证必须把角色也当成一个被测维度。

## 7. 防回归建议（待拍板，未落地）

`notifyUsers` 的注释能约束人，但约束不了新代码。建议加一条与 `check_permission_gates.py`
同族的门禁：扫 `app/api/**` 里的 `notification.create(`，命中即红（lib/ 下按 §5 清单
白名单放行），并在 CI 里作为独立 step 跑。落这条需要改 `.github/workflows/ci.yml`
并新增 required check，属于共享配置变更，本轮**没有擅自做**。
