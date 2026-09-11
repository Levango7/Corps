-- F3: Widget 仪表盘 — 用户工作区布局偏好表
-- 每个用户在每个工作区有独立的 Widget 布局配置（react-grid-layout 格式）。
-- 无配置时使用角色默认布局。

CREATE TABLE "user_dashboard_prefs" (
  "id" UUID PRIMARY KEY,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "layout" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "user_dashboard_prefs_user_id_workspace_id_key" ON "user_dashboard_prefs"("user_id", "workspace_id");

-- F5: 分享增强 — Document 添加过期时间+密码字段
ALTER TABLE "documents" ADD COLUMN "share_expires_at" TIMESTAMPTZ;
ALTER TABLE "documents" ADD COLUMN "share_password" VARCHAR(100);

-- F5: 分享增强 — Task 添加过期时间+密码字段
ALTER TABLE "tasks" ADD COLUMN "share_expires_at" TIMESTAMPTZ;
ALTER TABLE "tasks" ADD COLUMN "share_password" VARCHAR(100);

-- F5: 分享访问日志表
CREATE TABLE "share_access_logs" (
  "id" UUID PRIMARY KEY,
  "entity_type" VARCHAR(20) NOT NULL,
  "entity_id" UUID NOT NULL,
  "ip" VARCHAR(45),
  "user_agent" TEXT,
  "accessed_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "share_access_logs_entity_type_entity_id_accessed_at_idx" ON "share_access_logs"("entity_type", "entity_id", "accessed_at");