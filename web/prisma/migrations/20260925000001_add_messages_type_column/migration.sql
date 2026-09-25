-- 补齐 messages.type 列
-- Prisma schema 已有 type 字段（default "text"），但此前的 migration 从未创建对应 DB 列，
-- 导致 Prisma 写入 messages 表时 500（column "type" of relation "messages" does not exist）。
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "type" VARCHAR(20) NOT NULL DEFAULT 'text';