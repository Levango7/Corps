-- ============================================================================
-- Corps — Canonical Deploy DDL + Row Level Security
-- Companion to: web/prisma/schema.prisma  (THE schema authority)
--
-- ── SOURCE OF TRUTH ─────────────────────────────────────────────────────────
--   * web/prisma/schema.prisma is the single source of truth for tables/columns.
--     Schema changes happen there (prisma db push / migrate), NEVER here first.
--   * This file mirrors that schema 1:1 and additionally owns what Prisma does
--     NOT manage: runtime roles, RLS policies, engine grants. Re-run the RLS
--     section after adding a new tenant table.
--   * Historical note: an earlier revision of this file described a custom-auth
--     design (argon2id + refresh-hash sessions + no Better Auth tables) that was
--     never deployed. That design is obsolete; do not resurrect it from VCS.
--
-- ── ACTIVATION (production hardening, opt-in) ───────────────────────────────
--   RLS below binds ONLY when the app connects through a NON-owner role:
--     1. psql -c "CREATE ROLE corps_app LOGIN PASSWORD '<secret>' NOINHERIT;"
--        (freshly created roles cannot bypass RLS and own no tables)
--     2. Apply this file's DDL + RLS sections as the migration/owner user.
--     3. Point DATABASE_URL at corps_app.
--   In dev (connecting as the table owner / superuser) PostgreSQL bypasses RLS,
--   which keeps local workflows simple. AC-04's engine-level guarantee holds
--   only under the corps_app connection — integration tests assert the
--   application-level equivalent instead (see tests/integration/workspace.test.ts).
--
--   Escape hatch contract (app.auth_op GUC, transaction-scoped):
--     'login'     member/workspace listing for an authenticated user (uid set)
--     'provision' creating the first workspace + owner member at register
--     'webhook'   Stripe webhook writes keyed by stripe ids, not wid
--   Set via lib/auth.ts helpers runWithAuthOp() / runWithWorkspace().
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. ROLES (idempotent)
--    app_migrator : runs migrations / this file. Not used at runtime.
--    corps_app    : recommended runtime connection role (NOINHERIT, no table
--                   ownership ⇒ cannot disable or bypass RLS).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_migrator') THEN
    CREATE ROLE app_migrator WITH LOGIN PASSWORD 'CHANGE_ME_MIGRATOR';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'corps_app') THEN
    CREATE ROLE corps_app WITH LOGIN PASSWORD 'CHANGE_ME_APP' NOINHERIT;
  END IF;
END
$$;

ALTER ROLE corps_app NOBYPASSRLS;
ALTER ROLE corps_app NOSUPERUSER;
ALTER ROLE corps_app NOINHERIT;

GRANT CONNECT ON DATABASE postgres TO corps_app;
GRANT USAGE ON SCHEMA public TO corps_app;

-- ===========================================================================
-- 2. TABLES (mirror of web/prisma/schema.prisma — do not diverge)
-- ===========================================================================

-- users — global identity, owned by Better Auth (no RLS: managed wholesale)
CREATE TABLE IF NOT EXISTS users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           varchar(100),
  email          varchar(255) NOT NULL UNIQUE,
  email_verified boolean      NOT NULL DEFAULT false,
  avatar_url     text,
  password_hash  text,                          -- Better Auth hasher output
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);

-- workspaces — tenant ROOT
CREATE TABLE IF NOT EXISTS workspaces (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       varchar(100) NOT NULL,
  slug       varchar(50)  NOT NULL UNIQUE,
  owner_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan       varchar(20)  NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro')),
  seat_limit integer      NOT NULL DEFAULT 10 CHECK (seat_limit >= 1 AND seat_limit <= 1000),
  created_at timestamptz  NOT NULL DEFAULT now(),
  updated_at timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workspaces_owner_id ON workspaces(owner_id);

-- members — RBAC source of truth. PK column order mirrors @@id([userId, workspaceId])
CREATE TABLE IF NOT EXISTS members (
  user_id      uuid NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role         varchar(20) NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  invited_by   uuid,
  joined_at    timestamptz NOT NULL DEFAULT now(),
  invited_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, workspace_id)
);
CREATE INDEX IF NOT EXISTS idx_members_workspace_id ON members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_members_user_id      ON members(user_id);

-- tasks — kanban card
CREATE TABLE IF NOT EXISTS tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title       varchar(255) NOT NULL,
  description text,
  status      varchar(20) NOT NULL DEFAULT 'todo'
                CHECK (status IN ('todo','in_progress','review','done')),
  priority    varchar(20) NOT NULL DEFAULT 'medium'
                CHECK (priority IN ('low','medium','high','urgent')),
  assignee_id uuid REFERENCES users(id) ON DELETE SET NULL,
  due_date    timestamptz,
  sort_order  double precision NOT NULL DEFAULT 0,
  created_by  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace_status ON tasks(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace_created ON tasks(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_id      ON tasks(assignee_id);

-- comments — task-scoped discussion
CREATE TABLE IF NOT EXISTS comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid NOT NULL REFERENCES tasks(id)      ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  author_id   uuid NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  body        text NOT NULL,
  mentions    text[] NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comments_task_id      ON comments(task_id);
CREATE INDEX IF NOT EXISTS idx_comments_workspace_id ON comments(workspace_id);

-- decisions — task-linked decision record (Markdown). version bumps on edit.
CREATE TABLE IF NOT EXISTS decisions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid NOT NULL REFERENCES tasks(id)      ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  markdown    text NOT NULL,
  version     integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  author_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_decisions_task_id      ON decisions(task_id);
CREATE INDEX IF NOT EXISTS idx_decisions_workspace_id ON decisions(workspace_id);

-- decision_versions — immutable history (AC-10)
CREATE TABLE IF NOT EXISTS decision_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL REFERENCES decisions(id)  ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  markdown    text NOT NULL,
  version     integer NOT NULL CHECK (version >= 1),
  author_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_decision_versions_dec ON decision_versions(decision_id);
CREATE INDEX IF NOT EXISTS idx_decision_versions_ws  ON decision_versions(workspace_id);

-- subscriptions — Stripe subscription per workspace
CREATE TABLE IF NOT EXISTS subscriptions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  stripe_customer_id varchar(255),
  stripe_sub_id      varchar(255),
  quantity           integer NOT NULL DEFAULT 1,
  status             varchar(20) NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','past_due','canceled','trialing','incomplete')),
  current_period_end timestamptz,
  canceled_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id)
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id);

-- sessions — Better Auth session store (no RLS: identity domain, app-layer gated)
CREATE TABLE IF NOT EXISTS sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expires_at timestamptz NOT NULL,
  token      text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ip_address varchar(45),
  user_agent varchar(500),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

-- accounts — Better Auth linked OAuth credentials
CREATE TABLE IF NOT EXISTS accounts (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id              text NOT NULL,
  provider_id             text NOT NULL,
  user_id                 uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token            text,
  refresh_token           text,
  id_token                text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope                   text,
  password                text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);

-- verifications — Better Auth verification tokens
CREATE TABLE IF NOT EXISTS verifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  value      text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ===========================================================================
-- 4. ROW LEVEL SECURITY — engine-enforced tenant isolation (see header:
--    binds only when the app connects via corps_app, not as table owner).
--    Identity tables (users/accounts/sessions/verifications) are intentionally
--    excluded: Better Auth manages them wholesale and they carry no tenant key.
-- ===========================================================================

ALTER TABLE members           ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE decisions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces        ENABLE ROW LEVEL SECURITY;

-- Unset GUC ⇒ comparison against NULL ⇒ no rows: missing context is a hard DENY.
CREATE POLICY p_members_rls ON members
  FOR ALL
  USING (
    workspace_id = current_setting('app.workspace_id', true)::uuid
    OR (current_setting('app.auth_op', true) = 'login'
        AND user_id = current_setting('app.user_id', true)::uuid)
    OR (current_setting('app.auth_op', true) = 'provision'
        AND user_id = current_setting('app.user_id', true)::uuid)
  )
  WITH CHECK (
    workspace_id = current_setting('app.workspace_id', true)::uuid
    OR (current_setting('app.auth_op', true) = 'login'
        AND user_id = current_setting('app.user_id', true)::uuid)
    OR (current_setting('app.auth_op', true) = 'provision'
        AND user_id = current_setting('app.user_id', true)::uuid)
  );

CREATE POLICY p_tasks_rls ON tasks
  FOR ALL
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

CREATE POLICY p_comments_rls ON comments
  FOR ALL
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

CREATE POLICY p_decisions_rls ON decisions
  FOR ALL
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

CREATE POLICY p_decision_versions_rls ON decision_versions
  FOR ALL
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

CREATE POLICY p_subscriptions_rls ON subscriptions
  FOR ALL
  USING (
    workspace_id = current_setting('app.workspace_id', true)::uuid
    OR current_setting('app.auth_op', true) = 'webhook'
  )
  WITH CHECK (
    workspace_id = current_setting('app.workspace_id', true)::uuid
    OR current_setting('app.auth_op', true) = 'webhook'
  );

-- workspaces: readable via membership; writable by owner, with narrow
-- provision (register/create-workspace) and webhook (plan sync) hatches.
CREATE POLICY p_workspaces_select ON workspaces
  FOR SELECT
  USING (
    id IN (
      SELECT m.workspace_id FROM members m
      WHERE m.user_id = current_setting('app.user_id', true)::uuid
    )
  );

CREATE POLICY p_workspaces_write ON workspaces
  FOR ALL
  USING (
    owner_id = current_setting('app.user_id', true)::uuid
    OR current_setting('app.auth_op', true) IN ('provision', 'webhook')
  )
  WITH CHECK (
    owner_id = current_setting('app.user_id', true)::uuid
    OR (current_setting('app.auth_op', true) = 'provision'
        AND owner_id = current_setting('app.user_id', true)::uuid)
    OR current_setting('app.auth_op', true) = 'webhook'
  );

-- ===========================================================================
-- 5. GRANTS — runtime role gets DML only; it owns nothing and cannot disable RLS.
-- ===========================================================================
GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public
  TO corps_app;

-- ===========================================================================
-- ===== DOWN (rollback) =====
--   DROP TABLE IF EXISTS verifications, accounts, sessions, subscriptions,
--     decision_versions, decisions, comments, tasks, members, workspaces,
--     users CASCADE;
--   DROP POLICY IF EXISTS ... (policies drop with their tables);
-- ===========================================================================
