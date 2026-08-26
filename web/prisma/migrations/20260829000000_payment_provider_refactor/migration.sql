-- PaymentProvider 抽象落地（ADR-003 §5 落地要点 2）：
-- 1) subscriptions 增加通道归属两列，nullable 起步（down 直接删列，符合 Spec §10 可回滚约束）；
-- 2) 存量全量回填 'stripe'——MVP 全链路只有 Stripe，任何 subscription 行都来自 Stripe checkout
--    （该表仅在 webhook checkout.session.completed 分支 upsert，见 ADR-003 现状核对表）；
-- 3) 幂等表泛化：processed_stripe_events -> processed_payment_events，
--    主键从 (id) 改为 (provider, event_id)，历史数据原样迁入，不丢弃。
--
-- 【P3-1 BLOCKER 修复】DROP TABLE "processed_stripe_events" 移出本批 migration！
--   旧表保留至下一次清理迁移（设计文档 §6.5）。理由：本批 migration 与应用代码同批滚动发布期间，
--   滚动排水期内存活的旧 webhook 实例仍向 processed_stripe_events 写入；若 up 已 DROP 旧表，
--   旧实例的 prisma.processedStripeEvent.create(...) 会抛「表不存在」异常，被 .catch(()=>null)
--   吞成幂等命中并返回 200——Stripe 收到 200 即停止重试，事件被静默永久丢失
--   （证据：webhook/route.ts L38–47）。保留旧表使旧实例写入正常成功，过渡期幂等事实源为
--   「两表之并集」，副作用由落库逻辑的 upsert/updateMany 幂等性兜底（见 §9.5 取舍断言）。

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN "provider" VARCHAR(20);
ALTER TABLE "subscriptions" ADD COLUMN "provider_order_id" VARCHAR(255);

-- Backfill：存量全量回填 'stripe'
UPDATE "subscriptions" SET "provider" = 'stripe';

-- 泛化幂等表：新建 + 迁移（不 DROP 旧表）
CREATE TABLE "processed_payment_events" (
    "provider" VARCHAR(20) NOT NULL,
    "event_id" VARCHAR(255) NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "processed_payment_events_pkey" PRIMARY KEY ("provider", "event_id")
);

INSERT INTO "processed_payment_events" ("provider", "event_id", "received_at")
SELECT 'stripe', "id", "received_at"
FROM "processed_stripe_events"
ON CONFLICT DO NOTHING;