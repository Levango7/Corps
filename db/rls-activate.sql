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
-- 信任模型：app.auth_op / app.user_id / app.workspace_id / app.public_token 四个 GUC
--   仅由服务端代码（lib/auth.ts 的 withGuc 白名单）设置，客户端不可控。op 枚举：
--     login     登录/刷新时按 user_id 读自己的成员关系
--     provision 注册/建工作区/服务端埋点写入
--     webhook   支付通道回调（订阅与计划同步）
--     invite    按 token 读取邀请（公开预览/接受前的取件）
--     seat      邀请/接受的席位保护段（wid+uid 齐备，允许 FOR UPDATE 行锁）
--     cron      定时作业跨工作区只读扫描（截止日提醒；无写入路径）
--     calendar  日历同步跨工作区只读扫描（任务定位/用户截止日任务扫描；无写入路径）
--   public_token 不属于 op 枚举：documents 公开分享读按 share_token 与之相等放行
--   （p_documents_share_select，仅 SELECT），token 本身 192 位熵不可猜。
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
    'labels','milestones','messages','message_attachments','task_labels',
    'chat_presences','message_reads','calendar_connections','task_calendar_events',
    'documents'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- ─── 4. 策略（先删后建，保证幂等且与本文件声明一致）────────────────────────

-- members：读 = 本工作区 或 login/provision/seat 时读自己；
-- 插入 = 本工作区 或注册时的 owner 自插；
-- 更新/删除 = 仅本工作区（角色变更/成员移除全量调用点均经 runWithWorkspace，
-- 携带 workspace_id 上下文，无 auth_op 场景——不加 op 逃生口，保持最小权限；
-- UPDATE 的 WITH CHECK 同 USING，防止借 UPDATE 篡改 workspace_id 跨租户挪动）
DROP POLICY IF EXISTS p_members_rls        ON members;
DROP POLICY IF EXISTS p_members_select     ON members;
DROP POLICY IF EXISTS p_members_insert     ON members;
DROP POLICY IF EXISTS p_members_update     ON members;
DROP POLICY IF EXISTS p_members_delete     ON members;
CREATE POLICY p_members_select ON members FOR SELECT USING (
  workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
  OR (current_setting('app.auth_op', true) IN ('login', 'provision', 'seat')
      AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
);
CREATE POLICY p_members_insert ON members FOR INSERT WITH CHECK (
  workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
  OR (current_setting('app.auth_op', true) = 'provision'
      AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
);
CREATE POLICY p_members_update ON members FOR UPDATE USING (
  workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
) WITH CHECK (
  workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
);
CREATE POLICY p_members_delete ON members FOR DELETE USING (
  workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
);

-- tasks / comments / decisions / decision_versions：纯 workspace 谓词。
-- tasks 的 SELECT 另放行 cron / calendar 系统作业（截止日提醒与日历同步均需
-- 跨工作区只读扫描），写操作不设逃生口（两类作业均只读）。
DROP POLICY IF EXISTS p_tasks_rls ON tasks;
CREATE POLICY p_tasks_rls ON tasks FOR ALL
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

DROP POLICY IF EXISTS p_tasks_cron_select ON tasks;
CREATE POLICY p_tasks_cron_select ON tasks FOR SELECT
  USING (current_setting('app.auth_op', true) = 'cron');

-- 日历同步逃生口（审计 P1-A）：lib/calendar/sync.ts 按 taskId 定位任务 /
-- 按用户扫描有截止日的任务，属用户级跨工作区只读作业——与 cron 同信任
-- 级别、同只读约束（授权发起自登录用户的 OAuth 连接，见 ADR-006）。
DROP POLICY IF EXISTS p_tasks_calendar_select ON tasks;
CREATE POLICY p_tasks_calendar_select ON tasks FOR SELECT
  USING (current_setting('app.auth_op', true) = 'calendar');

-- v2 扩面（审计 P2-3）：labels / milestones / messages / message_attachments / task_labels
-- 均带 workspace_id 且全部读写路由经 runWithWorkspace（GUC 事务），套用与 tasks
-- 相同的纯租户谓词。message_attachments 自 20260831000000 迁移补列后纳入 FORCE RLS，
-- 下载归属定位走下方 cron SELECT 逃生口。
-- 仍不在清单：message_reads / chat_presences（暂无直接 API 路由）、
-- calendar_connections / task_calendar_events（user 作用域，无 workspace 键，另议）。
-- ↓ 2026-08-30 更新：上段说明作废——四表已按下述策略收编（见各自策略块）。
DROP POLICY IF EXISTS p_labels_rls ON labels;
CREATE POLICY p_labels_rls ON labels FOR ALL
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

DROP POLICY IF EXISTS p_milestones_rls ON milestones;
CREATE POLICY p_milestones_rls ON milestones FOR ALL
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

DROP POLICY IF EXISTS p_messages_rls ON messages;
CREATE POLICY p_messages_rls ON messages FOR ALL
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

DROP POLICY IF EXISTS p_message_attachments_rls ON message_attachments;
CREATE POLICY p_message_attachments_rls ON message_attachments FOR ALL
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- 附件下载归属定位逃生口：/api/uploads/* 以 runWithAuthOp("cron") 只读定位附件的
-- workspace_id（仅 select workspace_id，不返回文件内容），故 cron op 下放行 SELECT。
-- 与 p_tasks_cron_select 同源同约束（CRON_SECRET 为唯一防线）；写操作无逃生口。
DROP POLICY IF EXISTS p_message_attachments_cron_select ON message_attachments;
CREATE POLICY p_message_attachments_cron_select ON message_attachments FOR SELECT
  USING (current_setting('app.auth_op', true) = 'cron');

DROP POLICY IF EXISTS p_task_labels_rls ON task_labels;
CREATE POLICY p_task_labels_rls ON task_labels FOR ALL
  USING (
    task_id IN (SELECT t.id FROM tasks t
                WHERE t.workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  )
  WITH CHECK (
    task_id IN (SELECT t.id FROM tasks t
                WHERE t.workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  );

-- ─── 2026-08-30 四表收编（审计 P2 + 决策 A 体验优先版）──────────────────────
-- chat_presences / message_reads：与 messages 同域（经 task/message 关联套租户）。
-- 调用点（stream/read 路由）已持 wid 上下文，改走 runWithWorkspace 注入 GUC。
DROP POLICY IF EXISTS p_chat_presences_rls ON chat_presences;
CREATE POLICY p_chat_presences_rls ON chat_presences FOR ALL
  USING (
    task_id IN (SELECT t.id FROM tasks t
                WHERE t.workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  )
  WITH CHECK (
    task_id IN (SELECT t.id FROM tasks t
                WHERE t.workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  );

DROP POLICY IF EXISTS p_message_reads_rls ON message_reads;
CREATE POLICY p_message_reads_rls ON message_reads FOR ALL
  USING (
    message_id IN (SELECT m.id FROM messages m
                   WHERE m.workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  )
  WITH CHECK (
    message_id IN (SELECT m.id FROM messages m
                   WHERE m.workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  );

-- calendar_connections：用户私有连接数据（OAuth token），无 workspace 键——
-- 按 user_id 谓词：本人（app.user_id）或 calendar 逃生口（同步系统作业）可见。
-- 调用点：status 路由本人查询（user_id GUC）、sync.ts 跨工作区作业（calendar op）、
-- callback upsert（connect 时已有认证 user_id——经 login/provision op 的 user_id 分支）。
DROP POLICY IF EXISTS p_calendar_connections_rls ON calendar_connections;
CREATE POLICY p_calendar_connections_rls ON calendar_connections FOR ALL
  USING (
    user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR current_setting('app.auth_op', true) = 'calendar'
  )
  WITH CHECK (
    user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR current_setting('app.auth_op', true) = 'calendar'
  );

-- task_calendar_events：任务↔连接映射，经 task 的 workspace 关联套租户；
-- 同步作业（calendar op）需读写映射行 → calendar 逃生口覆盖 FOR ALL。
DROP POLICY IF EXISTS p_task_calendar_events_rls ON task_calendar_events;
CREATE POLICY p_task_calendar_events_rls ON task_calendar_events FOR ALL
  USING (
    task_id IN (SELECT t.id FROM tasks t
                WHERE t.workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
    OR current_setting('app.auth_op', true) = 'calendar'
  )
  WITH CHECK (
    task_id IN (SELECT t.id FROM tasks t
                WHERE t.workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
    OR current_setting('app.auth_op', true) = 'calendar'
  );

-- documents（v0.4.0 文档中心）：workspace 谓词 + 公开分享只读逃生口。
-- /api/documents/share/[token] 无登录态，经 runWithShareToken 注入 app.public_token，
-- share_token 与之相等的行才可读（NULL 永不匹配：未分享/草稿天然隔离）；
-- 写操作仅 workspace 谓词，无逃生口。
DROP POLICY IF EXISTS p_documents_rls ON documents;
CREATE POLICY p_documents_rls ON documents FOR ALL
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

DROP POLICY IF EXISTS p_documents_share_select ON documents;
CREATE POLICY p_documents_share_select ON documents FOR SELECT
  USING (
    share_token IS NOT NULL
    AND share_token = NULLIF(current_setting('app.public_token', true), '')
  );

DROP POLICY IF EXISTS p_comments_rls ON comments;
CREATE POLICY p_comments_rls ON comments FOR ALL
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

DROP POLICY IF EXISTS p_decisions_rls ON decisions;
CREATE POLICY p_decisions_rls ON decisions FOR ALL
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

DROP POLICY IF EXISTS p_decision_versions_rls ON decision_versions;
CREATE POLICY p_decision_versions_rls ON decision_versions FOR ALL
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- subscriptions：workspace 谓词 + webhook 逃生口
DROP POLICY IF EXISTS p_subscriptions_rls ON subscriptions;
CREATE POLICY p_subscriptions_rls ON subscriptions FOR ALL
  USING (
    workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
    OR current_setting('app.auth_op', true) = 'webhook'
  )
  WITH CHECK (
    workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
    OR current_setting('app.auth_op', true) = 'webhook'
  );

-- notifications：只按 workspace 判定（应用层 WHERE 负责“看自己的”；
-- 给他人写 mention 通知是合法操作，旧策略的 user_id 条件与之冲突，已移除）
DROP POLICY IF EXISTS p_notifications_rls ON notifications;
CREATE POLICY p_notifications_rls ON notifications FOR ALL
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- invitations：workspace 谓词 + invite 取件逃生口（按 token 的公开预览/接受前置读取）
DROP POLICY IF EXISTS p_invitations_rls ON invitations;
CREATE POLICY p_invitations_rls ON invitations FOR ALL
  USING (
    workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
    OR current_setting('app.auth_op', true) = 'invite'
  )
  WITH CHECK (
    workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
    OR current_setting('app.auth_op', true) = 'invite'
  );

-- analytics_events：workspace 谓词 + provision 埋点写入 + 本人读取（events GET dev）
DROP POLICY IF EXISTS p_analytics_events_rls ON analytics_events;
CREATE POLICY p_analytics_events_rls ON analytics_events FOR ALL
  USING (
    workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
    OR current_setting('app.auth_op', true) = 'provision'
    OR (user_id IS NOT NULL
        AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  )
  WITH CHECK (
    workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
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
         WHERE m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  OR id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
  OR current_setting('app.auth_op', true) IN ('provision', 'webhook', 'invite', 'cron')
);

CREATE POLICY p_workspaces_insert ON workspaces FOR INSERT WITH CHECK (
  owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  OR current_setting('app.auth_op', true) = 'webhook'
  OR (current_setting('app.auth_op', true) = 'provision'
      AND owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
);

CREATE POLICY p_workspaces_update ON workspaces FOR UPDATE
  USING (
    owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR current_setting('app.auth_op', true) IN ('provision', 'webhook', 'seat')
    OR EXISTS (
      SELECT 1 FROM members m
      WHERE m.workspace_id = id
        AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND m.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR current_setting('app.auth_op', true) = 'webhook'
    OR EXISTS (
      SELECT 1 FROM members m
      WHERE m.workspace_id = id
        AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND m.role IN ('owner', 'admin')
    )
  );

CREATE POLICY p_workspaces_delete ON workspaces FOR DELETE
  USING (owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
