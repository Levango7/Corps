-- ============================================================================
-- Add pg_trgm GIN indexes — 全局搜索优化（P2）
-- 用途：加速 tasks.title / tasks.description / decisions.markdown 上的
-- ILIKE '%q%' 模糊匹配（全局搜索 / 命令面板场景），trigram 索引可把
-- 全表顺序扫描降为索引扫描。
-- 注意：CREATE EXTENSION 需要超级用户/相应权限；幂等（IF NOT EXISTS），
-- CI 的 prisma migrate deploy 会按序应用本迁移。
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_tasks_title_trgm ON tasks USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_tasks_description_trgm ON tasks USING gin (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_decisions_markdown_trgm ON decisions USING gin (markdown gin_trgm_ops);
