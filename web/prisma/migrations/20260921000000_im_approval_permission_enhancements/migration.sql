-- ─── IM: Conversation 新增字段 ─────────────────────────────────────────────
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS task_id UUID;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'manual';
CREATE INDEX IF NOT EXISTS conversations_task_id_idx ON conversations(task_id);

-- ─── IM: ConversationMember 新增字段 ──────────────────────────────────────
ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS invited_by UUID;

-- ─── Approval: ApprovalTemplate 新增字段 ──────────────────────────────────
ALTER TABLE approval_templates ADD COLUMN IF NOT EXISTS flow_type VARCHAR(20) DEFAULT 'sequential';
ALTER TABLE approval_templates ADD COLUMN IF NOT EXISTS form_schema JSONB;
ALTER TABLE approval_templates ADD COLUMN IF NOT EXISTS icon VARCHAR(50) DEFAULT 'file-check';
ALTER TABLE approval_templates ADD COLUMN IF NOT EXISTS category VARCHAR(50);
ALTER TABLE approval_templates ADD COLUMN IF NOT EXISTS is_builtin BOOLEAN DEFAULT false;
CREATE INDEX IF NOT EXISTS approval_templates_workspace_id_category_idx ON approval_templates(workspace_id, category);

-- ─── Approval: ApprovalInstance 新增字段 ──────────────────────────────────
ALTER TABLE approval_instances ADD COLUMN IF NOT EXISTS active_node_ids TEXT[] DEFAULT '{}';
ALTER TABLE approval_instances ADD COLUMN IF NOT EXISTS condition_cache JSONB;
ALTER TABLE approval_instances ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'normal';
ALTER TABLE approval_instances ADD COLUMN IF NOT EXISTS expected_at TIMESTAMPTZ;
ALTER TABLE approval_instances ADD COLUMN IF NOT EXISTS entity_type VARCHAR(20);
ALTER TABLE approval_instances ADD COLUMN IF NOT EXISTS entity_id UUID;
CREATE INDEX IF NOT EXISTS approval_instances_workspace_id_priority_status_idx ON approval_instances(workspace_id, priority, status);

-- ─── Approval: ApprovalOperation 新增字段 ─────────────────────────────────
ALTER TABLE approval_operations ADD COLUMN IF NOT EXISTS node_id VARCHAR(100);
ALTER TABLE approval_operations ADD COLUMN IF NOT EXISTS add_sign_to_id UUID;
ALTER TABLE approval_operations ADD COLUMN IF NOT EXISTS delegate_to_id UUID;
CREATE INDEX IF NOT EXISTS approval_operations_instance_id_node_id_idx ON approval_operations(instance_id, node_id);

-- ─── Approval: 新表 ApprovalCcRecord ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS approval_cc_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID NOT NULL REFERENCES approval_instances(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  node_index INTEGER NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(instance_id, user_id, node_index)
);
CREATE INDEX IF NOT EXISTS approval_cc_records_user_id_read_at_idx ON approval_cc_records(user_id, read_at);

-- ─── Approval: 新表 ApprovalDelegate ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS approval_delegates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  delegator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delegate_to_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  reason TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, delegator_id, start_at)
);
CREATE INDEX IF NOT EXISTS approval_delegates_delegate_to_id_active_idx ON approval_delegates(delegate_to_id, active);

-- ─── Permission: DocumentPermission 新增字段 ───────────────────────────────
ALTER TABLE document_permissions ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'explicit';
ALTER TABLE document_permissions ADD COLUMN IF NOT EXISTS inherited_from_id UUID;
ALTER TABLE document_permissions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS document_permissions_workspace_id_grantee_type_grantee_id_idx ON document_permissions(workspace_id, grantee_type, grantee_id);

-- ─── Permission: 新表 FolderPermission ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS folder_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  target_type VARCHAR(10) NOT NULL,
  target_id UUID NOT NULL,
  grantee_type VARCHAR(20) NOT NULL,
  grantee_id VARCHAR(100) NOT NULL,
  permission VARCHAR(20) NOT NULL,
  granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  inheritable BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(target_type, target_id, grantee_type, grantee_id)
);
CREATE INDEX IF NOT EXISTS folder_permissions_target_type_target_id_idx ON folder_permissions(target_type, target_id);
CREATE INDEX IF NOT EXISTS folder_permissions_workspace_id_grantee_type_grantee_id_idx ON folder_permissions(workspace_id, grantee_type, grantee_id);

-- ─── Permission: 新表 ShareLinkPermission ──────────────────────────────────
CREATE TABLE IF NOT EXISTS share_link_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  share_token VARCHAR(64) NOT NULL UNIQUE,
  permission VARCHAR(20) DEFAULT 'view',
  allow_download BOOLEAN DEFAULT false,
  allow_print BOOLEAN DEFAULT false,
  allow_copy BOOLEAN DEFAULT true,
  password_hash VARCHAR(100),
  expires_at TIMESTAMPTZ,
  max_views INTEGER,
  view_count INTEGER DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS share_link_permissions_document_id_idx ON share_link_permissions(document_id);

-- ─── Permission: 新表 PermissionAuditLog ───────────────────────────────────
CREATE TABLE IF NOT EXISTS permission_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  action VARCHAR(20) NOT NULL,
  target_type VARCHAR(20) NOT NULL,
  target_id UUID NOT NULL,
  grantee_type VARCHAR(20) NOT NULL,
  grantee_id VARCHAR(100) NOT NULL,
  old_permission VARCHAR(20),
  new_permission VARCHAR(20),
  operator_id UUID NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS permission_audit_logs_target_type_target_id_created_at_idx ON permission_audit_logs(target_type, target_id, created_at);
CREATE INDEX IF NOT EXISTS permission_audit_logs_workspace_id_grantee_type_grantee_id_idx ON permission_audit_logs(workspace_id, grantee_type, grantee_id);