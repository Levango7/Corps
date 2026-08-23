-- ============================================================================
-- Add AnalyticsEvent table — P2 数据埋点（注册/激活/留存/转化漏斗）
-- See schema.prisma AnalyticsEvent model for design rationale.
-- ============================================================================

CREATE TABLE "analytics_events" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"       UUID,
  "workspace_id"  UUID,
  "name"          VARCHAR(64) NOT NULL,
  "props"         JSON NOT NULL DEFAULT '{}',
  "session_id"    VARCHAR(64),
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Foreign keys: user/workspace 可为空（全局事件如 register）
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;

-- Indexes（与 schema.prisma @@index 对齐）
CREATE INDEX "analytics_events_name_created_at_idx" ON "analytics_events"("name", "created_at");
CREATE INDEX "analytics_events_user_id_created_at_idx" ON "analytics_events"("user_id", "created_at");
CREATE INDEX "analytics_events_workspace_id_created_at_idx" ON "analytics_events"("workspace_id", "created_at");
CREATE INDEX "analytics_events_session_id_created_at_idx" ON "analytics_events"("session_id", "created_at");