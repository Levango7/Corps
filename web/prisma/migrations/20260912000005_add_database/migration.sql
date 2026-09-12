-- Phase 3A 多维表格（Notion 式 Database）
-- 结构化数据容器：Database → Field（列定义）+ Record（数据行）+ View（视图）
-- Database 归属 Workspace，可选归属 Space/Folder（与 Document 同构的目录树挂载）
--
-- 迁移安全性：均为新增表（CREATE TABLE），不修改/删除现有字段，
-- 保证向下兼容、可安全在线执行、可回滚（DROP TABLE）。

-- ─── 多维表格主表 ───
CREATE TABLE "databases" (
  "id" UUID PRIMARY KEY,
  "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "space_id" UUID REFERENCES "spaces"("id") ON DELETE SET NULL,
  "folder_id" UUID REFERENCES "folders"("id") ON DELETE SET NULL,
  "title" VARCHAR(255) NOT NULL,
  "icon" VARCHAR(50) NOT NULL DEFAULT 'table',
  "emoji" VARCHAR(10),
  "description" TEXT,
  "sort_order" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 知识库目录树查询：按空间 + 文件夹 + 排序
CREATE INDEX "databases_space_id_folder_id_sort_order_idx"
  ON "databases"("space_id", "folder_id", "sort_order");
-- 工作区维度查询
CREATE INDEX "databases_workspace_id_idx" ON "databases"("workspace_id");

-- ─── 多维表格字段（列定义）───
CREATE TABLE "database_fields" (
  "id" UUID PRIMARY KEY,
  "database_id" UUID NOT NULL REFERENCES "databases"("id") ON DELETE CASCADE,
  "name" VARCHAR(100) NOT NULL,
  "type" VARCHAR(20) NOT NULL,
  "options" JSON NOT NULL DEFAULT '{}',
  "sort_order" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 按表格 + 排序值查询字段列表
CREATE INDEX "database_fields_database_id_sort_order_idx"
  ON "database_fields"("database_id", "sort_order");

-- ─── 多维表格记录（数据行）───
CREATE TABLE "database_records" (
  "id" UUID PRIMARY KEY,
  "database_id" UUID NOT NULL REFERENCES "databases"("id") ON DELETE CASCADE,
  "data" JSON NOT NULL DEFAULT '{}',
  "sort_order" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 按表格 + 排序值查询记录列表
CREATE INDEX "database_records_database_id_sort_order_idx"
  ON "database_records"("database_id", "sort_order");

-- ─── 多维表格视图 ───
CREATE TABLE "database_views" (
  "id" UUID PRIMARY KEY,
  "database_id" UUID NOT NULL REFERENCES "databases"("id") ON DELETE CASCADE,
  "name" VARCHAR(100) NOT NULL,
  "type" VARCHAR(20) NOT NULL,
  "config" JSON NOT NULL DEFAULT '{}',
  "sort_order" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 按表格 + 排序值查询视图列表
CREATE INDEX "database_views_database_id_sort_order_idx"
  ON "database_views"("database_id", "sort_order");