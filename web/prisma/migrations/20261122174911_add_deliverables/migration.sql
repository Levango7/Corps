-- ============================================================================
-- deliverables：AI 交付域落库表（nexusloom sidecar 交付账本的 corps 侧元数据）
--
-- 职责边界：交付账本在 sidecar（产出契约/审批闸门/成本账），本表只存展示与
-- 归属元数据——提交即落库（running），列表/详情接口顺带同步 sidecar 状态。
-- 多租户隔离随落库自然成立（此前列表为 sidecar 全量透传）。
--
-- 本迁移只包含本表。历史 schema 与迁移记录之间的既有漂移不得混入（曾出现
-- migrate dev 的 diff 把数百项无关变更打包进本迁移，已剔除）。
-- ============================================================================

-- CreateTable
CREATE TABLE "deliverables" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "task_id" VARCHAR(64) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "pipeline" VARCHAR(50) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'running',
    "output_path" VARCHAR(500),
    "output_summary" TEXT,
    "size_bytes" INTEGER,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "deliverables_pkey" PRIMARY KEY ("id")
);

-- Unique: 同一工作区内一个 sidecar task 只落一条（防重复落库）
CREATE UNIQUE INDEX "deliverables_workspace_id_task_id_key" ON "deliverables" ("workspace_id", "task_id");

-- 列表按工作区+状态过滤的常用索引
CREATE INDEX "deliverables_workspace_id_status_idx" ON "deliverables" ("workspace_id", "status");

-- 外键：工作区/创建人，级联删除与更新
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
