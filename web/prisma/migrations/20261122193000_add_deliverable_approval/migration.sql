-- deliverables 交付后审批字段（corps 自含审批层：交付内容的通过/驳回记录）
-- 与 sidecar 的 DAG 人审节点不同：这里记的是交付完成后的用户验收动作。
ALTER TABLE "deliverables" ADD COLUMN "approval_status" VARCHAR(20);
ALTER TABLE "deliverables" ADD COLUMN "approval_note" TEXT;
ALTER TABLE "deliverables" ADD COLUMN "approved_by" UUID;
ALTER TABLE "deliverables" ADD COLUMN "approved_at" TIMESTAMPTZ(6);
