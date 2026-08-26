# corps FUNNEL-METRICS 埋点体系实施设计

- **日期**：2026-08-26（2026-08-27 修订）
- **状态**：DRAFT（待评审）→ 三线审核放行条件 P2-1~P2-6 已落实（见各节内联 P2-x 标注），可进入实现阶段
- **依据**：docs/analytics/FUNNEL-METRICS.md（ACCEPTED，2026-08-26）＋ 仓库代码实测核实 ＋ docs/design/tri-line-design-review.md（审核报告，2026-08-26）
- **范围声明**：本文档为实施设计，不含任何产品代码改动。webhook 侧 4 个事件（subscription_activated / payment_failed / subscription_renewed / subscription_churned）由支付线团队顺带落地（见 §2.7），不列入本埋点线实施范围。
- **关联文件**：web/app/api/v1/events/route.ts、web/lib/analytics.ts、web/lib/analytics-server.ts、web/app/api/v1/workspaces/[wid]/analytics/overview/route.ts、web/prisma/schema.prisma

---

## 1. 现状核实结论

### 1.1 行号校准（以代码实测为准）

设计前对 FUNNEL-METRICS.md 引用的行号逐一实测，以下偏差在本文档中一律以实测值为准：

表：FUNNEL-METRICS 行号与实测值对照表

| 引用处 | 文档标注 | 实测位置 | 备注 |
|--------|----------|----------|------|
| register_success 打点 | auth/register/route.ts L77 | L77–82 ✓ | props={plan:"free",seatLimit:10} |
| create_task 打点 | tasks/route.ts L97 | L95–105 ✓ | props={priority,status,hasAssignee,hasDueDate} |
| invite_member 打点 | members/invite/route.ts L209 | **L199–205** | props 仅 {role}，文档标注偏后约 10 行 |
| task_status_change 服务端 | tasks/[id]/route.ts L129 | L122–131 ✓ | props 键名为 `to`（非 toStatus） |
| task_status_change 客户端 | board/page.tsx L175 | **L193** | props={batch:true,count,...patch}，键名未固化 |
| page_view | w/[wid]/layout.tsx L67 | **L73** | 仅登录区触发，结论不变 |
| workspace_switch | w/[wid]/layout.tsx L186 | **L192** | 结论不变 |
| create_decision | tasks/[id]/decisions/route.ts L92 | L90–93 ✓ | — |
| login_success | auth/login/route.ts L67 | L67–73 ✓ | props={workspaceCount} |
| accept 端点幂等标记 | invitations/[token]/accept/route.ts L87/L110 | L85–102/L110 ✓ | acceptedAt 一次性消费 |

### 1.2 对批准文档假设的两处补充发现

1. **服务端事件全部缺失 sessionId**。trackServerEvent（analytics-server.ts L11–16）的入参不含 sessionId，写入时该列恒为 null；而获客段漏斗的 landing_view/click_signup/register_submit 均为客户端匿名事件、只有 sessionId 没有 userId。若不补通道，register_success 无法按 §6.2 的 identity stitching 规则挂回匿名会话，获客段漏斗在序列化口径下断链。**本设计新增基础设施项**：trackServerEvent 增加可选 sessionId 参数，注册 API 接受客户端上报的会话标识（§4.2）。这是对 FUNNEL-METRICS §6.1「同一 sessionId 内自动衔接」假设的必要落地补充。
2. **tasks/batch 路径无服务端打点**。批量状态变更（board/page.tsx L193 → POST /tasks/batch）仅有一条客户端聚合事件，batch/route.ts 内无 trackServerEvent。toStatus 固化（§2.2）只统一键名，不改变此覆盖现状，盲区记录于开放问题。

### 1.3 关键现状事实清单

1. **无营销落地页**：web/app/page.tsx 全文仅 `redirect("/auth/login")`；LANDING.md 为 MVP 落地报告而非营销页设计稿；`/pricing` 路由不存在（并行团队开发中）。页面路由全集＝/auth/login、/auth/signup、/w/[wid]/*。
2. overview 的 daily 聚合是 **JS 内存聚合**（findMany 取全量 + for 循环分桶，route.ts L63–80），不是 SQL 聚合——决定 D1 修复选型（§4.1）。
3. 身份域（users/sessions/accounts）**有意豁免 RLS**（web/docker/init-rls.sql 注释：「身份域有意豁免：Better Auth 托管、无租户键」）；invite/route.ts L28 已有全局 prisma 直查 user 的先例——激活判定读 users.createdAt 无 RLS 障碍。
4. 仓库已有 **partial unique index 手写迁移先例**（prisma/migrations/20260827100000_invitations_partial_unique_index），Prisma schema 层不支持声明式 partial index 但迁移层可行。
5. Invitation 表**无 channel 字段**（schema.prisma L89–105），且已注册用户的邀请走直加路径（members/invite/route.ts L123–176 直接建 member），**不经过 accept 端点**。
6. vitest 已配置（package.json "test": "vitest run"，vitest.config.ts 存在）但尚无单测文件；Playwright e2e 仅 e2e/smoke.spec.ts。
7. 根 layout（app/layout.tsx）是 server component，{children} 位于 L26，可挂载客户端追踪组件。
8. signup 页已有邀请 token 解析逻辑（signup/page.tsx L28–47 useEffect 读 ?invite=），但注册请求体不携带 token，服务端注册时不知道邀请来源。

---

## 2. 逐事件落点设计

### 2.1 新增 9 事件落点总表

打点端 S=trackServerEvent（服务端）/ C=track（客户端）。「幂等策略」列指重复触发的防重手段。

表：新增事件落点对照表

| # | 事件名 | 端 | 文件与落点 | 触发条件 | props | 幂等策略 |
|---|--------|----|-----------|----------|-------|----------|
| 1 | landing_view | C | 新建 web/lib/analytics-attribution.ts + app/layout.tsx 挂 `<PublicPageTracker/>`（L26 children 处） | pathname 命中公开路由集（§5.3）且本次页面加载首次渲染完成后 | { referrer, utmSource?, utmMedium?, utmCampaign?, path, locale } | 每 sid 每路径会话内至多一条：模块级 Set 记录已上报 (sid,path)，SPA 内跳转去重 |
| 2 | click_signup | C | auth/login/page.tsx L127 「创建一个」Link 包 onClick（**本期落地范围收敛为 auth/login 页注册链接**，见裁决一附属） | 用户点击 auth/login 页「注册」CTA | { cta: "header", path: "/auth/login" } | 无需幂等（意图事件，允许多次） |
| 3 | session_start | C | lib/analytics.ts getSessionId() 新建分支（L50–56 改造，见 §2.5） | localStorage 无有效 sid 或已过期，生成新 sid 时同步入队 | { referrer?, language, screenW } | 由 sid 新建语义天然一次性；续期分支不打 |
| 4 | activation_completed | S | workspaces/[wid]/tasks/route.ts POST 成功分支（L94 打点段旁扩展，见 §2.4） | 事务返回 isFirstTask 且 hasAssignee 且 !selfAssigned 且 minutesSinceRegister ≤15 且查重 count=0 | { taskId, minutesSinceRegister } | 事务内查重（每工作区至多一条）＋查询侧 min(created_at) 兜底（§2.4） |
| 5 | invite_accepted | S | invitations/[token]/accept/route.ts result.full 判空后、200 返回前（L118–119 之间插入） | accept 事务成功提交（含 existing member 幂等路径） | { inviterUserId, channel:"link", waitedHours } | invitation.acceptedAt 一次性消费天然保证：二次请求在 L55 被 410 拦截，不会重复到达打点处 |
| 6 | subscription_activated | S | billing/webhook/route.ts checkout.session.completed 分支事务成功后（L102 之后，见 §2.7） | webhook 确认开通且 upsert 提交 | { plan, quantity } | ProcessedStripeEvent 表幂等（T2.7 既有机制）＋查询侧 min 兜底 |
| 7 | payment_failed | S | billing/webhook/route.ts invoice.payment_failed 分支（L123 updateMany 后，见 §2.7） | webhook 扣款失败标记 past_due 后 | { attempt? } | 同上 |
| 8 | subscription_renewed | S | billing/webhook/route.ts **新增 invoice.paid case**（支付线实现，见 §2.7） | billing_reason="subscription_cycle" | { quantity, amountMinor } | 同上 |
| 9 | subscription_churned | S | billing/webhook/route.ts customer.subscription.deleted 分支（L200 事务成功后，见 §2.7） | webhook 确认订阅删除且降级提交 | { reason? } | 同上 |

### 2.2 既有事件 props 增强落点表（5 项）

表：既有事件增强落点对照表

| 事件 | 增加 props | 落点与实现要点 | 动机 |
|------|------------|----------------|------|
| create_task | selfAssigned: boolean | tasks/route.ts：runWithWorkspace 回调返回值扩展 `{ invalidAssignee, task, isFirstTask }`（isFirstTask=回调内 `tx.task.count({where:{workspaceId:wid}})===1`）；L99–104 props 增加 `selfAssigned: validated.assigneeId === ctx.payload.sub` | AC-07 他派判定；isFirstTask 供 activation 判定复用，避免事务外二次计数竞态 |
| invite_member | channel:"email"; seatUsage:{used,limit} | members/invite/route.ts L199–205：channel 恒 "email"（现有唯一发出方式即邮件携带链接）；seatUsage 从同函数上游 seatCheck 事务已知信息或响应前补一次 `workspace.seatLimit`+`memberCount` 读取获得（全局 prisma 直查，先例 L28） | 渠道与紧迫度分析 |
| register_success | channel:"organic"\|"invite"; inviteWorkspaceId? | auth/register/route.ts：zod schema 增加可选 `inviteToken`；signup 页 handleSubmit（L79–84）在 URL 带 ?invite= 时随请求体上送；服务端 sha256(token) 查 invitations.tokenHash，命中即 channel="invite"、inviteWorkspaceId=invitation.workspaceId，否则 "organic"。**token 明文不入 props**（PII 红线），props 只存枚举与 wid | 获客归因闭环（K 因子分子侧） |
| task_status_change | 键名固化 toStatus | 服务端 tasks/[id]/route.ts L126 `props:{taskId:id,toStatus:validated.status}`；客户端 board/page.tsx L193 改显式 `{ batch:true, count:resp.updated, toStatus:patch.status }`（patch.status 不存在时不带键）。双端不再依赖 spread 隐式携带 | 「完成任务数」可统计（done 占比） |
| page_view | 维持现状不扩 | landing_view 承接公开页曝光职责后（§5.3），page_view 保持登录区 layout L73 单点不变，避免公开区双打导致曝光基线虚高 | 全站曝光基线由 landing_view+page_view 分域承担 |

register_success 归因判定细节：查 invitations 时**命中即归因，不校验 acceptedAt/expiresAt**。理由：受邀新用户注册发生在 accept 之前（accept 在前端注册成功后才调用，signup/page.tsx L98–100），此时 acceptedAt 必为 null；过期链接注册仍属邀请驱动，归因从宽符合渠道评估语义。

### 2.3 白名单既有、漏斗必需的两个补埋项

FUNNEL-METRICS §3.1 将 register_view/register_submit 列为缺口，D2 新漏斗获客段的第 3/4 步依赖它们，否则中间步骤恒为 0。两者白名单已有（events/route.ts L23–24），仅需补打点调用：

表：补埋项落点对照表

| 事件 | 落点 | 触发条件 | props |
|------|------|----------|-------|
| register_view | auth/signup/page.tsx 组件挂载 useEffect（L28 既有 effect 或新增专用 effect） | 注册页首次渲染完成 | { path:"/auth/signup", hasInvite: boolean } |
| register_submit | auth/signup/page.tsx handleSubmit 入口（L74 setBusy(true) 前） | 用户提交注册表单（含后续校验失败，语义为「尝试提交」） | { hasInvite: boolean } |

hasInvite = `new URLSearchParams(window.location.search).has("invite")`，用于拆分自然注册与邀请注册两条子漏斗。

### 2.4 activation_completed 幂等与 15 分钟窗口基准（难点 2）

#### 2.4.1 t0（窗口起点）取 users.createdAt

三个候选对比：

表：t0 基准候选对照表

| 候选 | 正确性 | 健壮性 | 成本 |
|------|--------|--------|------|
| **users.createdAt** | 与注册请求同请求产生，偏差 <1s | 不受埋点静默失败影响（trackServerEvent 是 .catch(()=>{}) 的 fire-and-forget，register_success 可能丢失） | 一次主键 findUnique |
| 首条 register_success 事件 createdAt | 语义等同 | 埋点丢失则 t0 永缺、激活永不可判；传输重复需再取 min | 多一次 analytics_events 查询 |
| 事件缺失时回退 users.createdAt | 等同 | 两套基准并存，minutesSinceRegister 分布混源 | 双查询＋分支 |

**结论：取 users.createdAt。** 依据：①身份域豁免 RLS，读写无障碍（§1.3-3）；②users.createdAt 是账号体系业务事实，埋点只是观测副本，观测丢失不应使业务判定失效；③invite/route.ts L28 已确立全局 prisma 直查 user 的模式先例。

#### 2.4.2 并发安全实现：事务内查重为主，唯一索引为可选加固

三候选对比：

表：activation 幂等方案候选对照表

| 方案 | 防重强度 | 实现成本 | 评价 |
|------|----------|----------|------|
| **a) 写入前事务内 count 查重** | 弱一致：两并发事务同时 count=0 可双写 | 零迁移，5 行代码 | 激活场景并发窗口极窄（同一工作区两个成员毫秒级同创首任务），概率≈0；§6.3 已约定查询侧 min(created_at) 兜底 |
| b) partial unique index `ON analytics_events(workspace_id) WHERE name='activation_completed'` | 强一致 | 手写 SQL 迁移（有 invitations_pending 先例可循）＋写入侧 P2002 异常吞并处理 | 最强，但 analytics_events 是通用事件表，为单一事件名加约束侵入存储层语义 |
| c) 条件 update | 不适用 | — | append-only 事件表无「占位行」可 UPDATE |

**结论：P0 采用方案 a**——在 tasks/route.ts POST 主事务（runWithWorkspace）内随任务创建一并 `tx.count({where:{workspaceId:wid,name:"activation_completed"}})` 取 dupCount，事务提交后仅在窗口条件满足时经 trackServerEvent 写入（写失败静默，符合既有约定）；查询侧 min(created_at) 兜底为既定第二道防线。**方案 b 列为二期可选加固**：若运行期观察到重复数据再上 partial unique index（迁移写法照抄 20260827100000 先例），避免提前付出迁移维护成本。

> **P2-1 落实（审核放行条件 #5）**：dupCount 必须在主事务内用 `tx.count` 取值——既消除「全局 prisma 实例读 analytics_events 是否受 RLS SELECT 策略拦截」的疑问，又使「事务内随任务创建一并 count」的文字与伪代码自洽。整个 activation 判定块（含 user.findUnique 与 dupCount 读取）必须包 try-catch 失败静默，违反「埋点失败不阻塞主流程」既有约定（tasks/route.ts 现有打点依赖 trackServerEvent 自身 .catch 静默）的裸抛实现一律不可接受。单测须补「判定块查询抛错时主接口仍 200」用例（见 §6.1）。

#### 2.4.3 判定伪代码

```ts
// 代码示例：create_task 事务内首任务标记（TypeScript，落点 tasks/route.ts）
const result = await runWithWorkspace(wid, async (tx) => {
  // ……既有 assignee 校验、task.create 不变……
  const taskCount = await tx.task.count({ where: { workspaceId: wid } });
  const isFirstTask = taskCount === 1;
  // P2-1：dupCount 在主事务内用 tx.count 取值，消除全局实例 RLS 疑问
  const dupCount = await tx.analyticsEvent.count({
    where: { workspaceId: wid, name: "activation_completed" },
  });
  return { invalidAssignee: false as const, task, isFirstTask, dupCount };
});
// ……既有 create_task 打点，props 增加 selfAssigned ……

// 激活判定：主事务提交后、响应返回前；P2-1 整块包 try-catch 失败静默
try {
  if (result.isFirstTask && !!validated.assigneeId &&
      validated.assigneeId !== ctx.payload.sub &&
      result.dupCount === 0) {
    const user = await prisma.user.findUnique({
      where: { id: ctx.payload.sub }, select: { createdAt: true },
    });
    if (user) {
      const minutesSinceRegister =
        (Date.now() - user.createdAt.getTime()) / 60_000;
      if (minutesSinceRegister <= 15) {
        await trackServerEvent({
          userId: ctx.payload.sub, workspaceId: wid,
          name: "activation_completed",
          props: {
            taskId: result.task.task.id,
            minutesSinceRegister: Math.round(minutesSinceRegister),
          },
        });
      }
    }
  }
} catch {
  /* P2-1：判定块任一查询/写入抛错均静默，主接口已 200 不受影响 */
}
```

口径备注：批准文档 §4.1 要求「本工作区首个任务」，故首任务自派、第二任务他派的用户不计激活——此为已拍板口径的保守面，与 Q2 一并在 8 周复议时评估是否放宽（见附录开放问题）。

### 2.5 session_start 注入方式（难点 3）

#### 2.5.1 约束分析

- track() 内部调用 getSessionId()（analytics.ts L95）：若在 getSessionId 新建分支里直接调 track("session_start")，track 又调 getSessionId 取 sid——虽然续期分支会直接返回新 sid 不致无限递归，但形成隐式自引用，且 track 会再次走一遍 localStorage 读写。**采用直接入队**：新建分支构造 QueuedEvent 后 push 进 queue，完全绕开 track()/getSessionId() 二次调用，无循环依赖。
- SSR 安全：getSessionId 当前无 window 卫语句（靠 try-catch 兜底），session_start 的 props 需要 navigator/screen——必须加 `typeof window === "undefined"` 卫语句，否则构建期预渲染报错。
- 失败静默：入队本身不抛错；flush/flushSync 既有 catch 兜底；localStorage 异常沿用既有 try-catch，不影响 sid 返回。

#### 2.5.2 改造伪代码

```ts
// 代码示例：getSessionId 新建分支同步注入 session_start（TypeScript）
function enqueue(event: QueuedEvent): void {   // 自 track() 抽出的公共入队逻辑
  queue.push(event);
  if (queue.length >= BATCH_SIZE) flush();
  else if (!flushTimer) { /* 既有 5 秒兜底 timer 逻辑 */ }
}

function getSessionId(): string {
  // ……续期分支不变，不打点……
  const sid = crypto.randomUUID();
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ sid, ts: Date.now() }));
  } catch { /* ignore */ }
  // 新会话：同步入队 session_start（不经 track，避免递归；失败静默）
  try {
    enqueue({
      name: "session_start",
      props: {
        ...(document.referrer ? { referrer: document.referrer } : {}),
        language: navigator.language,
        screenW: window.screen.width,
      },
      sessionId: sid,
      ts: Date.now(),
    });
  } catch { /* SSR/隐私模式降级：丢事件不抛错 */ }
  return sid;
}
```

注意：session_start 的 referrer 取 document.referrer 快照，与 landing_view 的 first-touch 归因互不干扰（landing_view 是渠道归因载体，session_start 只做回访频次信号，二者不合并职责）。

### 2.6 invite_accepted 补充说明

- **channel 取值**：Invitation 表无 channel 字段（§1.3-5），且能到达 accept 端点的唯一载体就是邀请链接（邮件也只是送达渠道），因此 **channel 恒填 "link"**。FUNNEL-METRICS 定义的 "email" 枚举当前无对应现实路径，字段保留、暂不产出（偏差已在附录登记）。
- **waitedHours**：`(Date.now() - invitation.createdAt.getTime()) / 3_600_000` 四舍五入保留 1 位小数；invitation 对象在打点处作用域内可直接取用。
- **幂等路径覆盖**：「已是成员直接标记 accepted」（L90–91 existing 分支）同样走到统一打点处；重复点击场景第二次请求因 acceptedAt 已置位在 L55 被 410 拦截，**无需额外查重**，「只打一次」由 invitation.acceptedAt 的一次性消费语义天然保证。
- **已知盲区**：已注册用户被直加（members/invite L123–176 直接建 member，不经 accept 端点）不产生 invite_accepted，Referral 接受率会被低估。是否在该路径补打 invite_accepted(channel="email") 属超出批准文档字面范围的口径变更，登记于附录开放问题，不在本设计擅改。

### 2.7 webhook 侧 4 事件伪代码与放置说明（支付线范围，非本任务实施）

放置原则（对支付线的三点要求）：

1. **打点必须在对应 runWithAuthOp("webhook") 事务成功提交之后**（回调外），防止外层事务回滚但事件已写入造成假信号。trackServerEvent 自带独立 provision 连接，不嵌套进 webhook 事务。
2. **绝不阻塞 Stripe 应答**：trackServerEvent 已是失败静默，直接 await 即可；不要包 try-catch 重试。
3. userId 取不到时传 `"unknown"` 不合适——本线已在阶段 1 独占改造 analytics-server.ts，目标签名 `trackServerEvent(data: { userId?: string | null; workspaceId: string | null; sessionId?: string; name: string; props? })`（见 §7 阶段 1 终态契约），支付线 webhook 四埋点直接消费：metadata 中 owner id 缺失时传 `userId: null`，runWithAuthOp 第三参内部以 `data.userId ?? undefined` 适配（auth.ts L119–125 签名不变）。

```ts
// 代码示例：webhook 侧四事件打点伪代码（TypeScript，供支付线参照）
import { trackServerEvent } from "@/lib/analytics-server";

// ① checkout.session.completed —— 置于 runWithAuthOp("webhook", ...) 回调 resolve 之后（对应现状 webhook/route.ts L102 之后）：
await trackServerEvent({
  userId: ownerIdFromMetadata ?? FALLBACK,      // 见放置原则 3
  workspaceId: wid,
  name: "subscription_activated",
  props: { plan: "pro", quantity },             // quantity 为 L73–79 已拉取的真实席位数
});

// ② invoice.payment_failed —— 置于 L117–122 updateMany 之后：
await trackServerEvent({
  userId: /* sub→workspace→owner 反查，查不到传占位 */,
  workspaceId: widBySubId,
  name: "payment_failed",
  props: { attempt: inv.attempt_count },        // Stripe Invoice 自带字段，可选
});

// ③ invoice.paid —— 新增 case，与 ② 平级：
case "invoice.paid": {
  const inv = event.data.object;
  if (inv.billing_reason === "subscription_cycle") {   // 首期发票由①承载，只记周期续费
    await trackServerEvent({
      userId: /* 同上 */,
      workspaceId: widBySubId,
      name: "subscription_renewed",
      props: { quantity, amountMinor: inv.amount_paid },  // 最小货币单位整数，PII 红线合规
    });
  }
  break;
}
// 注意：invoice.paid 需在 Stripe Dashboard/webhook 配置中订阅该事件类型，属支付线配置项。

// ④ customer.subscription.deleted —— 置于 L183 runWithAuthOp(...) 事务成功后：
await trackServerEvent({
  userId: /* 同上 */,
  workspaceId: subscription.workspaceId ?? widBySubId,
  name: "subscription_churned",
  props: { reason: /* cancellation_details?.reason，可缺省 */ },
});
```

---

## 3. 白名单 diff（events/route.ts ALLOWED_EVENT_NAMES）

### 3.1 新旧对照

表：ALLOWED_EVENT_NAMES 新旧对照表（20 → 29）

| 分类 | 旧（20，保留不动） | 新增（9） |
|------|--------------------|-----------|
| 注册激活漏斗 | register_view、register_submit、register_success、login_view、login_submit、login_success、onboarding_start、onboarding_complete、onboarding_skip | landing_view、click_signup、session_start |
| 核心激活 | create_task、invite_member、create_decision、create_comment、task_status_change | activation_completed |
| 留存信号 | page_view、workspace_switch | — |
| Referral | — | invite_accepted |
| 转化 | billing_view、billing_checkout、billing_success、billing_cancel | subscription_activated、payment_failed、subscription_renewed、subscription_churned |

> **P2-4 基数更正（审核放行条件 MINOR）**：原稿「21 → 30」系误抄，实测 events/route.ts L21–46 共 20 个事件名（9 注册激活＋5 核心激活＋2 留存＋4 转化），新增 9 个后为 29。上游 FUNNEL-METRICS §1.2 的「21」亦为同一计数偏差，已在该文档勘误登记。

login_success 等 login_* 三件套**白名单保留但退出漏斗定义**（§4.2）；billing_success/billing_cancel 保留作辅助信号（FUNNEL-METRICS §3.4 既定原则）。

### 3.2 配套重构（落实批准文档 §4.3 建议）

1. 白名单常量抽至 **web/lib/analytics-whitelist.ts** 单一事实源，导出 `ALLOWED_EVENT_NAMES: ReadonlySet<string>`；events/route.ts 与客户端 SDK 共同 import，消除「服务端过滤、客户端无感」的双源漂移。
2. 客户端 dev 环境 warn：analytics.ts track() 入口增加 `process.env.NODE_ENV !== "production" && !ALLOWED_EVENT_NAMES.has(name) && console.warn(...)`——非法名生产环境仍由服务端静默丢弃（行为不变），dev 环境可排障。
3. 白名单追加 9 名与 SDK 改造**同一 PR 合入**，避免「事件已打、闸门未开」的静默丢弃窗口期。

---

## 4. overview 口径修正方案

### 4.1 D1 日界修正（Asia/Shanghai）

现状确认：daily 为 JS 内存聚合（route.ts L63–80 findMany + for 循环），topEvents/activeUsers 为 Prisma groupBy。**选 JS 侧偏移**，不引入 $queryRaw：

表：D1 修复方案候选对照表

| 方案 | 改动面 | 风险 |
|------|--------|------|
| **JS 内存层偏移（推荐）** | 单行：`const day = new Date(e.createdAt.getTime() + 8*3600_000).toISOString().slice(0,10)` | 零；与现有聚合管线同构，纯函数可单测 |
| SQL 层 `(created_at AT TIME ZONE 'Asia/Shanghai')::date` | 需 $queryRaw 替换 findMany；GUC/RLS 上下文须在 tx 内手工维护 | 类型安全丢失、回归面大，收益为零（数据量小，内存聚合无性能压力） |

中国无夏令时，固定 +8h 数学正确；物理存储保持 Timestamptz UTC 不变（schema 不动）。抽取 `shanghaiDay(date: Date): string` 纯函数供 daily/WAW/retention 三处复用。WAW 周界同法：`shanghaiWeekKey(date)` 以周一 00:00 UTC+8 为界（`day = (offsetDate.getUTCDay()+6)%7` 回推）。

### 4.2 D2 序列化漏斗（严格先后序）

表：漏斗实现方案候选对照表

| 方案 | 正确性 | 工程成本 |
|------|--------|----------|
| **JS 内存序列过滤（推荐）** | 精确子序列语义 | 一次 findMany（14 天 × 单工作区，容量估算 §6.5 支撑）＋纯函数匹配器，可单测 |
| SQL 自连接 | 等价 | $queryRaw 多步 LEFT JOIN + 时间谓词，RLS/GUC 耦合，不可单测，Prisma 类型全丢 |

**新漏斗步骤定义**（替代现 FUNNEL_STEPS 五步）：

```
获客段（按 sessionId 分组串联，匿名可算）：
  landing_view → click_signup → register_submit → register_success
激活段（按 workspaceId+userId 分组串联，全服务端事件）：
  register_success(t0=users.createdAt) → create_task(hasAssignee && !selfAssigned)
                                        （≤15min）→ activation_completed
废弃步骤：login_success（登录非转化语义）、invite_member/create_decision（并行行为）
```

> **P2-3 跳步规则登记（审核放行条件 #2，裁决一附属）**：获客段匹配器允许跳步——`/pricing` 来源用户无 `click_signup`（定价线 §5.1 已裁定 /pricing 四 CTA 只打 `click_upgrade`，本期 `click_signup` 落地范围收敛为 auth/login 页注册链接，见 §2.1 #2）属预期跳步，`register_submit` 计数不受影响，「点击意愿」信号由 `click_upgrade` 单独承载。理由：同一意图双打会造成 CTR 分子重复计数，比少一格漏斗步骤危害更大；未来独立营销首页出现后 `click_signup` 自然获得真实落点。匹配器本就允许跳步（直达 /auth/signup 的用户无 landing/click 两步，submit→success 相邻即转化），无需为 /pricing 来源特殊编码。

**分组键规则**（关键设计）：
- 获客段按 **sessionId** 分组：前三步是匿名客户端事件只有 sid；register_success 依赖 §1.2-1 的新通道（register API zod 加可选 `clientSessionId`，服务端经扩展后的 trackServerEvent 写入 sessionId 列）才能挂回会话。未携带 clientSessionId 的历史/异常注册，其 register_success 单独归入 `sid=null` 组，只计入末步总量、不参与串联（宁缺毋错）。
- 激活段按 **(workspaceId, userId)** 分组：三个事件均为服务端事件、均带双 ID，不依赖 sid，天然健壮。
- 匹配算法：每组事件按 createdAt 升序，对步骤序列做贪心子序列匹配（依次寻找 ≥ 上一步时间的首个实例），允许真实跳步（如直达 /auth/signup 的用户无 landing/click 两步，submit→success 相邻即转化），各步计数与相邻转化率照常输出。

### 4.3 D3 会话利用与新活跃口径

1. **activeUsers 废弃**（现 route.ts L93–103「14 天任意事件去重 userId」，page_view 即算活跃，过松）：替换为 **WAU 字段**＝最近一个完整周（周一 00:00 UTC+8 起）CORE_EVENTS={session_start, create_task, task_status_change, create_comment, create_decision, invite_member} 去重 workspaceId 计数。overview 是工作区作用域接口，WAW 的全局值由该字段跨工作区聚合而来——单工作区内输出 `coreActiveUsers`（同口径去重 userId），全局 WAW 另设轻量聚合端点或在面板层汇总（P0 先出 coreActiveUsers，全局 WAW 卡片随 §5 看板第二批）。
2. **retention 字段新增**：D_n 回访率（n∈{1,7,30}）＝「工作区内 register_success 所在日（Asia/Shanghai 日界）后第 n 天产生 ≥1 次 CORE_EVENTS 的用户数 ÷ 注册满 n 天的用户数」。D0 以 register_success 事件 createdAt 为准（批准口径）；该事件缺失的用户剔除分子分母（与 activation 的 t0 取舍不同：此处是统计展示而非业务判定，遵循批准口径优先）。实现复用 14 天窗口 findMany 结果内存计算，走 [workspaceId,createdAt] 索引，禁止全表扫描。
3. **session 维度**：sessionId 已入库且有 [sessionId,createdAt] 索引（schema L344），overview 增加 `sessions` 字段（窗口内去重 sid 计数）支撑「人均会话数」；会话级明细重建（时长近似等）留待看板 P1/P2，不在本接口铺开。

API 返回结构变更：`funnel` 改为 `{ acquisition: Step[], activation: Step[] }` 两段；新增 `waw/coreActiveUsers`、`retention{d1,d7,d30}`、`sessions`；`activeUsers` 字段保留一个过渡期（面板切换完成前双发），随后移除。

---

## 5. landing_view 载体决策与归因传播（难点 1）

### 5.1 现状核实

- 项目**无营销落地页**：根路由 `/` 仅 redirect 到 /auth/login（app/page.tsx 全文 5 行）；LANDING.md 是 MVP 落地报告，无对应页面路由。
- `/pricing` 不存在，由并行团队开发中，上线时间不受本线控制。
- 公开可达页面目前仅 /auth/login、/auth/signup；ADR-008 S1（国际化信号）依赖 landing_view.locale，若等待 /pricing 则 M2 期间信号全空白（Q1 开放问题的现实化）。

### 5.2 候选方案利弊

表：landing_view 载体候选对照表

| 候选 | 利 | 弊 |
|------|----|----|
| a) app 层对公开路由统一打点 | 一处代码全覆盖；/pricing 及未来营销页零成本自动生效；utm 采集不依赖各页面自觉接入；ADR-008 S1 立即可用 | landing_view 语义从「营销页曝光」扩为「公开页曝光」，auth 页曝光进入 CTR1 分母，稀释转化率观感 |
| b) /pricing 与 /auth 页各自手动打 | 语义精确到页 | 分散易漏接（每个新营销页都要记得接入）；/pricing 上线前获客段全空白，Q1 无解 |
| c) 只等 /pricing 上线后打 | 语义最纯 | M2/M3 期间 landing→signup 漏斗前三步恒 0；S1 国际化信号延迟数周；违反渐进交付原则 |

### 5.3 推荐方案：a 的收敛版（公开路由守卫组件）

**新建 `PublicPageTracker` 客户端组件挂在根 layout**（app/layout.tsx L26 children 同层），内部维护公开路由白名单：

```text
PUBLIC_LANDING_ROUTES = ["/", "/pricing", "/pricing/*", 未来营销页…] ＋ ["/auth/*"]
```

命中且本次加载未上报过 (sid,path) 时打 `landing_view { referrer, utm*, path, locale:navigator.language }`。

理由与边界处理：
1. **/pricing 上线即覆盖**，另一团队无需感知埋点契约，消除跨团队协调成本；
2. auth 页纳入分母的口径问题用 **path 维度拆解**消化：漏斗查询支持按 `path` 过滤 landing_view（如 CTR1 仅取 path=/pricing 或排除 /auth/*两种视角都可得），数据不丢、口径可后选；
3. register_view（§2.3 补埋）继续由 /auth/signup 页单独打，作为「注册页精确曝光」与 landing_view(path=/auth/signup) 交叉验证；
4. page_view 保持登录区不变（§2.2），公开区曝光职责整体移交 landing_view，无双打；
5. 组件实现放 web/lib/analytics-attribution.ts（导出 captureLandingAttribution 与 PublicPageTracker），usePathname + useEffect 单次执行，SSR 安全。

### 5.4 referrer/utm first-touch 归因随 sessionId 传播

沿批准文档 §6.1 执行，落地要点：

1. **采集时机**：仅 PublicPageTracker 命中时解析一次 `location.search` 的 utm_source/utm_medium/utm_campaign（camelCase 存 props）＋ document.referrer，写入该条 landing_view.props；后续事件一律不重复采集。
2. **传播机制**：不需要任何额外存储——同会话所有事件共享 localStorage 的 sid（30 分钟 TTL 续期），查询侧以 `sessionId` 等值 join 到 landing_view.props 即还原渠道；[sessionId,createdAt] 索引（schema L344）已备。
3. **归因窗口**：sid 生命周期即窗口，超时新建会话重新归因（last session wins），工程最简、偏差可控（批准既定）。
4. **匿名→登录衔接**：POST /events 对匿名请求 userId=null（events/route.ts L68–70），注册后同 sid 事件自动带 userId，无需显式合并；漏斗归属按 §6.2 取 sid 内最早非空 userId。
5. **PII 边界**：referrer 只存 document.referrer 原始串（可能含第三方域，非用户 PII）；utm 值长度截断 128 字符防滥用；禁止把 email/姓名类 query 参数误收——采集器仅识别 `utm_` 前缀键。

---

## 6. 测试计划

### 6.1 单元测试（vitest，新增 web/__tests__/ 目录）

表：单元测试用例规划表

| 模块 | 用例 | 断言要点 |
|------|------|----------|
| analytics-whitelist | 导出集合内容快照 | 含 29 名（20 旧＋9 新），无重复 |
| events route 过滤 | 白名单外事件被丢弃 | mock tx.analyticsEvent.createMany 收到的 rows 不含非法名；全非法时 accepted=0 且不触碰 db |
| analytics.ts getSessionId TTL（jsdom＋localStorage mock） | ①有效期内续期分支：不产生 session_start、sid 不变、ts 刷新；②过期分支：产生恰 1 条 session_start 且新 sid≠旧 sid；③localStorage.setItem 抛错（隐私模式）：仍返回内存 sid、session_start 仍入队、不抛错；④SSR（window undefined）：track 直接 return | 队列内容与调用次数 |
| activation 判定（抽出纯函数 shouldActivate({isFirstTask,assigneeId,selfAssigned,minutes,dupCount})） | 各条件边界：dup>0 不写；minutes=15.0 写/15.01 不写；selfAssigned=true 不写；isFirstTask=false 不写；全满足写 | 布尔矩阵 |
| activation 判定块失败隔离（P2-1） | mock prisma.user.findUnique 抛错 / mock tx.analyticsEvent.count 抛错 / mock trackServerEvent 抛错 | 主接口仍返回 201，create_task 已落库，无 500 抛到外层 |
| shanghaiDay / shanghaiWeekKey 纯函数 | 北京时间 00:00±1min 的 UTC 时刻分桶归属正确日/周；周日 23:30(UTC+8) 与周一 00:30(UTC+8) 分属不同周 | 桶 key |
| 序列漏斗匹配器 matchFunnel(events, steps) | 乱序输入排序后匹配；跳步（无 landing 直达 submit）计入 submit/success 两步；同事件多次取首个满足 ≥prev 的实例；sid=null 组只计末步 | 每步计数与转化率 |
| captureLandingAttribution | utm 三键 camelCase 映射、缺省键不出现在 props、referrer 截断、同 (sid,path) 二次调用不上报 | props 结构 |

### 6.2 集成测试（Playwright 扩展 e2e/smoke.spec.ts ＋ API 层断言）

表：集成测试场景规划表

| 场景 | 步骤 | 断言（直查 analytics_events 或拦截 POST /api/v1/events 请求体） |
|------|------|------------------------------------------------------------------|
| 获客段端到端 | 打开 / → 点注册 CTA → 提交表单 → 注册成功 | 依序出现 landing_view、click_signup、register_submit、register_success，且 sessionId 同值；register_success.channel 符合预期 |
| 激活端到端 | 新注册用户 ≤15min 内创建他派任务 | create_task.props.selfAssigned=false；activation_completed 恰 1 条且 minutesSinceRegister≤15；重复触发第二个他派任务不再新增 activation_completed |
| 激活负路径 | 自派任务／超 15 分钟（mock users.createdAt 回拨）／第二任务才他派 | 均**无** activation_completed |
| 邀请接受 | A 邀请未注册邮箱 → B 经链接注册 → B accept | invite_accepted 1 条：inviterUserId=A、channel="link"、waitedHours≥0；B 重复 accept 返回 410 且事件不重复 |
| register_success 归因 | 带 ?invite=token 注册 | channel="invite" 且 inviteWorkspaceId=邀请方 wid；props 中不含 token 明文 |
| overview 口径 | 造跨 UTC 日界数据（北京时间 07:30＝UTC 前一日 23:30） | daily 分桶归北京当日；WAU/retention 字段存在且类型正确 |
| webhook（支付线联调时） | Stripe test clock 触发 checkout/paid/fail/deleted | 四事件各 1 条、金额为 amountMinor 整数、重复投递不重复计数 |

---

## 7. 实施顺序建议（先基础设施后事件）

```text
阶段 0（bugfix，可立即独立上线）
  └─ D1 日界修复：shanghaiDay 抽取＋overview daily 改造（0.5h，不等其余）

阶段 1 基础设施（一切事件的闸门与管道）
  ├─ lib/analytics-whitelist.ts 抽取＋ALLOWED_EVENT_NAMES +9＋events route 接入（0.5h）
  ├─ lib/analytics.ts：enqueue 抽取＋session_start 注入＋dev warn（0.5d）
  └─ lib/analytics-server.ts：trackServerEvent 增加可选 sessionId ＋ userId 放宽 string|null（0.5h）
      ※ P2-2 独占声明（审核放行条件 #6，裁决二）：analytics-server.ts 的全部改造由
        本线独占，一次成型目标签名作为终态契约：
          trackServerEvent(data: {
            userId?: string | null;
            workspaceId: string | null;
            sessionId?: string;
            name: string;
            props?: Record<string, unknown>;
          }): Promise<unknown>
        内部 runWithAuthOp 第三参传 data.userId ?? undefined（auth.ts L119–125 签名不变），
        入库 userId 列写 data.userId ?? null；支付线 webhook 四埋点只消费该签名，
        不得并行修改该文件。若排期倒挂支付线按此终态签名自行落地最小实现，
        合流时以本线版本为准（签名一致即无合并冲突）。
      ※ 三者同批合入，避免「打点先于白名单」的丢弃窗口

阶段 2 服务端事件（依赖阶段 1）
  ├─ tasks/route.ts：selfAssigned＋isFirstTask＋activation_completed（0.5d）
  ├─ accept/route.ts：invite_accepted（2h）
  ├─ register/route.ts＋signup 页：inviteToken 上送＋channel/inviteWorkspaceId（2h）
  └─ members/invite/route.ts：channel/seatUsage（1h）

阶段 3 overview 口径重构（依赖阶段 2 出数，接口先行也可兼容空数据）
  └─ D2 两段序列化漏斗＋WAU/retention/sessions 字段＋activeUsers 过渡（2d）

阶段 4 客户端页面事件（可与阶段 2/3 并行）
  ├─ PublicPageTracker＋captureLandingAttribution 挂根 layout（0.5d）
  ├─ login 页 CTA click_signup；signup 页 register_view/register_submit（0.5h）
  └─ board/page.tsx L193 toStatus 固化＋tasks/[id] 服务端同步（0.5h）

阶段 5（支付线顺带，非本线排期）
  └─ webhook 四事件＋invoice.paid 监听＋Stripe 事件订阅配置
```

关键依赖链：白名单（阶段 1）→ 所有新事件；sessionId 通道（阶段 1）→ 获客段漏斗串联（阶段 3）；selfAssigned/isFirstTask（阶段 2）→ activation_completed。P0 合计约 4.5 人日，与批准文档 §7 估算一致。

---

## 8. 非目标（明确不做）

1. **webhook 侧 4 事件的实施**（subscription_activated/payment_failed/subscription_renewed/subscription_churned）：本设计仅交付伪代码与放置约束（§2.7），编码、Stripe 事件订阅配置、联调均由支付线在其 webhook 重构中顺带完成。
2. cohort 周粒度留存矩阵、功能渗透率等 §5 P2 图表及其查询端点。
3. onboarding_start/complete/skip 三事件：M2 引导流程上线后补埋（白名单已预留）。
4. 跨设备 identity graph（批准文档 §6.2 明确过度设计，不做）。
5. GeoIP locale：locale 取 navigator.language，GeoIP 待 CloudBase header 能力确认（Q4）。
6. OLAP 外移：PostgreSQL 直存，每季度复核增速（§6.5）。
7. tasks/batch 服务端打点补齐：涉及批量语义口径（一条聚合还是 N 条明细），登记开放问题后另议。
8. 海外多时区日界参数化：固定 Asia/Shanghai（ADR-008 国际化落地后再议）。

---

## 附：移交评审的开放问题

| 编号 | 问题 | 移交对象 |
|------|------|----------|
| O1 | invite_accepted 的 "email" 枚举无现实路径（§2.6）；已注册直加路径是否补打 invite_accepted（Referral 接受率低估约数） | 产品＋平台分析师拍板口径 |
| O2 | activation「首任务自派、次任务他派不计」的保守面是否随 Q2（15 分钟窗口复议）一并放宽 | 8 周数据复盘时决议 |
| O3 | register API 上送 clientSessionId 的载体选择：请求体字段（zod 可选）vs X-Analytics-Session 自定义头——前者简单，后者不污染领域 schema | 实施者二选一，倾向请求体字段。**P2-5 已定**：采用请求体字段，zod 校验 `z.string().max(64)`（对齐 events/route.ts eventSchema.sessionId 先例与 analytics_events.session_id 列 varchar(64)），超长输入由 zod 400 拒绝而非 PG 截断报错后被 .catch 静默丢弃 |
| O4 | landing_view 是否永久包含 /auth/*：本设计以 path 维度保留两种口径的计算可能性，看板默认视角待 P0 图表评审定 | 看板评审 |