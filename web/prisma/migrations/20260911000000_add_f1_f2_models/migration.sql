-- F1: 决策驱动执行 — 行动项与任务关联表
-- 每个行动项从决策 Markdown 中解析得出，可自动创建 Task。
-- 同步策略：新增→创建Task+ActionItem；删除→标记removed=true（Task保留）；
-- 用户手动改Task→标记userModified=true，停止该字段自动同步。

CREATE TABLE "decision_action_items" (
  "id" UUID PRIMARY KEY,
  "decision_id" UUID NOT NULL REFERENCES "decisions"("id") ON DELETE CASCADE,
  "task_id" UUID REFERENCES "tasks"("id") ON DELETE SET NULL,
  "line_index" INTEGER NOT NULL,
  "checked" BOOLEAN NOT NULL DEFAULT false,
  "assignee_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "due_date" TIMESTAMPTZ,
  "priority" VARCHAR(20) NOT NULL DEFAULT 'medium',
  "title" VARCHAR(500) NOT NULL,
  "removed" BOOLEAN NOT NULL DEFAULT false,
  "user_modified" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "decision_action_items_decision_id_idx" ON "decision_action_items"("decision_id");
CREATE INDEX "decision_action_items_task_id_idx" ON "decision_action_items"("task_id");

-- F2: Viewer 角色 + 模块权限矩阵 — 权限覆盖表
-- 按角色+模块粒度覆盖默认权限。owner/admin 不可覆盖（短路返回 true）。
-- 仅对 member/viewer 生效。actions 为空数组=完全禁止该模块。

CREATE TABLE "member_permissions" (
  "id" UUID PRIMARY KEY,
  "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "role" VARCHAR(20) NOT NULL,
  "module" VARCHAR(30) NOT NULL,
  "actions" TEXT[] NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "uq_member_perm" ON "member_permissions"("workspace_id", "role", "module");
CREATE INDEX "member_permissions_workspace_id_idx" ON "member_permissions"("workspace_id");

-- F2: 更新 members.role CHECK 约束，新增 'viewer' 角色
ALTER TABLE "members" DROP CONSTRAINT IF EXISTS "members_role_check";
ALTER TABLE "members" ADD CONSTRAINT "members_role_check"
  CHECK ("role" IN ('owner','admin','member','viewer'));