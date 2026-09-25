-- 补齐 meetings.recording_started_at + recording_stopped_at 列
-- Prisma schema 已有这两个字段（recordingStartedAt/recordingStoppedAt），
-- 但此前的 migration 从未创建对应 DB 列，导致 Prisma 查询/写入 meetings 表时 500。
ALTER TABLE "meetings" ADD COLUMN IF NOT EXISTS "recording_started_at" TIMESTAMPTZ;
ALTER TABLE "meetings" ADD COLUMN IF NOT EXISTS "recording_stopped_at" TIMESTAMPTZ;