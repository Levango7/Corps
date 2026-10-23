-- Workspace.settings：工作区级轻量配置（P1-B2 侧栏可选模块开关）
--
-- 为什么是"加列"而不是新建一张 workspace_module_prefs 表：
--   这份数据是**一组开关**，读在每次侧栏渲染的热路径上、写极少。加列可以跟着
--   workspace 那次查询一起取，零 join；新建表则要额外查询 + 关系维护，
--   换来的是"按模块反查工作区"的能力——目前没有这个分析需求。
--   若将来真需要按模块聚合（例如"多少工作区开了 wiki"），再加 GIN 索引或迁移成表。
--
-- 为什么是 additive + DEFAULT '{}'：PG 11+ 对非易失默认值只写 catalog、不重写表，
-- 存量行自动获得空配置，不需要 backfill；NOT NULL 也因为有 DEFAULT 而可直接施加。
-- 空配置的语义 = 所有可选模块都在「更多」里，与 P1-B1 的默认呈现一致。
--
-- 不加 CHECK 约束：取值域（可选模块 id 列表）由 lib/workspace-settings.ts 的 zod
-- 在写入边界收口；加 DB 约束会让"新增可配置项"都变成一次迁移。

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "settings" JSONB NOT NULL DEFAULT '{}';
