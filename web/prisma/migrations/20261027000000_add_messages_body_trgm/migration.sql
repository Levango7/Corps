-- ============================================================================
-- Add trgm GIN index for messages.body substring search
-- 用途：/api/v1/im/search 的 tsvector 分支用 'simple' 解析器，连续中文整段只
-- 生成一个 lexeme（实测 to_tsvector('simple','中文关键词测试') = '中文关键词测试':1），
-- 因此中文子串查询恒不命中。补一条 ILIKE 子串并集后需要 trigram 索引兜住扫描成本。
-- 实测（postgres:18.6，20005 行 / 5 行命中）：
--   EXPLAIN ... WHERE body ILIKE '%关键中文子串%'
--   -> Bitmap Index Scan on idx_messages_body_trgm
-- 注意：pg_trgm 扩展已在 20260826000000_add_search_trgm_indexes 中创建，
-- 此处保留幂等 CREATE EXTENSION 以保证迁移可独立应用；IF NOT EXISTS 保证幂等。
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add trgm GIN index for messages.body substring (ILIKE) search
CREATE INDEX IF NOT EXISTS idx_messages_body_trgm ON "messages" USING gin ("body" gin_trgm_ops);
