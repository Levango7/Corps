-- F2: 临时权限授权 — 限时角色提升，到期自动回收
-- 管理员可为成员授予限时权限（如临时提升为 admin），到期后由
-- /api/cron/check-expired-permissions 定时任务自动恢复原角色并删除授权记录。
-- 同一 (user_id, workspace_id) 仅保留一条有效授权（唯一约束）。
-- RLS 策略：成员可读自己工作区的授权，仅 owner/admin 可写；cron 作业跨工作区扫描。

CREATE TABLE "temporary_grants" (
  "id" UUID PRIMARY KEY,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "temp_role" VARCHAR(20) NOT NULL,
  "original_role" VARCHAR(20) NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "reason" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 同一用户在同一工作区仅保留一条临时授权（覆盖语义：重新授权更新现有记录）
-- 索引名与 Prisma @@unique([userId, workspaceId]) 默认生成名一致
CREATE UNIQUE INDEX "temporary_grants_user_id_workspace_id_key"
  ON "temporary_grants"("user_id", "workspace_id");

-- cron 作业按工作区 + 过期时间扫描高效索引
CREATE INDEX "temporary_grants_workspace_id_expires_at_idx"
  ON "temporary_grants"("workspace_id", "expires_at");

-- ─── RLS 策略 ───
-- temporary_grants：读 = 本工作区成员可见（含非 admin，用于展示自己的临时授权状态）
--   + cron 逃生口（跨工作区扫描过期记录）；
-- 写（INSERT/UPDATE/DELETE）= 仅本工作区（owner/admin 在应用层校验，RLS 仅做租户隔离）。
ALTER TABLE "temporary_grants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "temporary_grants" FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_temporary_grants_select ON "temporary_grants";
DROP POLICY IF EXISTS p_temporary_grants_insert ON "temporary_grants";
DROP POLICY IF EXISTS p_temporary_grants_update ON "temporary_grants";
DROP POLICY IF EXISTS p_temporary_grants_delete ON "temporary_grants";

CREATE POLICY p_temporary_grants_select ON "temporary_grants" FOR SELECT USING (
  workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
  OR current_setting('app.auth_op', true) = 'cron'
);

CREATE POLICY p_temporary_grants_insert ON "temporary_grants" FOR INSERT WITH CHECK (
  workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
);

CREATE POLICY p_temporary_grants_update ON "temporary_grants" FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

CREATE POLICY p_temporary_grants_delete ON "temporary_grants" FOR DELETE
  USING (
    workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
    OR current_setting('app.auth_op', true) = 'cron'
  );