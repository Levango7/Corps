-- 方向 G：实时会议 AI — 会议会话
CREATE TABLE "ai_meeting_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "transcript" JSONB NOT NULL DEFAULT '[]',
    "summary" TEXT,
    "participant_count" INTEGER NOT NULL DEFAULT 0,
    "start_time" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "end_time" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "ai_meeting_sessions_pkey" PRIMARY KEY ("id")
);

-- 方向 G：实时会议 AI — 行动项
CREATE TABLE "ai_meeting_action_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "assignee_id" UUID,
    "due_date" TIMESTAMPTZ,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "extracted_by" VARCHAR(10) NOT NULL DEFAULT 'ai',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "ai_meeting_action_items_pkey" PRIMARY KEY ("id")
);

-- 方向 G：实时会议 AI — 决策
CREATE TABLE "ai_meeting_decisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "context" TEXT,
    "participants" JSONB NOT NULL DEFAULT '[]',
    "status" VARCHAR(20) NOT NULL DEFAULT 'proposed',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "ai_meeting_decisions_pkey" PRIMARY KEY ("id")
);

-- 方向 H：AI 语音交互 — 命令记录
CREATE TABLE "ai_voice_commands" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "transcript" TEXT NOT NULL,
    "intent" VARCHAR(100),
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "executed" BOOLEAN NOT NULL DEFAULT false,
    "result" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "ai_voice_commands_pkey" PRIMARY KEY ("id")
);

-- 方向 H：AI 语音交互 — 用户偏好
CREATE TABLE "ai_voice_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "language" VARCHAR(10) NOT NULL DEFAULT 'zh-CN',
    "voice_id" VARCHAR(50),
    "speed" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "wake_word" VARCHAR(50) NOT NULL DEFAULT '你好小助手',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "ai_voice_preferences_pkey" PRIMARY KEY ("id")
);

-- 外键约束
ALTER TABLE "ai_meeting_sessions" ADD CONSTRAINT "ai_meeting_sessions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
ALTER TABLE "ai_meeting_sessions" ADD CONSTRAINT "ai_meeting_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "ai_meeting_action_items" ADD CONSTRAINT "ai_meeting_action_items_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "ai_meeting_sessions"("id") ON DELETE CASCADE;
ALTER TABLE "ai_meeting_action_items" ADD CONSTRAINT "ai_meeting_action_items_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
ALTER TABLE "ai_meeting_decisions" ADD CONSTRAINT "ai_meeting_decisions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "ai_meeting_sessions"("id") ON DELETE CASCADE;
ALTER TABLE "ai_meeting_decisions" ADD CONSTRAINT "ai_meeting_decisions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
ALTER TABLE "ai_voice_commands" ADD CONSTRAINT "ai_voice_commands_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
ALTER TABLE "ai_voice_commands" ADD CONSTRAINT "ai_voice_commands_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "ai_voice_preferences" ADD CONSTRAINT "ai_voice_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;

-- 索引
CREATE INDEX "ai_meeting_sessions_workspace_id_status_idx" ON "ai_meeting_sessions"("workspace_id", "status");
CREATE INDEX "ai_meeting_action_items_session_id_status_idx" ON "ai_meeting_action_items"("session_id", "status");
CREATE INDEX "ai_meeting_decisions_session_id_status_idx" ON "ai_meeting_decisions"("session_id", "status");
CREATE INDEX "ai_voice_commands_user_id_created_at_idx" ON "ai_voice_commands"("user_id", "created_at");
CREATE UNIQUE INDEX "ai_voice_preferences_user_id_key" ON "ai_voice_preferences"("user_id");