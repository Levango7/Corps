-- M4 实时协作基础：User.onlineAt 在线状态心跳时间戳
-- presence API POST 定期更新此字段；GET 查询以 now - 5min 为阈值判定在线。
-- NULL 表示从未心跳（视为离线）。复用 timestamptz 类型，与 last_login_at 对齐。
ALTER TABLE "users" ADD COLUMN "online_at" TIMESTAMPTZ;

-- 在线状态查询索引：presence GET 按 online_at DESC 扫描最近心跳的用户。
-- 部分索引（WHERE online_at IS NOT NULL）跳过从未心跳的行，减小索引体积。
CREATE INDEX "idx_users_online_at" ON "users" ("online_at" DESC)
  WHERE "online_at" IS NOT NULL;