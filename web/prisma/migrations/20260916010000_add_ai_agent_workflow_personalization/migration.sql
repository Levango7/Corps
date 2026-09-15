-- 方向 D：AI Agent 定义
CREATE TABLE "ai_agents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "role" VARCHAR(50) NOT NULL,
    "capabilities" JSONB NOT NULL,
    "system_prompt" TEXT NOT NULL,
    "model" VARCHAR(50) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "ai_agents_pkey" PRIMARY KEY ("id")
);

-- 方向 D：Agent 间消息
CREATE TABLE "ai_agent_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "from_agent_id" UUID NOT NULL,
    "to_agent_id" UUID,
    "content" TEXT NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "ai_agent_messages_pkey" PRIMARY KEY ("id")
);

-- 方向 E：AI 工作流模板
CREATE TABLE "ai_workflow_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT NOT NULL,
    "category" VARCHAR(50) NOT NULL,
    "steps" JSONB NOT NULL,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "workspace_id" UUID,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "ai_workflow_templates_pkey" PRIMARY KEY ("id")
);

-- 方向 F：用户行为记录
CREATE TABLE "ai_user_behaviors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "capability" VARCHAR(50) NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "ai_user_behaviors_pkey" PRIMARY KEY ("id")
);

-- 方向 F：AI 个性化推荐
CREATE TABLE "ai_personalizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "content" JSONB NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "ai_personalizations_pkey" PRIMARY KEY ("id")
);

-- 外键
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
ALTER TABLE "ai_agent_messages" ADD CONSTRAINT "ai_agent_messages_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
ALTER TABLE "ai_agent_messages" ADD CONSTRAINT "ai_agent_messages_from_agent_id_fkey"
    FOREIGN KEY ("from_agent_id") REFERENCES "ai_agents"("id") ON DELETE CASCADE;
ALTER TABLE "ai_agent_messages" ADD CONSTRAINT "ai_agent_messages_to_agent_id_fkey"
    FOREIGN KEY ("to_agent_id") REFERENCES "ai_agents"("id") ON DELETE SET NULL;
ALTER TABLE "ai_workflow_templates" ADD CONSTRAINT "ai_workflow_templates_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
ALTER TABLE "ai_user_behaviors" ADD CONSTRAINT "ai_user_behaviors_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
ALTER TABLE "ai_user_behaviors" ADD CONSTRAINT "ai_user_behaviors_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "ai_personalizations" ADD CONSTRAINT "ai_personalizations_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
ALTER TABLE "ai_personalizations" ADD CONSTRAINT "ai_personalizations_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;

-- 索引
CREATE INDEX "ai_agents_workspace_id_enabled_idx" ON "ai_agents"("workspace_id", "enabled");
CREATE INDEX "ai_agent_messages_workspace_id_created_at_idx" ON "ai_agent_messages"("workspace_id", "created_at");
CREATE INDEX "ai_agent_messages_from_agent_id_created_at_idx" ON "ai_agent_messages"("from_agent_id", "created_at");
CREATE INDEX "ai_agent_messages_to_agent_id_created_at_idx" ON "ai_agent_messages"("to_agent_id", "created_at");
CREATE INDEX "ai_workflow_templates_category_is_public_idx" ON "ai_workflow_templates"("category", "is_public");
CREATE INDEX "ai_workflow_templates_workspace_id_idx" ON "ai_workflow_templates"("workspace_id");
CREATE INDEX "ai_user_behaviors_user_id_action_created_at_idx" ON "ai_user_behaviors"("user_id", "action", "created_at");
CREATE INDEX "ai_user_behaviors_workspace_id_capability_created_at_idx" ON "ai_user_behaviors"("workspace_id", "capability", "created_at");
CREATE INDEX "ai_personalizations_user_id_type_created_at_idx" ON "ai_personalizations"("user_id", "type", "created_at");