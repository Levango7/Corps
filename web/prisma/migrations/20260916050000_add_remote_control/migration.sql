-- 方向 K：远程控制会话表
-- WebRTC 屏幕共享 + 输入事件传输的会话记录

-- CreateTable
CREATE TABLE "remote_control_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "initiator_id" UUID NOT NULL,
    "target_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "end_reason" VARCHAR(200),
    "expires_at" TIMESTAMPTZ NOT NULL,
    "accepted_at" TIMESTAMPTZ,
    "ended_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "remote_control_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "remote_control_sessions_workspace_id_status_idx" ON "remote_control_sessions"("workspace_id", "status");
CREATE INDEX "remote_control_sessions_initiator_id_status_idx" ON "remote_control_sessions"("initiator_id", "status");
CREATE INDEX "remote_control_sessions_target_id_status_idx" ON "remote_control_sessions"("target_id", "status");

-- AddForeignKey
ALTER TABLE "remote_control_sessions" ADD CONSTRAINT "remote_control_sessions_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "remote_control_sessions" ADD CONSTRAINT "remote_control_sessions_initiator_id_fkey"
    FOREIGN KEY ("initiator_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "remote_control_sessions" ADD CONSTRAINT "remote_control_sessions_target_id_fkey"
    FOREIGN KEY ("target_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;