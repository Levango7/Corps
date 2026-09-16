-- 企业邮箱 — 邮箱账户配置
CREATE TABLE "email_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "email" VARCHAR(200) NOT NULL,
    "display_name" VARCHAR(100),
    "provider" VARCHAR(50) NOT NULL DEFAULT 'custom',
    "smtp_host" VARCHAR(200) NOT NULL,
    "smtp_port" INTEGER NOT NULL DEFAULT 587,
    "smtp_secure" BOOLEAN NOT NULL DEFAULT false,
    "imap_host" VARCHAR(200),
    "imap_port" INTEGER DEFAULT 993,
    "credential" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "email_accounts_pkey" PRIMARY KEY ("id")
);

-- 企业邮箱 — 邮件记录
CREATE TABLE "mails" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "message_id" VARCHAR(500),
    "from_addr" VARCHAR(500) NOT NULL,
    "to_addr" TEXT NOT NULL,
    "cc_addr" TEXT,
    "bcc_addr" TEXT,
    "subject" VARCHAR(500) NOT NULL,
    "body_text" TEXT,
    "body_html" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "thread_id" UUID,
    "in_reply_to" VARCHAR(500),
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "is_starred" BOOLEAN NOT NULL DEFAULT false,
    "sent_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "mails_pkey" PRIMARY KEY ("id")
);

-- 通知偏好
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "email_notify" BOOLEAN NOT NULL DEFAULT true,
    "push_notify" BOOLEAN NOT NULL DEFAULT true,
    "dnd_enabled" BOOLEAN NOT NULL DEFAULT false,
    "dnd_start" VARCHAR(5) NOT NULL DEFAULT '22:00',
    "dnd_end" VARCHAR(5) NOT NULL DEFAULT '08:00',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- 外键
ALTER TABLE "email_accounts" ADD CONSTRAINT "email_accounts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
ALTER TABLE "email_accounts" ADD CONSTRAINT "email_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "mails" ADD CONSTRAINT "mails_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
ALTER TABLE "mails" ADD CONSTRAINT "mails_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "email_accounts"("id") ON DELETE CASCADE;
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;

-- 索引
CREATE UNIQUE INDEX "email_accounts_user_id_email_key" ON "email_accounts"("user_id", "email");
CREATE INDEX "email_accounts_workspace_id_user_id_idx" ON "email_accounts"("workspace_id", "user_id");
CREATE INDEX "mails_workspace_id_account_id_status_idx" ON "mails"("workspace_id", "account_id", "status");
CREATE INDEX "mails_workspace_id_status_created_at_idx" ON "mails"("workspace_id", "status", "created_at");
CREATE UNIQUE INDEX "notification_preferences_user_id_key" ON "notification_preferences"("user_id");