-- 审计 D3：删除用户不得级联销毁其在他人工坊创建的内容
-- creator/author 外键由 CASCADE 改为 SET NULL，列改为可空；前端对 null 显示「已注销用户」

ALTER TABLE "tasks" ALTER COLUMN "created_by" DROP NOT NULL;
ALTER TABLE "comments" ALTER COLUMN "author_id" DROP NOT NULL;
ALTER TABLE "decisions" ALTER COLUMN "author_id" DROP NOT NULL;
ALTER TABLE "decision_versions" ALTER COLUMN "author_id" DROP NOT NULL;

ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_created_by_fkey";
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;

ALTER TABLE "comments" DROP CONSTRAINT IF EXISTS "comments_author_id_fkey";
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_fkey"
  FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL;

ALTER TABLE "decisions" DROP CONSTRAINT IF EXISTS "decisions_author_id_fkey";
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_author_id_fkey"
  FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL;

ALTER TABLE "decision_versions" DROP CONSTRAINT IF EXISTS "decision_versions_author_id_fkey";
ALTER TABLE "decision_versions" ADD CONSTRAINT "decision_versions_author_id_fkey"
  FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL;
