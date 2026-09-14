-- ===========================================================================
-- add_ai_feedback_and_usage — AI 结果反馈 + 使用量日志/限额（方向 D + G）
--
-- 背景：
--   方向 D：AI 结果反馈循环 — 用户对 AI 输出的点赞/点踩/修正反馈
--   方向 G：AI 使用量记录（Token/成本/耗时）+ 按用户/工作空间的限额
--
-- 兼容性：
--   - 纯新增表，不修改现有表结构，在线可执行。
--   - 所有外键 ON DELETE CASCADE，与项目级联策略一致。
--   - ai_usage_limits.user_id 可空（null = 工作空间级默认限额），
--     PostgreSQL 中 NULL 不参与唯一约束，工作空间级 + 用户级限额可共存。
-- ===========================================================================

-- ===== UP =====

-- ── 1. ai_feedback 表（方向 D：AI 结果反馈）──
CREATE TABLE "public"."ai_feedback" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "capability" VARCHAR(50) NOT NULL,
    "rating" VARCHAR(10) NOT NULL,
    "comment" TEXT,
    "originalOutput" JSONB,
    "correctedOutput" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_feedback_pkey" PRIMARY KEY ("id")
);

-- ── 2. ai_usage_logs 表（方向 G：AI 使用量日志）──
CREATE TABLE "public"."ai_usage_logs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "capability" VARCHAR(50) NOT NULL,
    "model" VARCHAR(50) NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_logs_pkey" PRIMARY KEY ("id")
);

-- ── 3. ai_usage_limits 表（方向 G：AI 使用限额）──
CREATE TABLE "public"."ai_usage_limits" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID,
    "daily_token_limit" INTEGER,
    "monthly_token_limit" INTEGER,
    "daily_call_limit" INTEGER,
    "monthly_call_limit" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ai_usage_limits_pkey" PRIMARY KEY ("id")
);

-- ── 4. 索引 ──
-- ai_feedback
CREATE INDEX "ai_feedback_workspace_id_capability_created_at_idx" ON "public"."ai_feedback"("workspace_id", "capability", "created_at");
CREATE INDEX "ai_feedback_user_id_created_at_idx" ON "public"."ai_feedback"("user_id", "created_at");

-- ai_usage_logs
CREATE INDEX "ai_usage_logs_workspace_id_created_at_idx" ON "public"."ai_usage_logs"("workspace_id", "created_at");
CREATE INDEX "ai_usage_logs_user_id_created_at_idx" ON "public"."ai_usage_logs"("user_id", "created_at");
CREATE INDEX "ai_usage_logs_workspace_id_capability_created_at_idx" ON "public"."ai_usage_logs"("workspace_id", "capability", "created_at");

-- ai_usage_limits（workspaceId + userId 唯一约束，NULL 不参与唯一）
CREATE UNIQUE INDEX "ai_usage_limits_workspace_id_user_id_key" ON "public"."ai_usage_limits"("workspace_id", "user_id");

-- ── 5. 外键 ──
-- ai_feedback
ALTER TABLE "public"."ai_feedback" ADD CONSTRAINT "ai_feedback_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."ai_feedback" ADD CONSTRAINT "ai_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ai_usage_logs
ALTER TABLE "public"."ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ai_usage_limits
ALTER TABLE "public"."ai_usage_limits" ADD CONSTRAINT "ai_usage_limits_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."ai_usage_limits" ADD CONSTRAINT "ai_usage_limits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===== DOWN (rollback，按 DB-MIGRATION-GUIDE §2 保留注释，需要时取消注释执行) =====
-- DROP TABLE IF EXISTS "public"."ai_usage_limits";
-- DROP TABLE IF EXISTS "public"."ai_usage_logs";
-- DROP TABLE IF EXISTS "public"."ai_feedback";