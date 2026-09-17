-- AI 助理对话 — 一个用户在工作区内围绕某任务的连续对话
CREATE TABLE "assistant_conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "task_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "assistant_conversations_pkey" PRIMARY KEY ("id")
);

-- AI 助理消息 — 对话中的单条消息（user/assistant）
CREATE TABLE "assistant_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "content" TEXT NOT NULL,
    "capability_used" VARCHAR(50),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "assistant_messages_pkey" PRIMARY KEY ("id")
);

-- 外键约束
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "assistant_conversations"("id") ON DELETE CASCADE;

-- 索引
CREATE INDEX "assistant_conversations_user_id_workspace_id_idx" ON "assistant_conversations"("user_id", "workspace_id");
CREATE INDEX "assistant_messages_conversation_id_idx" ON "assistant_messages"("conversation_id");