-- Phase 1 云文档增强（设计文档 §2.2 / §2.3 / §2.4 / §6）
-- 知识库结构：Workspace → Space → Folder → Document 层级
-- 文档版本历史：DocumentVersion 快照（full / diff 两种存储策略）
-- 文档行内批注：DocumentComment（锚点 + 讨论线程 + 解决状态）
--
-- 迁移安全性：所有变更均为增量字段（ADD COLUMN）或新增表（CREATE TABLE），
-- 不修改/删除现有字段，保证向下兼容、可安全在线执行、可回滚。

-- ─── 知识库空间 ───
CREATE TABLE "spaces" (
  "id" UUID PRIMARY KEY,
  "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "name" VARCHAR(100) NOT NULL,
  "icon" VARCHAR(50) NOT NULL DEFAULT 'book',
  "sort_order" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "color" VARCHAR(50) NOT NULL DEFAULT 'var(--accent)',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 同一工作区内空间名唯一
CREATE UNIQUE INDEX "uq_spaces_workspace_name" ON "spaces"("workspace_id", "name");
-- 按工作区 + 排序值查询（目录树展示）
CREATE INDEX "spaces_workspace_id_sort_order_idx" ON "spaces"("workspace_id", "sort_order");

-- ─── 文件夹（可嵌套，最多 5 层，API 层强制）───
CREATE TABLE "folders" (
  "id" UUID PRIMARY KEY,
  "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "space_id" UUID NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  "parent_id" UUID REFERENCES "folders"("id") ON DELETE CASCADE,
  "name" VARCHAR(100) NOT NULL,
  "icon" VARCHAR(50) NOT NULL DEFAULT 'folder',
  "sort_order" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "expanded" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 目录树查询：按空间 + 父文件夹 + 排序
CREATE INDEX "folders_space_id_parent_id_sort_order_idx" ON "folders"("space_id", "parent_id", "sort_order");
CREATE INDEX "folders_workspace_id_idx" ON "folders"("workspace_id");

-- ─── 文档版本历史快照 ───
CREATE TABLE "document_versions" (
  "id" UUID PRIMARY KEY,
  "document_id" UUID NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "version" INTEGER NOT NULL,
  "snapshot_type" VARCHAR(10) NOT NULL,
  "content_full" JSON,
  "content_diff" TEXT,
  "markdown" TEXT NOT NULL,
  "message" VARCHAR(255),
  "source" VARCHAR(20) NOT NULL DEFAULT 'manual',
  "author_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 同一文档版本号唯一
CREATE UNIQUE INDEX "uq_doc_versions_doc_version" ON "document_versions"("document_id", "version");
-- 版本历史按文档 + 创建时间查询
CREATE INDEX "document_versions_document_id_created_at_idx" ON "document_versions"("document_id", "created_at");
CREATE INDEX "document_versions_workspace_id_idx" ON "document_versions"("workspace_id");

-- ─── 文档行内批注（评论）───
CREATE TABLE "document_comments" (
  "id" UUID PRIMARY KEY,
  "document_id" UUID NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "anchor_path" VARCHAR(100) NOT NULL,
  "anchor_text" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "mentions" TEXT[] NOT NULL DEFAULT '{}',
  "parent_id" UUID REFERENCES "document_comments"("id") ON DELETE CASCADE,
  "resolved" BOOLEAN NOT NULL DEFAULT false,
  "resolved_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "resolved_at" TIMESTAMPTZ,
  "author_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 按文档 + 锚点路径查询
CREATE INDEX "document_comments_document_id_anchor_path_idx" ON "document_comments"("document_id", "anchor_path");
-- 按文档 + 解决状态筛选
CREATE INDEX "document_comments_document_id_resolved_idx" ON "document_comments"("document_id", "resolved");
CREATE INDEX "document_comments_workspace_id_idx" ON "document_comments"("workspace_id");

-- ─── Document 模型增量字段（不破坏现有数据）───
-- 知识库空间 ID（null = 迁移期未归类文档，UI 显示在"未分类"区）
ALTER TABLE "documents" ADD COLUMN "space_id" UUID;
-- 所属文件夹 ID（null = 空间根目录下的文档）
ALTER TABLE "documents" ADD COLUMN "folder_id" UUID;
-- 同层级排序值（拖拽排序）
ALTER TABLE "documents" ADD COLUMN "sort_order" DOUBLE PRECISION NOT NULL DEFAULT 0;
-- 文档图标（Lucide 图标名，默认 file-text）
ALTER TABLE "documents" ADD COLUMN "icon" VARCHAR(50) NOT NULL DEFAULT 'file-text';
-- 文档 emoji 封面（可选）
ALTER TABLE "documents" ADD COLUMN "emoji" VARCHAR(10);
-- 当前版本号（每次创建版本递增）
ALTER TABLE "documents" ADD COLUMN "current_version" INTEGER NOT NULL DEFAULT 0;

-- 外键关联（SetNull：空间/文件夹删除时文档保留，归入未分类）
ALTER TABLE "documents" ADD CONSTRAINT "documents_space_id_fkey"
  FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE SET NULL;
ALTER TABLE "documents" ADD CONSTRAINT "documents_folder_id_fkey"
  FOREIGN KEY ("folder_id") REFERENCES "folders"("id") ON DELETE SET NULL;

-- 知识库目录树查询：按空间 + 文件夹 + 排序
CREATE INDEX "documents_space_id_folder_id_sort_order_idx"
  ON "documents"("space_id", "folder_id", "sort_order");