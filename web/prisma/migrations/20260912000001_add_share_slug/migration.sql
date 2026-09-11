-- F5增强：分享链接自定义路径 shareSlug
-- 为 documents 和 tasks 添加可选的自定义分享路径字段。
-- null 表示使用默认的 shareToken；非 null 时公开分享路由优先按 slug 匹配。
-- 唯一性为表内唯一（documents 表内唯一，tasks 表内唯一），部分唯一索引排除 NULL。

ALTER TABLE documents ADD COLUMN IF NOT EXISTS share_slug VARCHAR(100);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS share_slug VARCHAR(100);

-- 部分唯一索引：仅对非 NULL 的 share_slug 强制唯一（NULL 可多次出现）
CREATE UNIQUE INDEX IF NOT EXISTS documents_share_slug_idx ON documents (share_slug) WHERE share_slug IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tasks_share_slug_idx ON tasks (share_slug) WHERE share_slug IS NOT NULL;