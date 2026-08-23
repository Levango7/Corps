-- ============================================================================
-- Init migration — mirrors web/prisma/schema.prisma (the schema authority).
-- DDL extracted from db/schema.sql; RLS policies / runtime roles / grants are
-- managed separately by db/schema.sql + docker/init-rls.sql and intentionally
-- excluded here (Prisma does not own RLS).
-- ============================================================================

-- users — global identity, owned by Better Auth (no RLS: managed wholesale)
CREATE TABLE "users" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"           VARCHAR(100),
  "email"          VARCHAR(255) NOT NULL,
  "email_verified" BOOLEAN      NOT NULL DEFAULT false,
  "avatar_url"     TEXT,
  "password_hash"  TEXT,
  "created_at"     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updated_at"     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "last_login_at"  TIMESTAMPTZ
);

-- Create unique index for users.email
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- workspaces — tenant ROOT
CREATE TABLE "workspaces" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"       VARCHAR(100) NOT NULL,
  "slug"       VARCHAR(50)  NOT NULL,
  "owner_id"   UUID NOT NULL,
  "plan"       VARCHAR(20)  NOT NULL DEFAULT 'free',
  "seat_limit" INTEGER      NOT NULL DEFAULT 10,
  "created_at" TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Create unique index for workspaces.slug
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces"("slug");

-- Add foreign key for workspaces.owner_id
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE;

-- Add check constraints for workspaces
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_plan_check"
  CHECK ("plan" IN ('free','starter','pro','enterprise'));
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_seat_limit_check"
  CHECK ("seat_limit" >= 1 AND "seat_limit" <= 1000);

CREATE INDEX "workspaces_owner_id_idx" ON "workspaces"("owner_id");

-- members — RBAC source of truth
CREATE TABLE "members" (
  "user_id"      UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "role"         VARCHAR(20) NOT NULL DEFAULT 'member',
  "invited_by"   UUID,
  "joined_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "invited_at"   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add foreign keys for members
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "members" ADD CONSTRAINT "members_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;

-- Add check constraint for members.role
ALTER TABLE "members" ADD CONSTRAINT "members_role_check"
  CHECK ("role" IN ('owner','admin','member'));

-- Composite primary key for members
ALTER TABLE "members" ADD CONSTRAINT "members_pkey"
  PRIMARY KEY ("user_id", "workspace_id");

CREATE INDEX "members_workspace_id_idx" ON "members"("workspace_id");
CREATE INDEX "members_user_id_idx" ON "members"("user_id");

-- tasks — kanban card
CREATE TABLE "tasks" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "title"        VARCHAR(255) NOT NULL,
  "description"  TEXT,
  "status"       VARCHAR(20) NOT NULL DEFAULT 'todo',
  "priority"     VARCHAR(20) NOT NULL DEFAULT 'medium',
  "assignee_id"  UUID,
  "due_date"     TIMESTAMPTZ,
  "sort_order"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  "created_by"   UUID NOT NULL,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add foreign keys for tasks
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_fkey"
  FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE;

-- Add check constraints for tasks
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_status_check"
  CHECK ("status" IN ('todo','in_progress','review','done'));
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_priority_check"
  CHECK ("priority" IN ('low','medium','high','urgent'));

CREATE INDEX "tasks_workspace_id_status_idx" ON "tasks"("workspace_id", "status");
CREATE INDEX "tasks_workspace_id_created_at_idx" ON "tasks"("workspace_id", "created_at");
CREATE INDEX "tasks_assignee_id_idx" ON "tasks"("assignee_id");

-- comments — task-scoped discussion
CREATE TABLE "comments" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "task_id"      UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "author_id"    UUID NOT NULL,
  "body"         TEXT NOT NULL,
  "mentions"     TEXT[] NOT NULL DEFAULT '{}',
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add foreign keys for comments
ALTER TABLE "comments" ADD CONSTRAINT "comments_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE;
ALTER TABLE "comments" ADD CONSTRAINT "comments_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_fkey"
  FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE;

CREATE INDEX "comments_task_id_idx" ON "comments"("task_id");
CREATE INDEX "comments_workspace_id_idx" ON "comments"("workspace_id");

-- decisions — task-linked decision record
CREATE TABLE "decisions" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "task_id"      UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "markdown"     TEXT NOT NULL,
  "version"      INTEGER NOT NULL DEFAULT 1,
  "author_id"    UUID NOT NULL,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add foreign keys for decisions
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE;
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_author_id_fkey"
  FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE;

-- Add check constraint for decisions.version
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_version_check"
  CHECK ("version" >= 1);

CREATE INDEX "decisions_task_id_idx" ON "decisions"("task_id");
CREATE INDEX "decisions_workspace_id_idx" ON "decisions"("workspace_id");

-- decision_versions — immutable history (AC-10)
CREATE TABLE "decision_versions" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "decision_id"  UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "markdown"     TEXT NOT NULL,
  "version"      INTEGER NOT NULL,
  "author_id"    UUID NOT NULL,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add foreign keys for decision_versions
ALTER TABLE "decision_versions" ADD CONSTRAINT "decision_versions_decision_id_fkey"
  FOREIGN KEY ("decision_id") REFERENCES "decisions"("id") ON DELETE CASCADE;
ALTER TABLE "decision_versions" ADD CONSTRAINT "decision_versions_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
ALTER TABLE "decision_versions" ADD CONSTRAINT "decision_versions_author_id_fkey"
  FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE;

-- Add check constraint for decision_versions.version
ALTER TABLE "decision_versions" ADD CONSTRAINT "decision_versions_version_check"
  CHECK ("version" >= 1);

CREATE INDEX "decision_versions_decision_id_idx" ON "decision_versions"("decision_id");
CREATE INDEX "decision_versions_workspace_id_idx" ON "decision_versions"("workspace_id");

-- subscriptions — Stripe subscription per workspace
CREATE TABLE "subscriptions" (
  "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id"       UUID NOT NULL,
  "stripe_customer_id" VARCHAR(255),
  "stripe_sub_id"      VARCHAR(255),
  "quantity"           INTEGER NOT NULL DEFAULT 1,
  "status"             VARCHAR(20) NOT NULL DEFAULT 'active',
  "current_period_end" TIMESTAMPTZ,
  "canceled_at"        TIMESTAMPTZ,
  "created_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add foreign key for subscriptions
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;

-- Add check constraint for subscriptions.status
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_status_check"
  CHECK ("status" IN ('active','past_due','canceled','trialing','incomplete'));

-- Add unique constraint for subscriptions.workspace_id
CREATE UNIQUE INDEX "subscriptions_workspace_id_key" ON "subscriptions"("workspace_id");

CREATE INDEX "subscriptions_stripe_customer_id_idx" ON "subscriptions"("stripe_customer_id");

-- notifications — workspace-scoped user notifications
CREATE TABLE "notifications" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "user_id"      UUID NOT NULL,
  "type"         VARCHAR(30) NOT NULL,
  "entity_id"    UUID NOT NULL,
  "entity_title" VARCHAR(255) NOT NULL,
  "read"         BOOLEAN NOT NULL DEFAULT false,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add foreign keys for notifications
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;

CREATE INDEX "notifications_user_id_workspace_id_idx" ON "notifications"("user_id", "workspace_id");
CREATE INDEX "notifications_workspace_id_idx" ON "notifications"("workspace_id");
CREATE INDEX "notifications_workspace_id_user_id_read_idx" ON "notifications"("workspace_id", "user_id", "read");

-- sessions — Better Auth session store
CREATE TABLE "sessions" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "expires_at" TIMESTAMPTZ NOT NULL,
  "token"      TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "ip_address" VARCHAR(45),
  "user_agent" VARCHAR(500),
  "user_id"    UUID NOT NULL
);

-- Add foreign key for sessions
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;

-- Create unique index for sessions.token
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- accounts — Better Auth linked OAuth credentials
CREATE TABLE "accounts" (
  "id"                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "account_id"              TEXT NOT NULL,
  "provider_id"             TEXT NOT NULL,
  "user_id"                 UUID NOT NULL,
  "access_token"            TEXT,
  "refresh_token"           TEXT,
  "id_token"                TEXT,
  "access_token_expires_at" TIMESTAMPTZ,
  "refresh_token_expires_at" TIMESTAMPTZ,
  "scope"                   TEXT,
  "password"                TEXT,
  "created_at"              TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add foreign key for accounts
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;

CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");

-- verifications — Better Auth verification tokens
CREATE TABLE "verifications" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "identifier" TEXT NOT NULL,
  "value"      TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);