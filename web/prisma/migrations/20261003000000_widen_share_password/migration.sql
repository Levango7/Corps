-- F5: 分享密码列宽不足导致设密码必 500
-- better-auth 的 scrypt 哈希实测 161 字符，而这两列原为 VARCHAR(100)，
-- Prisma 抛 P2000（value too long for type character varying(100)）。
ALTER TABLE "public"."tasks" ALTER COLUMN "share_password" TYPE VARCHAR(255);

ALTER TABLE "public"."documents" ALTER COLUMN "share_password" TYPE VARCHAR(255);
