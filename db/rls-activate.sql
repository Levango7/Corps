-- ===========================================================================
-- rls-activate.sql — RLS 加固模式一键激活（幂等，可重复执行）
--
-- 运行方式（entrypoint.sh 在 RLS_ACTIVATE=true 时自动执行）：
--   psql "$DATABASE_OWNER_URL" -v ON_ERROR_STOP=1 \
--        -v app_password="$CORPS_APP_PASSWORD" -f db/rls-activate.sql
--
-- 内容：
--   1. corps_app 最小权限运行时角色（NOBYPASSRLS）
--   2. GRANT + ALTER DEFAULT PRIVILEGES（新建表自动授权，修复快照式 GRANT 缺陷）
--   3. 全部租户表 ENABLE + FORCE ROW LEVEL SECURITY（FORCE 堵 owner 旁路）
--   4. 策略定义（与应用层对齐，见 ADR-006 的 op 信任模型）
--
-- 信任模型：app.auth_op / app.user_id / app.workspace_id 三个 GUC 仅由服务端代码
--   （lib/auth.ts 的 withGuc 白名单）设置，客户端不可控。op 枚举：
--     login     登录/刷新时按 user_id 读自己的成员关系
--     provision 注册/建工作区/服务端埋点写入
--     webhook   Stripe 回调（订阅与计划同步）
--     invite    按 token 读取邀请（公开预览/接受前的取件）
--     seat      邀请/接受的席位保护段（wid+uid 齐备，允许 FOR UPDATE 行锁）
-- ===========================================================================

-- ─── 1. 运行时角色 ─────────────────────────────────────────────────────────
SELECT 'CREATE ROLE corps_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'corps_app')\gexec
ALTER ROLE corps_app WITH PASSWORD :'app_password';

-- ─── 2. 授权（含未来表的默认权限）─────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO corps_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO corps_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO corps_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO corps_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO corps_app;

-- ─── 3. 启用并 FORCE RLS（FORCE：表属主同样受策略约束）─────────────────────
-- 身份域（users/sessions/accounts/verifications）有意豁免：Better Auth 托管、无租户键。
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'members','tasks','comments','decisions','decision_versions',
    'subscriptions','notifications','workspaces','invitations','analytics_events',
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- ─── 4. 策略（先删后建，保证幂等且与本文件声明一致）────────────────────────

-- members：读 = 本工作区 或 login/provision 时读自己；写 = 本工作区 或注册时的 owner 自插
DROP POLICY IF EXISTS p_members_rls        ON members;
DROP POLICY IF EXISTS p_members_select     ON members;
DROP POLICY IF EXISTS p_members_insert     ON members;
DROP POLICY IF EXISTS p_members_update     ON members;
DROP POLICY IF EXISTS p_members_delete     ON members;
CREATE POLICY p_members_select ON members FOR SELECT USING (
  workspace_id = current_setting('app.workspace_id', true)::uuid
  OR (current_setting('app.auth_op', true) IN ('login', 'provision', 'seat')
      AND user_id = current_setting('app.user_id', true)::uuid)
);
CREATE POLICY p_members_insert ON members FOR INSERT WITH CHECK (
  workspace_id = current_setting('app.workspace_id', true)::uuid
  OR (current_setting('app.auth_op', true) = 'provision'
      AND user_id = current_setting('app.user_id', true)::uuid)
);

-- tasks / comments / decisions / decision_versions：纯 workspace 谓词
DROP POLICY IF EXISTS p_tasks_rls ON tasks;
CREATE POLICY p_tasks_rls ON tasks FOR ALL
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

DROP POLICY IF EXISTS p_comments_rls ON comments;
CREATE POLICY p_comments_rls ON comments FOR ALL
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

DROP POLICY IF EXISTS p_decisions_rls ON decisions;
CREATE POLICY p_decisions_rls ON decisions FOR ALL
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

DROP POLICY IF EXISTS p_decision_versions_rls ON decision_versions;
CREATE POLICY p_decision_versions_rls ON decision_versions FOR ALL
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- subscriptions：workspace 谓词 + webhook 逃生口
DROP POLICY IF EXISTS p_subscriptions_rls ON subscriptions;
CREATE POLICY p_subscriptions_rls ON subscriptions FOR ALL
  USING (
    workspace_id = current_setting('app.workspace_id', true)::uuid
    OR current_setting('app.auth_op', true) = 'webhook'
  )
  WITH CHECK (
    workspace_id = current_setting('app.workspace_id', true)::uuid
    OR current_setting('app.auth_op', true) = 'webhook'
  );

-- notifications：只按 workspace 判定（应用层 WHERE 负责“看自己的”；
-- 给他人写 mention 通知是合法操作，旧策略的 user_id 条件与之冲突，已移除）
DROP POLICY IF EXISTS p_notifications_rls ON notifications;
CREATE POLICY p_notifications_rls ON notifications FOR ALL
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- invitations：workspace 谓词 + invite 取件逃生口（按 token 的公开预览/接受前置读取）
DROP POLICY IF EXISTS p_invitations_rls ON invitations;
CREATE POLICY p_invitations_rls ON invitations FOR ALL
  USING (
    workspace_id = current_setting('app.workspace_id', true)::uuid
    OR current_setting('app.auth_op', true) = 'invite'
  )
  WITH CHECK (
    workspace_id = current_setting('app.workspace_id', true)::uuid
    OR current_setting('app.auth_op', true) = 'invite'
  );

-- analytics_events：workspace 谓词 + provision 埋点写入 + 本人读取（events GET dev）
DROP POLICY IF EXISTS p_analytics_events_rls ON analytics_events;
CREATE POLICY p_analytics_events_rls ON analytics_events FOR ALL
  USING (
    workspace_id = current_setting('app.workspace_id', true)::uuid
    OR current_setting('app.auth_op', true) = 'provision'
    OR (user_id IS NOT NULL
        AND user_id = current_setting('app.user_id', true)::uuid)
  )
  WITH CHECK (
    workspace_id = current_setting('app.workspace_id', true)::uuid
    OR current_setting('app.auth_op', true) = 'provision'
  );

-- workspaces：读 = 成员 或 wid 上下文 或 op 逃生口；
-- 写拆分 INSERT/UPDATE/DELETE，UPDATE 放行 owner 与 owner/admin 成员（对齐产品 RBAC，
-- 修复 admin 改名在加固模式下的 P2025→500），seat op 仅为 FOR UPDATE 行锁放行。
DROP POLICY IF EXISTS p_workspaces_select ON workspaces;
DROP POLICY IF EXISTS p_workspaces_write  ON workspaces;
DROP POLICY IF EXISTS p_workspaces_insert ON workspaces;
DROP POLICY IF EXISTS p_workspaces_update ON workspaces;
DROP POLICY IF EXISTS p_workspaces_delete ON workspaces;

CREATE POLICY p_workspaces_select ON workspaces FOR SELECT USING (
  id IN (SELECT m.workspace_id FROM members m
         WHERE m.user_id = current_setting('app.user_id', true)::uuid)
  OR id = current_setting('app.workspace_id', true)::uuid
  OR current_setting('app.auth_op', true) IN ('provision', 'webhook', 'invite')
);

CREATE POLICY p_workspaces_insert ON workspaces FOR INSERT WITH CHECK (
  owner_id = current_setting('app.user_id', true)::uuid
  OR current_setting('app.auth_op', true) = 'webhook'
  OR (current_setting('app.auth_op', true) = 'provision'
      AND owner_id = current_setting('app.user_id', true)::uuid)
);

CREATE POLICY p_workspaces_update ON workspaces FOR UPDATE
  USING (
    owner_id = current_setting('app.user_id', true)::uuid
    OR current_setting('app.auth_op', true) IN ('provision', 'webhook', 'seat')
    OR EXISTS (
      SELECT 1 FROM members m
      WHERE m.workspace_id = id
        AND m.user_id = current_setting('app.user_id', true)::uuid
        AND m.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    owner_id = current_setting('app.user_id', true)::uuid
    OR current_setting('app.auth_op', true) = 'webhook'
    OR EXISTS (
      SELECT 1 FROM members m
      WHERE m.workspace_id = id
        AND m.user_id = current_setting('app.user_id', true)::uuid
        AND m.role IN ('owner', 'admin')
    )
  );

CREATE POLICY p_workspaces_delete ON workspaces FOR DELETE
  USING (owner_id = current_setting('app.user_id', true)::uuid);