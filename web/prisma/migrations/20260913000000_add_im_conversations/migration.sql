-- ===========================================================================
-- add_im_conversations — 独立 IM（单聊/群聊）会话模型
--
-- 背景：原 Message 绑定 taskId（任务内聊天），需扩展为支持独立 IM 通道。
--   Conversation 统一单聊/群聊；ConversationMember 管理成员关系；
--   Message.taskId 变可选，新增 conversationId 指向会话；
--   ChatPresence 同步支持会话级在线状态。
--
-- 兼容性：
--   - messages.task_id DROP NOT NULL：现有任务聊天记录 task_id 非 null，不受影响。
--   - messages 外键 messages_task_id_fkey 保持不变（NULL 不参与引用检查）。
--   - chat_presences 唯一索引重建为命名版本，nullable 语义不变
--     （PostgreSQL 中 NULL 不参与唯一约束，任务级/会话级互不干扰）。
--   - 新增列均 nullable 或有默认值，在线可执行。
-- ===========================================================================

-- ===== UP =====

-- ── 1. 新增 conversations 表（会话：单聊/群聊统一模型）──
CREATE TABLE "public"."conversations" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "title" VARCHAR(200),
    "avatar" TEXT,
    "description" VARCHAR(500),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "last_message_at" TIMESTAMPTZ,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- ── 2. 新增 conversation_members 表（会话成员关系）──
CREATE TABLE "public"."conversation_members" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" VARCHAR(20) NOT NULL DEFAULT 'member',
    "joined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_read_at" TIMESTAMPTZ,
    "muted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "conversation_members_pkey" PRIMARY KEY ("id")
);

-- ── 3. 扩展 messages 表 ──
-- task_id 变可选（外键 messages_task_id_fkey 保持，NULL 不参与引用检查）
ALTER TABLE "public"."messages" ALTER COLUMN "task_id" DROP NOT NULL;

-- 新增 IM 字段
ALTER TABLE "public"."messages" ADD COLUMN "conversation_id" UUID;
ALTER TABLE "public"."messages" ADD COLUMN "edited_at" TIMESTAMPTZ;
ALTER TABLE "public"."messages" ADD COLUMN "revoked_at" TIMESTAMPTZ;
ALTER TABLE "public"."messages" ADD COLUMN "revoked_by" UUID;
ALTER TABLE "public"."messages" ADD COLUMN "reply_to_id" UUID;
ALTER TABLE "public"."messages" ADD COLUMN "mentions" TEXT[] NOT NULL DEFAULT '{}';

-- ── 4. 扩展 chat_presences 表 ──
-- task_id 变可选
ALTER TABLE "public"."chat_presences" ALTER COLUMN "task_id" DROP NOT NULL;

-- 新增 conversation_id
ALTER TABLE "public"."chat_presences" ADD COLUMN "conversation_id" UUID;

-- 重建 task 级唯一索引（命名版本，nullable 语义不变：NULL 不参与唯一约束）
DROP INDEX IF EXISTS "public"."chat_presences_task_id_user_id_key";
CREATE UNIQUE INDEX "uq_chat_presences_task_user" ON "public"."chat_presences"("task_id", "user_id");

-- 会话级唯一索引（conversation_id 非 null 时生效）
CREATE UNIQUE INDEX "uq_chat_presences_conversation_user" ON "public"."chat_presences"("conversation_id", "user_id");

-- ── 5. 索引 ──
-- conversations
CREATE INDEX "conversations_workspace_id_updated_at_idx" ON "public"."conversations"("workspace_id", "updated_at");

-- conversation_members
CREATE UNIQUE INDEX "conversation_members_conversation_id_user_id_key" ON "public"."conversation_members"("conversation_id", "user_id");
CREATE INDEX "conversation_members_user_id_idx" ON "public"."conversation_members"("user_id");

-- messages（会话聊天按时间顺序加载）
CREATE INDEX "messages_conversation_id_created_at_idx" ON "public"."messages"("conversation_id", "created_at");

-- chat_presences（按会话查询在线成员）
CREATE INDEX "chat_presences_conversation_id_idx" ON "public"."chat_presences"("conversation_id");

-- ── 6. 外键 ──
-- conversations
ALTER TABLE "public"."conversations" ADD CONSTRAINT "conversations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."conversations" ADD CONSTRAINT "conversations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- conversation_members
ALTER TABLE "public"."conversation_members" ADD CONSTRAINT "conversation_members_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."conversation_members" ADD CONSTRAINT "conversation_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- messages 新增外键（conversation + 回复自关联）
ALTER TABLE "public"."messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."messages" ADD CONSTRAINT "messages_reply_to_id_fkey" FOREIGN KEY ("reply_to_id") REFERENCES "public"."messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- chat_presences 新增外键
ALTER TABLE "public"."chat_presences" ADD CONSTRAINT "chat_presences_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===== DOWN (rollback，按 DB-MIGRATION-GUIDE §2 保留注释，需要时取消注释执行) =====
-- -- chat_presences: 回滚外键 + 索引 + 列
-- ALTER TABLE "public"."chat_presences" DROP CONSTRAINT "chat_presences_conversation_id_fkey";
-- DROP INDEX IF EXISTS "public"."chat_presences_conversation_id_idx";
-- DROP INDEX IF EXISTS "public"."uq_chat_presences_conversation_user";
-- DROP INDEX IF EXISTS "public"."uq_chat_presences_task_user";
-- ALTER TABLE "public"."chat_presences" DROP COLUMN IF EXISTS "conversation_id";
-- ALTER TABLE "public"."chat_presences" ALTER COLUMN "task_id" SET NOT NULL;
-- CREATE UNIQUE INDEX "chat_presences_task_id_user_id_key" ON "public"."chat_presences"("task_id", "user_id");
--
-- -- messages: 回滚外键 + 索引 + 列
-- ALTER TABLE "public"."messages" DROP CONSTRAINT "messages_reply_to_id_fkey";
-- ALTER TABLE "public"."messages" DROP CONSTRAINT "messages_conversation_id_fkey";
-- DROP INDEX IF EXISTS "public"."messages_conversation_id_created_at_idx";
-- ALTER TABLE "public"."messages" DROP COLUMN IF EXISTS "mentions";
-- ALTER TABLE "public"."messages" DROP COLUMN IF EXISTS "reply_to_id";
-- ALTER TABLE "public"."messages" DROP COLUMN IF EXISTS "revoked_by";
-- ALTER TABLE "public"."messages" DROP COLUMN IF EXISTS "revoked_at";
-- ALTER TABLE "public"."messages" DROP COLUMN IF EXISTS "edited_at";
-- ALTER TABLE "public"."messages" DROP COLUMN IF EXISTS "conversation_id";
-- ALTER TABLE "public"."messages" ALTER COLUMN "task_id" SET NOT NULL;
--
-- -- conversation_members / conversations: 回滚表
-- DROP TABLE IF EXISTS "public"."conversation_members";
-- DROP TABLE IF EXISTS "public"."conversations";