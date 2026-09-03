-- 任务层级（子任务自关联）+ 阻塞标记（v0.4.0 队列第 1 项）
-- parentId：父任务 ID，自关联 tasks.id；父任务删除时子任务级联删除
-- blocked/blockedReason：任务被问题/依赖卡住时的标记与原因说明

ALTER TABLE "tasks" ADD COLUMN "parent_id" UUID;
ALTER TABLE "tasks" ADD COLUMN "blocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tasks" ADD COLUMN "blocked_reason" VARCHAR(500);

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "tasks"("id") ON DELETE CASCADE;

CREATE INDEX "tasks_parent_id_idx" ON "tasks"("parent_id");
