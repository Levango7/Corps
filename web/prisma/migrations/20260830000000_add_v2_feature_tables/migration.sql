-- ===========================================================================
-- add_v2_feature_tables — 补齐 v2 功能线的全部缺失表（P1 修复 2026-08-28）
--
-- 背景：schema.prisma 中的 labels / task_labels / milestones / messages /
--   message_reads / message_attachments / chat_presences / calendar_connections /
--   task_calendar_events 九张表以及 tasks.milestone_id 列从未生成迁移，
--   生产走 prisma migrate deploy 时这些对象不存在，标签/里程碑/任务聊天/
--   日历集成四条功能线运行时必然 500（"column tasks.milestone_id does not exist"）。
--   本迁移由 prisma migrate diff（部署库 → schema）人工遴选生成：仅包含
--   真实缺失的对象，不包含 diff 噪声（FK 重建、id DEFAULT 清理、既有索引改名、
--   invitations 全量唯一索引——后者会破坏"已接受邀请可重新邀请"的部分唯一语义）。
--
-- 注意（遗留漂移，待后续独立迁移收口）：
--   - schema 声明的部分复合索引（comments_task_id_created_at_idx、
--     tasks_workspace_id_status_sort_order_idx 等）与 init 迁移中的单列索引
--     名称/列不一致，属性能漂移，不影响正确性。
--   - 本批新表暂未纳入 db/rls-activate.sql 的 FORCE RLS 清单（纵深防御
--     待统一评估后补齐，见审计 P2-3）。
-- ===========================================================================

-- ===== UP =====

-- ALTER TABLE "public"."tasks" ADD COLUMN "milestone_id" UUID;
ALTER TABLE "public"."tasks" ADD COLUMN "milestone_id" UUID;

-- CreateTable labels
CREATE TABLE "public"."labels" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "color" VARCHAR(50) NOT NULL DEFAULT 'var(--muted)',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable task_labels
CREATE TABLE "public"."task_labels" (
    "task_id" UUID NOT NULL,
    "label_id" UUID NOT NULL,

    CONSTRAINT "task_labels_pkey" PRIMARY KEY ("task_id","label_id")
);

-- CreateTable milestones
CREATE TABLE "public"."milestones" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "due_date" TIMESTAMPTZ,
    "description" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable messages
CREATE TABLE "public"."messages" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "author_id" UUID,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable message_reads
CREATE TABLE "public"."message_reads" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "read_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_reads_pkey" PRIMARY KEY ("id")
);

-- CreateTable message_attachments
CREATE TABLE "public"."message_attachments" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "file_size" INTEGER NOT NULL,
    "file_type" VARCHAR(100) NOT NULL,
    "url" TEXT NOT NULL,
    "thumbnail_url" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable chat_presences
CREATE TABLE "public"."chat_presences" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "last_seen" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_presences_pkey" PRIMARY KEY ("id")
);

-- CreateTable calendar_connections
CREATE TABLE "public"."calendar_connections" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "token_expires_at" TIMESTAMPTZ NOT NULL,
    "calendar_id" VARCHAR(255) NOT NULL,
    "last_sync_at" TIMESTAMPTZ,
    "sync_status" VARCHAR(20) NOT NULL DEFAULT 'idle',
    "sync_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "calendar_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable task_calendar_events
CREATE TABLE "public"."task_calendar_events" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "external_event_id" VARCHAR(255) NOT NULL,
    "last_synced_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex（新表自有索引）
CREATE INDEX "labels_workspace_id_idx" ON "public"."labels"("workspace_id");
CREATE UNIQUE INDEX "labels_workspace_id_name_key" ON "public"."labels"("workspace_id", "name");
CREATE INDEX "task_labels_label_id_idx" ON "public"."task_labels"("label_id");
CREATE INDEX "milestones_workspace_id_idx" ON "public"."milestones"("workspace_id");
CREATE INDEX "messages_task_id_created_at_idx" ON "public"."messages"("task_id", "created_at");
CREATE INDEX "messages_workspace_id_idx" ON "public"."messages"("workspace_id");
CREATE INDEX "message_reads_message_id_idx" ON "public"."message_reads"("message_id");
CREATE INDEX "message_reads_user_id_idx" ON "public"."message_reads"("user_id");
CREATE UNIQUE INDEX "message_reads_message_id_user_id_key" ON "public"."message_reads"("message_id", "user_id");
CREATE INDEX "message_attachments_message_id_idx" ON "public"."message_attachments"("message_id");
CREATE INDEX "chat_presences_task_id_idx" ON "public"."chat_presences"("task_id");
CREATE UNIQUE INDEX "chat_presences_task_id_user_id_key" ON "public"."chat_presences"("task_id", "user_id");
CREATE INDEX "calendar_connections_user_id_idx" ON "public"."calendar_connections"("user_id");
CREATE UNIQUE INDEX "calendar_connections_user_id_provider_key" ON "public"."calendar_connections"("user_id", "provider");
CREATE INDEX "task_calendar_events_connection_id_idx" ON "public"."task_calendar_events"("connection_id");
CREATE UNIQUE INDEX "task_calendar_events_task_id_connection_id_key" ON "public"."task_calendar_events"("task_id", "connection_id");
CREATE INDEX "tasks_workspace_id_milestone_id_idx" ON "public"."tasks"("workspace_id", "milestone_id");

-- AddForeignKey（新表外键 + tasks.milestone_id）
ALTER TABLE "public"."tasks" ADD CONSTRAINT "tasks_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."labels" ADD CONSTRAINT "labels_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."task_labels" ADD CONSTRAINT "task_labels_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."task_labels" ADD CONSTRAINT "task_labels_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "public"."labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."milestones" ADD CONSTRAINT "milestones_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."messages" ADD CONSTRAINT "messages_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."messages" ADD CONSTRAINT "messages_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."messages" ADD CONSTRAINT "messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."message_reads" ADD CONSTRAINT "message_reads_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."message_reads" ADD CONSTRAINT "message_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."message_attachments" ADD CONSTRAINT "message_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."chat_presences" ADD CONSTRAINT "chat_presences_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."chat_presences" ADD CONSTRAINT "chat_presences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."calendar_connections" ADD CONSTRAINT "calendar_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."task_calendar_events" ADD CONSTRAINT "task_calendar_events_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."task_calendar_events" ADD CONSTRAINT "task_calendar_events_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===== DOWN (rollback，按 DB-MIGRATION-GUIDE §2 保留注释，需要时取消注释执行) =====
-- ALTER TABLE "public"."tasks" DROP CONSTRAINT "tasks_milestone_id_fkey";
-- ALTER TABLE "public"."tasks" DROP COLUMN IF EXISTS "milestone_id";
-- DROP INDEX IF EXISTS "tasks_workspace_id_milestone_id_idx";
-- DROP TABLE IF EXISTS "public"."task_calendar_events";
-- DROP TABLE IF EXISTS "public"."calendar_connections";
-- DROP TABLE IF EXISTS "public"."chat_presences";
-- DROP TABLE IF EXISTS "public"."message_attachments";
-- DROP TABLE IF EXISTS "public"."message_reads";
-- DROP TABLE IF EXISTS "public"."messages";
-- DROP TABLE IF EXISTS "public"."milestones";
-- DROP TABLE IF EXISTS "public"."task_labels";
-- DROP TABLE IF EXISTS "public"."labels";
