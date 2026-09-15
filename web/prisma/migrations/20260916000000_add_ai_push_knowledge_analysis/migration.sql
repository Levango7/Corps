-- 方向 A：AI 主动推送计划
CREATE TABLE "ai_push_schedules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "capability" VARCHAR(50) NOT NULL,
    "cron" VARCHAR(50) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "last_run_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "ai_push_schedules_pkey" PRIMARY KEY ("id")
);

-- 方向 A：AI 推送记录
CREATE TABLE "ai_push_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schedule_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "capability" VARCHAR(50) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "summary" TEXT NOT NULL,
    "detail" JSONB,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "ai_push_records_pkey" PRIMARY KEY ("id")
);

-- 方向 B：知识图谱节点
CREATE TABLE "knowledge_nodes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "content" TEXT NOT NULL,
    "source_type" VARCHAR(50) NOT NULL,
    "source_id" UUID NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "knowledge_nodes_pkey" PRIMARY KEY ("id")
);

-- 方向 B：知识图谱边
CREATE TABLE "knowledge_edges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "source_node_id" UUID NOT NULL,
    "target_node_id" UUID NOT NULL,
    "relation" VARCHAR(50) NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "knowledge_edges_pkey" PRIMARY KEY ("id")
);

-- 方向 C：AI 分析报告
CREATE TABLE "ai_analysis_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "summary" TEXT NOT NULL,
    "data" JSONB,
    "insights" JSONB,
    "period" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "ai_analysis_reports_pkey" PRIMARY KEY ("id")
);

-- 外键约束
ALTER TABLE "ai_push_schedules" ADD CONSTRAINT "ai_push_schedules_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
ALTER TABLE "ai_push_schedules" ADD CONSTRAINT "ai_push_schedules_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;

ALTER TABLE "ai_push_records" ADD CONSTRAINT "ai_push_records_schedule_id_fkey"
    FOREIGN KEY ("schedule_id") REFERENCES "ai_push_schedules"("id") ON DELETE CASCADE;
ALTER TABLE "ai_push_records" ADD CONSTRAINT "ai_push_records_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
ALTER TABLE "ai_push_records" ADD CONSTRAINT "ai_push_records_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;

ALTER TABLE "knowledge_nodes" ADD CONSTRAINT "knowledge_nodes_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;

ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_source_node_id_fkey"
    FOREIGN KEY ("source_node_id") REFERENCES "knowledge_nodes"("id") ON DELETE CASCADE;
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_target_node_id_fkey"
    FOREIGN KEY ("target_node_id") REFERENCES "knowledge_nodes"("id") ON DELETE CASCADE;

ALTER TABLE "ai_analysis_reports" ADD CONSTRAINT "ai_analysis_reports_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
ALTER TABLE "ai_analysis_reports" ADD CONSTRAINT "ai_analysis_reports_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;

-- 索引
CREATE INDEX "ai_push_schedules_workspace_id_enabled_idx" ON "ai_push_schedules"("workspace_id", "enabled");
CREATE INDEX "ai_push_schedules_user_id_enabled_idx" ON "ai_push_schedules"("user_id", "enabled");

CREATE INDEX "ai_push_records_workspace_id_created_at_idx" ON "ai_push_records"("workspace_id", "created_at");
CREATE INDEX "ai_push_records_user_id_read_created_at_idx" ON "ai_push_records"("user_id", "read", "created_at");

CREATE INDEX "knowledge_nodes_workspace_id_type_idx" ON "knowledge_nodes"("workspace_id", "type");
CREATE INDEX "knowledge_nodes_workspace_id_source_type_source_id_idx" ON "knowledge_nodes"("workspace_id", "source_type", "source_id");

CREATE INDEX "knowledge_edges_workspace_id_relation_idx" ON "knowledge_edges"("workspace_id", "relation");
CREATE INDEX "knowledge_edges_source_node_id_idx" ON "knowledge_edges"("source_node_id");
CREATE INDEX "knowledge_edges_target_node_id_idx" ON "knowledge_edges"("target_node_id");

CREATE INDEX "ai_analysis_reports_workspace_id_type_created_at_idx" ON "ai_analysis_reports"("workspace_id", "type", "created_at");
CREATE INDEX "ai_analysis_reports_user_id_created_at_idx" ON "ai_analysis_reports"("user_id", "created_at");