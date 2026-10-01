-- ADR-010 G4：share_access_logs 收编引擎层 RLS 的前置列。
-- 归属键由写入路径从实体行反查（公开分享路径先凭 token 读出文档行后
-- setTxGuc 注入 workspace_id），历史行按 entity_id 回填；
-- 实体已删除的孤儿行保持 NULL——对应用查询不可见（策略按 workspace_id 判等）。

ALTER TABLE "public"."share_access_logs" ADD COLUMN "workspace_id" UUID;

UPDATE "public"."share_access_logs" AS sal
SET "workspace_id" = t."workspace_id"
FROM "public"."tasks" AS t
WHERE sal."entity_type" = 'task' AND sal."entity_id" = t."id";

UPDATE "public"."share_access_logs" AS sal
SET "workspace_id" = d."workspace_id"
FROM "public"."documents" AS d
WHERE sal."entity_type" = 'document' AND sal."entity_id" = d."id";

CREATE INDEX "share_access_logs_workspace_id_idx" ON "public"."share_access_logs"("workspace_id");

ALTER TABLE "public"."share_access_logs"
  ADD CONSTRAINT "share_access_logs_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
