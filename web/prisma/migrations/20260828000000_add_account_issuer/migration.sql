-- Better Auth 1.7.1 account 表新增 issuer 字段（标识签发者：credential 端 "local:credential"，
-- OAuth 端为 provider issuer URL）。与 accountId 组成唯一键。
-- 加 DEFAULT 'local:credential' 保证现有 account 行（均为 credential 类型）NOT NULL 约束通过。

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN "issuer" TEXT NOT NULL DEFAULT 'local:credential';

-- CreateIndex
CREATE UNIQUE INDEX "accounts_issuer_account_id_key" ON "accounts"("issuer", "account_id");