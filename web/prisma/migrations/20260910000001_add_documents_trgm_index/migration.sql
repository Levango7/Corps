-- ============================================================================
-- Add trgm GIN index for documents.markdown full-text search (D-2)
-- 用途：加速 documents.markdown 上的 ILIKE '%q%' 模糊匹配（文档全文搜索场景），
-- trigram 索引可把全表顺序扫描降为索引扫描。
-- 注意：pg_trgm 扩展已在 20260826000000_add_search_trgm_indexes 中创建，
-- 此处保留幂等 CREATE EXTENSION 以保证迁移可独立应用；IF NOT EXISTS 保证幂等。
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add trgm GIN index for documents.markdown full-text search
CREATE INDEX IF NOT EXISTS idx_documents_markdown_trgm ON "documents" USING gin ("markdown" gin_trgm_ops);