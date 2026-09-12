-- Phase 4A 云盘文件管理
-- 云盘文件资产（file_assets）+ 文件版本历史（file_versions）
-- 支持上传/下载/删除/移动/去重（sha256）/版本回滚
--
-- 迁移安全性：均为新增表（CREATE TABLE），不修改/删除现有字段，
-- 保证向下兼容、可安全在线执行、可回滚（DROP TABLE）。

-- ─── 云盘文件主表 ───
CREATE TABLE "file_assets" (
  "id" UUID PRIMARY KEY,
  "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "file_name" VARCHAR(255) NOT NULL,
  "file_size" INTEGER NOT NULL,
  "file_type" VARCHAR(100) NOT NULL,
  "storage_key" TEXT NOT NULL,
  "thumbnail_key" TEXT,
  "sha256" VARCHAR(64) NOT NULL,
  "uploaded_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "folder_id" UUID REFERENCES "folders"("id") ON DELETE SET NULL,
  "sort_order" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "current_version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 目录树查询：按工作区 + 文件夹 + 排序
CREATE INDEX "file_assets_workspace_id_folder_id_sort_order_idx"
  ON "file_assets"("workspace_id", "folder_id", "sort_order");
-- 去重查询：按 sha256 查找同工作区内已有文件
CREATE INDEX "file_assets_sha256_idx" ON "file_assets"("sha256");

-- ─── 文件版本历史 ───
CREATE TABLE "file_versions" (
  "id" UUID PRIMARY KEY,
  "file_asset_id" UUID NOT NULL REFERENCES "file_assets"("id") ON DELETE CASCADE,
  "version" INTEGER NOT NULL,
  "storage_key" TEXT NOT NULL,
  "file_size" INTEGER NOT NULL,
  "message" VARCHAR(255),
  "uploaded_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 同一文件版本号唯一
CREATE UNIQUE INDEX "file_versions_file_asset_id_version_key"
  ON "file_versions"("file_asset_id", "version");
-- 版本历史按文件 + 创建时间查询
CREATE INDEX "file_versions_file_asset_id_created_at_idx"
  ON "file_versions"("file_asset_id", "created_at");