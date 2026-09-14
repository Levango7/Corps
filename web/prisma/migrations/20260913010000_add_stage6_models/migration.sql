-- 阶段 6：音视频会议 + 审批流 + 文档级权限 + 回收站软删除

-- CreateTable: meetings
CREATE TABLE "meetings" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(500),
    "created_by" UUID,
    "room_name" VARCHAR(100) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'scheduled',
    "type" VARCHAR(20) NOT NULL DEFAULT 'instant',
    "scheduled_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ,
    "ended_at" TIMESTAMPTZ,
    "max_participants" INTEGER NOT NULL DEFAULT 50,
    "recording_enabled" BOOLEAN NOT NULL DEFAULT false,
    "recording_url" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable: meeting_participants
CREATE TABLE "meeting_participants" (
    "id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "joined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMPTZ,
    "role" VARCHAR(20) NOT NULL DEFAULT 'guest',

    CONSTRAINT "meeting_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable: approval_templates
CREATE TABLE "approval_templates" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(500),
    "nodes" JSONB NOT NULL,
    "created_by" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable: approval_instances
CREATE TABLE "approval_instances" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "template_id" UUID,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "applicant_id" UUID NOT NULL,
    "content" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "current_node" INTEGER NOT NULL DEFAULT 0,
    "nodes" JSONB NOT NULL,
    "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable: approval_operations
CREATE TABLE "approval_operations" (
    "id" UUID NOT NULL,
    "instance_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "node_index" INTEGER NOT NULL,
    "comment" TEXT,
    "transfer_to_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable: document_permissions
CREATE TABLE "document_permissions" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "grantee_type" VARCHAR(20) NOT NULL,
    "grantee_id" UUID NOT NULL,
    "permission" VARCHAR(20) NOT NULL,
    "granted_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: meetings
CREATE UNIQUE INDEX "meetings_room_name_key" ON "meetings"("room_name");
CREATE INDEX "meetings_workspace_id_status_idx" ON "meetings"("workspace_id", "status");
CREATE INDEX "meetings_workspace_id_scheduled_at_idx" ON "meetings"("workspace_id", "scheduled_at");

-- CreateIndex: meeting_participants
CREATE UNIQUE INDEX "meeting_participants_meeting_id_user_id_key" ON "meeting_participants"("meeting_id", "user_id");
CREATE INDEX "meeting_participants_user_id_idx" ON "meeting_participants"("user_id");

-- CreateIndex: approval_templates
CREATE INDEX "approval_templates_workspace_id_active_idx" ON "approval_templates"("workspace_id", "active");

-- CreateIndex: approval_instances
CREATE INDEX "approval_instances_workspace_id_status_idx" ON "approval_instances"("workspace_id", "status");
CREATE INDEX "approval_instances_applicant_id_status_idx" ON "approval_instances"("applicant_id", "status");

-- CreateIndex: approval_operations
CREATE INDEX "approval_operations_instance_id_created_at_idx" ON "approval_operations"("instance_id", "created_at");

-- CreateIndex: document_permissions
CREATE UNIQUE INDEX "document_permissions_document_id_grantee_type_grantee_id_key" ON "document_permissions"("document_id", "grantee_type", "grantee_id");
CREATE INDEX "document_permissions_document_id_idx" ON "document_permissions"("document_id");

-- AddColumn: tasks 软删除
ALTER TABLE "tasks" ADD COLUMN "deleted_at" TIMESTAMPTZ;
ALTER TABLE "tasks" ADD COLUMN "deleted_by" UUID;
CREATE INDEX "tasks_workspace_id_deleted_at_idx" ON "tasks"("workspace_id", "deleted_at");

-- AddColumn: documents 可见性 + 软删除
ALTER TABLE "documents" ADD COLUMN "visibility" VARCHAR(20) NOT NULL DEFAULT 'private';
ALTER TABLE "documents" ADD COLUMN "deleted_at" TIMESTAMPTZ;
ALTER TABLE "documents" ADD COLUMN "deleted_by" UUID;
CREATE INDEX "documents_workspace_id_deleted_at_idx" ON "documents"("workspace_id", "deleted_at");

-- AddForeignKey: meetings
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: meeting_participants
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: approval_templates
ALTER TABLE "approval_templates" ADD CONSTRAINT "approval_templates_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approval_templates" ADD CONSTRAINT "approval_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: approval_instances
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "approval_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: approval_operations
ALTER TABLE "approval_operations" ADD CONSTRAINT "approval_operations_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "approval_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approval_operations" ADD CONSTRAINT "approval_operations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approval_operations" ADD CONSTRAINT "approval_operations_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approval_operations" ADD CONSTRAINT "approval_operations_transfer_to_id_fkey" FOREIGN KEY ("transfer_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: document_permissions
ALTER TABLE "document_permissions" ADD CONSTRAINT "document_permissions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_permissions" ADD CONSTRAINT "document_permissions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_permissions" ADD CONSTRAINT "document_permissions_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;