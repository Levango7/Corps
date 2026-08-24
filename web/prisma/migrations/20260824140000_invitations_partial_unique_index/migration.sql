-- T3.9: invitations 部分唯一索引（仅未接受的邀请不可重复）
-- 替换原有普通复合索引

DROP INDEX IF EXISTS "invitations_workspace_id_email_idx";

CREATE UNIQUE INDEX "uq_invitations_pending"
  ON "invitations" ("workspace_id", "email")
  WHERE "accepted_at" IS NULL;
