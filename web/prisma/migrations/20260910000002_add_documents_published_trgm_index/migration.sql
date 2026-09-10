-- ============================================================================
-- Add trgm GIN index for documents.published_markdown ilike search (后端B-L1)
-- 用途：加速 documents.published_markdown 上的 ILIKE '%q%' 模糊匹配（已发布文档
-- 全文搜索场景），trigram 索引可把全表顺序扫描降为索引扫描。
-- 注意：pg_trgm 扩展已在 20260826000000_add_search_trgm_indexes 中创建，
-- 此处保留幂等 CREATE EXTENSION 以保证迁移可独立应用；IF NOT EXISTS 保证幂等。
-- 不使用 CONCURRENTLY：Prisma migrate deploy 在事务块中执行，CONCURRENTLY 不支持
-- 事务内执行。IF NOT EXISTS 已保证幂等性。
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add trgm GIN index for documents.published_markdown full-text search
CREATE INDEX IF NOT EXISTS idx_documents_published_markdown_trgm
  ON documents USING gin (published_markdown gin_trgm_ops);