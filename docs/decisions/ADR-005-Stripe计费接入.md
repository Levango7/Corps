# ADR-005: Stripe 计费接入

- **状态**：Accepted（2026-08-22，用户拍板「测试模式占位开发」）
- **编号说明**：原文件名 ADR-003.md，因与计费方案 ADR-003 编号冲突，2026-08-24 重编号为 ADR-005
- **提交**：高见远（首席架构师）｜依据：Spec §2（P1 席位计费雏形）、§5（billing 端点）、§6（subscriptions 表已存在）
- **关联**：ADR-004（Better Auth 认证重建）｜OPEN-DECISIONS（国内支付选型）

---

## Background（背景）

Spec 将「席位计费雏形」定为 P1：Stripe Checkout + Portal + webhook，成员数变更同步 subscription quantity（AC-08），扣款失败不立即中断（AC-09）。`Subscription` 模型已存在于 schema（workspaceId / stripeCustomerId / stripeSubId / quantity / status / currentPeriodEnd）。此前**无任何计费后端实现**。

## Decision（决策）

1. **依赖**：新增 `stripe`（Node SDK），密钥经环境变量注入（`STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_ID`），测试模式占位，不写死。
2. **端点**（统一前缀 `/api/v1`）：
   - `POST /billing/checkout`：Owner 仅。用 `stripe.checkout.sessions.create({ mode: "subscription", line_items:[{ price: STRIPE_PRICE_ID, quantity: seatCount }], success_url, cancel_url })`。会话完成后在 webhook 写 `Subscription`。
   - `POST /billing/webhook`：用 `stripe.webhooks.constructEvent(rawBody, sigHeader, STRIPE_WEBHOOK_SECRET)` 校验签名（**必须传原始 body**，Next.js Route Handler 用 `await req.text()` 取原始体）。处理：
     - `checkout.session.completed` → 建/更新 `Subscription`（stripeCustomerId, stripeSubId, status=active/trialing, quantity）。
     - `invoice.payment_failed` → status=past_due，**不立即中断服务**（AC-09），仅标记。
     - `customer.subscription.updated` / `deleted` → 同步 status / currentPeriodEnd。
   - `GET /billing/status`：返回当前套餐（`Workspace.plan`）、席位数、Subscription 状态，供前端计费页展示。
   - `POST /billing/portal`：Owner 仅。用 `stripe.billingPortal.sessions.create({ customer, return_url })` 返回 Portal URL，供用户自助改支付方式/取消。
3. **席位与邀请联动**：`POST /workspaces/:wid/members/invite`（Admin）接受邀请；成员数达 `Workspace.seatLimit` 时**拦截并提示升级**（触发 checkout）。移除成员（Admin）更新计数。
4. **本地联调**：用 `stripe listen --forward-to localhost:3000/api/v1/billing/webhook` 转发测试事件，测试卡 `4242 4242 4242 4242`。

## Consequences（后果）

- 正面：计费闭环对齐 Spec P1（AC-08/09），前端计费页有真实后端。
- 负面 / 待定：
  - 中国大陆 Stripe 跨境可行性未定 → 记入 OPEN-DECISIONS，必要时替换为微信/支付宝（不影响本接口结构，仅换 provider 适配层）。
  - 定价未在 Spec 终确认（OPEN：¥59/人/月 起步）→ `STRIPE_PRICE_ID` 由用户配置，代码不硬编码价目。
  - webhook 验签依赖 `STRIPE_WEBHOOK_SECRET`；缺失时路由返回 500 并提示配置（不静默放行）。

## 验收映射

- AC-08 第 N+1 成员 → quantity 同步：invite 成功 + checkout 完成时同步。
- AC-09 扣款失败 → 标记 past_due 不中断：webhook 处理。
