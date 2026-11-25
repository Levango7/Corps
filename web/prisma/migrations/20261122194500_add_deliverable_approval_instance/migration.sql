-- deliverables.approval_instance_id：送审到 corps approvals 引擎后的实例关联
ALTER TABLE "deliverables" ADD COLUMN "approval_instance_id" UUID;
