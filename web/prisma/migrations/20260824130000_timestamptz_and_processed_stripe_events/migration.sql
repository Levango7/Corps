-- T2.4: 所有 DateTime 列迁移为 timestamptz（PostgreSQL 推荐时区感知存储）
-- 使用 USING 子句确保已有数据的时区转换正确（现有数据视为 UTC）

ALTER TABLE "users"           ALTER COLUMN "created_at"       SET DATA TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "users"           ALTER COLUMN "updated_at"       SET DATA TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';
ALTER TABLE "users"           ALTER COLUMN "last_login_at"    SET DATA TYPE timestamptz USING "last_login_at" AT TIME ZONE 'UTC';

ALTER TABLE "workspaces"      ALTER COLUMN "created_at"       SET DATA TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "workspaces"      ALTER COLUMN "updated_at"       SET DATA TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';

ALTER TABLE "members"         ALTER COLUMN "joined_at"        SET DATA TYPE timestamptz USING "joined_at" AT TIME ZONE 'UTC';
ALTER TABLE "members"         ALTER COLUMN "invited_at"       SET DATA TYPE timestamptz USING "invited_at" AT TIME ZONE 'UTC';

ALTER TABLE "invitations"     ALTER COLUMN "expires_at"       SET DATA TYPE timestamptz USING "expires_at" AT TIME ZONE 'UTC';
ALTER TABLE "invitations"     ALTER COLUMN "accepted_at"      SET DATA TYPE timestamptz USING "accepted_at" AT TIME ZONE 'UTC';
ALTER TABLE "invitations"     ALTER COLUMN "created_at"       SET DATA TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';

ALTER TABLE "tasks"           ALTER COLUMN "due_date"         SET DATA TYPE timestamptz USING "due_date" AT TIME ZONE 'UTC';
ALTER TABLE "tasks"           ALTER COLUMN "created_at"       SET DATA TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "tasks"           ALTER COLUMN "updated_at"       SET DATA TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';

ALTER TABLE "comments"        ALTER COLUMN "created_at"       SET DATA TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "comments"        ALTER COLUMN "updated_at"       SET DATA TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';

ALTER TABLE "notifications"   ALTER COLUMN "created_at"       SET DATA TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';

ALTER TABLE "decisions"       ALTER COLUMN "created_at"       SET DATA TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "decisions"       ALTER COLUMN "updated_at"       SET DATA TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';

ALTER TABLE "decision_versions" ALTER COLUMN "created_at"     SET DATA TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';

ALTER TABLE "sessions"        ALTER COLUMN "expires_at"       SET DATA TYPE timestamptz USING "expires_at" AT TIME ZONE 'UTC';
ALTER TABLE "sessions"        ALTER COLUMN "created_at"       SET DATA TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "sessions"        ALTER COLUMN "updated_at"       SET DATA TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';

ALTER TABLE "accounts"        ALTER COLUMN "access_token_expires_at"  SET DATA TYPE timestamptz USING "access_token_expires_at"  AT TIME ZONE 'UTC';
ALTER TABLE "accounts"        ALTER COLUMN "refresh_token_expires_at" SET DATA TYPE timestamptz USING "refresh_token_expires_at" AT TIME ZONE 'UTC';
ALTER TABLE "accounts"        ALTER COLUMN "created_at"       SET DATA TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "accounts"        ALTER COLUMN "updated_at"       SET DATA TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';

ALTER TABLE "verifications"   ALTER COLUMN "expires_at"       SET DATA TYPE timestamptz USING "expires_at" AT TIME ZONE 'UTC';
ALTER TABLE "verifications"   ALTER COLUMN "created_at"       SET DATA TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "verifications"   ALTER COLUMN "updated_at"       SET DATA TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';

ALTER TABLE "subscriptions"   ALTER COLUMN "current_period_end" SET DATA TYPE timestamptz USING "current_period_end" AT TIME ZONE 'UTC';
ALTER TABLE "subscriptions"   ALTER COLUMN "canceled_at"     SET DATA TYPE timestamptz USING "canceled_at" AT TIME ZONE 'UTC';
ALTER TABLE "subscriptions"   ALTER COLUMN "created_at"      SET DATA TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';
ALTER TABLE "subscriptions"   ALTER COLUMN "updated_at"      SET DATA TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';

ALTER TABLE "analytics_events" ALTER COLUMN "created_at"     SET DATA TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC';

-- T2.7: Webhook 幂等 —— Stripe 重复事件检测表
CREATE TABLE "processed_stripe_events" (
    "id"          VARCHAR(255) NOT NULL,
    "received_at" TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "processed_stripe_events_pkey" PRIMARY KEY ("id")
);
