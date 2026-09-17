-- PushSubscription schema 修复：列重命名 + UUID 类型 + 外键 + 唯一约束

-- 1. 添加 UUID 类型的新列
ALTER TABLE "push_subscriptions" ADD COLUMN "new_id" UUID DEFAULT gen_random_uuid();
ALTER TABLE "push_subscriptions" ADD COLUMN "new_user_id" UUID;
ALTER TABLE "push_subscriptions" ADD COLUMN "new_p256dh_key" TEXT;
ALTER TABLE "push_subscriptions" ADD COLUMN "new_auth_key" TEXT;
ALTER TABLE "push_subscriptions" ADD COLUMN "new_created_at" TIMESTAMPTZ DEFAULT now();
ALTER TABLE "push_subscriptions" ADD COLUMN "new_updated_at" TIMESTAMPTZ DEFAULT now();

-- 2. 迁移数据（userId 是 UUID 字符串，可以转为 UUID 类型）
UPDATE "push_subscriptions" SET
  "new_id" = "id"::uuid,
  "new_user_id" = "userId"::uuid,
  "new_p256dh_key" = "p256dhKey",
  "new_auth_key" = "authKey",
  "new_created_at" = "createdAt",
  "new_updated_at" = "updatedAt";

-- 3. 删除旧列，重命名新列
ALTER TABLE "push_subscriptions" DROP COLUMN "id";
ALTER TABLE "push_subscriptions" DROP COLUMN "userId";
ALTER TABLE "push_subscriptions" DROP COLUMN "p256dhKey";
ALTER TABLE "push_subscriptions" DROP COLUMN "authKey";
ALTER TABLE "push_subscriptions" DROP COLUMN "createdAt";
ALTER TABLE "push_subscriptions" DROP COLUMN "updatedAt";

ALTER TABLE "push_subscriptions" RENAME COLUMN "new_id" TO "id";
ALTER TABLE "push_subscriptions" RENAME COLUMN "new_user_id" TO "user_id";
ALTER TABLE "push_subscriptions" RENAME COLUMN "new_p256dh_key" TO "p256dh_key";
ALTER TABLE "push_subscriptions" RENAME COLUMN "new_auth_key" TO "auth_key";
ALTER TABLE "push_subscriptions" RENAME COLUMN "new_created_at" TO "created_at";
ALTER TABLE "push_subscriptions" RENAME COLUMN "new_updated_at" TO "updated_at";

-- 4. 设置主键
ALTER TABLE "push_subscriptions" ADD PRIMARY KEY ("id");

-- 5. 添加外键
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;

-- 6. 添加唯一约束和索引
CREATE UNIQUE INDEX "push_subscriptions_user_id_endpoint_key" ON "push_subscriptions"("user_id", "endpoint");
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");

-- 7. 删除旧索引（如果存在）
DROP INDEX IF EXISTS "push_subscriptions_userId_idx";