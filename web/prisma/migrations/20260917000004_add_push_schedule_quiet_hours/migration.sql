-- M2 闭环完善：AiPushSchedule 加静默时段 + 推送频率字段
-- quiet_hours_start / quiet_hours_end：静默时段起止小时（0-23），NULL 表示不限制
-- frequency：推送频率（daily/weekly/hourly），缺省 'daily'
ALTER TABLE "ai_push_schedules" ADD COLUMN "quiet_hours_start" INTEGER,
  ADD COLUMN "quiet_hours_end" INTEGER,
  ADD COLUMN "frequency" TEXT DEFAULT 'daily';