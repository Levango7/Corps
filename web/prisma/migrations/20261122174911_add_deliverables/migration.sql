/*
  Warnings:

  - You are about to drop the column `body_tsv` on the `messages` table. All the data in the column will be lost.
  - You are about to drop the column `content_tsv` on the `wiki_pages` table. All the data in the column will be lost.
  - Made the column `active` on table `approval_delegates` required. This step will fail if there are existing NULL values in that column.
  - Made the column `priority` on table `approval_instances` required. This step will fail if there are existing NULL values in that column.
  - Made the column `flow_type` on table `approval_templates` required. This step will fail if there are existing NULL values in that column.
  - Made the column `icon` on table `approval_templates` required. This step will fail if there are existing NULL values in that column.
  - Made the column `is_builtin` on table `approval_templates` required. This step will fail if there are existing NULL values in that column.
  - Made the column `source` on table `conversations` required. This step will fail if there are existing NULL values in that column.
  - Made the column `source` on table `document_permissions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `inheritable` on table `folder_permissions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `user_id` on table `push_subscriptions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `p256dh_key` on table `push_subscriptions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `auth_key` on table `push_subscriptions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `created_at` on table `push_subscriptions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `updated_at` on table `push_subscriptions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `permission` on table `share_link_permissions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `allow_download` on table `share_link_permissions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `allow_print` on table `share_link_permissions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `allow_copy` on table `share_link_permissions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `view_count` on table `share_link_permissions` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_user_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_agent_messages" DROP CONSTRAINT "ai_agent_messages_from_agent_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_agent_messages" DROP CONSTRAINT "ai_agent_messages_to_agent_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_agent_messages" DROP CONSTRAINT "ai_agent_messages_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_agents" DROP CONSTRAINT "ai_agents_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_analysis_reports" DROP CONSTRAINT "ai_analysis_reports_user_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_analysis_reports" DROP CONSTRAINT "ai_analysis_reports_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_meeting_action_items" DROP CONSTRAINT "ai_meeting_action_items_session_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_meeting_action_items" DROP CONSTRAINT "ai_meeting_action_items_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_meeting_decisions" DROP CONSTRAINT "ai_meeting_decisions_session_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_meeting_decisions" DROP CONSTRAINT "ai_meeting_decisions_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_meeting_sessions" DROP CONSTRAINT "ai_meeting_sessions_user_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_meeting_sessions" DROP CONSTRAINT "ai_meeting_sessions_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_personalizations" DROP CONSTRAINT "ai_personalizations_user_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_personalizations" DROP CONSTRAINT "ai_personalizations_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_push_records" DROP CONSTRAINT "ai_push_records_schedule_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_push_records" DROP CONSTRAINT "ai_push_records_user_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_push_records" DROP CONSTRAINT "ai_push_records_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_push_schedules" DROP CONSTRAINT "ai_push_schedules_user_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_push_schedules" DROP CONSTRAINT "ai_push_schedules_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_user_behaviors" DROP CONSTRAINT "ai_user_behaviors_user_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_user_behaviors" DROP CONSTRAINT "ai_user_behaviors_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_voice_commands" DROP CONSTRAINT "ai_voice_commands_user_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_voice_commands" DROP CONSTRAINT "ai_voice_commands_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_voice_preferences" DROP CONSTRAINT "ai_voice_preferences_user_id_fkey";

-- DropForeignKey
ALTER TABLE "ai_workflow_templates" DROP CONSTRAINT "ai_workflow_templates_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "analytics_events" DROP CONSTRAINT "analytics_events_user_id_fkey";

-- DropForeignKey
ALTER TABLE "analytics_events" DROP CONSTRAINT "analytics_events_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "approval_cc_records" DROP CONSTRAINT "approval_cc_records_instance_id_fkey";

-- DropForeignKey
ALTER TABLE "approval_cc_records" DROP CONSTRAINT "approval_cc_records_user_id_fkey";

-- DropForeignKey
ALTER TABLE "approval_cc_records" DROP CONSTRAINT "approval_cc_records_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "approval_delegates" DROP CONSTRAINT "approval_delegates_delegate_to_id_fkey";

-- DropForeignKey
ALTER TABLE "approval_delegates" DROP CONSTRAINT "approval_delegates_delegator_id_fkey";

-- DropForeignKey
ALTER TABLE "approval_delegates" DROP CONSTRAINT "approval_delegates_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "assistant_messages" DROP CONSTRAINT "assistant_messages_conversation_id_fkey";

-- DropForeignKey
ALTER TABLE "calendar_events" DROP CONSTRAINT "calendar_events_created_by_fkey";

-- DropForeignKey
ALTER TABLE "calendar_events" DROP CONSTRAINT "calendar_events_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "comments" DROP CONSTRAINT "comments_author_id_fkey";

-- DropForeignKey
ALTER TABLE "comments" DROP CONSTRAINT "comments_task_id_fkey";

-- DropForeignKey
ALTER TABLE "comments" DROP CONSTRAINT "comments_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "database_fields" DROP CONSTRAINT "database_fields_database_id_fkey";

-- DropForeignKey
ALTER TABLE "database_records" DROP CONSTRAINT "database_records_database_id_fkey";

-- DropForeignKey
ALTER TABLE "database_views" DROP CONSTRAINT "database_views_database_id_fkey";

-- DropForeignKey
ALTER TABLE "databases" DROP CONSTRAINT "databases_folder_id_fkey";

-- DropForeignKey
ALTER TABLE "databases" DROP CONSTRAINT "databases_space_id_fkey";

-- DropForeignKey
ALTER TABLE "databases" DROP CONSTRAINT "databases_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "decision_action_items" DROP CONSTRAINT "decision_action_items_assignee_id_fkey";

-- DropForeignKey
ALTER TABLE "decision_action_items" DROP CONSTRAINT "decision_action_items_decision_id_fkey";

-- DropForeignKey
ALTER TABLE "decision_action_items" DROP CONSTRAINT "decision_action_items_task_id_fkey";

-- DropForeignKey
ALTER TABLE "decision_versions" DROP CONSTRAINT "decision_versions_author_id_fkey";

-- DropForeignKey
ALTER TABLE "decision_versions" DROP CONSTRAINT "decision_versions_decision_id_fkey";

-- DropForeignKey
ALTER TABLE "decision_versions" DROP CONSTRAINT "decision_versions_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "decisions" DROP CONSTRAINT "decisions_author_id_fkey";

-- DropForeignKey
ALTER TABLE "decisions" DROP CONSTRAINT "decisions_task_id_fkey";

-- DropForeignKey
ALTER TABLE "decisions" DROP CONSTRAINT "decisions_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "document_comments" DROP CONSTRAINT "document_comments_author_id_fkey";

-- DropForeignKey
ALTER TABLE "document_comments" DROP CONSTRAINT "document_comments_document_id_fkey";

-- DropForeignKey
ALTER TABLE "document_comments" DROP CONSTRAINT "document_comments_parent_id_fkey";

-- DropForeignKey
ALTER TABLE "document_comments" DROP CONSTRAINT "document_comments_resolved_by_fkey";

-- DropForeignKey
ALTER TABLE "document_comments" DROP CONSTRAINT "document_comments_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "document_versions" DROP CONSTRAINT "document_versions_author_id_fkey";

-- DropForeignKey
ALTER TABLE "document_versions" DROP CONSTRAINT "document_versions_document_id_fkey";

-- DropForeignKey
ALTER TABLE "document_versions" DROP CONSTRAINT "document_versions_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "documents" DROP CONSTRAINT "documents_author_id_fkey";

-- DropForeignKey
ALTER TABLE "documents" DROP CONSTRAINT "documents_folder_id_fkey";

-- DropForeignKey
ALTER TABLE "documents" DROP CONSTRAINT "documents_space_id_fkey";

-- DropForeignKey
ALTER TABLE "documents" DROP CONSTRAINT "documents_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "email_accounts" DROP CONSTRAINT "email_accounts_user_id_fkey";

-- DropForeignKey
ALTER TABLE "email_accounts" DROP CONSTRAINT "email_accounts_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "favorites" DROP CONSTRAINT "favorites_user_id_fkey";

-- DropForeignKey
ALTER TABLE "favorites" DROP CONSTRAINT "favorites_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "file_assets" DROP CONSTRAINT "file_assets_folder_id_fkey";

-- DropForeignKey
ALTER TABLE "file_assets" DROP CONSTRAINT "file_assets_uploaded_by_fkey";

-- DropForeignKey
ALTER TABLE "file_assets" DROP CONSTRAINT "file_assets_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "file_versions" DROP CONSTRAINT "file_versions_file_asset_id_fkey";

-- DropForeignKey
ALTER TABLE "file_versions" DROP CONSTRAINT "file_versions_uploaded_by_fkey";

-- DropForeignKey
ALTER TABLE "folder_permissions" DROP CONSTRAINT "folder_permissions_granted_by_fkey";

-- DropForeignKey
ALTER TABLE "folder_permissions" DROP CONSTRAINT "folder_permissions_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "folders" DROP CONSTRAINT "folders_parent_id_fkey";

-- DropForeignKey
ALTER TABLE "folders" DROP CONSTRAINT "folders_space_id_fkey";

-- DropForeignKey
ALTER TABLE "folders" DROP CONSTRAINT "folders_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "invitations" DROP CONSTRAINT "invitations_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "knowledge_edges" DROP CONSTRAINT "knowledge_edges_source_node_id_fkey";

-- DropForeignKey
ALTER TABLE "knowledge_edges" DROP CONSTRAINT "knowledge_edges_target_node_id_fkey";

-- DropForeignKey
ALTER TABLE "knowledge_edges" DROP CONSTRAINT "knowledge_edges_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "knowledge_nodes" DROP CONSTRAINT "knowledge_nodes_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "mails" DROP CONSTRAINT "mails_account_id_fkey";

-- DropForeignKey
ALTER TABLE "mails" DROP CONSTRAINT "mails_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "member_permissions" DROP CONSTRAINT "member_permissions_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "members" DROP CONSTRAINT "members_user_id_fkey";

-- DropForeignKey
ALTER TABLE "members" DROP CONSTRAINT "members_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "message_attachments" DROP CONSTRAINT "message_attachments_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "notification_preferences" DROP CONSTRAINT "notification_preferences_user_id_fkey";

-- DropForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_user_id_fkey";

-- DropForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "permission_audit_logs" DROP CONSTRAINT "permission_audit_logs_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "push_subscriptions" DROP CONSTRAINT "push_subscriptions_user_id_fkey";

-- DropForeignKey
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_user_id_fkey";

-- DropForeignKey
ALTER TABLE "share_link_permissions" DROP CONSTRAINT "share_link_permissions_document_id_fkey";

-- DropForeignKey
ALTER TABLE "share_link_permissions" DROP CONSTRAINT "share_link_permissions_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "spaces" DROP CONSTRAINT "spaces_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_assignee_id_fkey";

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_created_by_fkey";

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_parent_id_fkey";

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "temporary_grants" DROP CONSTRAINT "temporary_grants_user_id_fkey";

-- DropForeignKey
ALTER TABLE "temporary_grants" DROP CONSTRAINT "temporary_grants_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "user_dashboard_prefs" DROP CONSTRAINT "user_dashboard_prefs_user_id_fkey";

-- DropForeignKey
ALTER TABLE "user_dashboard_prefs" DROP CONSTRAINT "user_dashboard_prefs_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "wiki_pages" DROP CONSTRAINT "wiki_pages_created_by_fkey";

-- DropForeignKey
ALTER TABLE "wiki_pages" DROP CONSTRAINT "wiki_pages_parent_id_fkey";

-- DropForeignKey
ALTER TABLE "wiki_pages" DROP CONSTRAINT "wiki_pages_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "workspaces" DROP CONSTRAINT "workspaces_owner_id_fkey";

-- DropForeignKey
ALTER TABLE "yjs_persistence" DROP CONSTRAINT "yjs_persistence_document_id_fkey";

-- DropIndex
DROP INDEX "comments_task_id_idx";

-- DropIndex
DROP INDEX "decisions_task_id_idx";

-- DropIndex
DROP INDEX "idx_decisions_markdown_trgm";

-- DropIndex
DROP INDEX "idx_documents_markdown_trgm";

-- DropIndex
DROP INDEX "idx_documents_published_markdown_trgm";

-- DropIndex
DROP INDEX "idx_messages_body_trgm";

-- DropIndex
DROP INDEX "messages_body_tsv_idx";

-- DropIndex
DROP INDEX "sessions_user_id_idx";

-- DropIndex
DROP INDEX "idx_tasks_description_trgm";

-- DropIndex
DROP INDEX "idx_tasks_title_trgm";

-- DropIndex
DROP INDEX "wiki_pages_content_tsv_idx";

-- AlterTable
ALTER TABLE "accounts" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "issuer" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ai_agent_messages" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ai_agents" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ai_analysis_reports" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ai_meeting_action_items" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ai_meeting_decisions" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ai_meeting_sessions" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ai_personalizations" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ai_push_records" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ai_push_schedules" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ai_user_behaviors" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ai_voice_commands" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ai_voice_preferences" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ai_workflow_templates" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "analytics_events" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "props" SET DATA TYPE JSONB;

-- AlterTable
ALTER TABLE "announcements" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "approval_cc_records" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "approval_delegates" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "active" SET NOT NULL;

-- AlterTable
ALTER TABLE "approval_instances" ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "priority" SET NOT NULL;

-- AlterTable
ALTER TABLE "approval_templates" ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "flow_type" SET NOT NULL,
ALTER COLUMN "icon" SET NOT NULL,
ALTER COLUMN "is_builtin" SET NOT NULL;

-- AlterTable
ALTER TABLE "assistant_conversations" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "assistant_messages" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "calendar_events" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "comments" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "contacts" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "conversations" ALTER COLUMN "source" SET NOT NULL;

-- AlterTable
ALTER TABLE "database_fields" ALTER COLUMN "options" SET DATA TYPE JSONB;

-- AlterTable
ALTER TABLE "database_records" ALTER COLUMN "data" SET DATA TYPE JSONB,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "database_views" ALTER COLUMN "config" SET DATA TYPE JSONB;

-- AlterTable
ALTER TABLE "databases" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "decision_action_items" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "decision_versions" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "decisions" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "document_comments" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "document_permissions" ALTER COLUMN "grantee_id" SET DATA TYPE VARCHAR(100),
ALTER COLUMN "source" SET NOT NULL;

-- AlterTable
ALTER TABLE "document_versions" ALTER COLUMN "content_full" SET DATA TYPE JSONB;

-- AlterTable
ALTER TABLE "documents" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "email_accounts" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "favorites" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "file_assets" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "folder_permissions" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "inheritable" SET NOT NULL,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "folders" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "forms" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "invitations" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "key_results" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "knowledge_edges" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "knowledge_nodes" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "mails" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "meeting_minutes" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "meetings" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "member_permissions" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "messages" DROP COLUMN "body_tsv";

-- AlterTable
ALTER TABLE "notification_preferences" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "notifications" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "objectives" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "permission_audit_logs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "project_templates" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "push_subscriptions" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "user_id" SET NOT NULL,
ALTER COLUMN "p256dh_key" SET NOT NULL,
ALTER COLUMN "auth_key" SET NOT NULL,
ALTER COLUMN "created_at" SET NOT NULL,
ALTER COLUMN "updated_at" SET NOT NULL,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "remote_control_sessions" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "sessions" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "share_link_permissions" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "permission" SET NOT NULL,
ALTER COLUMN "allow_download" SET NOT NULL,
ALTER COLUMN "allow_print" SET NOT NULL,
ALTER COLUMN "allow_copy" SET NOT NULL,
ALTER COLUMN "view_count" SET NOT NULL;

-- AlterTable
ALTER TABLE "spaces" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "subscriptions" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "tasks" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "user_dashboard_prefs" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "verifications" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "whiteboards" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "wiki_pages" DROP COLUMN "content_tsv",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "workflows" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "workspaces" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "yjs_persistence" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "deliverables" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "task_id" VARCHAR(64) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "pipeline" VARCHAR(50) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'running',
    "output_path" VARCHAR(500),
    "output_summary" TEXT,
    "size_bytes" INTEGER,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "deliverables_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deliverables_workspace_id_status_idx" ON "deliverables"("workspace_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "deliverables_workspace_id_task_id_key" ON "deliverables"("workspace_id", "task_id");

-- CreateIndex
CREATE INDEX "analytics_events_workspace_id_name_created_at_idx" ON "analytics_events"("workspace_id", "name", "created_at");

-- CreateIndex
CREATE INDEX "comments_task_id_created_at_idx" ON "comments"("task_id", "created_at");

-- CreateIndex
CREATE INDEX "conversation_members_conversation_id_idx" ON "conversation_members"("conversation_id");

-- CreateIndex
CREATE INDEX "decisions_task_id_version_idx" ON "decisions"("task_id", "version");

-- CreateIndex
CREATE INDEX "notifications_workspace_id_created_at_idx" ON "notifications"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_workspace_id_read_created_at_idx" ON "notifications"("workspace_id", "read", "created_at");

-- CreateIndex
CREATE INDEX "sessions_user_id_expires_at_idx" ON "sessions"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "tasks_workspace_id_assignee_id_idx" ON "tasks"("workspace_id", "assignee_id");

-- CreateIndex
CREATE INDEX "tasks_workspace_id_sort_order_idx" ON "tasks"("workspace_id", "sort_order");

-- CreateIndex
CREATE INDEX "tasks_workspace_id_status_sort_order_idx" ON "tasks"("workspace_id", "status", "sort_order");

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_versions" ADD CONSTRAINT "decision_versions_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_versions" ADD CONSTRAINT "decision_versions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_versions" ADD CONSTRAINT "decision_versions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_action_items" ADD CONSTRAINT "decision_action_items_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_action_items" ADD CONSTRAINT "decision_action_items_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_action_items" ADD CONSTRAINT "decision_action_items_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_permissions" ADD CONSTRAINT "member_permissions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_dashboard_prefs" ADD CONSTRAINT "user_dashboard_prefs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_dashboard_prefs" ADD CONSTRAINT "user_dashboard_prefs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temporary_grants" ADD CONSTRAINT "temporary_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temporary_grants" ADD CONSTRAINT "temporary_grants_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folders" ADD CONSTRAINT "folders_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folders" ADD CONSTRAINT "folders_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folders" ADD CONSTRAINT "folders_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_comments" ADD CONSTRAINT "document_comments_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_comments" ADD CONSTRAINT "document_comments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_comments" ADD CONSTRAINT "document_comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "document_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_comments" ADD CONSTRAINT "document_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_comments" ADD CONSTRAINT "document_comments_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yjs_persistence" ADD CONSTRAINT "yjs_persistence_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "databases" ADD CONSTRAINT "databases_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "databases" ADD CONSTRAINT "databases_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "databases" ADD CONSTRAINT "databases_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_fields" ADD CONSTRAINT "database_fields_database_id_fkey" FOREIGN KEY ("database_id") REFERENCES "databases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_records" ADD CONSTRAINT "database_records_database_id_fkey" FOREIGN KEY ("database_id") REFERENCES "databases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_views" ADD CONSTRAINT "database_views_database_id_fkey" FOREIGN KEY ("database_id") REFERENCES "databases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_file_asset_id_fkey" FOREIGN KEY ("file_asset_id") REFERENCES "file_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_operations" ADD CONSTRAINT "approval_operations_add_sign_to_id_fkey" FOREIGN KEY ("add_sign_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_operations" ADD CONSTRAINT "approval_operations_delegate_to_id_fkey" FOREIGN KEY ("delegate_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_cc_records" ADD CONSTRAINT "approval_cc_records_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "approval_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_cc_records" ADD CONSTRAINT "approval_cc_records_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_cc_records" ADD CONSTRAINT "approval_cc_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_delegates" ADD CONSTRAINT "approval_delegates_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_delegates" ADD CONSTRAINT "approval_delegates_delegator_id_fkey" FOREIGN KEY ("delegator_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_delegates" ADD CONSTRAINT "approval_delegates_delegate_to_id_fkey" FOREIGN KEY ("delegate_to_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folder_permissions" ADD CONSTRAINT "folder_permissions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folder_permissions" ADD CONSTRAINT "folder_permissions_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_link_permissions" ADD CONSTRAINT "share_link_permissions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_link_permissions" ADD CONSTRAINT "share_link_permissions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_audit_logs" ADD CONSTRAINT "permission_audit_logs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "wiki_pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_push_schedules" ADD CONSTRAINT "ai_push_schedules_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_push_schedules" ADD CONSTRAINT "ai_push_schedules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_push_records" ADD CONSTRAINT "ai_push_records_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "ai_push_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_push_records" ADD CONSTRAINT "ai_push_records_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_push_records" ADD CONSTRAINT "ai_push_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_nodes" ADD CONSTRAINT "knowledge_nodes_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_source_node_id_fkey" FOREIGN KEY ("source_node_id") REFERENCES "knowledge_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_target_node_id_fkey" FOREIGN KEY ("target_node_id") REFERENCES "knowledge_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_analysis_reports" ADD CONSTRAINT "ai_analysis_reports_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_analysis_reports" ADD CONSTRAINT "ai_analysis_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_messages" ADD CONSTRAINT "ai_agent_messages_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_messages" ADD CONSTRAINT "ai_agent_messages_from_agent_id_fkey" FOREIGN KEY ("from_agent_id") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_messages" ADD CONSTRAINT "ai_agent_messages_to_agent_id_fkey" FOREIGN KEY ("to_agent_id") REFERENCES "ai_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_workflow_templates" ADD CONSTRAINT "ai_workflow_templates_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_user_behaviors" ADD CONSTRAINT "ai_user_behaviors_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_user_behaviors" ADD CONSTRAINT "ai_user_behaviors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_personalizations" ADD CONSTRAINT "ai_personalizations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_personalizations" ADD CONSTRAINT "ai_personalizations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_meeting_sessions" ADD CONSTRAINT "ai_meeting_sessions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_meeting_sessions" ADD CONSTRAINT "ai_meeting_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_meeting_action_items" ADD CONSTRAINT "ai_meeting_action_items_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "ai_meeting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_meeting_action_items" ADD CONSTRAINT "ai_meeting_action_items_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_meeting_decisions" ADD CONSTRAINT "ai_meeting_decisions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "ai_meeting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_meeting_decisions" ADD CONSTRAINT "ai_meeting_decisions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_voice_commands" ADD CONSTRAINT "ai_voice_commands_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_voice_commands" ADD CONSTRAINT "ai_voice_commands_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_voice_preferences" ADD CONSTRAINT "ai_voice_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_accounts" ADD CONSTRAINT "email_accounts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_accounts" ADD CONSTRAINT "email_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mails" ADD CONSTRAINT "mails_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mails" ADD CONSTRAINT "mails_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "email_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "assistant_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "uq_chat_presences_conversation_user" RENAME TO "chat_presences_conversation_id_user_id_key";

-- RenameIndex
ALTER INDEX "uq_chat_presences_task_user" RENAME TO "chat_presences_task_id_user_id_key";

-- RenameIndex
ALTER INDEX "uq_doc_versions_doc_version" RENAME TO "document_versions_document_id_version_key";

-- RenameIndex
ALTER INDEX "FileAsset_workspaceId_sha256_key" RENAME TO "file_assets_workspace_id_sha256_key";

-- RenameIndex
ALTER INDEX "uq_member_perm" RENAME TO "member_permissions_workspace_id_role_module_key";

-- RenameIndex
ALTER INDEX "uq_spaces_workspace_name" RENAME TO "spaces_workspace_id_name_key";
