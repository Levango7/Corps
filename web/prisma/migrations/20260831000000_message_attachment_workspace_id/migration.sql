-- ============================================================================
-- Add workspace_id to message_attachments — 附件租户隔离（审计修复）
--
-- 背景：message_attachments 此前无 workspace_id 列，无法纳入 RLS workspace
-- 谓词，多租户隔离仅靠应用层；且下载端点（/api/uploads/*）无归属校验。
--
-- 本迁移：
--   1. 新增 workspace_id UUID NOT NULL（先加列 → 回填 → SET NOT NULL）
--   2. 从所属 message 回填 workspace_id（历史数据）
--   3. 外键 + 索引
-- ============================================================================

-- 1. 加列（可空，便于回填）
ALTER TABLE "message_attachments" ADD COLUMN "workspace_id" UUID;

-- 2. 回填：从所属消息的工作区复制（历史存量数据）
UPDATE "message_attachments" ma
SET "workspace_id" = m."workspace_id"
FROM "messages" m
WHERE m."id" = ma."message_id"
  AND ma."workspace_id" IS NULL;

-- 3. 兜底：无法回填的行（孤儿附件）强制删除——它们已无归属消息，保留只会
--    悬挂无效记录，且后续 NOT NULL 约束会拒绝它们
DELETE FROM "message_attachments" ma
WHERE ma."workspace_id" IS NULL;

-- 4. 收紧为 NOT NULL
ALTER TABLE "message_attachments" ALTER COLUMN "workspace_id" SET NOT NULL;

-- 5. 外键（工作区删除时级联清理附件）
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;

-- 6. 索引（RLS 谓词 + 下载归属校验）
CREATE INDEX "message_attachments_workspace_id_idx" ON "message_attachments"("workspace_id");
