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
    'conversations','conversation_members',
    'chat_presences','message_reads','calendar_connections','task_calendar_events',
    'documents','temporary_grants',
    'push_subscriptions','push_tokens','ai_push_schedules','ai_push_records',
    -- ── 55 张补齐 RLS 的租户表（纯 workspace_id 谓词）──
    'ai_agent_messages','ai_agents','ai_conversations','ai_feedback','ai_meeting_action_items',
    'ai_meeting_decisions','ai_meeting_sessions','ai_personalizations','ai_usage_limits',
    'ai_usage_logs','ai_user_behaviors','ai_workflow_templates','ai_analysis_reports',
    'ai_voice_commands','announcements','approval_cc_records','approval_delegates',
    'approval_instances','approval_operations','approval_templates','assistant_conversations',
    'calendar_events','contact_groups','contacts','databases','document_comments',
    'document_permissions','document_versions','email_accounts','favorites','file_assets',
    'folder_permissions','folders','forms','form_submissions','knowledge_edges','knowledge_nodes',
    'mails','meeting_minutes','meetings','member_permissions','objectives',
    'permission_audit_logs','project_templates','remote_control_sessions',
    'share_link_permissions','spaces','time_entries','user_dashboard_prefs','whiteboards',
    'wiki_pages','workflows','workflow_executions'
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
DROP POLICY IF EXISTS p_members_update ON members;
CREATE POLICY p_members_update ON members FOR UPDATE USING (
  workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
) WITH CHECK (
  workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
);
DROP POLICY IF EXISTS p_members_delete ON members;
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
-- 任务公开只读分享（v0.4 队列第 6 项）：放行 share_token 或 share_slug 与 GUC 相等的行
DROP POLICY IF EXISTS p_tasks_share_select ON tasks;
CREATE POLICY p_tasks_share_select ON tasks FOR SELECT
  USING (
    (task_share_token IS NOT NULL
     AND task_share_token = NULLIF(current_setting('app.public_token', true), ''))
    OR (share_slug IS NOT NULL
     AND share_slug = NULLIF(current_setting('app.public_token', true), ''))
  );

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
-- chat_presences：扩展 RLS 覆盖 conversation_id 路径
-- 原：仅 task_id → tasks → workspace_id
-- 新：task_id → tasks → workspace_id OR conversation_id → conversations → workspace_id
DROP POLICY IF EXISTS p_chat_presences_rls ON chat_presences;
CREATE POLICY p_chat_presences_rls ON chat_presences FOR ALL
  USING (
    task_id IN (SELECT t.id FROM tasks t
                WHERE t.workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
    OR conversation_id IN (SELECT c.id FROM conversations c
                           WHERE c.workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  )
  WITH CHECK (
    task_id IN (SELECT t.id FROM tasks t
                WHERE t.workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
    OR conversation_id IN (SELECT c.id FROM conversations c
                           WHERE c.workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
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
-- share_token 或 share_slug 与之相等的行才可读（NULL 永不匹配：未分享/草稿天然隔离）；
-- 写操作仅 workspace 谓词，无逃生口。
DROP POLICY IF EXISTS p_documents_rls ON documents;
CREATE POLICY p_documents_rls ON documents FOR ALL
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

DROP POLICY IF EXISTS p_documents_share_select ON documents;
CREATE POLICY p_documents_share_select ON documents FOR SELECT
  USING (
    (share_token IS NOT NULL
     AND share_token = NULLIF(current_setting('app.public_token', true), ''))
    OR (share_slug IS NOT NULL
     AND share_slug = NULLIF(current_setting('app.public_token', true), ''))
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

-- notifications：拆分 SELECT / INSERT / UPDATE / DELETE 策略（DL-17，P3：
-- RLS 缺 user_id 纵深防御；M2 审计确认 user_id 容错处理已正确实现）。
--
-- 背景：原策略 p_notifications_rls（FOR ALL）仅按 workspace 判定，应用层
-- WHERE 负责"看自己的"。风险：应用层若遗漏 user_id 过滤，用户可读他人通知。
--
-- 权衡：给他人写 mention 通知是合法操作（INSERT 行的 user_id 是接收者而非
-- 当前用户），故 INSERT 不能加 user_id 谓词。拆分策略：
--  - SELECT：workspace + user_id（纵深防御；app.user_id 未设置时容错放行，
--    向后兼容现有未传 userId 的 runWithWorkspace 调用）
--  - INSERT：仅 workspace（系统给他人写 mention 通知）
--  - UPDATE：workspace + user_id（用户只能改自己的通知，如标记已读）
--  - DELETE：workspace + user_id（用户只能删自己的通知）
--
-- user_id 容错模式（M2 确认正确）：NULLIF(current_setting('app.user_id', true), '') IS NULL
-- → app.user_id 未设置时放行（向后兼容，覆盖 login/provision 等受信系统 op
--    经 runWithAuthOp 调用但未传 userId 的场景）；设置后按 user_id 隔离（纵深防御）。
-- 审计结论（M2）：四策略 user_id 谓词均已正确包含容错分支，无需进一步修改。
DROP POLICY IF EXISTS p_notifications_rls ON notifications;
DROP POLICY IF EXISTS p_notifications_select ON notifications;
DROP POLICY IF EXISTS p_notifications_insert ON notifications;
DROP POLICY IF EXISTS p_notifications_update ON notifications;
DROP POLICY IF EXISTS p_notifications_delete ON notifications;

CREATE POLICY p_notifications_select ON notifications FOR SELECT
  USING (
    workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
    AND (
      NULLIF(current_setting('app.user_id', true), '') IS NULL
      OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    )
  );

DROP POLICY IF EXISTS p_notifications_insert ON notifications;
CREATE POLICY p_notifications_insert ON notifications FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

DROP POLICY IF EXISTS p_notifications_update ON notifications;
CREATE POLICY p_notifications_update ON notifications FOR UPDATE
  USING (
    workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
    AND (
      NULLIF(current_setting('app.user_id', true), '') IS NULL
      OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    )
  )
  WITH CHECK (
    workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
    AND (
      NULLIF(current_setting('app.user_id', true), '') IS NULL
      OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    )
  );

DROP POLICY IF EXISTS p_notifications_delete ON notifications;
CREATE POLICY p_notifications_delete ON notifications FOR DELETE
  USING (
    workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
    AND (
      NULLIF(current_setting('app.user_id', true), '') IS NULL
      OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    )
  );

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

DROP POLICY IF EXISTS p_workspaces_insert ON workspaces;
CREATE POLICY p_workspaces_insert ON workspaces FOR INSERT WITH CHECK (
  owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  OR current_setting('app.auth_op', true) = 'webhook'
  OR (current_setting('app.auth_op', true) = 'provision'
      AND owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
);

DROP POLICY IF EXISTS p_workspaces_update ON workspaces;
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

DROP POLICY IF EXISTS p_workspaces_delete ON workspaces;
CREATE POLICY p_workspaces_delete ON workspaces FOR DELETE
  USING (owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
-- ─── F2（任务 186）：临时权限授权表 ──────────────────────────────────────────
-- temporary_grants：读 = 本工作区成员可见（用于展示自己的临时授权状态）
--   + cron 逃生口（跨工作区扫描过期记录）；
-- 写（INSERT/UPDATE/DELETE）= 仅本工作区（owner/admin 在应用层校验，RLS 仅做
-- 租户隔离）；DELETE 另放行 cron op（过期回收作业删除已处理记录）。
-- 与 members 策略同模式：UPDATE 的 WITH CHECK 同 USING，防止借 UPDATE 篡改
-- workspace_id 跨租户挪动。
DROP POLICY IF EXISTS p_temporary_grants_select ON temporary_grants;
DROP POLICY IF EXISTS p_temporary_grants_insert ON temporary_grants;
DROP POLICY IF EXISTS p_temporary_grants_update ON temporary_grants;
DROP POLICY IF EXISTS p_temporary_grants_delete ON temporary_grants;

CREATE POLICY p_temporary_grants_select ON temporary_grants FOR SELECT
  USING (
    workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
    OR current_setting('app.auth_op', true) = 'cron'
  );

DROP POLICY IF EXISTS p_temporary_grants_insert ON temporary_grants;
CREATE POLICY p_temporary_grants_insert ON temporary_grants FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

DROP POLICY IF EXISTS p_temporary_grants_update ON temporary_grants;
CREATE POLICY p_temporary_grants_update ON temporary_grants FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

DROP POLICY IF EXISTS p_temporary_grants_delete ON temporary_grants;
CREATE POLICY p_temporary_grants_delete ON temporary_grants FOR DELETE
  USING (
    workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
    OR current_setting('app.auth_op', true) = 'cron'
  );
-- ── push_subscriptions（用户级，按 user_id 隔离）──────────────────────────
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_push_subscriptions_select ON push_subscriptions;
CREATE POLICY p_push_subscriptions_select ON push_subscriptions FOR SELECT
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
         OR current_setting('app.auth_op', true) = 'cron');

DROP POLICY IF EXISTS p_push_subscriptions_insert ON push_subscriptions;
CREATE POLICY p_push_subscriptions_insert ON push_subscriptions FOR INSERT
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

DROP POLICY IF EXISTS p_push_subscriptions_update ON push_subscriptions;
CREATE POLICY p_push_subscriptions_update ON push_subscriptions FOR UPDATE
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

DROP POLICY IF EXISTS p_push_subscriptions_delete ON push_subscriptions;
CREATE POLICY p_push_subscriptions_delete ON push_subscriptions FOR DELETE
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- ── push_tokens（用户级，按 user_id 隔离；ADR-010 G3 收编试点）────────────
-- 无 cron 逃生口：唯一跨用户读路径 sendPushToUser 以【目标用户】身份注入
-- app.user_id 后查询，不存在"以系统身份跨用户读"的时刻。
-- 同时登记进批量数组：rls-bare-query-guard 只解析文件首个 ARRAY，不入列则
-- 该表的裸查不受看守。ENABLE/FORCE 在本块重复一次，保证块自包含、可重跑。
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_tokens FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_push_tokens_select ON push_tokens;
CREATE POLICY p_push_tokens_select ON push_tokens FOR SELECT
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

DROP POLICY IF EXISTS p_push_tokens_insert ON push_tokens;
CREATE POLICY p_push_tokens_insert ON push_tokens FOR INSERT
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

DROP POLICY IF EXISTS p_push_tokens_update ON push_tokens;
CREATE POLICY p_push_tokens_update ON push_tokens FOR UPDATE
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

DROP POLICY IF EXISTS p_push_tokens_delete ON push_tokens;
CREATE POLICY p_push_tokens_delete ON push_tokens FOR DELETE
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- ── ai_push_schedules（工作区级，按 workspace_id + user_id 隔离）──────────
ALTER TABLE ai_push_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_push_schedules FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_ai_push_schedules_select ON ai_push_schedules;
CREATE POLICY p_ai_push_schedules_select ON ai_push_schedules FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
         OR current_setting('app.auth_op', true) = 'cron');

DROP POLICY IF EXISTS p_ai_push_schedules_insert ON ai_push_schedules;
CREATE POLICY p_ai_push_schedules_insert ON ai_push_schedules FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

DROP POLICY IF EXISTS p_ai_push_schedules_update ON ai_push_schedules;
CREATE POLICY p_ai_push_schedules_update ON ai_push_schedules FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

DROP POLICY IF EXISTS p_ai_push_schedules_delete ON ai_push_schedules;
CREATE POLICY p_ai_push_schedules_delete ON ai_push_schedules FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── ai_push_records（工作区级，按 workspace_id + user_id 隔离）────────────
ALTER TABLE ai_push_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_push_records FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_ai_push_records_select ON ai_push_records;
CREATE POLICY p_ai_push_records_select ON ai_push_records FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
         OR current_setting('app.auth_op', true) = 'cron');

DROP POLICY IF EXISTS p_ai_push_records_insert ON ai_push_records;
CREATE POLICY p_ai_push_records_insert ON ai_push_records FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
              OR current_setting('app.auth_op', true) = 'cron');

DROP POLICY IF EXISTS p_ai_push_records_update ON ai_push_records;
CREATE POLICY p_ai_push_records_update ON ai_push_records FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
         OR current_setting('app.auth_op', true) = 'cron')
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
              OR current_setting('app.auth_op', true) = 'cron');

DROP POLICY IF EXISTS p_ai_push_records_delete ON ai_push_records;
CREATE POLICY p_ai_push_records_delete ON ai_push_records FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
-- ─── IM 会话表 RLS 补齐（安全修复）──────────────────────────────────────────
-- conversations：workspace_id 直接谓词（与 tasks/labels/milestones 同模式）
DROP POLICY IF EXISTS p_conversations_rls ON conversations;
CREATE POLICY p_conversations_rls ON conversations FOR ALL
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- conversation_members：经 conversation 关联套 workspace_id 谓词
-- （与 task_labels/message_reads 同模式：子查询 IN 路径）
DROP POLICY IF EXISTS p_conversation_members_rls ON conversation_members;
CREATE POLICY p_conversation_members_rls ON conversation_members FOR ALL
  USING (
    conversation_id IN (SELECT c.id FROM conversations c
                        WHERE c.workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  )
  WITH CHECK (
    conversation_id IN (SELECT c.id FROM conversations c
                        WHERE c.workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  );
-- ===========================================================================
-- ─── 55 张补齐 RLS 租户表策略（纯 workspace_id 谓词）────────────────────────
-- 每张表 4 类策略：SELECT / INSERT / UPDATE / DELETE
-- 命名约定：p_{table_name}_{operation}
-- 谓词模式：workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
-- UPDATE 的 WITH CHECK 同 USING，防止借 UPDATE 篡改 workspace_id 跨租户挪动。
-- ===========================================================================

-- ── ai_agent_messages ──
DROP POLICY IF EXISTS p_ai_agent_messages_select ON ai_agent_messages;
CREATE POLICY p_ai_agent_messages_select ON ai_agent_messages FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_agent_messages_insert ON ai_agent_messages;
CREATE POLICY p_ai_agent_messages_insert ON ai_agent_messages FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_agent_messages_update ON ai_agent_messages;
CREATE POLICY p_ai_agent_messages_update ON ai_agent_messages FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_agent_messages_delete ON ai_agent_messages;
CREATE POLICY p_ai_agent_messages_delete ON ai_agent_messages FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── ai_agents ──
DROP POLICY IF EXISTS p_ai_agents_select ON ai_agents;
CREATE POLICY p_ai_agents_select ON ai_agents FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_agents_insert ON ai_agents;
CREATE POLICY p_ai_agents_insert ON ai_agents FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_agents_update ON ai_agents;
CREATE POLICY p_ai_agents_update ON ai_agents FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_agents_delete ON ai_agents;
CREATE POLICY p_ai_agents_delete ON ai_agents FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── ai_conversations ──
DROP POLICY IF EXISTS p_ai_conversations_select ON ai_conversations;
CREATE POLICY p_ai_conversations_select ON ai_conversations FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_conversations_insert ON ai_conversations;
CREATE POLICY p_ai_conversations_insert ON ai_conversations FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_conversations_update ON ai_conversations;
CREATE POLICY p_ai_conversations_update ON ai_conversations FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_conversations_delete ON ai_conversations;
CREATE POLICY p_ai_conversations_delete ON ai_conversations FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── ai_feedback ──
DROP POLICY IF EXISTS p_ai_feedback_select ON ai_feedback;
CREATE POLICY p_ai_feedback_select ON ai_feedback FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_feedback_insert ON ai_feedback;
CREATE POLICY p_ai_feedback_insert ON ai_feedback FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_feedback_update ON ai_feedback;
CREATE POLICY p_ai_feedback_update ON ai_feedback FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_feedback_delete ON ai_feedback;
CREATE POLICY p_ai_feedback_delete ON ai_feedback FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── ai_meeting_action_items ──
DROP POLICY IF EXISTS p_ai_meeting_action_items_select ON ai_meeting_action_items;
CREATE POLICY p_ai_meeting_action_items_select ON ai_meeting_action_items FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_meeting_action_items_insert ON ai_meeting_action_items;
CREATE POLICY p_ai_meeting_action_items_insert ON ai_meeting_action_items FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_meeting_action_items_update ON ai_meeting_action_items;
CREATE POLICY p_ai_meeting_action_items_update ON ai_meeting_action_items FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_meeting_action_items_delete ON ai_meeting_action_items;
CREATE POLICY p_ai_meeting_action_items_delete ON ai_meeting_action_items FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── ai_meeting_decisions ──
DROP POLICY IF EXISTS p_ai_meeting_decisions_select ON ai_meeting_decisions;
CREATE POLICY p_ai_meeting_decisions_select ON ai_meeting_decisions FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_meeting_decisions_insert ON ai_meeting_decisions;
CREATE POLICY p_ai_meeting_decisions_insert ON ai_meeting_decisions FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_meeting_decisions_update ON ai_meeting_decisions;
CREATE POLICY p_ai_meeting_decisions_update ON ai_meeting_decisions FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_meeting_decisions_delete ON ai_meeting_decisions;
CREATE POLICY p_ai_meeting_decisions_delete ON ai_meeting_decisions FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── ai_meeting_sessions ──
DROP POLICY IF EXISTS p_ai_meeting_sessions_select ON ai_meeting_sessions;
CREATE POLICY p_ai_meeting_sessions_select ON ai_meeting_sessions FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_meeting_sessions_insert ON ai_meeting_sessions;
CREATE POLICY p_ai_meeting_sessions_insert ON ai_meeting_sessions FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_meeting_sessions_update ON ai_meeting_sessions;
CREATE POLICY p_ai_meeting_sessions_update ON ai_meeting_sessions FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_meeting_sessions_delete ON ai_meeting_sessions;
CREATE POLICY p_ai_meeting_sessions_delete ON ai_meeting_sessions FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── ai_personalizations ──
DROP POLICY IF EXISTS p_ai_personalizations_select ON ai_personalizations;
CREATE POLICY p_ai_personalizations_select ON ai_personalizations FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_personalizations_insert ON ai_personalizations;
CREATE POLICY p_ai_personalizations_insert ON ai_personalizations FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_personalizations_update ON ai_personalizations;
CREATE POLICY p_ai_personalizations_update ON ai_personalizations FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_personalizations_delete ON ai_personalizations;
CREATE POLICY p_ai_personalizations_delete ON ai_personalizations FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── ai_usage_limits ──
DROP POLICY IF EXISTS p_ai_usage_limits_select ON ai_usage_limits;
CREATE POLICY p_ai_usage_limits_select ON ai_usage_limits FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_usage_limits_insert ON ai_usage_limits;
CREATE POLICY p_ai_usage_limits_insert ON ai_usage_limits FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_usage_limits_update ON ai_usage_limits;
CREATE POLICY p_ai_usage_limits_update ON ai_usage_limits FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_usage_limits_delete ON ai_usage_limits;
CREATE POLICY p_ai_usage_limits_delete ON ai_usage_limits FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── ai_usage_logs ──
DROP POLICY IF EXISTS p_ai_usage_logs_select ON ai_usage_logs;
CREATE POLICY p_ai_usage_logs_select ON ai_usage_logs FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_usage_logs_insert ON ai_usage_logs;
CREATE POLICY p_ai_usage_logs_insert ON ai_usage_logs FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_usage_logs_update ON ai_usage_logs;
CREATE POLICY p_ai_usage_logs_update ON ai_usage_logs FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_usage_logs_delete ON ai_usage_logs;
CREATE POLICY p_ai_usage_logs_delete ON ai_usage_logs FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── ai_user_behaviors ──
DROP POLICY IF EXISTS p_ai_user_behaviors_select ON ai_user_behaviors;
CREATE POLICY p_ai_user_behaviors_select ON ai_user_behaviors FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_user_behaviors_insert ON ai_user_behaviors;
CREATE POLICY p_ai_user_behaviors_insert ON ai_user_behaviors FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_user_behaviors_update ON ai_user_behaviors;
CREATE POLICY p_ai_user_behaviors_update ON ai_user_behaviors FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_user_behaviors_delete ON ai_user_behaviors;
CREATE POLICY p_ai_user_behaviors_delete ON ai_user_behaviors FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── ai_workflow_templates ──
DROP POLICY IF EXISTS p_ai_workflow_templates_select ON ai_workflow_templates;
CREATE POLICY p_ai_workflow_templates_select ON ai_workflow_templates FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_workflow_templates_insert ON ai_workflow_templates;
CREATE POLICY p_ai_workflow_templates_insert ON ai_workflow_templates FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_workflow_templates_update ON ai_workflow_templates;
CREATE POLICY p_ai_workflow_templates_update ON ai_workflow_templates FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_workflow_templates_delete ON ai_workflow_templates;
CREATE POLICY p_ai_workflow_templates_delete ON ai_workflow_templates FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── ai_analysis_reports ──
DROP POLICY IF EXISTS p_ai_analysis_reports_select ON ai_analysis_reports;
CREATE POLICY p_ai_analysis_reports_select ON ai_analysis_reports FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_analysis_reports_insert ON ai_analysis_reports;
CREATE POLICY p_ai_analysis_reports_insert ON ai_analysis_reports FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_analysis_reports_update ON ai_analysis_reports;
CREATE POLICY p_ai_analysis_reports_update ON ai_analysis_reports FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_analysis_reports_delete ON ai_analysis_reports;
CREATE POLICY p_ai_analysis_reports_delete ON ai_analysis_reports FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── ai_voice_commands ──
DROP POLICY IF EXISTS p_ai_voice_commands_select ON ai_voice_commands;
CREATE POLICY p_ai_voice_commands_select ON ai_voice_commands FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_voice_commands_insert ON ai_voice_commands;
CREATE POLICY p_ai_voice_commands_insert ON ai_voice_commands FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_voice_commands_update ON ai_voice_commands;
CREATE POLICY p_ai_voice_commands_update ON ai_voice_commands FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_ai_voice_commands_delete ON ai_voice_commands;
CREATE POLICY p_ai_voice_commands_delete ON ai_voice_commands FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── announcements ──
DROP POLICY IF EXISTS p_announcements_select ON announcements;
CREATE POLICY p_announcements_select ON announcements FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_announcements_insert ON announcements;
CREATE POLICY p_announcements_insert ON announcements FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_announcements_update ON announcements;
CREATE POLICY p_announcements_update ON announcements FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_announcements_delete ON announcements;
CREATE POLICY p_announcements_delete ON announcements FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── approval_cc_records ──
DROP POLICY IF EXISTS p_approval_cc_records_select ON approval_cc_records;
CREATE POLICY p_approval_cc_records_select ON approval_cc_records FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_approval_cc_records_insert ON approval_cc_records;
CREATE POLICY p_approval_cc_records_insert ON approval_cc_records FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_approval_cc_records_update ON approval_cc_records;
CREATE POLICY p_approval_cc_records_update ON approval_cc_records FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_approval_cc_records_delete ON approval_cc_records;
CREATE POLICY p_approval_cc_records_delete ON approval_cc_records FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── approval_delegates ──
DROP POLICY IF EXISTS p_approval_delegates_select ON approval_delegates;
CREATE POLICY p_approval_delegates_select ON approval_delegates FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_approval_delegates_insert ON approval_delegates;
CREATE POLICY p_approval_delegates_insert ON approval_delegates FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_approval_delegates_update ON approval_delegates;
CREATE POLICY p_approval_delegates_update ON approval_delegates FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_approval_delegates_delete ON approval_delegates;
CREATE POLICY p_approval_delegates_delete ON approval_delegates FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── approval_instances ──
DROP POLICY IF EXISTS p_approval_instances_select ON approval_instances;
CREATE POLICY p_approval_instances_select ON approval_instances FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_approval_instances_insert ON approval_instances;
CREATE POLICY p_approval_instances_insert ON approval_instances FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_approval_instances_update ON approval_instances;
CREATE POLICY p_approval_instances_update ON approval_instances FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_approval_instances_delete ON approval_instances;
CREATE POLICY p_approval_instances_delete ON approval_instances FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── approval_operations ──
DROP POLICY IF EXISTS p_approval_operations_select ON approval_operations;
CREATE POLICY p_approval_operations_select ON approval_operations FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_approval_operations_insert ON approval_operations;
CREATE POLICY p_approval_operations_insert ON approval_operations FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_approval_operations_update ON approval_operations;
CREATE POLICY p_approval_operations_update ON approval_operations FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_approval_operations_delete ON approval_operations;
CREATE POLICY p_approval_operations_delete ON approval_operations FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── approval_templates ──
DROP POLICY IF EXISTS p_approval_templates_select ON approval_templates;
CREATE POLICY p_approval_templates_select ON approval_templates FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_approval_templates_insert ON approval_templates;
CREATE POLICY p_approval_templates_insert ON approval_templates FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_approval_templates_update ON approval_templates;
CREATE POLICY p_approval_templates_update ON approval_templates FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_approval_templates_delete ON approval_templates;
CREATE POLICY p_approval_templates_delete ON approval_templates FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── assistant_conversations ──
DROP POLICY IF EXISTS p_assistant_conversations_select ON assistant_conversations;
CREATE POLICY p_assistant_conversations_select ON assistant_conversations FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_assistant_conversations_insert ON assistant_conversations;
CREATE POLICY p_assistant_conversations_insert ON assistant_conversations FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_assistant_conversations_update ON assistant_conversations;
CREATE POLICY p_assistant_conversations_update ON assistant_conversations FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_assistant_conversations_delete ON assistant_conversations;
CREATE POLICY p_assistant_conversations_delete ON assistant_conversations FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── calendar_events ──
DROP POLICY IF EXISTS p_calendar_events_select ON calendar_events;
CREATE POLICY p_calendar_events_select ON calendar_events FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_calendar_events_insert ON calendar_events;
CREATE POLICY p_calendar_events_insert ON calendar_events FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_calendar_events_update ON calendar_events;
CREATE POLICY p_calendar_events_update ON calendar_events FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_calendar_events_delete ON calendar_events;
CREATE POLICY p_calendar_events_delete ON calendar_events FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── contact_groups ──
DROP POLICY IF EXISTS p_contact_groups_select ON contact_groups;
CREATE POLICY p_contact_groups_select ON contact_groups FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_contact_groups_insert ON contact_groups;
CREATE POLICY p_contact_groups_insert ON contact_groups FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_contact_groups_update ON contact_groups;
CREATE POLICY p_contact_groups_update ON contact_groups FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_contact_groups_delete ON contact_groups;
CREATE POLICY p_contact_groups_delete ON contact_groups FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── contacts ──
DROP POLICY IF EXISTS p_contacts_select ON contacts;
CREATE POLICY p_contacts_select ON contacts FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_contacts_insert ON contacts;
CREATE POLICY p_contacts_insert ON contacts FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_contacts_update ON contacts;
CREATE POLICY p_contacts_update ON contacts FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_contacts_delete ON contacts;
CREATE POLICY p_contacts_delete ON contacts FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── databases ──
DROP POLICY IF EXISTS p_databases_select ON databases;
CREATE POLICY p_databases_select ON databases FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_databases_insert ON databases;
CREATE POLICY p_databases_insert ON databases FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_databases_update ON databases;
CREATE POLICY p_databases_update ON databases FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_databases_delete ON databases;
CREATE POLICY p_databases_delete ON databases FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── document_comments ──
DROP POLICY IF EXISTS p_document_comments_select ON document_comments;
CREATE POLICY p_document_comments_select ON document_comments FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_document_comments_insert ON document_comments;
CREATE POLICY p_document_comments_insert ON document_comments FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_document_comments_update ON document_comments;
CREATE POLICY p_document_comments_update ON document_comments FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_document_comments_delete ON document_comments;
CREATE POLICY p_document_comments_delete ON document_comments FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── document_permissions ──
DROP POLICY IF EXISTS p_document_permissions_select ON document_permissions;
CREATE POLICY p_document_permissions_select ON document_permissions FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_document_permissions_insert ON document_permissions;
CREATE POLICY p_document_permissions_insert ON document_permissions FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_document_permissions_update ON document_permissions;
CREATE POLICY p_document_permissions_update ON document_permissions FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_document_permissions_delete ON document_permissions;
CREATE POLICY p_document_permissions_delete ON document_permissions FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── document_versions ──
DROP POLICY IF EXISTS p_document_versions_select ON document_versions;
CREATE POLICY p_document_versions_select ON document_versions FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_document_versions_insert ON document_versions;
CREATE POLICY p_document_versions_insert ON document_versions FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_document_versions_update ON document_versions;
CREATE POLICY p_document_versions_update ON document_versions FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_document_versions_delete ON document_versions;
CREATE POLICY p_document_versions_delete ON document_versions FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── email_accounts ──
DROP POLICY IF EXISTS p_email_accounts_select ON email_accounts;
CREATE POLICY p_email_accounts_select ON email_accounts FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_email_accounts_insert ON email_accounts;
CREATE POLICY p_email_accounts_insert ON email_accounts FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_email_accounts_update ON email_accounts;
CREATE POLICY p_email_accounts_update ON email_accounts FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_email_accounts_delete ON email_accounts;
CREATE POLICY p_email_accounts_delete ON email_accounts FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── favorites ──
DROP POLICY IF EXISTS p_favorites_select ON favorites;
CREATE POLICY p_favorites_select ON favorites FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_favorites_insert ON favorites;
CREATE POLICY p_favorites_insert ON favorites FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_favorites_update ON favorites;
CREATE POLICY p_favorites_update ON favorites FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_favorites_delete ON favorites;
CREATE POLICY p_favorites_delete ON favorites FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── file_assets ──
DROP POLICY IF EXISTS p_file_assets_select ON file_assets;
CREATE POLICY p_file_assets_select ON file_assets FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_file_assets_insert ON file_assets;
CREATE POLICY p_file_assets_insert ON file_assets FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_file_assets_update ON file_assets;
CREATE POLICY p_file_assets_update ON file_assets FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_file_assets_delete ON file_assets;
CREATE POLICY p_file_assets_delete ON file_assets FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── folder_permissions ──
DROP POLICY IF EXISTS p_folder_permissions_select ON folder_permissions;
CREATE POLICY p_folder_permissions_select ON folder_permissions FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_folder_permissions_insert ON folder_permissions;
CREATE POLICY p_folder_permissions_insert ON folder_permissions FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_folder_permissions_update ON folder_permissions;
CREATE POLICY p_folder_permissions_update ON folder_permissions FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_folder_permissions_delete ON folder_permissions;
CREATE POLICY p_folder_permissions_delete ON folder_permissions FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── folders ──
DROP POLICY IF EXISTS p_folders_select ON folders;
CREATE POLICY p_folders_select ON folders FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_folders_insert ON folders;
CREATE POLICY p_folders_insert ON folders FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_folders_update ON folders;
CREATE POLICY p_folders_update ON folders FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_folders_delete ON folders;
CREATE POLICY p_folders_delete ON folders FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── forms ──
DROP POLICY IF EXISTS p_forms_select ON forms;
CREATE POLICY p_forms_select ON forms FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_forms_insert ON forms;
CREATE POLICY p_forms_insert ON forms FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_forms_update ON forms;
CREATE POLICY p_forms_update ON forms FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_forms_delete ON forms;
CREATE POLICY p_forms_delete ON forms FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── form_submissions ──
DROP POLICY IF EXISTS p_form_submissions_select ON form_submissions;
CREATE POLICY p_form_submissions_select ON form_submissions FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_form_submissions_insert ON form_submissions;
CREATE POLICY p_form_submissions_insert ON form_submissions FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_form_submissions_update ON form_submissions;
CREATE POLICY p_form_submissions_update ON form_submissions FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_form_submissions_delete ON form_submissions;
CREATE POLICY p_form_submissions_delete ON form_submissions FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── knowledge_edges ──
DROP POLICY IF EXISTS p_knowledge_edges_select ON knowledge_edges;
CREATE POLICY p_knowledge_edges_select ON knowledge_edges FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_knowledge_edges_insert ON knowledge_edges;
CREATE POLICY p_knowledge_edges_insert ON knowledge_edges FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_knowledge_edges_update ON knowledge_edges;
CREATE POLICY p_knowledge_edges_update ON knowledge_edges FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_knowledge_edges_delete ON knowledge_edges;
CREATE POLICY p_knowledge_edges_delete ON knowledge_edges FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── knowledge_nodes ──
DROP POLICY IF EXISTS p_knowledge_nodes_select ON knowledge_nodes;
CREATE POLICY p_knowledge_nodes_select ON knowledge_nodes FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_knowledge_nodes_insert ON knowledge_nodes;
CREATE POLICY p_knowledge_nodes_insert ON knowledge_nodes FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_knowledge_nodes_update ON knowledge_nodes;
CREATE POLICY p_knowledge_nodes_update ON knowledge_nodes FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_knowledge_nodes_delete ON knowledge_nodes;
CREATE POLICY p_knowledge_nodes_delete ON knowledge_nodes FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── mails ──
DROP POLICY IF EXISTS p_mails_select ON mails;
CREATE POLICY p_mails_select ON mails FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_mails_insert ON mails;
CREATE POLICY p_mails_insert ON mails FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_mails_update ON mails;
CREATE POLICY p_mails_update ON mails FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_mails_delete ON mails;
CREATE POLICY p_mails_delete ON mails FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── meeting_minutes ──
DROP POLICY IF EXISTS p_meeting_minutes_select ON meeting_minutes;
CREATE POLICY p_meeting_minutes_select ON meeting_minutes FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_meeting_minutes_insert ON meeting_minutes;
CREATE POLICY p_meeting_minutes_insert ON meeting_minutes FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_meeting_minutes_update ON meeting_minutes;
CREATE POLICY p_meeting_minutes_update ON meeting_minutes FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_meeting_minutes_delete ON meeting_minutes;
CREATE POLICY p_meeting_minutes_delete ON meeting_minutes FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── meetings ──
DROP POLICY IF EXISTS p_meetings_select ON meetings;
CREATE POLICY p_meetings_select ON meetings FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_meetings_insert ON meetings;
CREATE POLICY p_meetings_insert ON meetings FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_meetings_update ON meetings;
CREATE POLICY p_meetings_update ON meetings FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_meetings_delete ON meetings;
CREATE POLICY p_meetings_delete ON meetings FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── member_permissions ──
DROP POLICY IF EXISTS p_member_permissions_select ON member_permissions;
CREATE POLICY p_member_permissions_select ON member_permissions FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_member_permissions_insert ON member_permissions;
CREATE POLICY p_member_permissions_insert ON member_permissions FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_member_permissions_update ON member_permissions;
CREATE POLICY p_member_permissions_update ON member_permissions FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_member_permissions_delete ON member_permissions;
CREATE POLICY p_member_permissions_delete ON member_permissions FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── objectives ──
DROP POLICY IF EXISTS p_objectives_select ON objectives;
CREATE POLICY p_objectives_select ON objectives FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_objectives_insert ON objectives;
CREATE POLICY p_objectives_insert ON objectives FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_objectives_update ON objectives;
CREATE POLICY p_objectives_update ON objectives FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_objectives_delete ON objectives;
CREATE POLICY p_objectives_delete ON objectives FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── permission_audit_logs ──
DROP POLICY IF EXISTS p_permission_audit_logs_select ON permission_audit_logs;
CREATE POLICY p_permission_audit_logs_select ON permission_audit_logs FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_permission_audit_logs_insert ON permission_audit_logs;
CREATE POLICY p_permission_audit_logs_insert ON permission_audit_logs FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_permission_audit_logs_update ON permission_audit_logs;
CREATE POLICY p_permission_audit_logs_update ON permission_audit_logs FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_permission_audit_logs_delete ON permission_audit_logs;
CREATE POLICY p_permission_audit_logs_delete ON permission_audit_logs FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── project_templates ──
DROP POLICY IF EXISTS p_project_templates_select ON project_templates;
CREATE POLICY p_project_templates_select ON project_templates FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_project_templates_insert ON project_templates;
CREATE POLICY p_project_templates_insert ON project_templates FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_project_templates_update ON project_templates;
CREATE POLICY p_project_templates_update ON project_templates FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_project_templates_delete ON project_templates;
CREATE POLICY p_project_templates_delete ON project_templates FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── remote_control_sessions ──
DROP POLICY IF EXISTS p_remote_control_sessions_select ON remote_control_sessions;
CREATE POLICY p_remote_control_sessions_select ON remote_control_sessions FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_remote_control_sessions_insert ON remote_control_sessions;
CREATE POLICY p_remote_control_sessions_insert ON remote_control_sessions FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_remote_control_sessions_update ON remote_control_sessions;
CREATE POLICY p_remote_control_sessions_update ON remote_control_sessions FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_remote_control_sessions_delete ON remote_control_sessions;
CREATE POLICY p_remote_control_sessions_delete ON remote_control_sessions FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── share_link_permissions ──
DROP POLICY IF EXISTS p_share_link_permissions_select ON share_link_permissions;
CREATE POLICY p_share_link_permissions_select ON share_link_permissions FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_share_link_permissions_insert ON share_link_permissions;
CREATE POLICY p_share_link_permissions_insert ON share_link_permissions FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_share_link_permissions_update ON share_link_permissions;
CREATE POLICY p_share_link_permissions_update ON share_link_permissions FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_share_link_permissions_delete ON share_link_permissions;
CREATE POLICY p_share_link_permissions_delete ON share_link_permissions FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── spaces ──
DROP POLICY IF EXISTS p_spaces_select ON spaces;
CREATE POLICY p_spaces_select ON spaces FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_spaces_insert ON spaces;
CREATE POLICY p_spaces_insert ON spaces FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_spaces_update ON spaces;
CREATE POLICY p_spaces_update ON spaces FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_spaces_delete ON spaces;
CREATE POLICY p_spaces_delete ON spaces FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── time_entries ──
DROP POLICY IF EXISTS p_time_entries_select ON time_entries;
CREATE POLICY p_time_entries_select ON time_entries FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_time_entries_insert ON time_entries;
CREATE POLICY p_time_entries_insert ON time_entries FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_time_entries_update ON time_entries;
CREATE POLICY p_time_entries_update ON time_entries FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_time_entries_delete ON time_entries;
CREATE POLICY p_time_entries_delete ON time_entries FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── user_dashboard_prefs ──
DROP POLICY IF EXISTS p_user_dashboard_prefs_select ON user_dashboard_prefs;
CREATE POLICY p_user_dashboard_prefs_select ON user_dashboard_prefs FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_user_dashboard_prefs_insert ON user_dashboard_prefs;
CREATE POLICY p_user_dashboard_prefs_insert ON user_dashboard_prefs FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_user_dashboard_prefs_update ON user_dashboard_prefs;
CREATE POLICY p_user_dashboard_prefs_update ON user_dashboard_prefs FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_user_dashboard_prefs_delete ON user_dashboard_prefs;
CREATE POLICY p_user_dashboard_prefs_delete ON user_dashboard_prefs FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── whiteboards ──
DROP POLICY IF EXISTS p_whiteboards_select ON whiteboards;
CREATE POLICY p_whiteboards_select ON whiteboards FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_whiteboards_insert ON whiteboards;
CREATE POLICY p_whiteboards_insert ON whiteboards FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_whiteboards_update ON whiteboards;
CREATE POLICY p_whiteboards_update ON whiteboards FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_whiteboards_delete ON whiteboards;
CREATE POLICY p_whiteboards_delete ON whiteboards FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── wiki_pages ──
DROP POLICY IF EXISTS p_wiki_pages_select ON wiki_pages;
CREATE POLICY p_wiki_pages_select ON wiki_pages FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_wiki_pages_insert ON wiki_pages;
CREATE POLICY p_wiki_pages_insert ON wiki_pages FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_wiki_pages_update ON wiki_pages;
CREATE POLICY p_wiki_pages_update ON wiki_pages FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_wiki_pages_delete ON wiki_pages;
CREATE POLICY p_wiki_pages_delete ON wiki_pages FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── workflows ──
DROP POLICY IF EXISTS p_workflows_select ON workflows;
CREATE POLICY p_workflows_select ON workflows FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_workflows_insert ON workflows;
CREATE POLICY p_workflows_insert ON workflows FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_workflows_update ON workflows;
CREATE POLICY p_workflows_update ON workflows FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_workflows_delete ON workflows;
CREATE POLICY p_workflows_delete ON workflows FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

-- ── workflow_executions ──
DROP POLICY IF EXISTS p_workflow_executions_select ON workflow_executions;
CREATE POLICY p_workflow_executions_select ON workflow_executions FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_workflow_executions_insert ON workflow_executions;
CREATE POLICY p_workflow_executions_insert ON workflow_executions FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_workflow_executions_update ON workflow_executions;
CREATE POLICY p_workflow_executions_update ON workflow_executions FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_workflow_executions_delete ON workflow_executions;
CREATE POLICY p_workflow_executions_delete ON workflow_executions FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
