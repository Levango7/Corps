-- 交付同步 outbox：持久化可重放意图，解除 sidecar 推进对 UI 轮询的依赖。
CREATE TABLE "delivery_outbox" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "deliverable_id" UUID NOT NULL,
    "task_id" VARCHAR(64) NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "dedupe_key" VARCHAR(160) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_until" TIMESTAMPTZ(6),
    "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "delivery_outbox_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "delivery_outbox_workspace_id_fkey"
      FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
    CONSTRAINT "delivery_outbox_kind_check"
      CHECK ("kind" IN ('sync', 'approve', 'reject')),
    CONSTRAINT "delivery_outbox_status_check"
      CHECK ("status" IN ('pending', 'processing', 'done', 'dead_letter'))
);

CREATE UNIQUE INDEX "delivery_outbox_workspace_id_dedupe_key_key"
  ON "delivery_outbox"("workspace_id", "dedupe_key");
CREATE INDEX "delivery_outbox_status_next_attempt_at_idx"
  ON "delivery_outbox"("status", "next_attempt_at");
CREATE INDEX "delivery_outbox_lease_until_idx"
  ON "delivery_outbox"("lease_until");
