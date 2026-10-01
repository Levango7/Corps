-- Better Auth 1.7.3+ 升级指南（1-7-upgrade-guide）：issuer 不再被写入/要求，需放宽为可空；
-- 账户改以 (providerId, accountId) 识别，(issuer, account_id) 复合唯一键不再需要。
-- 保留 DEFAULT 'local:credential'：1.7.2→1.7.6 过渡窗口内，若存在省略 issuer 的写入路径，
-- 去掉默认会让仍按 issuer 查询的 1.7.2 链路匹配不上存量行。两步均为可逆的放宽操作。
ALTER TABLE "accounts" ALTER COLUMN "issuer" DROP NOT NULL;

DROP INDEX "accounts_issuer_account_id_key";
