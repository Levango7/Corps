-- 任务级公开分享（v0.4.0 队列第 6 项）
-- shareToken：只读快照外链（与 documents.share_token 同模式），null=未分享

ALTER TABLE "tasks" ADD COLUMN "task_share_token" VARCHAR(64) UNIQUE;
