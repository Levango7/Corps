-- ============================================================================
-- Corps (团队) — Database Schema + Migrations
-- Target: PostgreSQL 18.4
-- Migration: 0001_init  (UP)
-- Reversible: yes — see "-- ===== DOWN (rollback) =====" at end of file
-- Author: 高见远 (Chief Architect, MVP Dev Expert Team)
-- Spec: spec/SPEC.md (section 6 DB tables, section 10 constraints)
-- ============================================================================
--
-- DESIGN CONTRACT (multi-tenant isolation — P0 red line from Spec section 10)
--   * workspace_id is resolved ONLY from the JWT claim `wid`. The application
--     NEVER trusts a client-supplied workspace id.
--   * RLS is enabled at engine level on every tenant table. Even if the app
--     forgets the WHERE workspace_id = ? clause, PostgreSQL RLS blocks the row.
--   * The application connects as `app_role` which has NOINHERIT and NOBYPASSRLS
--     and does NOT own any table, so it cannot disable RLS.
--   * Per request, the route handler sets a transaction-scoped GUC:
--         SET LOCAL app.workspace_id = '<JWT.wid>';
--         SET LOCAL app.user_id      = '<JWT.uid>';
--     See "REQUEST-LEVEL INJECTION POINT" comment near the bottom.
--
-- TENANT DATA TABLES (strict rule: workspace_id UUID NOT NULL REFERENCES workspaces(id))
--   members, tasks, comments, decisions, decision_versions, subscriptions
-- IDENTITY / ROOT TABLES (intentional, documented exceptions to the rule)
--   workspaces : the tenant ROOT — it cannot self-reference workspace_id NOT NULL.
--                RLS is keyed on membership (app.user_id) instead.
--   users      : global identity (Better Auth account). RLS keyed on app.user_id
--                with a narrow `app.auth_op` escape hatch for the login lookup only.
--   sessions   : refresh-token store. RLS keyed on app.user_id with an `app.auth_op`
--                escape hatch for the refresh-rotation lookup only.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. ROLES
--    app_migrator : owns all tables, runs migrations. NOT used by the app at runtime.
--    app_role     : the runtime connection role. NOINHERIT (cannot gain grants via
--                   inheritance), NOBYPASSRLS (cannot bypass row level security),
--                   does NOT own tables (cannot ALTER/DROP them, cannot disable RLS).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_migrator') THEN
    CREATE ROLE app_migrator WITH LOGIN PASSWORD 'CHANGE_ME_MIGRATOR';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_role') THEN
    CREATE ROLE app_role WITH LOGIN PASSWORD 'CHANGE_ME_APP' NOINHERIT;
  END IF;
END
$$;

-- Explicitly forbid the runtime role from bypassing RLS (defence in depth; this is
-- already the default for a freshly created role, stated here so the intent is auditable).
ALTER ROLE app_role NOBYPASSRLS;
ALTER ROLE app_role NOSUPERUSER;
ALTER ROLE app_role NOINHERIT;

GRANT CONNECT ON DATABASE postgres TO app_role;
GRANT USAGE ON SCHEMA public TO app_role;

-- ---------------------------------------------------------------------------
-- 1. GUC (global user configuration) placeholders
--    These are set per-request via SET LOCAL inside the app's route handlers.
--    Declaring them keeps psql/tooling happy and documents the contract.
-- ---------------------------------------------------------------------------
-- (No CREATE for GUCs needed; current_setting() reads them at runtime. They are
--  namespaced under `app.` to avoid colliding with PostgreSQL built-ins.)

-- ===========================================================================
-- 2. TABLES
-- ===========================================================================

-- users — global identity (Better Auth account). password_hash = argon2id output.
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,                 -- argon2id verification string (incl. salt+params)
  name          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- workspaces — tenant ROOT. owner_id references the creating user.
CREATE TABLE IF NOT EXISTS workspaces (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  owner_id   uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  plan       text NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro')),
  seat_limit integer NOT NULL DEFAULT 10 CHECK (seat_limit >= 1 AND seat_limit <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- members — joins users <-> workspaces. This is the RBAC source of truth.
CREATE TABLE IF NOT EXISTS members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  role         text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

-- tasks — kanban card. status/priority are constrained enums.
CREATE TABLE IF NOT EXISTS tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'todo'
                CHECK (status IN ('todo','in_progress','review','done')),
  priority    text NOT NULL DEFAULT 'medium'
                CHECK (priority IN ('low','medium','high','urgent')),
  assignee_id uuid REFERENCES users(id) ON DELETE SET NULL,   -- nullable: unassigned
  due_date    timestamptz,
  sort_order  double precision NOT NULL DEFAULT 0,            -- kanban ordering (Spec "order")
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- comments — task-scoped discussion. mentions = array of mentioned user_ids.
CREATE TABLE IF NOT EXISTS comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,  -- denormalized for RLS
  author_id  uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body       text NOT NULL,
  mentions   uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- decisions — task-linked decision record (Markdown). version is bumped on edit.
CREATE TABLE IF NOT EXISTS decisions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,  -- denormalized for RLS
  markdown   text NOT NULL DEFAULT '',
  version    integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  author_id  uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- decision_versions — immutable version history (AC-10: 版本留痕).
-- Every create/edit of a decision appends one row here.
CREATE TABLE IF NOT EXISTS decision_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id  uuid NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,  -- denormalized for RLS
  markdown     text NOT NULL,
  version      integer NOT NULL CHECK (version >= 1),
  author_id    uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- subscriptions — Stripe subscription per workspace. quantity = billable seats.
CREATE TABLE IF NOT EXISTS subscriptions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_price_id   text,
  quantity          integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  status            text NOT NULL DEFAULT 'incomplete'
                     CHECK (status IN ('incomplete','active','past_due','canceled','trialing')),
  current_period_end timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id)
);

-- sessions — refresh-token store. refresh_hash = argon2id hash of the opaque token.
-- Access JWTs are stateless (Better Auth JWT plugin) and are NOT stored here.
CREATE TABLE IF NOT EXISTS sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_hash text NOT NULL,                 -- argon2id hash of the opaque 7d refresh token
  user_agent   text,
  ip           inet,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ===========================================================================
-- 3. INDEXES
--    Every tenant table gets idx_<table>_workspace_id for RLS + filtered scans.
-- ===========================================================================
CREATE INDEX IF NOT EXISTS idx_users_email            ON users(email);
CREATE INDEX IF NOT EXISTS idx_workspaces_owner_id     ON workspaces(owner_id);
CREATE INDEX IF NOT EXISTS idx_members_user_id         ON members(user_id);
CREATE INDEX IF NOT EXISTS idx_members_workspace_id    ON members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace_id      ON tasks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace_status  ON tasks(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_id       ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_comments_workspace_id   ON comments(workspace_id);
CREATE INDEX IF NOT EXISTS idx_comments_task_id        ON comments(task_id);
CREATE INDEX IF NOT EXISTS idx_decisions_workspace_id  ON decisions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_decisions_task_id       ON decisions(task_id);
CREATE INDEX IF NOT EXISTS idx_decision_versions_ws    ON decision_versions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_decision_versions_dec   ON decision_versions(decision_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_workspace ON subscriptions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id        ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_refresh_hash   ON sessions(refresh_hash);

-- ===========================================================================
-- 4. ROW LEVEL SECURITY (engine-enforced multi-tenant isolation)
--    Enabled on ALL tables. Tenant tables use the workspace_id GUC; identity/root
--    tables use the user_id GUC (plus narrow auth-op escape hatches).
-- ===========================================================================

-- ---- 4.1 Tenant data tables: workspace_id GUC -------------------------------
ALTER TABLE members          ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE decisions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions    ENABLE ROW LEVEL SECURITY;

-- Helper expression: when app.workspace_id is unset (NULL) the comparison yields
-- no rows, so a missing GUC is a hard DENY, never a leak.
CREATE POLICY p_members_rls ON members
  FOR ALL
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

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
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- ---- 4.2 workspaces: membership / ownership keyed on user_id ----------------
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;

-- A user may SELECT a workspace they belong to (covers GET /workspaces list + detail).
CREATE POLICY p_workspaces_select ON workspaces
  FOR SELECT
  USING (
    id IN (
      SELECT m.workspace_id FROM members m
      WHERE m.user_id = current_setting('app.user_id', true)::uuid
    )
  );

-- Create / update / delete require ownership (covers RBAC: only owner provisions billing).
CREATE POLICY p_workspaces_owner ON workspaces
  FOR ALL
  USING (owner_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (owner_id = current_setting('app.user_id', true)::uuid);

-- ---- 4.3 users: self only, with narrow login escape hatch -------------------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_users_self ON users
  FOR ALL
  USING (
    id = current_setting('app.user_id', true)::uuid
    OR current_setting('app.auth_op', true) = 'login'   -- Better Auth email lookup during login only
  )
  WITH CHECK (id = current_setting('app.user_id', true)::uuid);

-- ---- 4.4 sessions: self, with narrow refresh-rotation escape hatch ----------
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_sessions_self ON sessions
  FOR ALL
  USING (
    user_id = current_setting('app.user_id', true)::uuid
    OR current_setting('app.auth_op', true) = 'refresh'  -- lookup by refresh_hash during rotation
  )
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);

-- ===========================================================================
-- 5. GRANTS — app_role gets DML only; it owns nothing and cannot disable RLS.
-- ===========================================================================
GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public
  TO app_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_role;

-- ===========================================================================
-- 6. REQUEST-LEVEL INJECTION POINT  (SET LOCAL app.workspace_id = <JWT.wid>)
-- ===========================================================================
-- Every authenticated route handler MUST, immediately after verifying the access
-- JWT, open a transaction and set the GUCs BEFORE any query. Because the value is
-- taken ONLY from the verified JWT claim `wid` (never from the request path/body),
-- this is the single choke point that binds the connection to one tenant for the
-- duration of the request. With transaction-level pooling (PgBouncer) the SET LOCAL
-- is automatically reset at end of transaction, preventing cross-tenant leakage
-- between pooled connections (see Spec section 11 known pit: "RLS 连接池串租户").
--
-- Pseudocode (Next.js Route Handler):
--   const jwt = verifyAccessToken(req);              // throws 401 if invalid/expired
--   await prisma.$transaction(async (tx) => {
--     await tx.$executeRaw`SET LOCAL app.workspace_id = ${jwt.wid}::uuid`;
--     await tx.$executeRaw`SET LOCAL app.user_id      = ${jwt.uid}::uuid`;
--     // ... business queries; RLS now filters every row to this workspace
--   });
--
-- For the login/refresh flows (unauthenticated request), set the auth-op escape hatch:
--   await tx.$executeRaw`SET LOCAL app.auth_op = 'login'`;   // or 'refresh'
--   await tx.$executeRaw`SET LOCAL app.user_id = ${uid}::uuid`;  -- once identity known

-- ===========================================================================
-- 7. ISOLATION TEST POINTS (maps to Spec AC-03 / AC-04 — MUST be covered by tests)
-- ===========================================================================
-- AC-03 (cross-tenant direct access returns 404/403, no leak):
--   Given user A (member of workspace W_A) with a valid access JWT,
--   When A calls GET /api/v1/workspaces/W_B/tasks with W_B != W_A,
--   Then the handler sets app.workspace_id = W_A, RLS on tasks filters to W_A,
--   and the row for W_B is never returned (HTTP 404 — unknown to A).
--   TEST: execute as app_role with SET LOCAL app.workspace_id='W_A', then
--         SELECT * FROM tasks WHERE id = <a task belonging to W_B>;
--         assertion: 0 rows (RLS blocks it).
--
-- AC-04 (missing WHERE is still blocked by RLS):
--   Given the SAME connection, run a query that OMITS the workspace_id filter:
--         SELECT count(*) FROM tasks;   -- no WHERE clause at all
--   Then RLS applies automatically; only W_A rows are visible.
--   TEST: assertion: count == count of W_A tasks, never the global total.
--
-- AC-05 (RBAC enforced server-side):
--   A Member role setting app.user_id to a member and calling DELETE /members/:uid
--   or POST /billing/checkout must be rejected at the app layer (403) — this is an
--   app-layer check on the `members.role` row, independent of but reinforced by RLS.

-- ===========================================================================
-- ===== DOWN (rollback) =====
-- Reversible migration. Drop in reverse order. RLS + policies are dropped with tables.
--   DROP TABLE IF EXISTS sessions, subscriptions, decision_versions, decisions,
--     comments, tasks, members, workspaces, users CASCADE;
--   -- roles are intentionally retained (revoke instead if removing):
--   -- REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_role;
--   -- DROP ROLE IF EXISTS app_role; DROP ROLE IF EXISTS app_migrator;
-- ===========================================================================
