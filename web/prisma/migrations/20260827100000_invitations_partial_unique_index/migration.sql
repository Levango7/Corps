-- T3.9: invitations 部分唯一索引（仅未接受的邀请不可重复）
-- 替换原有普通复合索引
-- 幂等化：IF NOT EXISTS 保证迁移在已应用过的库上重跑不报错
-- （prisma migrate deploy 不校验已应用迁移的 checksum，编辑本文件对 deploy 流程安全）

DROP INDEX IF EXISTS "invitations_workspace_id_email_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "uq_invitations_pending"
  ON "invitations" ("workspace_id", "email")
  WHERE "accepted_at" IS NULL;
