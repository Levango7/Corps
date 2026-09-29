# T2 复核：矩阵域内 20 条 ad-hoc 角色判断，逐条判"真门禁 / 假门禁"

日期：2026-09-29 方式：只读精读每个写 handler 的代码块（handler 级切片）
范围：`scripts/permission-gate-adhoc-baseline.txt` 的全部 20 条
（由 `scripts/check_permission_gates.py` 的 T2 档定义：位于 `v1/workspaces/[wid]` 且首段能映射到
`lib/permissions.ts` 的 12 个模块，但代码块里没有 `requirePermission(/checkPermission(`，只有角色字面量比较）

## 一、结论（先说推翻了我自己的怀疑）

1. **20 条全部是有效门禁，没有一条是"只校验目标对象角色而放行调用者"的假门禁。**
   我在建立 T2 档时的假设是"宽松匹配可能命中会话成员角色、被加入者角色这类**目标**角色，
   于是接口可能实际零门禁"。**实测不成立**：凡是取目标角色的地方，都同时存在对调用者本人的判断
   （`conversations/{cid}/members/{uid}` 的 `myMembership` 与 `targetMembership` 是并列两道判断，
   见 `members/[uid]/route.ts:57-59` 与 `:62/:71`）。这条假设如实作废。
2. 但 T2 档**保留**：它的语义不是"这些是缺陷"，而是"这些没走矩阵、且矩阵目前无法等价表达"。
   20 条里只有 8 条能机械替换成 `requirePermission`，其余 12 条分属三个矩阵里没有的轴。
3. **收敛 T2 的前置条件是给矩阵加轴，不是"接一下调用就行"。**把 12 条硬换成单轴的
   `requirePermission(ctx, module, action)` 会**改变行为**（见第四节的两处方向性风险）。

## 二、逐条判定

| # | handler | 比较的是什么 | 证据（文件:行） | 判定 | 矩阵能否等价表达 |
|---|---|---|---|---|---|
| 1 | POST `labels` | 调用者 workspace 角色 | `labels/route.ts:64` | 有效，**比矩阵严** | ✅ 能 |
| 2 | PATCH `labels` | 同上 | `labels/route.ts:197` | 同上 | ✅ |
| 3 | DELETE `labels` | 同上 | `labels/route.ts:126` | 同上 | ✅ |
| 4 | POST `milestones` | 同上 | `milestones/route.ts:65` | 同上 | ✅ |
| 5 | PATCH `milestones` | 同上 | `milestones/route.ts:186` | 同上 | ✅ |
| 6 | DELETE `milestones` | 同上 | `milestones/route.ts:121` | 同上 | ✅ |
| 7 | POST `members/invite` | 同上 | `members/invite/route.ts:29` | 有效，与矩阵 `members` 一致 | ✅ |
| 8 | POST `documents/batch-permissions` | 同上（`:49` 取值，`:86` 拒绝） | `documents/batch-permissions/route.ts:49,86` | 有效，**比矩阵严** | ✅ |
| 9 | PATCH `documents/{id}` | workspace 角色 **且** 文档级权限 | `documents/[id]/route.ts:108-125` | 有效，双轴 | ❌ 缺文档权限轴 |
| 10 | DELETE `documents/{id}` | 同上 | `documents/[id]/route.ts:240-257` | 有效，双轴 | ❌ |
| 11 | PATCH `conversations/{cid}` | **会话成员角色**（`userId = ctx.payload.sub` 取的是调用者自己的 membership） | `conversations/[cid]/route.ts:122-135` | 有效 | ❌ 缺会话角色轴 |
| 12 | DELETE `conversations/{cid}` | 会话角色；owner 删会话，非 owner 只删自己的成员记录（= 退群） | `conversations/[cid]/route.ts:218-232` | 有效；退群属**自我操作** | ❌ 且需豁免 |
| 13 | POST `conversations/{cid}/members` | 调用者的会话角色 | `members/route.ts:137-150` | 有效 | ❌ |
| 14 | PATCH `conversations/{cid}/members/{uid}` | muted 分支仅允许 `uid === userId`（本人）；改角色分支要求调用者会话角色 `owner` | `members/[uid]/route.ts:168-171,193-195` | 有效；静音属**自我操作** | ❌ 且需豁免 |
| 15 | DELETE `conversations/{cid}/members/{uid}` | 调用者会话角色 isManager，另加"不得移除 owner"的目标保护 | `members/[uid]/route.ts:57-59,62,71` | 有效（两道判断并列，非"只看目标"） | ❌ |
| 16 | DELETE `conversations/{cid}/messages/{mid}` | 作者本人 **或** 会话管理员 | `messages/[mid]/route.ts:212-217` | 有效 | ❌ 缺属主轴 |
| 17 | PATCH `tasks/{id}/comments` | 作者本人 或 workspace owner/admin | `tasks/[id]/comments/route.ts:305` | 有效，**作者分支比矩阵松** | ⚠️ 见第四节 |
| 18 | DELETE `tasks/{id}/comments` | 同上 | `tasks/[id]/comments/route.ts:230` | 同上 | ⚠️ |
| 19 | PATCH `documents/{id}/comments/{commentId}` | 同上形 | `comments/[commentId]/route.ts:63` | 同上 | ⚠️ |
| 20 | DELETE `documents/{id}/comments/{commentId}` | 同上 | `comments/[commentId]/route.ts:173` | 同上 | ⚠️ |

按轴归类：单轴可入矩阵 **8** 条（1-8）/ 会话角色轴 **6** 条（11-16）/ 文档权限轴 **2** 条（9-10）/
属主+角色混合 **4** 条（17-20）。8+6+2+4=20，与基线条数吻合。

## 三、复核过程中的两次自我纠错（避免这些数字被别人当结论）

- **属主轴不能用正则判定。**我一度给门禁加了"含属主判断"计数列，实测严格正则命中 T1=3，
  其中 `POST tasks/{id}/conversation` 是**假阳**（`:38` 只是 `const userId = ctx.payload.sub` 赋值，
  不是比较）；换宽口径又命中 12 条且混入大量 `createdBy:` 赋值。两个方向都不可信 → **该计数列已撤回**，
  本文里的属主判定全部来自逐条读代码，不来自正则。
- **我的临时核对脚本曾报 3 条 "PATH-NOT-FOUND"**，原因是用 `Path.glob()` 拼含 `[id]` 的路径时，
  `[abc]` 被当作字符类而不是目录名。门禁主脚本用 `rglob("route.ts")` 遍历真实目录，不受影响；
  该问题只存在于我的一次性验证脚本，已改用显式路径拼接复验。

## 四、两处方向性风险（收敛时必须先决策，不能顺手改）

1. **改成 `requirePermission` 会放宽权限（3 组）**：`labels`/`milestones` 现在只允许 owner/admin，
   而矩阵里 `member.tasks = "crud"`；`documents/batch-permissions` 同理（`member.documents = "cr"`）。
   机械替换等于给 member 开出建标签/里程碑/批量授权的能力——**这是安全回归方向**，
   需要产品确认"到底谁该能建标签"，再决定是收紧矩阵还是保留 ad-hoc。
2. **"作者本人"分支会放行 viewer（4 条）**：评论的 PATCH/DELETE 判的是 `isAuthor || isAdmin`。
   矩阵声明 viewer 对 tasks/messages 只有 `r`，但一个被降级为 viewer 的成员仍可改/删自己此前的评论。
   要么在矩阵里显式表达"作者例外"，要么在路由层对 viewer 追加拒绝——**现在的状态是声明与执行不一致**，
   与 `f2f926ed` 修掉的那类问题同源，只是方向相反（这里是偏松，不是偏严）。
3. **自我操作需要显式豁免**：退群（#12）与静音自己（#14）语义上不是"写租户内容"。
   若按矩阵一刀切，viewer 连退群都会被 403。建议与现有 `*/read`、`*/share/verify` 豁免同列处理。

## 五、这份复核没有做什么

- 没改任何路由代码，没动任何鉴权行为（纯只读）。产物只有本文与 T2 基线的注释。
- 没做运行时验证：viewer 实际请求会不会 403，属于集成腿，本机无 dev server + DB 跑不了。
  因此第四节的两个风险是**代码语义推导**，不是实测行为。
- 没复核 T3/T4（矩阵外 170+33 条）。它们连"资源应有权限"都还没定义，需要产品先给矩阵补模块。
