-- 收藏/书签
CREATE TABLE "favorites" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "target_type" VARCHAR(20) NOT NULL,
    "target_id" UUID NOT NULL,
    "note" VARCHAR(200),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "favorites_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "favorites" ADD CONSTRAINT "favorites_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;

CREATE UNIQUE INDEX "favorites_user_id_target_type_target_id_key" ON "favorites"("user_id", "target_type", "target_id");
CREATE INDEX "favorites_workspace_id_user_id_idx" ON "favorites"("workspace_id", "user_id");
CREATE INDEX "favorites_user_id_target_type_idx" ON "favorites"("user_id", "target_type");

-- 消息全文搜索：添加 tsvector 生成列 + GIN 索引
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "body_tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce("body", ''))) STORED;

CREATE INDEX IF NOT EXISTS "messages_body_tsv_idx" ON "messages" USING GIN ("body_tsv");

-- 文档全文搜索：添加 tsvector 生成列 + GIN 索引（用于 Wiki/文档搜索）
ALTER TABLE "wiki_pages" ADD COLUMN IF NOT EXISTS "content_tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce("content", ''))) STORED;

CREATE INDEX IF NOT EXISTS "wiki_pages_content_tsv_idx" ON "wiki_pages" USING GIN ("content_tsv");