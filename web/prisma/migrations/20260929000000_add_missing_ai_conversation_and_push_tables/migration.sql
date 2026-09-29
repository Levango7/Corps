-- 补齐 schema.prisma 已声明、但迁移链从未建过的三张表。
-- 这三张表历史上靠 `prisma migrate dev` 之外的路径（db push / 手工）存在于开发库，
-- 导致 `migrate deploy` 建出的库缺表：db/rls-activate.sql 对 ai_conversations 建策略时
-- 直接 ERROR: relation "ai_conversations" does not exist，令加固模式 CI 与容器启动中断。
-- DDL 由 `prisma migrate diff --from-migrations ./prisma/migrations
-- --to-schema-datamodel ./prisma/schema.prisma --shadow-database-url <shadow> --script` 生成。

-- CreateTable
CREATE TABLE "public"."ai_conversations" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "scopes" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ai_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."push_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "platform" VARCHAR(20) NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_conversations_workspace_id_user_id_updated_at_idx" ON "public"."ai_conversations"("workspace_id", "user_id", "updated_at");

-- CreateIndex
CREATE INDEX "ai_messages_conversation_id_created_at_idx" ON "public"."ai_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "push_tokens_user_id_idx" ON "public"."push_tokens"("user_id");

-- CreateIndex
CREATE INDEX "push_tokens_token_idx" ON "public"."push_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "push_tokens_user_id_platform_token_key" ON "public"."push_tokens"("user_id", "platform", "token");

-- AddForeignKey
ALTER TABLE "public"."ai_conversations" ADD CONSTRAINT "ai_conversations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."push_tokens" ADD CONSTRAINT "push_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
