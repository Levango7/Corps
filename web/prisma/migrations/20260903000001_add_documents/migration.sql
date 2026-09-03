-- 工作区文档中心（v0.4.0 队列第 2 项）
-- 文档与决策正交：决策绑任务，文档解绑任务用于团队知识沉淀
-- 草稿在 markdown 字段；发布快照在 publishedMarkdown；shareToken 唯一索引

CREATE TABLE "documents" (
  "id" UUID PRIMARY KEY,
  "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "title" VARCHAR(255) NOT NULL,
  "markdown" TEXT NOT NULL DEFAULT '',
  "published_markdown" TEXT,
  "published_at" TIMESTAMPTZ,
  "share_token" VARCHAR(64) UNIQUE,
  "author_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 工作区内文档按更新时间倒序
CREATE INDEX "documents_workspace_id_updated_at_idx" ON "documents"("workspace_id", "updated_at");
-- 工作区内文档搜索（按标题索引）
CREATE INDEX "documents_workspace_id_title_idx" ON "documents"("workspace_id", "title");
