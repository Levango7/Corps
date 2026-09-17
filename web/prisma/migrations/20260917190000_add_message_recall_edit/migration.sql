-- Message 映射至 messages；editedAt / edited_at 已在 20260913000000 迁移中添加。
ALTER TABLE "messages" ADD COLUMN "isRecalled" BOOLEAN NOT NULL DEFAULT false;

-- 与已有会话撤回状态保持一致，避免历史撤回消息重新显示。
UPDATE "messages" SET "isRecalled" = true WHERE "revoked_at" IS NOT NULL;