-- L2 #28 + L6 #32 + L8 #34：会议状态枚举约束 + 重复规则 + 密码锁定
--
-- 约定（见 docs/runbook-deploy.md §6）：
--  - 索引/约束创建用 IF NOT EXISTS（CONCURRENTLY 不支持事务内执行）
--  - 表名/列名小写 + 下划线，与既有 migration 一致

-- L2 #28：status 枚举 CHECK 约束（scheduled | active | ended | cancelled）
-- 先删除可能存在的旧约束（幂等），再添加
ALTER TABLE "meetings" DROP CONSTRAINT IF EXISTS "meetings_status_check";
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_status_check"
  CHECK ("status" IN ('scheduled', 'active', 'ended', 'cancelled'));

-- L6 #32：重复规则字段（iCal RRULE 格式，null 表示非重复会议）
ALTER TABLE "meetings" ADD COLUMN IF NOT EXISTS "recurring_rule" VARCHAR(255);

-- L8 #34：会议密码字段（null 表示无密码锁定）
ALTER TABLE "meetings" ADD COLUMN IF NOT EXISTS "password" VARCHAR(100);