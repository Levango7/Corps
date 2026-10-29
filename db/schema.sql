-- corps 数据库 schema（由 pg_dump --schema-only 生成 + RLS 层来自 rls-activate.sql）
-- 生成时间: 2026-10-27（pg_dump 18.6，--no-owner --no-privileges --no-policies；
--   按 docs/audit/MATURITY-2026Q4-BATCH2.md §3 的增量拼接口径补行，
--   新增行与 pg_dump 对已迁移库的产物逐字相同）
-- 对应迁移: 20261028000000_add_decision_reviewed_at（100 表，含 2026-09-04 后新增的 73 张表）
-- 表结构权威 = web/prisma/schema.prisma + web/prisma/migrations/；
-- RLS 权威 = 下方 rls-activate.sql（entrypoint 实际执行的就是它，守卫测试亦以它为准）。
--
-- PostgreSQL database dump
--

\restrict hnIhb0c8aofcsgw03uvnsIZK6f9sIGcMgpeDZQtdnCaBnKdWX7jhFdFllcjJ4O0

-- Dumped from database version 18.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: app; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA app;


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: get_workspace_id(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.get_workspace_id() RETURNS uuid
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN current_setting('app.workspace_id', true)::uuid;
EXCEPTION WHEN others THEN RETURN NULL;
END;
$$;


--
-- Name: set_workspace_id(uuid); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.set_workspace_id(wid uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  SET LOCAL app.workspace_id = wid;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


--
-- Name: accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id text NOT NULL,
    provider_id text NOT NULL,
    user_id uuid NOT NULL,
    access_token text,
    refresh_token text,
    id_token text,
    access_token_expires_at timestamp with time zone,
    refresh_token_expires_at timestamp with time zone,
    scope text,
    password text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    issuer text DEFAULT 'local:credential'::text
);


--
-- Name: ai_agent_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_agent_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    from_agent_id uuid NOT NULL,
    to_agent_id uuid,
    content text NOT NULL,
    type character varying(50) NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.ai_agent_messages FORCE ROW LEVEL SECURITY;


--
-- Name: ai_agents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_agents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    role character varying(50) NOT NULL,
    capabilities jsonb NOT NULL,
    system_prompt text NOT NULL,
    model character varying(50) NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.ai_agents FORCE ROW LEVEL SECURITY;


--
-- Name: ai_analysis_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_analysis_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    type character varying(50) NOT NULL,
    title character varying(200) NOT NULL,
    summary text NOT NULL,
    data jsonb,
    insights jsonb,
    period jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.ai_analysis_reports FORCE ROW LEVEL SECURITY;


--
-- Name: ai_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_conversations (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    title character varying(200) NOT NULL,
    scopes jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

ALTER TABLE ONLY public.ai_conversations FORCE ROW LEVEL SECURITY;


--
-- Name: ai_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_feedback (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    capability character varying(50) NOT NULL,
    rating character varying(10) NOT NULL,
    comment text,
    "originalOutput" jsonb,
    "correctedOutput" jsonb,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.ai_feedback FORCE ROW LEVEL SECURITY;


--
-- Name: ai_meeting_action_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_meeting_action_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    content text NOT NULL,
    assignee_id uuid,
    due_date timestamp with time zone,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    extracted_by character varying(10) DEFAULT 'ai'::character varying NOT NULL,
    confidence double precision DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.ai_meeting_action_items FORCE ROW LEVEL SECURITY;


--
-- Name: ai_meeting_decisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_meeting_decisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    content text NOT NULL,
    context text,
    participants jsonb DEFAULT '[]'::jsonb NOT NULL,
    status character varying(20) DEFAULT 'proposed'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.ai_meeting_decisions FORCE ROW LEVEL SECURITY;


--
-- Name: ai_meeting_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_meeting_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    title character varying(200) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    transcript jsonb DEFAULT '[]'::jsonb NOT NULL,
    summary text,
    participant_count integer DEFAULT 0 NOT NULL,
    start_time timestamp with time zone DEFAULT now() NOT NULL,
    end_time timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.ai_meeting_sessions FORCE ROW LEVEL SECURITY;


--
-- Name: ai_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_messages (
    id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    role character varying(20) NOT NULL,
    content text NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ai_personalizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_personalizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    type character varying(50) NOT NULL,
    content jsonb NOT NULL,
    score double precision NOT NULL,
    applied boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.ai_personalizations FORCE ROW LEVEL SECURITY;


--
-- Name: ai_push_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_push_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    schedule_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    capability character varying(50) NOT NULL,
    title character varying(200) NOT NULL,
    summary text NOT NULL,
    detail jsonb,
    read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.ai_push_records FORCE ROW LEVEL SECURITY;


--
-- Name: ai_push_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_push_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    capability character varying(50) NOT NULL,
    cron character varying(50) NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    config jsonb,
    last_run_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    quiet_hours_start integer,
    quiet_hours_end integer,
    frequency text DEFAULT 'daily'::text
);

ALTER TABLE ONLY public.ai_push_schedules FORCE ROW LEVEL SECURITY;


--
-- Name: ai_usage_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_usage_limits (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid,
    daily_token_limit integer,
    monthly_token_limit integer,
    daily_call_limit integer,
    monthly_call_limit integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

ALTER TABLE ONLY public.ai_usage_limits FORCE ROW LEVEL SECURITY;


--
-- Name: ai_usage_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_usage_logs (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    capability character varying(50) NOT NULL,
    model character varying(50) NOT NULL,
    input_tokens integer DEFAULT 0 NOT NULL,
    output_tokens integer DEFAULT 0 NOT NULL,
    total_tokens integer DEFAULT 0 NOT NULL,
    cost double precision DEFAULT 0 NOT NULL,
    duration_ms integer DEFAULT 0 NOT NULL,
    success boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.ai_usage_logs FORCE ROW LEVEL SECURITY;


--
-- Name: ai_user_behaviors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_user_behaviors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    action character varying(50) NOT NULL,
    capability character varying(50) NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.ai_user_behaviors FORCE ROW LEVEL SECURITY;


--
-- Name: ai_voice_commands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_voice_commands (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    transcript text NOT NULL,
    intent character varying(100),
    parameters jsonb DEFAULT '{}'::jsonb NOT NULL,
    executed boolean DEFAULT false NOT NULL,
    result jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.ai_voice_commands FORCE ROW LEVEL SECURITY;


--
-- Name: ai_voice_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_voice_preferences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    language character varying(10) DEFAULT 'zh-CN'::character varying NOT NULL,
    voice_id character varying(50),
    speed double precision DEFAULT 1.0 NOT NULL,
    wake_word character varying(50) DEFAULT '你好小助手'::character varying NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_workflow_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_workflow_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    description text NOT NULL,
    category character varying(50) NOT NULL,
    steps jsonb NOT NULL,
    is_public boolean DEFAULT false NOT NULL,
    workspace_id uuid,
    usage_count integer DEFAULT 0 NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.ai_workflow_templates FORCE ROW LEVEL SECURITY;


--
-- Name: analytics_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    workspace_id uuid,
    name character varying(64) NOT NULL,
    props json DEFAULT '{}'::json NOT NULL,
    session_id character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.analytics_events FORCE ROW LEVEL SECURITY;


--
-- Name: announcements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.announcements (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    title character varying(200) NOT NULL,
    content text NOT NULL,
    type character varying(20) DEFAULT 'info'::character varying NOT NULL,
    target_audience jsonb DEFAULT '{"type": "all"}'::jsonb NOT NULL,
    pinned boolean DEFAULT false NOT NULL,
    published_by uuid,
    published_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.announcements FORCE ROW LEVEL SECURITY;


--
-- Name: approval_cc_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approval_cc_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    instance_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    node_index integer NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.approval_cc_records FORCE ROW LEVEL SECURITY;


--
-- Name: approval_delegates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approval_delegates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    delegator_id uuid NOT NULL,
    delegate_to_id uuid NOT NULL,
    start_at timestamp with time zone NOT NULL,
    end_at timestamp with time zone NOT NULL,
    reason text,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.approval_delegates FORCE ROW LEVEL SECURITY;


--
-- Name: approval_instances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approval_instances (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    template_id uuid,
    title character varying(200) NOT NULL,
    description text,
    applicant_id uuid NOT NULL,
    content jsonb NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    current_node integer DEFAULT 0 NOT NULL,
    nodes jsonb NOT NULL,
    submitted_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    active_node_ids text[] DEFAULT '{}'::text[],
    condition_cache jsonb,
    priority character varying(20) DEFAULT 'normal'::character varying,
    expected_at timestamp with time zone,
    entity_type character varying(20),
    entity_id uuid
);

ALTER TABLE ONLY public.approval_instances FORCE ROW LEVEL SECURITY;


--
-- Name: approval_operations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approval_operations (
    id uuid NOT NULL,
    instance_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    operator_id uuid NOT NULL,
    action character varying(20) NOT NULL,
    node_index integer NOT NULL,
    comment text,
    transfer_to_id uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    node_id character varying(100),
    add_sign_to_id uuid,
    delegate_to_id uuid
);

ALTER TABLE ONLY public.approval_operations FORCE ROW LEVEL SECURITY;


--
-- Name: approval_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approval_templates (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    name character varying(200) NOT NULL,
    description character varying(500),
    nodes jsonb NOT NULL,
    created_by uuid,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    flow_type character varying(20) DEFAULT 'sequential'::character varying,
    form_schema jsonb,
    icon character varying(50) DEFAULT 'file-check'::character varying,
    category character varying(50),
    is_builtin boolean DEFAULT false
);

ALTER TABLE ONLY public.approval_templates FORCE ROW LEVEL SECURITY;


--
-- Name: assistant_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assistant_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    task_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.assistant_conversations FORCE ROW LEVEL SECURITY;


--
-- Name: assistant_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assistant_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    role character varying(20) NOT NULL,
    content text NOT NULL,
    capability_used character varying(50),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: calendar_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_connections (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    provider character varying(20) NOT NULL,
    email character varying(255) NOT NULL,
    access_token text NOT NULL,
    refresh_token text NOT NULL,
    token_expires_at timestamp with time zone NOT NULL,
    calendar_id character varying(255) NOT NULL,
    last_sync_at timestamp with time zone,
    sync_status character varying(20) DEFAULT 'idle'::character varying NOT NULL,
    sync_error text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

ALTER TABLE ONLY public.calendar_connections FORCE ROW LEVEL SECURITY;


--
-- Name: calendar_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    title character varying(200) NOT NULL,
    description text,
    start_at timestamp with time zone NOT NULL,
    end_at timestamp with time zone NOT NULL,
    all_day boolean DEFAULT false NOT NULL,
    location character varying(500),
    color character varying(20),
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.calendar_events FORCE ROW LEVEL SECURITY;


--
-- Name: chat_presences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_presences (
    id uuid NOT NULL,
    task_id uuid,
    user_id uuid NOT NULL,
    last_seen timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    conversation_id uuid
);

ALTER TABLE ONLY public.chat_presences FORCE ROW LEVEL SECURITY;


--
-- Name: comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    author_id uuid,
    body text NOT NULL,
    mentions text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.comments FORCE ROW LEVEL SECURITY;


--
-- Name: contact_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_groups (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.contact_groups FORCE ROW LEVEL SECURITY;


--
-- Name: contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contacts (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    email character varying(255),
    phone character varying(50),
    department character varying(100),
    "position" character varying(100),
    avatar text,
    notes text,
    group_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.contacts FORCE ROW LEVEL SECURITY;


--
-- Name: conversation_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_members (
    id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role character varying(20) DEFAULT 'member'::character varying NOT NULL,
    joined_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_read_at timestamp with time zone,
    muted boolean DEFAULT false NOT NULL,
    invited_by uuid
);

ALTER TABLE ONLY public.conversation_members FORCE ROW LEVEL SECURITY;


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    type character varying(20) NOT NULL,
    title character varying(200),
    avatar text,
    description character varying(500),
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    last_message_at timestamp with time zone,
    task_id uuid,
    source character varying(20) DEFAULT 'manual'::character varying
);

ALTER TABLE ONLY public.conversations FORCE ROW LEVEL SECURITY;


--
-- Name: database_fields; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.database_fields (
    id uuid NOT NULL,
    database_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    type character varying(20) NOT NULL,
    options json DEFAULT '{}'::json NOT NULL,
    sort_order double precision DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: database_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.database_records (
    id uuid NOT NULL,
    database_id uuid NOT NULL,
    data json DEFAULT '{}'::json NOT NULL,
    sort_order double precision DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: database_views; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.database_views (
    id uuid NOT NULL,
    database_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    type character varying(20) NOT NULL,
    config json DEFAULT '{}'::json NOT NULL,
    sort_order double precision DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: databases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.databases (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    space_id uuid,
    folder_id uuid,
    title character varying(255) NOT NULL,
    icon character varying(50) DEFAULT 'table'::character varying NOT NULL,
    emoji character varying(10),
    description text,
    sort_order double precision DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.databases FORCE ROW LEVEL SECURITY;


--
-- Name: decision_action_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.decision_action_items (
    id uuid NOT NULL,
    decision_id uuid NOT NULL,
    task_id uuid,
    line_index integer NOT NULL,
    checked boolean DEFAULT false NOT NULL,
    assignee_id uuid,
    due_date timestamp with time zone,
    priority character varying(20) DEFAULT 'medium'::character varying NOT NULL,
    title character varying(500) NOT NULL,
    removed boolean DEFAULT false NOT NULL,
    user_modified boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: decision_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.decision_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    decision_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    markdown text NOT NULL,
    version integer NOT NULL,
    author_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT decision_versions_version_check CHECK ((version >= 1))
);

ALTER TABLE ONLY public.decision_versions FORCE ROW LEVEL SECURITY;


--
-- Name: decisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.decisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    markdown text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    author_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewed_at timestamp with time zone,
    CONSTRAINT decisions_version_check CHECK ((version >= 1))
);

ALTER TABLE ONLY public.decisions FORCE ROW LEVEL SECURITY;


--
-- Name: document_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_comments (
    id uuid NOT NULL,
    document_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    anchor_path character varying(100) NOT NULL,
    anchor_text text NOT NULL,
    body text NOT NULL,
    mentions text[] DEFAULT '{}'::text[] NOT NULL,
    parent_id uuid,
    resolved boolean DEFAULT false NOT NULL,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    author_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.document_comments FORCE ROW LEVEL SECURITY;


--
-- Name: document_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_permissions (
    id uuid NOT NULL,
    document_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    grantee_type character varying(20) NOT NULL,
    grantee_id uuid NOT NULL,
    permission character varying(20) NOT NULL,
    granted_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    source character varying(20) DEFAULT 'explicit'::character varying,
    inherited_from_id uuid,
    expires_at timestamp with time zone
);

ALTER TABLE ONLY public.document_permissions FORCE ROW LEVEL SECURITY;


--
-- Name: document_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_versions (
    id uuid NOT NULL,
    document_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    version integer NOT NULL,
    snapshot_type character varying(10) NOT NULL,
    content_full json,
    content_diff text,
    markdown text NOT NULL,
    message character varying(255),
    source character varying(20) DEFAULT 'manual'::character varying NOT NULL,
    author_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.document_versions FORCE ROW LEVEL SECURITY;


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    title character varying(255) NOT NULL,
    markdown text DEFAULT ''::text NOT NULL,
    published_markdown text,
    published_at timestamp with time zone,
    share_token character varying(64),
    author_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    share_expires_at timestamp with time zone,
    share_password character varying(255),
    share_slug character varying(100),
    space_id uuid,
    folder_id uuid,
    sort_order double precision DEFAULT 0 NOT NULL,
    icon character varying(50) DEFAULT 'file-text'::character varying NOT NULL,
    emoji character varying(10),
    current_version integer DEFAULT 0 NOT NULL,
    visibility character varying(20) DEFAULT 'private'::character varying NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid
);

ALTER TABLE ONLY public.documents FORCE ROW LEVEL SECURITY;


--
-- Name: email_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    email character varying(200) NOT NULL,
    display_name character varying(100),
    provider character varying(50) DEFAULT 'custom'::character varying NOT NULL,
    smtp_host character varying(200) NOT NULL,
    smtp_port integer DEFAULT 587 NOT NULL,
    smtp_secure boolean DEFAULT false NOT NULL,
    imap_host character varying(200),
    imap_port integer DEFAULT 993,
    credential text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.email_accounts FORCE ROW LEVEL SECURITY;


--
-- Name: favorites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.favorites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    target_type character varying(20) NOT NULL,
    target_id uuid NOT NULL,
    note character varying(200),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.favorites FORCE ROW LEVEL SECURITY;


--
-- Name: file_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.file_assets (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    file_name character varying(255) NOT NULL,
    file_size integer NOT NULL,
    file_type character varying(100) NOT NULL,
    storage_key text NOT NULL,
    thumbnail_key text,
    sha256 character varying(64) NOT NULL,
    uploaded_by uuid,
    folder_id uuid,
    sort_order double precision DEFAULT 0 NOT NULL,
    current_version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.file_assets FORCE ROW LEVEL SECURITY;


--
-- Name: file_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.file_versions (
    id uuid NOT NULL,
    file_asset_id uuid NOT NULL,
    version integer NOT NULL,
    storage_key text NOT NULL,
    file_size integer NOT NULL,
    message character varying(255),
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: folder_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.folder_permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    target_type character varying(10) NOT NULL,
    target_id uuid NOT NULL,
    grantee_type character varying(20) NOT NULL,
    grantee_id character varying(100) NOT NULL,
    permission character varying(20) NOT NULL,
    granted_by uuid,
    inheritable boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.folder_permissions FORCE ROW LEVEL SECURITY;


--
-- Name: folders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.folders (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    space_id uuid NOT NULL,
    parent_id uuid,
    name character varying(100) NOT NULL,
    icon character varying(50) DEFAULT 'folder'::character varying NOT NULL,
    sort_order double precision DEFAULT 0 NOT NULL,
    expanded boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.folders FORCE ROW LEVEL SECURITY;


--
-- Name: form_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.form_submissions (
    id uuid NOT NULL,
    form_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    data jsonb NOT NULL,
    submitted_by uuid,
    submitted_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.form_submissions FORCE ROW LEVEL SECURITY;


--
-- Name: forms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.forms (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    title character varying(200) NOT NULL,
    description text,
    fields jsonb NOT NULL,
    created_by uuid,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.forms FORCE ROW LEVEL SECURITY;


--
-- Name: invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    email character varying(255) NOT NULL,
    token_hash character varying(64) NOT NULL,
    role character varying(20) DEFAULT 'member'::character varying NOT NULL,
    invited_by uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    accepted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.invitations FORCE ROW LEVEL SECURITY;


--
-- Name: key_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.key_results (
    id uuid NOT NULL,
    objective_id uuid NOT NULL,
    title character varying(200) NOT NULL,
    target_value double precision NOT NULL,
    current_value double precision DEFAULT 0 NOT NULL,
    unit character varying(20),
    weight double precision DEFAULT 1 NOT NULL,
    owner_id uuid,
    due_date timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: knowledge_edges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_edges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    source_node_id uuid NOT NULL,
    target_node_id uuid NOT NULL,
    relation character varying(50) NOT NULL,
    weight double precision DEFAULT 1.0 NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.knowledge_edges FORCE ROW LEVEL SECURITY;


--
-- Name: knowledge_nodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_nodes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    type character varying(50) NOT NULL,
    label character varying(200) NOT NULL,
    content text NOT NULL,
    source_type character varying(50) NOT NULL,
    source_id uuid NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.knowledge_nodes FORCE ROW LEVEL SECURITY;


--
-- Name: labels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.labels (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    name character varying(50) NOT NULL,
    color character varying(50) DEFAULT 'var(--muted)'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

ALTER TABLE ONLY public.labels FORCE ROW LEVEL SECURITY;


--
-- Name: mails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mails (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    account_id uuid NOT NULL,
    message_id character varying(500),
    from_addr character varying(500) NOT NULL,
    to_addr text NOT NULL,
    cc_addr text,
    bcc_addr text,
    subject character varying(500) NOT NULL,
    body_text text,
    body_html text,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    thread_id uuid,
    in_reply_to character varying(500),
    attachments jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    is_starred boolean DEFAULT false NOT NULL,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.mails FORCE ROW LEVEL SECURITY;


--
-- Name: meeting_minutes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meeting_minutes (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    meeting_id uuid,
    title character varying(200) NOT NULL,
    content text NOT NULL,
    attendees jsonb NOT NULL,
    action_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.meeting_minutes FORCE ROW LEVEL SECURITY;


--
-- Name: meeting_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meeting_participants (
    id uuid NOT NULL,
    meeting_id uuid NOT NULL,
    user_id uuid NOT NULL,
    joined_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    left_at timestamp with time zone,
    role character varying(20) DEFAULT 'guest'::character varying NOT NULL
);


--
-- Name: meetings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meetings (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    title character varying(200) NOT NULL,
    description character varying(500),
    created_by uuid,
    room_name character varying(100) NOT NULL,
    status character varying(20) DEFAULT 'scheduled'::character varying NOT NULL,
    type character varying(20) DEFAULT 'instant'::character varying NOT NULL,
    scheduled_at timestamp with time zone,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    max_participants integer DEFAULT 50 NOT NULL,
    recording_enabled boolean DEFAULT false NOT NULL,
    recording_url text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    recurring_rule character varying(255),
    password character varying(100),
    recording_started_at timestamp with time zone,
    recording_stopped_at timestamp with time zone,
    CONSTRAINT meetings_status_check CHECK (((status)::text = ANY ((ARRAY['scheduled'::character varying, 'active'::character varying, 'ended'::character varying, 'cancelled'::character varying])::text[])))
);

ALTER TABLE ONLY public.meetings FORCE ROW LEVEL SECURITY;


--
-- Name: member_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_permissions (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    role character varying(20) NOT NULL,
    module character varying(30) NOT NULL,
    actions text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.member_permissions FORCE ROW LEVEL SECURITY;


--
-- Name: members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.members (
    user_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    role character varying(20) DEFAULT 'member'::character varying NOT NULL,
    invited_by uuid,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    invited_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT members_role_check CHECK (((role)::text = ANY ((ARRAY['owner'::character varying, 'admin'::character varying, 'member'::character varying, 'viewer'::character varying])::text[])))
);

ALTER TABLE ONLY public.members FORCE ROW LEVEL SECURITY;


--
-- Name: message_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_attachments (
    id uuid NOT NULL,
    message_id uuid NOT NULL,
    file_name character varying(255) NOT NULL,
    file_size integer NOT NULL,
    file_type character varying(100) NOT NULL,
    url text NOT NULL,
    thumbnail_url text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    workspace_id uuid NOT NULL
);

ALTER TABLE ONLY public.message_attachments FORCE ROW LEVEL SECURITY;


--
-- Name: message_reads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_reads (
    id uuid NOT NULL,
    message_id uuid NOT NULL,
    user_id uuid NOT NULL,
    read_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.message_reads FORCE ROW LEVEL SECURITY;


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id uuid NOT NULL,
    task_id uuid,
    workspace_id uuid NOT NULL,
    author_id uuid,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    conversation_id uuid,
    edited_at timestamp with time zone,
    revoked_at timestamp with time zone,
    revoked_by uuid,
    reply_to_id uuid,
    mentions text[] DEFAULT '{}'::text[] NOT NULL,
    body_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, COALESCE(body, ''::text))) STORED,
    "isRecalled" boolean DEFAULT false NOT NULL,
    type character varying(20) DEFAULT 'text'::character varying NOT NULL
);

ALTER TABLE ONLY public.messages FORCE ROW LEVEL SECURITY;


--
-- Name: milestones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.milestones (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    due_date timestamp with time zone,
    description text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

ALTER TABLE ONLY public.milestones FORCE ROW LEVEL SECURITY;


--
-- Name: notification_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_preferences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    email_notify boolean DEFAULT true NOT NULL,
    push_notify boolean DEFAULT true NOT NULL,
    dnd_enabled boolean DEFAULT false NOT NULL,
    dnd_start character varying(5) DEFAULT '22:00'::character varying NOT NULL,
    dnd_end character varying(5) DEFAULT '08:00'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    type character varying(30) NOT NULL,
    entity_id uuid NOT NULL,
    entity_title character varying(255) NOT NULL,
    read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.notifications FORCE ROW LEVEL SECURITY;


--
-- Name: objectives; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.objectives (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    title character varying(200) NOT NULL,
    description text,
    owner_id uuid,
    period character varying(20) NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    progress double precision DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.objectives FORCE ROW LEVEL SECURITY;


--
-- Name: permission_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permission_audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    action character varying(20) NOT NULL,
    target_type character varying(20) NOT NULL,
    target_id uuid NOT NULL,
    grantee_type character varying(20) NOT NULL,
    grantee_id character varying(100) NOT NULL,
    old_permission character varying(20),
    new_permission character varying(20),
    operator_id uuid NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.permission_audit_logs FORCE ROW LEVEL SECURITY;


--
-- Name: processed_payment_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.processed_payment_events (
    provider character varying(20) NOT NULL,
    event_id character varying(255) NOT NULL,
    received_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: processed_stripe_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.processed_stripe_events (
    id character varying(255) NOT NULL,
    received_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: project_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_templates (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    name character varying(200) NOT NULL,
    description character varying(500),
    category character varying(100),
    template_data jsonb NOT NULL,
    created_by uuid,
    is_public boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.project_templates FORCE ROW LEVEL SECURITY;


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    endpoint text NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    p256dh_key text,
    auth_key text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY public.push_subscriptions FORCE ROW LEVEL SECURITY;


--
-- Name: push_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_tokens (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    platform character varying(20) NOT NULL,
    token text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

ALTER TABLE ONLY public.push_tokens FORCE ROW LEVEL SECURITY;


--
-- Name: remote_control_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.remote_control_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    initiator_id uuid NOT NULL,
    target_id uuid NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    end_reason character varying(200),
    expires_at timestamp with time zone NOT NULL,
    accepted_at timestamp with time zone,
    ended_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.remote_control_sessions FORCE ROW LEVEL SECURITY;


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    token text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ip_address character varying(45),
    user_agent character varying(500),
    user_id uuid NOT NULL
);


--
-- Name: share_access_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.share_access_logs (
    id uuid NOT NULL,
    entity_type character varying(20) NOT NULL,
    entity_id uuid NOT NULL,
    ip character varying(45),
    user_agent text,
    accessed_at timestamp with time zone DEFAULT now() NOT NULL,
    workspace_id uuid
);

ALTER TABLE ONLY public.share_access_logs FORCE ROW LEVEL SECURITY;


--
-- Name: share_link_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.share_link_permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    share_token character varying(64) NOT NULL,
    permission character varying(20) DEFAULT 'view'::character varying,
    allow_download boolean DEFAULT false,
    allow_print boolean DEFAULT false,
    allow_copy boolean DEFAULT true,
    password_hash character varying(100),
    expires_at timestamp with time zone,
    max_views integer,
    view_count integer DEFAULT 0,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.share_link_permissions FORCE ROW LEVEL SECURITY;


--
-- Name: spaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spaces (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    icon character varying(50) DEFAULT 'book'::character varying NOT NULL,
    sort_order double precision DEFAULT 0 NOT NULL,
    color character varying(50) DEFAULT 'var(--accent)'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.spaces FORCE ROW LEVEL SECURITY;


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    stripe_customer_id character varying(255),
    stripe_sub_id character varying(255),
    quantity integer DEFAULT 1 NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    current_period_end timestamp with time zone,
    canceled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    provider character varying(20),
    provider_order_id character varying(255),
    CONSTRAINT subscriptions_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'past_due'::character varying, 'canceled'::character varying, 'trialing'::character varying, 'incomplete'::character varying])::text[])))
);

ALTER TABLE ONLY public.subscriptions FORCE ROW LEVEL SECURITY;


--
-- Name: task_calendar_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_calendar_events (
    id uuid NOT NULL,
    task_id uuid NOT NULL,
    connection_id uuid NOT NULL,
    external_event_id character varying(255) NOT NULL,
    last_synced_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.task_calendar_events FORCE ROW LEVEL SECURITY;


--
-- Name: task_labels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_labels (
    task_id uuid NOT NULL,
    label_id uuid NOT NULL
);

ALTER TABLE ONLY public.task_labels FORCE ROW LEVEL SECURITY;


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    status character varying(20) DEFAULT 'todo'::character varying NOT NULL,
    priority character varying(20) DEFAULT 'medium'::character varying NOT NULL,
    assignee_id uuid,
    due_date timestamp with time zone,
    sort_order double precision DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    milestone_id uuid,
    parent_id uuid,
    blocked boolean DEFAULT false NOT NULL,
    blocked_reason character varying(500),
    task_share_token character varying(64),
    share_expires_at timestamp with time zone,
    share_password character varying(255),
    share_slug character varying(100),
    deleted_at timestamp with time zone,
    deleted_by uuid,
    CONSTRAINT tasks_priority_check CHECK (((priority)::text = ANY ((ARRAY['low'::character varying, 'medium'::character varying, 'high'::character varying, 'urgent'::character varying])::text[]))),
    CONSTRAINT tasks_status_check CHECK (((status)::text = ANY ((ARRAY['todo'::character varying, 'in_progress'::character varying, 'review'::character varying, 'done'::character varying])::text[])))
);

ALTER TABLE ONLY public.tasks FORCE ROW LEVEL SECURITY;


--
-- Name: temporary_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.temporary_grants (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    temp_role character varying(20) NOT NULL,
    original_role character varying(20) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.temporary_grants FORCE ROW LEVEL SECURITY;


--
-- Name: time_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.time_entries (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    task_id uuid,
    start_time timestamp with time zone NOT NULL,
    end_time timestamp with time zone,
    duration integer,
    description text,
    billable boolean DEFAULT false NOT NULL,
    hourly_rate double precision,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.time_entries FORCE ROW LEVEL SECURITY;


--
-- Name: user_dashboard_prefs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_dashboard_prefs (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    layout jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.user_dashboard_prefs FORCE ROW LEVEL SECURITY;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100),
    email character varying(255) NOT NULL,
    email_verified boolean DEFAULT false NOT NULL,
    avatar_url text,
    password_hash text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_login_at timestamp with time zone,
    online_at timestamp with time zone,
    locale character varying(5) DEFAULT 'zh'::character varying NOT NULL
);


--
-- Name: verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.verifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: whiteboards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whiteboards (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    title character varying(200) NOT NULL,
    data jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.whiteboards FORCE ROW LEVEL SECURITY;


--
-- Name: wiki_pages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wiki_pages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    title character varying(200) NOT NULL,
    slug character varying(200) NOT NULL,
    content text NOT NULL,
    parent_id uuid,
    created_by uuid NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, COALESCE(content, ''::text))) STORED
);

ALTER TABLE ONLY public.wiki_pages FORCE ROW LEVEL SECURITY;


--
-- Name: workflow_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_executions (
    id uuid NOT NULL,
    workflow_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    trigger_data jsonb NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    result jsonb,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.workflow_executions FORCE ROW LEVEL SECURITY;


--
-- Name: workflows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflows (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    name character varying(200) NOT NULL,
    description character varying(500),
    trigger jsonb NOT NULL,
    actions jsonb NOT NULL,
    created_by uuid,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.workflows FORCE ROW LEVEL SECURITY;


--
-- Name: workspaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    slug character varying(50) NOT NULL,
    owner_id uuid NOT NULL,
    plan character varying(20) DEFAULT 'free'::character varying NOT NULL,
    seat_limit integer DEFAULT 10 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT workspaces_plan_check CHECK (((plan)::text = ANY ((ARRAY['free'::character varying, 'starter'::character varying, 'pro'::character varying, 'enterprise'::character varying])::text[]))),
    CONSTRAINT workspaces_seat_limit_check CHECK (((seat_limit >= 1) AND (seat_limit <= 1000)))
);

ALTER TABLE ONLY public.workspaces FORCE ROW LEVEL SECURITY;


--
-- Name: yjs_persistence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.yjs_persistence (
    id uuid NOT NULL,
    document_id uuid NOT NULL,
    state bytea NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: ai_agent_messages ai_agent_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_agent_messages
    ADD CONSTRAINT ai_agent_messages_pkey PRIMARY KEY (id);


--
-- Name: ai_agents ai_agents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_agents
    ADD CONSTRAINT ai_agents_pkey PRIMARY KEY (id);


--
-- Name: ai_analysis_reports ai_analysis_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_analysis_reports
    ADD CONSTRAINT ai_analysis_reports_pkey PRIMARY KEY (id);


--
-- Name: ai_conversations ai_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_conversations
    ADD CONSTRAINT ai_conversations_pkey PRIMARY KEY (id);


--
-- Name: ai_feedback ai_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_feedback
    ADD CONSTRAINT ai_feedback_pkey PRIMARY KEY (id);


--
-- Name: ai_meeting_action_items ai_meeting_action_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_meeting_action_items
    ADD CONSTRAINT ai_meeting_action_items_pkey PRIMARY KEY (id);


--
-- Name: ai_meeting_decisions ai_meeting_decisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_meeting_decisions
    ADD CONSTRAINT ai_meeting_decisions_pkey PRIMARY KEY (id);


--
-- Name: ai_meeting_sessions ai_meeting_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_meeting_sessions
    ADD CONSTRAINT ai_meeting_sessions_pkey PRIMARY KEY (id);


--
-- Name: ai_messages ai_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_messages
    ADD CONSTRAINT ai_messages_pkey PRIMARY KEY (id);


--
-- Name: ai_personalizations ai_personalizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_personalizations
    ADD CONSTRAINT ai_personalizations_pkey PRIMARY KEY (id);


--
-- Name: ai_push_records ai_push_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_push_records
    ADD CONSTRAINT ai_push_records_pkey PRIMARY KEY (id);


--
-- Name: ai_push_schedules ai_push_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_push_schedules
    ADD CONSTRAINT ai_push_schedules_pkey PRIMARY KEY (id);


--
-- Name: ai_usage_limits ai_usage_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_limits
    ADD CONSTRAINT ai_usage_limits_pkey PRIMARY KEY (id);


--
-- Name: ai_usage_logs ai_usage_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_logs
    ADD CONSTRAINT ai_usage_logs_pkey PRIMARY KEY (id);


--
-- Name: ai_user_behaviors ai_user_behaviors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_user_behaviors
    ADD CONSTRAINT ai_user_behaviors_pkey PRIMARY KEY (id);


--
-- Name: ai_voice_commands ai_voice_commands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_voice_commands
    ADD CONSTRAINT ai_voice_commands_pkey PRIMARY KEY (id);


--
-- Name: ai_voice_preferences ai_voice_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_voice_preferences
    ADD CONSTRAINT ai_voice_preferences_pkey PRIMARY KEY (id);


--
-- Name: ai_workflow_templates ai_workflow_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_workflow_templates
    ADD CONSTRAINT ai_workflow_templates_pkey PRIMARY KEY (id);


--
-- Name: analytics_events analytics_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_pkey PRIMARY KEY (id);


--
-- Name: announcements announcements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_pkey PRIMARY KEY (id);


--
-- Name: approval_cc_records approval_cc_records_instance_id_user_id_node_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_cc_records
    ADD CONSTRAINT approval_cc_records_instance_id_user_id_node_index_key UNIQUE (instance_id, user_id, node_index);


--
-- Name: approval_cc_records approval_cc_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_cc_records
    ADD CONSTRAINT approval_cc_records_pkey PRIMARY KEY (id);


--
-- Name: approval_delegates approval_delegates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_delegates
    ADD CONSTRAINT approval_delegates_pkey PRIMARY KEY (id);


--
-- Name: approval_delegates approval_delegates_workspace_id_delegator_id_start_at_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_delegates
    ADD CONSTRAINT approval_delegates_workspace_id_delegator_id_start_at_key UNIQUE (workspace_id, delegator_id, start_at);


--
-- Name: approval_instances approval_instances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_instances
    ADD CONSTRAINT approval_instances_pkey PRIMARY KEY (id);


--
-- Name: approval_operations approval_operations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_operations
    ADD CONSTRAINT approval_operations_pkey PRIMARY KEY (id);


--
-- Name: approval_templates approval_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_templates
    ADD CONSTRAINT approval_templates_pkey PRIMARY KEY (id);


--
-- Name: assistant_conversations assistant_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_conversations
    ADD CONSTRAINT assistant_conversations_pkey PRIMARY KEY (id);


--
-- Name: assistant_messages assistant_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_messages
    ADD CONSTRAINT assistant_messages_pkey PRIMARY KEY (id);


--
-- Name: calendar_connections calendar_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_connections
    ADD CONSTRAINT calendar_connections_pkey PRIMARY KEY (id);


--
-- Name: calendar_events calendar_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_pkey PRIMARY KEY (id);


--
-- Name: chat_presences chat_presences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_presences
    ADD CONSTRAINT chat_presences_pkey PRIMARY KEY (id);


--
-- Name: comments comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_pkey PRIMARY KEY (id);


--
-- Name: contact_groups contact_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_groups
    ADD CONSTRAINT contact_groups_pkey PRIMARY KEY (id);


--
-- Name: contacts contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_pkey PRIMARY KEY (id);


--
-- Name: conversation_members conversation_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_members
    ADD CONSTRAINT conversation_members_pkey PRIMARY KEY (id);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: database_fields database_fields_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.database_fields
    ADD CONSTRAINT database_fields_pkey PRIMARY KEY (id);


--
-- Name: database_records database_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.database_records
    ADD CONSTRAINT database_records_pkey PRIMARY KEY (id);


--
-- Name: database_views database_views_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.database_views
    ADD CONSTRAINT database_views_pkey PRIMARY KEY (id);


--
-- Name: databases databases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.databases
    ADD CONSTRAINT databases_pkey PRIMARY KEY (id);


--
-- Name: decision_action_items decision_action_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_action_items
    ADD CONSTRAINT decision_action_items_pkey PRIMARY KEY (id);


--
-- Name: decision_versions decision_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_versions
    ADD CONSTRAINT decision_versions_pkey PRIMARY KEY (id);


--
-- Name: decisions decisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decisions
    ADD CONSTRAINT decisions_pkey PRIMARY KEY (id);


--
-- Name: document_comments document_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_comments
    ADD CONSTRAINT document_comments_pkey PRIMARY KEY (id);


--
-- Name: document_permissions document_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_permissions
    ADD CONSTRAINT document_permissions_pkey PRIMARY KEY (id);


--
-- Name: document_versions document_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_versions
    ADD CONSTRAINT document_versions_pkey PRIMARY KEY (id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: documents documents_share_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_share_token_key UNIQUE (share_token);


--
-- Name: email_accounts email_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_accounts
    ADD CONSTRAINT email_accounts_pkey PRIMARY KEY (id);


--
-- Name: favorites favorites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_pkey PRIMARY KEY (id);


--
-- Name: file_assets file_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_assets
    ADD CONSTRAINT file_assets_pkey PRIMARY KEY (id);


--
-- Name: file_versions file_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_versions
    ADD CONSTRAINT file_versions_pkey PRIMARY KEY (id);


--
-- Name: folder_permissions folder_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.folder_permissions
    ADD CONSTRAINT folder_permissions_pkey PRIMARY KEY (id);


--
-- Name: folder_permissions folder_permissions_target_type_target_id_grantee_type_grant_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.folder_permissions
    ADD CONSTRAINT folder_permissions_target_type_target_id_grantee_type_grant_key UNIQUE (target_type, target_id, grantee_type, grantee_id);


--
-- Name: folders folders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.folders
    ADD CONSTRAINT folders_pkey PRIMARY KEY (id);


--
-- Name: form_submissions form_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_submissions
    ADD CONSTRAINT form_submissions_pkey PRIMARY KEY (id);


--
-- Name: forms forms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forms
    ADD CONSTRAINT forms_pkey PRIMARY KEY (id);


--
-- Name: invitations invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_pkey PRIMARY KEY (id);


--
-- Name: key_results key_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.key_results
    ADD CONSTRAINT key_results_pkey PRIMARY KEY (id);


--
-- Name: knowledge_edges knowledge_edges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_edges
    ADD CONSTRAINT knowledge_edges_pkey PRIMARY KEY (id);


--
-- Name: knowledge_nodes knowledge_nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_nodes
    ADD CONSTRAINT knowledge_nodes_pkey PRIMARY KEY (id);


--
-- Name: labels labels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.labels
    ADD CONSTRAINT labels_pkey PRIMARY KEY (id);


--
-- Name: mails mails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mails
    ADD CONSTRAINT mails_pkey PRIMARY KEY (id);


--
-- Name: meeting_minutes meeting_minutes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_minutes
    ADD CONSTRAINT meeting_minutes_pkey PRIMARY KEY (id);


--
-- Name: meeting_participants meeting_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_participants
    ADD CONSTRAINT meeting_participants_pkey PRIMARY KEY (id);


--
-- Name: meetings meetings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_pkey PRIMARY KEY (id);


--
-- Name: member_permissions member_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_permissions
    ADD CONSTRAINT member_permissions_pkey PRIMARY KEY (id);


--
-- Name: members members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_pkey PRIMARY KEY (user_id, workspace_id);


--
-- Name: message_attachments message_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_attachments
    ADD CONSTRAINT message_attachments_pkey PRIMARY KEY (id);


--
-- Name: message_reads message_reads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reads
    ADD CONSTRAINT message_reads_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: milestones milestones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.milestones
    ADD CONSTRAINT milestones_pkey PRIMARY KEY (id);


--
-- Name: notification_preferences notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: objectives objectives_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.objectives
    ADD CONSTRAINT objectives_pkey PRIMARY KEY (id);


--
-- Name: permission_audit_logs permission_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_audit_logs
    ADD CONSTRAINT permission_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: processed_payment_events processed_payment_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processed_payment_events
    ADD CONSTRAINT processed_payment_events_pkey PRIMARY KEY (provider, event_id);


--
-- Name: processed_stripe_events processed_stripe_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processed_stripe_events
    ADD CONSTRAINT processed_stripe_events_pkey PRIMARY KEY (id);


--
-- Name: project_templates project_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_templates
    ADD CONSTRAINT project_templates_pkey PRIMARY KEY (id);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: push_tokens push_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_tokens
    ADD CONSTRAINT push_tokens_pkey PRIMARY KEY (id);


--
-- Name: remote_control_sessions remote_control_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_control_sessions
    ADD CONSTRAINT remote_control_sessions_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: share_access_logs share_access_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.share_access_logs
    ADD CONSTRAINT share_access_logs_pkey PRIMARY KEY (id);


--
-- Name: share_link_permissions share_link_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.share_link_permissions
    ADD CONSTRAINT share_link_permissions_pkey PRIMARY KEY (id);


--
-- Name: share_link_permissions share_link_permissions_share_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.share_link_permissions
    ADD CONSTRAINT share_link_permissions_share_token_key UNIQUE (share_token);


--
-- Name: spaces spaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spaces
    ADD CONSTRAINT spaces_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: task_calendar_events task_calendar_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_calendar_events
    ADD CONSTRAINT task_calendar_events_pkey PRIMARY KEY (id);


--
-- Name: task_labels task_labels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_labels
    ADD CONSTRAINT task_labels_pkey PRIMARY KEY (task_id, label_id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: tasks tasks_task_share_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_task_share_token_key UNIQUE (task_share_token);


--
-- Name: temporary_grants temporary_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.temporary_grants
    ADD CONSTRAINT temporary_grants_pkey PRIMARY KEY (id);


--
-- Name: time_entries time_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_entries
    ADD CONSTRAINT time_entries_pkey PRIMARY KEY (id);


--
-- Name: user_dashboard_prefs user_dashboard_prefs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_dashboard_prefs
    ADD CONSTRAINT user_dashboard_prefs_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: verifications verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verifications
    ADD CONSTRAINT verifications_pkey PRIMARY KEY (id);


--
-- Name: whiteboards whiteboards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whiteboards
    ADD CONSTRAINT whiteboards_pkey PRIMARY KEY (id);


--
-- Name: wiki_pages wiki_pages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_pages
    ADD CONSTRAINT wiki_pages_pkey PRIMARY KEY (id);


--
-- Name: workflow_executions workflow_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_executions
    ADD CONSTRAINT workflow_executions_pkey PRIMARY KEY (id);


--
-- Name: workflows workflows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflows
    ADD CONSTRAINT workflows_pkey PRIMARY KEY (id);


--
-- Name: workspaces workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);


--
-- Name: yjs_persistence yjs_persistence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.yjs_persistence
    ADD CONSTRAINT yjs_persistence_pkey PRIMARY KEY (id);


--
-- Name: FileAsset_workspaceId_sha256_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "FileAsset_workspaceId_sha256_key" ON public.file_assets USING btree (workspace_id, sha256);


--
-- Name: accounts_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounts_user_id_idx ON public.accounts USING btree (user_id);


--
-- Name: ai_agent_messages_from_agent_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_agent_messages_from_agent_id_created_at_idx ON public.ai_agent_messages USING btree (from_agent_id, created_at);


--
-- Name: ai_agent_messages_to_agent_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_agent_messages_to_agent_id_created_at_idx ON public.ai_agent_messages USING btree (to_agent_id, created_at);


--
-- Name: ai_agent_messages_workspace_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_agent_messages_workspace_id_created_at_idx ON public.ai_agent_messages USING btree (workspace_id, created_at);


--
-- Name: ai_agents_workspace_id_enabled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_agents_workspace_id_enabled_idx ON public.ai_agents USING btree (workspace_id, enabled);


--
-- Name: ai_analysis_reports_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_analysis_reports_user_id_created_at_idx ON public.ai_analysis_reports USING btree (user_id, created_at);


--
-- Name: ai_analysis_reports_workspace_id_type_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_analysis_reports_workspace_id_type_created_at_idx ON public.ai_analysis_reports USING btree (workspace_id, type, created_at);


--
-- Name: ai_conversations_workspace_id_user_id_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_conversations_workspace_id_user_id_updated_at_idx ON public.ai_conversations USING btree (workspace_id, user_id, updated_at);


--
-- Name: ai_feedback_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_feedback_user_id_created_at_idx ON public.ai_feedback USING btree (user_id, created_at);


--
-- Name: ai_feedback_workspace_id_capability_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_feedback_workspace_id_capability_created_at_idx ON public.ai_feedback USING btree (workspace_id, capability, created_at);


--
-- Name: ai_meeting_action_items_session_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_meeting_action_items_session_id_status_idx ON public.ai_meeting_action_items USING btree (session_id, status);


--
-- Name: ai_meeting_decisions_session_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_meeting_decisions_session_id_status_idx ON public.ai_meeting_decisions USING btree (session_id, status);


--
-- Name: ai_meeting_sessions_workspace_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_meeting_sessions_workspace_id_status_idx ON public.ai_meeting_sessions USING btree (workspace_id, status);


--
-- Name: ai_messages_conversation_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_messages_conversation_id_created_at_idx ON public.ai_messages USING btree (conversation_id, created_at);


--
-- Name: ai_personalizations_user_id_type_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_personalizations_user_id_type_created_at_idx ON public.ai_personalizations USING btree (user_id, type, created_at);


--
-- Name: ai_push_records_user_id_read_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_push_records_user_id_read_created_at_idx ON public.ai_push_records USING btree (user_id, read, created_at);


--
-- Name: ai_push_records_workspace_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_push_records_workspace_id_created_at_idx ON public.ai_push_records USING btree (workspace_id, created_at);


--
-- Name: ai_push_schedules_user_id_enabled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_push_schedules_user_id_enabled_idx ON public.ai_push_schedules USING btree (user_id, enabled);


--
-- Name: ai_push_schedules_workspace_id_enabled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_push_schedules_workspace_id_enabled_idx ON public.ai_push_schedules USING btree (workspace_id, enabled);


--
-- Name: ai_usage_limits_workspace_id_user_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ai_usage_limits_workspace_id_user_id_key ON public.ai_usage_limits USING btree (workspace_id, user_id);


--
-- Name: ai_usage_logs_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_usage_logs_user_id_created_at_idx ON public.ai_usage_logs USING btree (user_id, created_at);


--
-- Name: ai_usage_logs_workspace_id_capability_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_usage_logs_workspace_id_capability_created_at_idx ON public.ai_usage_logs USING btree (workspace_id, capability, created_at);


--
-- Name: ai_usage_logs_workspace_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_usage_logs_workspace_id_created_at_idx ON public.ai_usage_logs USING btree (workspace_id, created_at);


--
-- Name: ai_user_behaviors_user_id_action_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_user_behaviors_user_id_action_created_at_idx ON public.ai_user_behaviors USING btree (user_id, action, created_at);


--
-- Name: ai_user_behaviors_workspace_id_capability_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_user_behaviors_workspace_id_capability_created_at_idx ON public.ai_user_behaviors USING btree (workspace_id, capability, created_at);


--
-- Name: ai_voice_commands_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_voice_commands_user_id_created_at_idx ON public.ai_voice_commands USING btree (user_id, created_at);


--
-- Name: ai_voice_preferences_user_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ai_voice_preferences_user_id_key ON public.ai_voice_preferences USING btree (user_id);


--
-- Name: ai_workflow_templates_category_is_public_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_workflow_templates_category_is_public_idx ON public.ai_workflow_templates USING btree (category, is_public);


--
-- Name: ai_workflow_templates_workspace_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_workflow_templates_workspace_id_idx ON public.ai_workflow_templates USING btree (workspace_id);


--
-- Name: analytics_events_name_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_events_name_created_at_idx ON public.analytics_events USING btree (name, created_at);


--
-- Name: analytics_events_session_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_events_session_id_created_at_idx ON public.analytics_events USING btree (session_id, created_at);


--
-- Name: analytics_events_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_events_user_id_created_at_idx ON public.analytics_events USING btree (user_id, created_at);


--
-- Name: analytics_events_workspace_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_events_workspace_id_created_at_idx ON public.analytics_events USING btree (workspace_id, created_at);


--
-- Name: announcements_workspace_id_published_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX announcements_workspace_id_published_at_idx ON public.announcements USING btree (workspace_id, published_at);


--
-- Name: approval_cc_records_user_id_read_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX approval_cc_records_user_id_read_at_idx ON public.approval_cc_records USING btree (user_id, read_at);


--
-- Name: approval_delegates_delegate_to_id_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX approval_delegates_delegate_to_id_active_idx ON public.approval_delegates USING btree (delegate_to_id, active);


--
-- Name: approval_instances_applicant_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX approval_instances_applicant_id_status_idx ON public.approval_instances USING btree (applicant_id, status);


--
-- Name: approval_instances_workspace_id_priority_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX approval_instances_workspace_id_priority_status_idx ON public.approval_instances USING btree (workspace_id, priority, status);


--
-- Name: approval_instances_workspace_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX approval_instances_workspace_id_status_idx ON public.approval_instances USING btree (workspace_id, status);


--
-- Name: approval_operations_instance_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX approval_operations_instance_id_created_at_idx ON public.approval_operations USING btree (instance_id, created_at);


--
-- Name: approval_operations_instance_id_node_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX approval_operations_instance_id_node_id_idx ON public.approval_operations USING btree (instance_id, node_id);


--
-- Name: approval_templates_workspace_id_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX approval_templates_workspace_id_active_idx ON public.approval_templates USING btree (workspace_id, active);


--
-- Name: approval_templates_workspace_id_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX approval_templates_workspace_id_category_idx ON public.approval_templates USING btree (workspace_id, category);


--
-- Name: assistant_conversations_user_id_workspace_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assistant_conversations_user_id_workspace_id_idx ON public.assistant_conversations USING btree (user_id, workspace_id);


--
-- Name: assistant_messages_conversation_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assistant_messages_conversation_id_idx ON public.assistant_messages USING btree (conversation_id);


--
-- Name: calendar_connections_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calendar_connections_user_id_idx ON public.calendar_connections USING btree (user_id);


--
-- Name: calendar_connections_user_id_provider_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX calendar_connections_user_id_provider_key ON public.calendar_connections USING btree (user_id, provider);


--
-- Name: calendar_events_workspace_id_end_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calendar_events_workspace_id_end_at_idx ON public.calendar_events USING btree (workspace_id, end_at);


--
-- Name: calendar_events_workspace_id_start_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calendar_events_workspace_id_start_at_idx ON public.calendar_events USING btree (workspace_id, start_at);


--
-- Name: chat_presences_conversation_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_presences_conversation_id_idx ON public.chat_presences USING btree (conversation_id);


--
-- Name: chat_presences_task_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_presences_task_id_idx ON public.chat_presences USING btree (task_id);


--
-- Name: comments_task_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX comments_task_id_idx ON public.comments USING btree (task_id);


--
-- Name: comments_workspace_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX comments_workspace_id_idx ON public.comments USING btree (workspace_id);


--
-- Name: contact_groups_workspace_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contact_groups_workspace_id_idx ON public.contact_groups USING btree (workspace_id);


--
-- Name: contacts_workspace_id_group_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contacts_workspace_id_group_id_idx ON public.contacts USING btree (workspace_id, group_id);


--
-- Name: contacts_workspace_id_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contacts_workspace_id_name_idx ON public.contacts USING btree (workspace_id, name);


--
-- Name: conversation_members_conversation_id_user_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX conversation_members_conversation_id_user_id_key ON public.conversation_members USING btree (conversation_id, user_id);


--
-- Name: conversation_members_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversation_members_user_id_idx ON public.conversation_members USING btree (user_id);


--
-- Name: conversations_workspace_id_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversations_workspace_id_updated_at_idx ON public.conversations USING btree (workspace_id, updated_at);


--
-- Name: database_fields_database_id_sort_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX database_fields_database_id_sort_order_idx ON public.database_fields USING btree (database_id, sort_order);


--
-- Name: database_records_database_id_sort_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX database_records_database_id_sort_order_idx ON public.database_records USING btree (database_id, sort_order);


--
-- Name: database_views_database_id_sort_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX database_views_database_id_sort_order_idx ON public.database_views USING btree (database_id, sort_order);


--
-- Name: databases_space_id_folder_id_sort_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX databases_space_id_folder_id_sort_order_idx ON public.databases USING btree (space_id, folder_id, sort_order);


--
-- Name: databases_workspace_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX databases_workspace_id_idx ON public.databases USING btree (workspace_id);


--
-- Name: decision_action_items_decision_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX decision_action_items_decision_id_idx ON public.decision_action_items USING btree (decision_id);


--
-- Name: decision_action_items_task_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX decision_action_items_task_id_idx ON public.decision_action_items USING btree (task_id);


--
-- Name: decision_versions_decision_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX decision_versions_decision_id_idx ON public.decision_versions USING btree (decision_id);


--
-- Name: decision_versions_workspace_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX decision_versions_workspace_id_idx ON public.decision_versions USING btree (workspace_id);


--
-- Name: decisions_task_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX decisions_task_id_idx ON public.decisions USING btree (task_id);


--
-- Name: decisions_workspace_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX decisions_workspace_id_idx ON public.decisions USING btree (workspace_id);


--
-- Name: document_comments_document_id_anchor_path_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_comments_document_id_anchor_path_idx ON public.document_comments USING btree (document_id, anchor_path);


--
-- Name: document_comments_document_id_resolved_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_comments_document_id_resolved_idx ON public.document_comments USING btree (document_id, resolved);


--
-- Name: document_comments_workspace_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_comments_workspace_id_idx ON public.document_comments USING btree (workspace_id);


--
-- Name: document_permissions_document_id_grantee_type_grantee_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX document_permissions_document_id_grantee_type_grantee_id_key ON public.document_permissions USING btree (document_id, grantee_type, grantee_id);


--
-- Name: document_permissions_document_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_permissions_document_id_idx ON public.document_permissions USING btree (document_id);


--
-- Name: document_permissions_workspace_id_grantee_type_grantee_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_permissions_workspace_id_grantee_type_grantee_id_idx ON public.document_permissions USING btree (workspace_id, grantee_type, grantee_id);


--
-- Name: document_versions_document_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_versions_document_id_created_at_idx ON public.document_versions USING btree (document_id, created_at);


--
-- Name: document_versions_workspace_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_versions_workspace_id_idx ON public.document_versions USING btree (workspace_id);


--
-- Name: documents_share_slug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX documents_share_slug_idx ON public.documents USING btree (share_slug) WHERE (share_slug IS NOT NULL);


--
-- Name: documents_space_id_folder_id_sort_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_space_id_folder_id_sort_order_idx ON public.documents USING btree (space_id, folder_id, sort_order);


--
-- Name: documents_workspace_id_deleted_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_workspace_id_deleted_at_idx ON public.documents USING btree (workspace_id, deleted_at);


--
-- Name: documents_workspace_id_title_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_workspace_id_title_idx ON public.documents USING btree (workspace_id, title);


--
-- Name: documents_workspace_id_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_workspace_id_updated_at_idx ON public.documents USING btree (workspace_id, updated_at);


--
-- Name: email_accounts_user_id_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX email_accounts_user_id_email_key ON public.email_accounts USING btree (user_id, email);


--
-- Name: email_accounts_workspace_id_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_accounts_workspace_id_user_id_idx ON public.email_accounts USING btree (workspace_id, user_id);


--
-- Name: favorites_user_id_target_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX favorites_user_id_target_type_idx ON public.favorites USING btree (user_id, target_type);


--
-- Name: favorites_user_id_target_type_target_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX favorites_user_id_target_type_target_id_key ON public.favorites USING btree (user_id, target_type, target_id);


--
-- Name: favorites_workspace_id_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX favorites_workspace_id_user_id_idx ON public.favorites USING btree (workspace_id, user_id);


--
-- Name: file_assets_sha256_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX file_assets_sha256_idx ON public.file_assets USING btree (sha256);


--
-- Name: file_assets_workspace_id_folder_id_sort_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX file_assets_workspace_id_folder_id_sort_order_idx ON public.file_assets USING btree (workspace_id, folder_id, sort_order);


--
-- Name: file_versions_file_asset_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX file_versions_file_asset_id_created_at_idx ON public.file_versions USING btree (file_asset_id, created_at);


--
-- Name: file_versions_file_asset_id_version_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX file_versions_file_asset_id_version_key ON public.file_versions USING btree (file_asset_id, version);


--
-- Name: folder_permissions_target_type_target_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX folder_permissions_target_type_target_id_idx ON public.folder_permissions USING btree (target_type, target_id);


--
-- Name: folder_permissions_workspace_id_grantee_type_grantee_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX folder_permissions_workspace_id_grantee_type_grantee_id_idx ON public.folder_permissions USING btree (workspace_id, grantee_type, grantee_id);


--
-- Name: folders_space_id_parent_id_sort_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX folders_space_id_parent_id_sort_order_idx ON public.folders USING btree (space_id, parent_id, sort_order);


--
-- Name: folders_workspace_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX folders_workspace_id_idx ON public.folders USING btree (workspace_id);


--
-- Name: form_submissions_form_id_submitted_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX form_submissions_form_id_submitted_at_idx ON public.form_submissions USING btree (form_id, submitted_at);


--
-- Name: forms_workspace_id_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX forms_workspace_id_active_idx ON public.forms USING btree (workspace_id, active);


--
-- Name: idx_decisions_markdown_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_decisions_markdown_trgm ON public.decisions USING gin (markdown public.gin_trgm_ops);


--
-- Name: idx_documents_markdown_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_markdown_trgm ON public.documents USING gin (markdown public.gin_trgm_ops);


--
-- Name: idx_documents_published_markdown_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_published_markdown_trgm ON public.documents USING gin (published_markdown public.gin_trgm_ops);


--
-- Name: idx_messages_body_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_body_trgm ON public.messages USING gin (body public.gin_trgm_ops);


--
-- Name: idx_tasks_description_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_description_trgm ON public.tasks USING gin (description public.gin_trgm_ops);


--
-- Name: idx_tasks_title_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_title_trgm ON public.tasks USING gin (title public.gin_trgm_ops);


--
-- Name: idx_users_online_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_online_at ON public.users USING btree (online_at DESC) WHERE (online_at IS NOT NULL);


--
-- Name: invitations_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invitations_email_idx ON public.invitations USING btree (email);


--
-- Name: invitations_token_hash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX invitations_token_hash_key ON public.invitations USING btree (token_hash);


--
-- Name: key_results_objective_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX key_results_objective_id_idx ON public.key_results USING btree (objective_id);


--
-- Name: knowledge_edges_source_node_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_edges_source_node_id_idx ON public.knowledge_edges USING btree (source_node_id);


--
-- Name: knowledge_edges_target_node_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_edges_target_node_id_idx ON public.knowledge_edges USING btree (target_node_id);


--
-- Name: knowledge_edges_workspace_id_relation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_edges_workspace_id_relation_idx ON public.knowledge_edges USING btree (workspace_id, relation);


--
-- Name: knowledge_nodes_workspace_id_source_type_source_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_nodes_workspace_id_source_type_source_id_idx ON public.knowledge_nodes USING btree (workspace_id, source_type, source_id);


--
-- Name: knowledge_nodes_workspace_id_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_nodes_workspace_id_type_idx ON public.knowledge_nodes USING btree (workspace_id, type);


--
-- Name: labels_workspace_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX labels_workspace_id_idx ON public.labels USING btree (workspace_id);


--
-- Name: labels_workspace_id_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX labels_workspace_id_name_key ON public.labels USING btree (workspace_id, name);


--
-- Name: mails_workspace_id_account_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mails_workspace_id_account_id_status_idx ON public.mails USING btree (workspace_id, account_id, status);


--
-- Name: mails_workspace_id_status_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mails_workspace_id_status_created_at_idx ON public.mails USING btree (workspace_id, status, created_at);


--
-- Name: meeting_minutes_meeting_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX meeting_minutes_meeting_id_idx ON public.meeting_minutes USING btree (meeting_id);


--
-- Name: meeting_minutes_workspace_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX meeting_minutes_workspace_id_created_at_idx ON public.meeting_minutes USING btree (workspace_id, created_at);


--
-- Name: meeting_participants_meeting_id_left_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX meeting_participants_meeting_id_left_at_idx ON public.meeting_participants USING btree (meeting_id, left_at);


--
-- Name: meeting_participants_meeting_id_user_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX meeting_participants_meeting_id_user_id_key ON public.meeting_participants USING btree (meeting_id, user_id);


--
-- Name: meeting_participants_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX meeting_participants_user_id_idx ON public.meeting_participants USING btree (user_id);


--
-- Name: meetings_created_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX meetings_created_by_idx ON public.meetings USING btree (created_by);


--
-- Name: meetings_room_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX meetings_room_name_key ON public.meetings USING btree (room_name);


--
-- Name: meetings_workspace_id_scheduled_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX meetings_workspace_id_scheduled_at_idx ON public.meetings USING btree (workspace_id, scheduled_at);


--
-- Name: meetings_workspace_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX meetings_workspace_id_status_idx ON public.meetings USING btree (workspace_id, status);


--
-- Name: member_permissions_workspace_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_permissions_workspace_id_idx ON public.member_permissions USING btree (workspace_id);


--
-- Name: members_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX members_user_id_idx ON public.members USING btree (user_id);


--
-- Name: members_workspace_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX members_workspace_id_idx ON public.members USING btree (workspace_id);


--
-- Name: message_attachments_message_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX message_attachments_message_id_idx ON public.message_attachments USING btree (message_id);


--
-- Name: message_attachments_workspace_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX message_attachments_workspace_id_idx ON public.message_attachments USING btree (workspace_id);


--
-- Name: message_reads_message_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX message_reads_message_id_idx ON public.message_reads USING btree (message_id);


--
-- Name: message_reads_message_id_user_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX message_reads_message_id_user_id_key ON public.message_reads USING btree (message_id, user_id);


--
-- Name: message_reads_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX message_reads_user_id_idx ON public.message_reads USING btree (user_id);


--
-- Name: messages_body_tsv_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX messages_body_tsv_idx ON public.messages USING gin (body_tsv);


--
-- Name: messages_conversation_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX messages_conversation_id_created_at_idx ON public.messages USING btree (conversation_id, created_at);


--
-- Name: messages_task_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX messages_task_id_created_at_idx ON public.messages USING btree (task_id, created_at);


--
-- Name: messages_workspace_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX messages_workspace_id_idx ON public.messages USING btree (workspace_id);


--
-- Name: milestones_workspace_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX milestones_workspace_id_idx ON public.milestones USING btree (workspace_id);


--
-- Name: notification_preferences_user_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notification_preferences_user_id_key ON public.notification_preferences USING btree (user_id);


--
-- Name: notifications_user_id_workspace_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_user_id_workspace_id_idx ON public.notifications USING btree (user_id, workspace_id);


--
-- Name: notifications_workspace_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_workspace_id_idx ON public.notifications USING btree (workspace_id);


--
-- Name: notifications_workspace_id_user_id_read_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_workspace_id_user_id_read_idx ON public.notifications USING btree (workspace_id, user_id, read);


--
-- Name: objectives_workspace_id_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX objectives_workspace_id_period_idx ON public.objectives USING btree (workspace_id, period);


--
-- Name: objectives_workspace_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX objectives_workspace_id_status_idx ON public.objectives USING btree (workspace_id, status);


--
-- Name: permission_audit_logs_target_type_target_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX permission_audit_logs_target_type_target_id_created_at_idx ON public.permission_audit_logs USING btree (target_type, target_id, created_at);


--
-- Name: permission_audit_logs_workspace_id_grantee_type_grantee_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX permission_audit_logs_workspace_id_grantee_type_grantee_id_idx ON public.permission_audit_logs USING btree (workspace_id, grantee_type, grantee_id);


--
-- Name: project_templates_workspace_id_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_templates_workspace_id_category_idx ON public.project_templates USING btree (workspace_id, category);


--
-- Name: push_subscriptions_user_id_endpoint_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX push_subscriptions_user_id_endpoint_key ON public.push_subscriptions USING btree (user_id, endpoint);


--
-- Name: push_subscriptions_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX push_subscriptions_user_id_idx ON public.push_subscriptions USING btree (user_id);


--
-- Name: push_tokens_token_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX push_tokens_token_idx ON public.push_tokens USING btree (token);


--
-- Name: push_tokens_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX push_tokens_user_id_idx ON public.push_tokens USING btree (user_id);


--
-- Name: push_tokens_user_id_platform_token_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX push_tokens_user_id_platform_token_key ON public.push_tokens USING btree (user_id, platform, token);


--
-- Name: remote_control_sessions_initiator_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX remote_control_sessions_initiator_id_status_idx ON public.remote_control_sessions USING btree (initiator_id, status);


--
-- Name: remote_control_sessions_target_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX remote_control_sessions_target_id_status_idx ON public.remote_control_sessions USING btree (target_id, status);


--
-- Name: remote_control_sessions_workspace_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX remote_control_sessions_workspace_id_status_idx ON public.remote_control_sessions USING btree (workspace_id, status);


--
-- Name: sessions_token_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sessions_token_key ON public.sessions USING btree (token);


--
-- Name: sessions_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_user_id_idx ON public.sessions USING btree (user_id);


--
-- Name: share_access_logs_entity_type_entity_id_accessed_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX share_access_logs_entity_type_entity_id_accessed_at_idx ON public.share_access_logs USING btree (entity_type, entity_id, accessed_at);


--
-- Name: share_access_logs_workspace_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX share_access_logs_workspace_id_idx ON public.share_access_logs USING btree (workspace_id);


--
-- Name: share_link_permissions_document_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX share_link_permissions_document_id_idx ON public.share_link_permissions USING btree (document_id);


--
-- Name: spaces_workspace_id_sort_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX spaces_workspace_id_sort_order_idx ON public.spaces USING btree (workspace_id, sort_order);


--
-- Name: subscriptions_stripe_customer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subscriptions_stripe_customer_id_idx ON public.subscriptions USING btree (stripe_customer_id);


--
-- Name: subscriptions_workspace_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX subscriptions_workspace_id_key ON public.subscriptions USING btree (workspace_id);


--
-- Name: task_calendar_events_connection_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX task_calendar_events_connection_id_idx ON public.task_calendar_events USING btree (connection_id);


--
-- Name: task_calendar_events_task_id_connection_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX task_calendar_events_task_id_connection_id_key ON public.task_calendar_events USING btree (task_id, connection_id);


--
-- Name: task_labels_label_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX task_labels_label_id_idx ON public.task_labels USING btree (label_id);


--
-- Name: tasks_assignee_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_assignee_id_idx ON public.tasks USING btree (assignee_id);


--
-- Name: tasks_parent_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_parent_id_idx ON public.tasks USING btree (parent_id);


--
-- Name: tasks_share_slug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tasks_share_slug_idx ON public.tasks USING btree (share_slug) WHERE (share_slug IS NOT NULL);


--
-- Name: tasks_workspace_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_workspace_id_created_at_idx ON public.tasks USING btree (workspace_id, created_at);


--
-- Name: tasks_workspace_id_deleted_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_workspace_id_deleted_at_idx ON public.tasks USING btree (workspace_id, deleted_at);


--
-- Name: tasks_workspace_id_milestone_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_workspace_id_milestone_id_idx ON public.tasks USING btree (workspace_id, milestone_id);


--
-- Name: tasks_workspace_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_workspace_id_status_idx ON public.tasks USING btree (workspace_id, status);


--
-- Name: temporary_grants_user_id_workspace_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX temporary_grants_user_id_workspace_id_key ON public.temporary_grants USING btree (user_id, workspace_id);


--
-- Name: temporary_grants_workspace_id_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX temporary_grants_workspace_id_expires_at_idx ON public.temporary_grants USING btree (workspace_id, expires_at);


--
-- Name: time_entries_task_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX time_entries_task_id_idx ON public.time_entries USING btree (task_id);


--
-- Name: time_entries_workspace_id_user_id_start_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX time_entries_workspace_id_user_id_start_time_idx ON public.time_entries USING btree (workspace_id, user_id, start_time);


--
-- Name: uq_chat_presences_conversation_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_chat_presences_conversation_user ON public.chat_presences USING btree (conversation_id, user_id);


--
-- Name: uq_chat_presences_task_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_chat_presences_task_user ON public.chat_presences USING btree (task_id, user_id);


--
-- Name: uq_conversations_task_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_conversations_task_id ON public.conversations USING btree (task_id);


--
-- Name: uq_doc_versions_doc_version; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_doc_versions_doc_version ON public.document_versions USING btree (document_id, version);


--
-- Name: uq_invitations_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_invitations_pending ON public.invitations USING btree (workspace_id, email) WHERE (accepted_at IS NULL);


--
-- Name: uq_member_perm; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_member_perm ON public.member_permissions USING btree (workspace_id, role, module);


--
-- Name: uq_spaces_workspace_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_spaces_workspace_name ON public.spaces USING btree (workspace_id, name);


--
-- Name: user_dashboard_prefs_user_id_workspace_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_dashboard_prefs_user_id_workspace_id_key ON public.user_dashboard_prefs USING btree (user_id, workspace_id);


--
-- Name: users_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email);


--
-- Name: whiteboards_workspace_id_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX whiteboards_workspace_id_updated_at_idx ON public.whiteboards USING btree (workspace_id, updated_at);


--
-- Name: wiki_pages_content_tsv_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_pages_content_tsv_idx ON public.wiki_pages USING gin (content_tsv);


--
-- Name: wiki_pages_workspace_id_parent_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_pages_workspace_id_parent_id_idx ON public.wiki_pages USING btree (workspace_id, parent_id);


--
-- Name: wiki_pages_workspace_id_slug_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX wiki_pages_workspace_id_slug_key ON public.wiki_pages USING btree (workspace_id, slug);


--
-- Name: wiki_pages_workspace_id_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_pages_workspace_id_updated_at_idx ON public.wiki_pages USING btree (workspace_id, updated_at);


--
-- Name: workflow_executions_workflow_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workflow_executions_workflow_id_created_at_idx ON public.workflow_executions USING btree (workflow_id, created_at);


--
-- Name: workflow_executions_workspace_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workflow_executions_workspace_id_status_idx ON public.workflow_executions USING btree (workspace_id, status);


--
-- Name: workflows_workspace_id_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workflows_workspace_id_active_idx ON public.workflows USING btree (workspace_id, active);


--
-- Name: workspaces_owner_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspaces_owner_id_idx ON public.workspaces USING btree (owner_id);


--
-- Name: workspaces_slug_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workspaces_slug_key ON public.workspaces USING btree (slug);


-- ─── L36 修复：对齐 Prisma schema 中存在但 SQL schema 缺失的索引 ──────────────
-- 以下索引在 web/prisma/schema.prisma 的 @@index 中已定义，但 SQL schema 缺失，
-- 导致 Prisma migrate 产生 drift 或生产查询走非预期索引。此处补齐。

-- tasks: Prisma 有 (workspaceId, assigneeId) / (workspaceId, sortOrder) / (workspaceId, status, sortOrder)
CREATE INDEX tasks_workspace_id_assignee_id_idx ON public.tasks USING btree (workspace_id, assignee_id);
CREATE INDEX tasks_workspace_id_sort_order_idx ON public.tasks USING btree (workspace_id, sort_order);
CREATE INDEX tasks_workspace_id_status_sort_order_idx ON public.tasks USING btree (workspace_id, status, sort_order);

-- notifications: Prisma 有 (workspaceId, createdAt) / (workspaceId, read, createdAt)
CREATE INDEX notifications_workspace_id_created_at_idx ON public.notifications USING btree (workspace_id, created_at);
CREATE INDEX notifications_workspace_id_read_created_at_idx ON public.notifications USING btree (workspace_id, read, created_at);

-- comments: Prisma 有 (taskId, createdAt)，SQL 仅有 (task_id) 单列
CREATE INDEX comments_task_id_created_at_idx ON public.comments USING btree (task_id, created_at);

-- analytics_events: Prisma 有 (workspaceId, name, createdAt)
CREATE INDEX analytics_events_workspace_id_name_created_at_idx ON public.analytics_events USING btree (workspace_id, name, created_at);

-- decisions: Prisma 有 (taskId, version)，SQL 仅有 (task_id) 单列
CREATE INDEX decisions_task_id_version_idx ON public.decisions USING btree (task_id, version);

-- sessions: Prisma 有 (userId, expiresAt)，SQL 仅有 (user_id) 单列
CREATE INDEX sessions_user_id_expires_at_idx ON public.sessions USING btree (user_id, expires_at);


--
-- Name: yjs_persistence_document_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX yjs_persistence_document_id_key ON public.yjs_persistence USING btree (document_id);


--
-- Name: accounts accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ai_agent_messages ai_agent_messages_from_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_agent_messages
    ADD CONSTRAINT ai_agent_messages_from_agent_id_fkey FOREIGN KEY (from_agent_id) REFERENCES public.ai_agents(id) ON DELETE CASCADE;


--
-- Name: ai_agent_messages ai_agent_messages_to_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_agent_messages
    ADD CONSTRAINT ai_agent_messages_to_agent_id_fkey FOREIGN KEY (to_agent_id) REFERENCES public.ai_agents(id) ON DELETE SET NULL;


--
-- Name: ai_agent_messages ai_agent_messages_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_agent_messages
    ADD CONSTRAINT ai_agent_messages_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: ai_agents ai_agents_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_agents
    ADD CONSTRAINT ai_agents_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: ai_analysis_reports ai_analysis_reports_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_analysis_reports
    ADD CONSTRAINT ai_analysis_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ai_analysis_reports ai_analysis_reports_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_analysis_reports
    ADD CONSTRAINT ai_analysis_reports_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: ai_conversations ai_conversations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_conversations
    ADD CONSTRAINT ai_conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ai_conversations ai_conversations_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_conversations
    ADD CONSTRAINT ai_conversations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ai_feedback ai_feedback_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_feedback
    ADD CONSTRAINT ai_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ai_feedback ai_feedback_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_feedback
    ADD CONSTRAINT ai_feedback_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ai_meeting_action_items ai_meeting_action_items_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_meeting_action_items
    ADD CONSTRAINT ai_meeting_action_items_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.ai_meeting_sessions(id) ON DELETE CASCADE;


--
-- Name: ai_meeting_action_items ai_meeting_action_items_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_meeting_action_items
    ADD CONSTRAINT ai_meeting_action_items_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: ai_meeting_decisions ai_meeting_decisions_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_meeting_decisions
    ADD CONSTRAINT ai_meeting_decisions_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.ai_meeting_sessions(id) ON DELETE CASCADE;


--
-- Name: ai_meeting_decisions ai_meeting_decisions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_meeting_decisions
    ADD CONSTRAINT ai_meeting_decisions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: ai_meeting_sessions ai_meeting_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_meeting_sessions
    ADD CONSTRAINT ai_meeting_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ai_meeting_sessions ai_meeting_sessions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_meeting_sessions
    ADD CONSTRAINT ai_meeting_sessions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: ai_messages ai_messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_messages
    ADD CONSTRAINT ai_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.ai_conversations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ai_personalizations ai_personalizations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_personalizations
    ADD CONSTRAINT ai_personalizations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ai_personalizations ai_personalizations_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_personalizations
    ADD CONSTRAINT ai_personalizations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: ai_push_records ai_push_records_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_push_records
    ADD CONSTRAINT ai_push_records_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.ai_push_schedules(id) ON DELETE CASCADE;


--
-- Name: ai_push_records ai_push_records_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_push_records
    ADD CONSTRAINT ai_push_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ai_push_records ai_push_records_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_push_records
    ADD CONSTRAINT ai_push_records_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: ai_push_schedules ai_push_schedules_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_push_schedules
    ADD CONSTRAINT ai_push_schedules_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ai_push_schedules ai_push_schedules_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_push_schedules
    ADD CONSTRAINT ai_push_schedules_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: ai_usage_limits ai_usage_limits_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_limits
    ADD CONSTRAINT ai_usage_limits_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ai_usage_limits ai_usage_limits_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_limits
    ADD CONSTRAINT ai_usage_limits_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ai_usage_logs ai_usage_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_logs
    ADD CONSTRAINT ai_usage_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ai_usage_logs ai_usage_logs_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_logs
    ADD CONSTRAINT ai_usage_logs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ai_user_behaviors ai_user_behaviors_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_user_behaviors
    ADD CONSTRAINT ai_user_behaviors_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ai_user_behaviors ai_user_behaviors_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_user_behaviors
    ADD CONSTRAINT ai_user_behaviors_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: ai_voice_commands ai_voice_commands_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_voice_commands
    ADD CONSTRAINT ai_voice_commands_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ai_voice_commands ai_voice_commands_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_voice_commands
    ADD CONSTRAINT ai_voice_commands_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: ai_voice_preferences ai_voice_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_voice_preferences
    ADD CONSTRAINT ai_voice_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ai_workflow_templates ai_workflow_templates_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_workflow_templates
    ADD CONSTRAINT ai_workflow_templates_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: analytics_events analytics_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: analytics_events analytics_events_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: announcements announcements_published_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_published_by_fkey FOREIGN KEY (published_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: announcements announcements_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: approval_cc_records approval_cc_records_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_cc_records
    ADD CONSTRAINT approval_cc_records_instance_id_fkey FOREIGN KEY (instance_id) REFERENCES public.approval_instances(id) ON DELETE CASCADE;


--
-- Name: approval_cc_records approval_cc_records_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_cc_records
    ADD CONSTRAINT approval_cc_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: approval_cc_records approval_cc_records_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_cc_records
    ADD CONSTRAINT approval_cc_records_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: approval_delegates approval_delegates_delegate_to_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_delegates
    ADD CONSTRAINT approval_delegates_delegate_to_id_fkey FOREIGN KEY (delegate_to_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: approval_delegates approval_delegates_delegator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_delegates
    ADD CONSTRAINT approval_delegates_delegator_id_fkey FOREIGN KEY (delegator_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: approval_delegates approval_delegates_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_delegates
    ADD CONSTRAINT approval_delegates_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: approval_instances approval_instances_applicant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_instances
    ADD CONSTRAINT approval_instances_applicant_id_fkey FOREIGN KEY (applicant_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: approval_instances approval_instances_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_instances
    ADD CONSTRAINT approval_instances_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.approval_templates(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: approval_instances approval_instances_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_instances
    ADD CONSTRAINT approval_instances_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: approval_operations approval_operations_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_operations
    ADD CONSTRAINT approval_operations_instance_id_fkey FOREIGN KEY (instance_id) REFERENCES public.approval_instances(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: approval_operations approval_operations_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_operations
    ADD CONSTRAINT approval_operations_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: approval_operations approval_operations_transfer_to_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_operations
    ADD CONSTRAINT approval_operations_transfer_to_id_fkey FOREIGN KEY (transfer_to_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: approval_operations approval_operations_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_operations
    ADD CONSTRAINT approval_operations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: approval_templates approval_templates_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_templates
    ADD CONSTRAINT approval_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: approval_templates approval_templates_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_templates
    ADD CONSTRAINT approval_templates_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: assistant_messages assistant_messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_messages
    ADD CONSTRAINT assistant_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.assistant_conversations(id) ON DELETE CASCADE;


--
-- Name: calendar_connections calendar_connections_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_connections
    ADD CONSTRAINT calendar_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: calendar_events calendar_events_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: calendar_events calendar_events_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: chat_presences chat_presences_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_presences
    ADD CONSTRAINT chat_presences_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: chat_presences chat_presences_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_presences
    ADD CONSTRAINT chat_presences_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: chat_presences chat_presences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_presences
    ADD CONSTRAINT chat_presences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: comments comments_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: comments comments_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: comments comments_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: contact_groups contact_groups_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_groups
    ADD CONSTRAINT contact_groups_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: contacts contacts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: contacts contacts_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.contact_groups(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: contacts contacts_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: conversation_members conversation_members_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_members
    ADD CONSTRAINT conversation_members_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: conversation_members conversation_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_members
    ADD CONSTRAINT conversation_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: conversations conversations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: conversations conversations_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: database_fields database_fields_database_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.database_fields
    ADD CONSTRAINT database_fields_database_id_fkey FOREIGN KEY (database_id) REFERENCES public.databases(id) ON DELETE CASCADE;


--
-- Name: database_records database_records_database_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.database_records
    ADD CONSTRAINT database_records_database_id_fkey FOREIGN KEY (database_id) REFERENCES public.databases(id) ON DELETE CASCADE;


--
-- Name: database_views database_views_database_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.database_views
    ADD CONSTRAINT database_views_database_id_fkey FOREIGN KEY (database_id) REFERENCES public.databases(id) ON DELETE CASCADE;


--
-- Name: databases databases_folder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.databases
    ADD CONSTRAINT databases_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.folders(id) ON DELETE SET NULL;


--
-- Name: databases databases_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.databases
    ADD CONSTRAINT databases_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE SET NULL;


--
-- Name: databases databases_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.databases
    ADD CONSTRAINT databases_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: decision_action_items decision_action_items_assignee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_action_items
    ADD CONSTRAINT decision_action_items_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: decision_action_items decision_action_items_decision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_action_items
    ADD CONSTRAINT decision_action_items_decision_id_fkey FOREIGN KEY (decision_id) REFERENCES public.decisions(id) ON DELETE CASCADE;


--
-- Name: decision_action_items decision_action_items_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_action_items
    ADD CONSTRAINT decision_action_items_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;


--
-- Name: decision_versions decision_versions_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_versions
    ADD CONSTRAINT decision_versions_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: decision_versions decision_versions_decision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_versions
    ADD CONSTRAINT decision_versions_decision_id_fkey FOREIGN KEY (decision_id) REFERENCES public.decisions(id) ON DELETE CASCADE;


--
-- Name: decision_versions decision_versions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_versions
    ADD CONSTRAINT decision_versions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: decisions decisions_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decisions
    ADD CONSTRAINT decisions_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: decisions decisions_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decisions
    ADD CONSTRAINT decisions_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: decisions decisions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decisions
    ADD CONSTRAINT decisions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: document_comments document_comments_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_comments
    ADD CONSTRAINT document_comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: document_comments document_comments_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_comments
    ADD CONSTRAINT document_comments_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: document_comments document_comments_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_comments
    ADD CONSTRAINT document_comments_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.document_comments(id) ON DELETE CASCADE;


--
-- Name: document_comments document_comments_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_comments
    ADD CONSTRAINT document_comments_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: document_comments document_comments_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_comments
    ADD CONSTRAINT document_comments_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: document_permissions document_permissions_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_permissions
    ADD CONSTRAINT document_permissions_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: document_permissions document_permissions_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_permissions
    ADD CONSTRAINT document_permissions_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: document_permissions document_permissions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_permissions
    ADD CONSTRAINT document_permissions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: document_versions document_versions_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_versions
    ADD CONSTRAINT document_versions_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: document_versions document_versions_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_versions
    ADD CONSTRAINT document_versions_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: document_versions document_versions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_versions
    ADD CONSTRAINT document_versions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: documents documents_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: documents documents_folder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.folders(id) ON DELETE SET NULL;


--
-- Name: documents documents_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE SET NULL;


--
-- Name: documents documents_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: email_accounts email_accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_accounts
    ADD CONSTRAINT email_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: email_accounts email_accounts_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_accounts
    ADD CONSTRAINT email_accounts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: favorites favorites_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: favorites favorites_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: file_assets file_assets_folder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_assets
    ADD CONSTRAINT file_assets_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.folders(id) ON DELETE SET NULL;


--
-- Name: file_assets file_assets_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_assets
    ADD CONSTRAINT file_assets_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: file_assets file_assets_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_assets
    ADD CONSTRAINT file_assets_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: file_versions file_versions_file_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_versions
    ADD CONSTRAINT file_versions_file_asset_id_fkey FOREIGN KEY (file_asset_id) REFERENCES public.file_assets(id) ON DELETE CASCADE;


--
-- Name: file_versions file_versions_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_versions
    ADD CONSTRAINT file_versions_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: folder_permissions folder_permissions_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.folder_permissions
    ADD CONSTRAINT folder_permissions_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: folder_permissions folder_permissions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.folder_permissions
    ADD CONSTRAINT folder_permissions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: folders folders_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.folders
    ADD CONSTRAINT folders_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.folders(id) ON DELETE CASCADE;


--
-- Name: folders folders_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.folders
    ADD CONSTRAINT folders_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE CASCADE;


--
-- Name: folders folders_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.folders
    ADD CONSTRAINT folders_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: form_submissions form_submissions_form_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_submissions
    ADD CONSTRAINT form_submissions_form_id_fkey FOREIGN KEY (form_id) REFERENCES public.forms(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: form_submissions form_submissions_submitted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_submissions
    ADD CONSTRAINT form_submissions_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: form_submissions form_submissions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_submissions
    ADD CONSTRAINT form_submissions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: forms forms_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forms
    ADD CONSTRAINT forms_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: forms forms_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forms
    ADD CONSTRAINT forms_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: invitations invitations_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: key_results key_results_objective_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.key_results
    ADD CONSTRAINT key_results_objective_id_fkey FOREIGN KEY (objective_id) REFERENCES public.objectives(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: key_results key_results_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.key_results
    ADD CONSTRAINT key_results_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: knowledge_edges knowledge_edges_source_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_edges
    ADD CONSTRAINT knowledge_edges_source_node_id_fkey FOREIGN KEY (source_node_id) REFERENCES public.knowledge_nodes(id) ON DELETE CASCADE;


--
-- Name: knowledge_edges knowledge_edges_target_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_edges
    ADD CONSTRAINT knowledge_edges_target_node_id_fkey FOREIGN KEY (target_node_id) REFERENCES public.knowledge_nodes(id) ON DELETE CASCADE;


--
-- Name: knowledge_edges knowledge_edges_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_edges
    ADD CONSTRAINT knowledge_edges_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: knowledge_nodes knowledge_nodes_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_nodes
    ADD CONSTRAINT knowledge_nodes_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: labels labels_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.labels
    ADD CONSTRAINT labels_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: mails mails_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mails
    ADD CONSTRAINT mails_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.email_accounts(id) ON DELETE CASCADE;


--
-- Name: mails mails_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mails
    ADD CONSTRAINT mails_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: meeting_minutes meeting_minutes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_minutes
    ADD CONSTRAINT meeting_minutes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: meeting_minutes meeting_minutes_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_minutes
    ADD CONSTRAINT meeting_minutes_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.meetings(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: meeting_minutes meeting_minutes_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_minutes
    ADD CONSTRAINT meeting_minutes_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: meeting_participants meeting_participants_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_participants
    ADD CONSTRAINT meeting_participants_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.meetings(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: meeting_participants meeting_participants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_participants
    ADD CONSTRAINT meeting_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: meetings meetings_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: meetings meetings_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: member_permissions member_permissions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_permissions
    ADD CONSTRAINT member_permissions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: members members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: members members_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: message_attachments message_attachments_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_attachments
    ADD CONSTRAINT message_attachments_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: message_attachments message_attachments_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_attachments
    ADD CONSTRAINT message_attachments_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: message_reads message_reads_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reads
    ADD CONSTRAINT message_reads_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: message_reads message_reads_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reads
    ADD CONSTRAINT message_reads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: messages messages_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: messages messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: messages messages_reply_to_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_reply_to_id_fkey FOREIGN KEY (reply_to_id) REFERENCES public.messages(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: messages messages_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: messages messages_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: milestones milestones_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.milestones
    ADD CONSTRAINT milestones_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: notification_preferences notification_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: objectives objectives_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.objectives
    ADD CONSTRAINT objectives_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: objectives objectives_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.objectives
    ADD CONSTRAINT objectives_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: permission_audit_logs permission_audit_logs_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_audit_logs
    ADD CONSTRAINT permission_audit_logs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: project_templates project_templates_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_templates
    ADD CONSTRAINT project_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: project_templates project_templates_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_templates
    ADD CONSTRAINT project_templates_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: push_tokens push_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_tokens
    ADD CONSTRAINT push_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: remote_control_sessions remote_control_sessions_initiator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_control_sessions
    ADD CONSTRAINT remote_control_sessions_initiator_id_fkey FOREIGN KEY (initiator_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: remote_control_sessions remote_control_sessions_target_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_control_sessions
    ADD CONSTRAINT remote_control_sessions_target_id_fkey FOREIGN KEY (target_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: remote_control_sessions remote_control_sessions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.remote_control_sessions
    ADD CONSTRAINT remote_control_sessions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: share_access_logs share_access_logs_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.share_access_logs
    ADD CONSTRAINT share_access_logs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: share_link_permissions share_link_permissions_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.share_link_permissions
    ADD CONSTRAINT share_link_permissions_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: share_link_permissions share_link_permissions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.share_link_permissions
    ADD CONSTRAINT share_link_permissions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: spaces spaces_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spaces
    ADD CONSTRAINT spaces_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: task_calendar_events task_calendar_events_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_calendar_events
    ADD CONSTRAINT task_calendar_events_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.calendar_connections(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: task_calendar_events task_calendar_events_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_calendar_events
    ADD CONSTRAINT task_calendar_events_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: task_labels task_labels_label_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_labels
    ADD CONSTRAINT task_labels_label_id_fkey FOREIGN KEY (label_id) REFERENCES public.labels(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: task_labels task_labels_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_labels
    ADD CONSTRAINT task_labels_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: tasks tasks_assignee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_milestone_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_milestone_id_fkey FOREIGN KEY (milestone_id) REFERENCES public.milestones(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: tasks tasks_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: tasks tasks_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: temporary_grants temporary_grants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.temporary_grants
    ADD CONSTRAINT temporary_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: temporary_grants temporary_grants_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.temporary_grants
    ADD CONSTRAINT temporary_grants_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: time_entries time_entries_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_entries
    ADD CONSTRAINT time_entries_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: time_entries time_entries_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_entries
    ADD CONSTRAINT time_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: time_entries time_entries_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_entries
    ADD CONSTRAINT time_entries_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_dashboard_prefs user_dashboard_prefs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_dashboard_prefs
    ADD CONSTRAINT user_dashboard_prefs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_dashboard_prefs user_dashboard_prefs_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_dashboard_prefs
    ADD CONSTRAINT user_dashboard_prefs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: whiteboards whiteboards_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whiteboards
    ADD CONSTRAINT whiteboards_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: whiteboards whiteboards_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whiteboards
    ADD CONSTRAINT whiteboards_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: wiki_pages wiki_pages_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_pages
    ADD CONSTRAINT wiki_pages_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: wiki_pages wiki_pages_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_pages
    ADD CONSTRAINT wiki_pages_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.wiki_pages(id) ON DELETE SET NULL;


--
-- Name: wiki_pages wiki_pages_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_pages
    ADD CONSTRAINT wiki_pages_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workflow_executions workflow_executions_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_executions
    ADD CONSTRAINT workflow_executions_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.workflows(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: workflow_executions workflow_executions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_executions
    ADD CONSTRAINT workflow_executions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: workflows workflows_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflows
    ADD CONSTRAINT workflows_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: workflows workflows_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflows
    ADD CONSTRAINT workflows_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: workspaces workspaces_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: yjs_persistence yjs_persistence_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.yjs_persistence
    ADD CONSTRAINT yjs_persistence_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict hnIhb0c8aofcsgw03uvnsIZK6f9sIGcMgpeDZQtdnCaBnKdWX7jhFdFllcjJ4O0


-- ============================================================================
-- RLS 激活与策略（来自 db/rls-activate.sql，2026-10-20 同步版）
-- ============================================================================

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
    'wiki_pages','workflows','workflow_executions',
    -- ADR-010 G4 收编：share_access_logs（workspace_id 写入时反查落列）
    'share_access_logs'
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
-- 2026-10-09：补 cron 逃生口（与 SELECT 的 cron 逃生口对称）——cron/ai-push-web
-- 的过期订阅清理（410 Gone 后 deleteMany）是跨用户操作，无此口在加固模式下
-- 静默删 0 行，死订阅会让后续 cron 永远重试失败。
CREATE POLICY p_push_subscriptions_delete ON push_subscriptions FOR DELETE
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
         OR current_setting('app.auth_op', true) = 'cron');

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
-- 2026-10-09：模板库两类逃生口（此前加固模式下整个模板库是死的）：
--  1) 公开模板（workspace_id IS NULL 且 is_public）：裸行在 workspace_id=GUC 下
--     永不匹配 → 列表为空/详情 404/无法创建公开模板。SELECT+INSERT 补
--     "NULL 且公开"放行；UPDATE/DELETE 刻意不补——公开模板在加固模式下
--     变为只读不可删（比非加固的"任何登录用户可改"更安全；公开模板的
--     归属/权限语义待产品立项后再放开）。
--  2) 按成员资格子查询放行（与 workspaces SELECT 同款模式）：模板详情的
--     by-id 探测无法预知 workspace_id 注入哪个 GUC，按"用户是其成员的
--     工作区"放行后由路由层继续做成员校验。
DROP POLICY IF EXISTS p_ai_workflow_templates_select ON ai_workflow_templates;
CREATE POLICY p_ai_workflow_templates_select ON ai_workflow_templates FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
         OR (workspace_id IS NULL AND is_public = true)
         OR workspace_id IN (SELECT m.workspace_id FROM members m
                             WHERE m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid));
DROP POLICY IF EXISTS p_ai_workflow_templates_insert ON ai_workflow_templates;
CREATE POLICY p_ai_workflow_templates_insert ON ai_workflow_templates FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
              OR (workspace_id IS NULL AND is_public = true));
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

-- ── share_access_logs（工作区级，按 workspace_id 隔离；ADR-010 G4 收编）──
-- workspace_id 在写入时从实体行反查落列（迁移 20261001000001 已对存量行回填）。
-- 历史孤儿行（实体已删除）反查不到归属、workspace_id 为 NULL——NULL 不匹配任何
-- GUC，对应用与公开路径均不可见；此为设计取舍：宁可审计行不可读，也不放错行。
-- 公开路径 /api/documents/share/[token]/verify 凭 token 读出文档行后，用
-- setTxGuc 注入该行 workspace_id 再写日志（见 web/lib/auth.ts setTxGuc）。
-- 无 auth_op 逃生口。ENABLE/FORCE 在本块重复一次，保证块自包含、可重跑。
ALTER TABLE share_access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_access_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_share_access_logs_select ON share_access_logs;
CREATE POLICY p_share_access_logs_select ON share_access_logs FOR SELECT
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_share_access_logs_insert ON share_access_logs;
CREATE POLICY p_share_access_logs_insert ON share_access_logs FOR INSERT
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_share_access_logs_update ON share_access_logs;
CREATE POLICY p_share_access_logs_update ON share_access_logs FOR UPDATE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
DROP POLICY IF EXISTS p_share_access_logs_delete ON share_access_logs;
CREATE POLICY p_share_access_logs_delete ON share_access_logs FOR DELETE
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
