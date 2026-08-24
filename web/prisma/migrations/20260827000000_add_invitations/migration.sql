-- ============================================================================
-- Add Invitations table — 邀请未注册用户完整流程（P2）
-- See schema.prisma Invitation model for design rationale.
-- ============================================================================

CREATE TABLE "invitations" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id"  UUID NOT NULL,
  "email"         VARCHAR(255) NOT NULL,
  -- 仅存 sha256(token) 哈希；明文 token 只在邀请响应/邮件中出现一次
  "token_hash"    VARCHAR(64) NOT NULL,
  "role"          VARCHAR(20) NOT NULL DEFAULT 'member',
  "invited_by"    UUID NOT NULL,
  "expires_at"    TIMESTAMPTZ NOT NULL,
  "accepted_at"   TIMESTAMPTZ,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Foreign keys: 删除工作区时级联清理邀请
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;

-- Indexes（与 schema.prisma @@unique / @@index 对齐）
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");
CREATE INDEX "invitations_workspace_id_email_idx" ON "invitations"("workspace_id", "email");
CREATE INDEX "invitations_email_idx" ON "invitations"("email");
