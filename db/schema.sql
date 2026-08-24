-- corps 数据库 schema（由 pg_dump --schema-only 生成 + RLS 层来自 rls-activate.sql）
-- 生成时间: 2026-08-25 04:53:28

-- -- PostgreSQL database dump --  \restrict DuB0QouDvyyebyUUPZ1OlDz8PxiEdzVlk2GnqoQymvnheZ1cDHpw7W442EsAKwc  -- Dumped from database version 18.6 -- Dumped by pg_dump version 18.6  SET statement_timeout = 0; SET lock_timeout = 0; SET idle_in_transaction_session_timeout = 0; SET transaction_timeout = 0; SET client_encoding = 'UTF8'; SET standard_conforming_strings = on; SELECT pg_catalog.set_config('search_path', '', false); SET check_function_bodies = false; SET xmloption = content; SET client_min_messages = warning; SET row_security = off;  -- -- Name: app; Type: SCHEMA; Schema: -; Owner: - --  CREATE SCHEMA app;   -- -- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: - --  CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;   -- -- Name: get_workspace_id(); Type: FUNCTION; Schema: app; Owner: - --  CREATE FUNCTION app.get_workspace_id() RETURNS uuid     LANGUAGE plpgsql SECURITY DEFINER     AS $$ BEGIN   RETURN current_setting('app.workspace_id', true)::uuid; EXCEPTION WHEN others THEN RETURN NULL; END; $$;   -- -- Name: set_workspace_id(uuid); Type: FUNCTION; Schema: app; Owner: - --  CREATE FUNCTION app.set_workspace_id(wid uuid) RETURNS void     LANGUAGE plpgsql SECURITY DEFINER     AS $$ BEGIN   SET LOCAL app.workspace_id = wid; END; $$;   SET default_tablespace = '';  SET default_table_access_method = heap;  -- -- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: - --  CREATE TABLE public._prisma_migrations (     id character varying(36) NOT NULL,     checksum character varying(64) NOT NULL,     finished_at timestamp with time zone,     migration_name character varying(255) NOT NULL,     logs text,     rolled_back_at timestamp with time zone,     started_at timestamp with time zone DEFAULT now() NOT NULL,     applied_steps_count integer DEFAULT 0 NOT NULL );   -- -- Name: accounts; Type: TABLE; Schema: public; Owner: - --  CREATE TABLE public.accounts (     id uuid DEFAULT gen_random_uuid() NOT NULL,     account_id text NOT NULL,     provider_id text NOT NULL,     user_id uuid NOT NULL,     access_token text,     refresh_token text,     id_token text,     access_token_expires_at timestamp with time zone,     refresh_token_expires_at timestamp with time zone,     scope text,     password text,     created_at timestamp with time zone DEFAULT now() NOT NULL,     updated_at timestamp with time zone DEFAULT now() NOT NULL );   -- -- Name: analytics_events; Type: TABLE; Schema: public; Owner: - --  CREATE TABLE public.analytics_events (     id uuid DEFAULT gen_random_uuid() NOT NULL,     user_id uuid,     workspace_id uuid,     name character varying(64) NOT NULL,     props json DEFAULT '{}'::json NOT NULL,     session_id character varying(64),     created_at timestamp with time zone DEFAULT now() NOT NULL );   -- -- Name: comments; Type: TABLE; Schema: public; Owner: - --  CREATE TABLE public.comments (     id uuid DEFAULT gen_random_uuid() NOT NULL,     task_id uuid NOT NULL,     workspace_id uuid NOT NULL,     author_id uuid,     body text NOT NULL,     mentions text[] DEFAULT '{}'::text[] NOT NULL,     created_at timestamp with time zone DEFAULT now() NOT NULL,     updated_at timestamp with time zone DEFAULT now() NOT NULL );   -- -- Name: decision_versions; Type: TABLE; Schema: public; Owner: - --  CREATE TABLE public.decision_versions (     id uuid DEFAULT gen_random_uuid() NOT NULL,     decision_id uuid NOT NULL,     workspace_id uuid NOT NULL,     markdown text NOT NULL,     version integer NOT NULL,     author_id uuid,     created_at timestamp with time zone DEFAULT now() NOT NULL,     CONSTRAINT decision_versions_version_check CHECK ((version >= 1)) );   -- -- Name: decisions; Type: TABLE; Schema: public; Owner: - --  CREATE TABLE public.decisions (     id uuid DEFAULT gen_random_uuid() NOT NULL,     task_id uuid NOT NULL,     workspace_id uuid NOT NULL,     markdown text NOT NULL,     version integer DEFAULT 1 NOT NULL,     author_id uuid,     created_at timestamp with time zone DEFAULT now() NOT NULL,     updated_at timestamp with time zone DEFAULT now() NOT NULL,     CONSTRAINT decisions_version_check CHECK ((version >= 1)) );   -- -- Name: invitations; Type: TABLE; Schema: public; Owner: - --  CREATE TABLE public.invitations (     id uuid DEFAULT gen_random_uuid() NOT NULL,     workspace_id uuid NOT NULL,     email character varying(255) NOT NULL,     token_hash character varying(64) NOT NULL,     role character varying(20) DEFAULT 'member'::character varying NOT NULL,     invited_by uuid NOT NULL,     expires_at timestamp with time zone NOT NULL,     accepted_at timestamp with time zone,     created_at timestamp with time zone DEFAULT now() NOT NULL );   -- -- Name: members; Type: TABLE; Schema: public; Owner: - --  CREATE TABLE public.members (     user_id uuid NOT NULL,     workspace_id uuid NOT NULL,     role character varying(20) DEFAULT 'member'::character varying NOT NULL,     invited_by uuid,     joined_at timestamp with time zone DEFAULT now() NOT NULL,     invited_at timestamp with time zone DEFAULT now() NOT NULL,     CONSTRAINT members_role_check CHECK (((role)::text = ANY ((ARRAY['owner'::character varying, 'admin'::character varying, 'member'::character varying])::text[]))) );   -- -- Name: notifications; Type: TABLE; Schema: public; Owner: - --  CREATE TABLE public.notifications (     id uuid DEFAULT gen_random_uuid() NOT NULL,     workspace_id uuid NOT NULL,     user_id uuid NOT NULL,     type character varying(30) NOT NULL,     entity_id uuid NOT NULL,     entity_title character varying(255) NOT NULL,     read boolean DEFAULT false NOT NULL,     created_at timestamp with time zone DEFAULT now() NOT NULL );   -- -- Name: processed_stripe_events; Type: TABLE; Schema: public; Owner: - --  CREATE TABLE public.processed_stripe_events (     id character varying(255) NOT NULL,     received_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL );   -- -- Name: sessions; Type: TABLE; Schema: public; Owner: - --  CREATE TABLE public.sessions (     id uuid DEFAULT gen_random_uuid() NOT NULL,     expires_at timestamp with time zone NOT NULL,     token text NOT NULL,     created_at timestamp with time zone DEFAULT now() NOT NULL,     updated_at timestamp with time zone DEFAULT now() NOT NULL,     ip_address character varying(45),     user_agent character varying(500),     user_id uuid NOT NULL );   -- -- Name: subscriptions; Type: TABLE; Schema: public; Owner: - --  CREATE TABLE public.subscriptions (     id uuid DEFAULT gen_random_uuid() NOT NULL,     workspace_id uuid NOT NULL,     stripe_customer_id character varying(255),     stripe_sub_id character varying(255),     quantity integer DEFAULT 1 NOT NULL,     status character varying(20) DEFAULT 'active'::character varying NOT NULL,     current_period_end timestamp with time zone,     canceled_at timestamp with time zone,     created_at timestamp with time zone DEFAULT now() NOT NULL,     updated_at timestamp with time zone DEFAULT now() NOT NULL,     CONSTRAINT subscriptions_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'past_due'::character varying, 'canceled'::character varying, 'trialing'::character varying, 'incomplete'::character varying])::text[]))) );   -- -- Name: tasks; Type: TABLE; Schema: public; Owner: - --  CREATE TABLE public.tasks (     id uuid DEFAULT gen_random_uuid() NOT NULL,     workspace_id uuid NOT NULL,     title character varying(255) NOT NULL,     description text,     status character varying(20) DEFAULT 'todo'::character varying NOT NULL,     priority character varying(20) DEFAULT 'medium'::character varying NOT NULL,     assignee_id uuid,     due_date timestamp with time zone,     sort_order double precision DEFAULT 0 NOT NULL,     created_by uuid,     created_at timestamp with time zone DEFAULT now() NOT NULL,     updated_at timestamp with time zone DEFAULT now() NOT NULL,     CONSTRAINT tasks_priority_check CHECK (((priority)::text = ANY ((ARRAY['low'::character varying, 'medium'::character varying, 'high'::character varying, 'urgent'::character varying])::text[]))),     CONSTRAINT tasks_status_check CHECK (((status)::text = ANY ((ARRAY['todo'::character varying, 'in_progress'::character varying, 'review'::character varying, 'done'::character varying])::text[]))) );   -- -- Name: users; Type: TABLE; Schema: public; Owner: - --  CREATE TABLE public.users (     id uuid DEFAULT gen_random_uuid() NOT NULL,     name character varying(100),     email character varying(255) NOT NULL,     email_verified boolean DEFAULT false NOT NULL,     avatar_url text,     password_hash text,     created_at timestamp with time zone DEFAULT now() NOT NULL,     updated_at timestamp with time zone DEFAULT now() NOT NULL,     last_login_at timestamp with time zone );   -- -- Name: verifications; Type: TABLE; Schema: public; Owner: - --  CREATE TABLE public.verifications (     id uuid DEFAULT gen_random_uuid() NOT NULL,     identifier text NOT NULL,     value text NOT NULL,     expires_at timestamp with time zone NOT NULL,     created_at timestamp with time zone DEFAULT now() NOT NULL,     updated_at timestamp with time zone DEFAULT now() NOT NULL );   -- -- Name: workspaces; Type: TABLE; Schema: public; Owner: - --  CREATE TABLE public.workspaces (     id uuid DEFAULT gen_random_uuid() NOT NULL,     name character varying(100) NOT NULL,     slug character varying(50) NOT NULL,     owner_id uuid NOT NULL,     plan character varying(20) DEFAULT 'free'::character varying NOT NULL,     seat_limit integer DEFAULT 10 NOT NULL,     created_at timestamp with time zone DEFAULT now() NOT NULL,     updated_at timestamp with time zone DEFAULT now() NOT NULL,     CONSTRAINT workspaces_plan_check CHECK (((plan)::text = ANY ((ARRAY['free'::character varying, 'starter'::character varying, 'pro'::character varying, 'enterprise'::character varying])::text[]))),     CONSTRAINT workspaces_seat_limit_check CHECK (((seat_limit >= 1) AND (seat_limit <= 1000))) );   -- -- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public._prisma_migrations     ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);   -- -- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.accounts     ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);   -- -- Name: analytics_events analytics_events_pkey; Type: CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.analytics_events     ADD CONSTRAINT analytics_events_pkey PRIMARY KEY (id);   -- -- Name: comments comments_pkey; Type: CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.comments     ADD CONSTRAINT comments_pkey PRIMARY KEY (id);   -- -- Name: decision_versions decision_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.decision_versions     ADD CONSTRAINT decision_versions_pkey PRIMARY KEY (id);   -- -- Name: decisions decisions_pkey; Type: CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.decisions     ADD CONSTRAINT decisions_pkey PRIMARY KEY (id);   -- -- Name: invitations invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.invitations     ADD CONSTRAINT invitations_pkey PRIMARY KEY (id);   -- -- Name: members members_pkey; Type: CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.members     ADD CONSTRAINT members_pkey PRIMARY KEY (user_id, workspace_id);   -- -- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.notifications     ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);   -- -- Name: processed_stripe_events processed_stripe_events_pkey; Type: CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.processed_stripe_events     ADD CONSTRAINT processed_stripe_events_pkey PRIMARY KEY (id);   -- -- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.sessions     ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);   -- -- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.subscriptions     ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);   -- -- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.tasks     ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);   -- -- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.users     ADD CONSTRAINT users_pkey PRIMARY KEY (id);   -- -- Name: verifications verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.verifications     ADD CONSTRAINT verifications_pkey PRIMARY KEY (id);   -- -- Name: workspaces workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.workspaces     ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);   -- -- Name: accounts_user_id_idx; Type: INDEX; Schema: public; Owner: - --  CREATE INDEX accounts_user_id_idx ON public.accounts USING btree (user_id);   -- -- Name: analytics_events_name_created_at_idx; Type: INDEX; Schema: public; Owner: - --  CREATE INDEX analytics_events_name_created_at_idx ON public.analytics_events USING btree (name, created_at);   -- -- Name: analytics_events_session_id_created_at_idx; Type: INDEX; Schema: public; Owner: - --  CREATE INDEX analytics_events_session_id_created_at_idx ON public.analytics_events USING btree (session_id, created_at);   -- -- Name: analytics_events_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: - --  CREATE INDEX analytics_events_user_id_created_at_idx ON public.analytics_events USING btree (user_id, created_at);   -- -- Name: analytics_events_workspace_id_created_at_idx; Type: INDEX; Schema: public; Owner: - --  CREATE INDEX analytics_events_workspace_id_created_at_idx ON public.analytics_events USING btree (workspace_id, created_at);   -- -- Name: comments_task_id_idx; Type: INDEX; Schema: public; Owner: - --  CREATE INDEX comments_task_id_idx ON public.comments USING btree (task_id);   -- -- Name: comments_workspace_id_idx; Type: INDEX; Schema: public; Owner: - --  CREATE INDEX comments_workspace_id_idx ON public.comments USING btree (workspace_id);   -- -- Name: decision_versions_decision_id_idx; Type: INDEX; Schema: public; Owner: - --  CREATE INDEX decision_versions_decision_id_idx ON public.decision_versions USING btree (decision_id);   -- -- Name: decision_versions_workspace_id_idx; Type: INDEX; Schema: public; Owner: - --  CREATE INDEX decision_versions_workspace_id_idx ON public.decision_versions USING btree (workspace_id);   -- -- Name: decisions_task_id_idx; Type: INDEX; Schema: public; Owner: - --  CREATE INDEX decisions_task_id_idx ON public.decisions USING btree (task_id);   -- -- Name: decisions_workspace_id_idx; Type: INDEX; Schema: public; Owner: - --  CREATE INDEX decisions_workspace_id_idx ON public.decisions USING btree (workspace_id);   -- -- Name: idx_decisions_markdown_trgm; Type: INDEX; Schema: public; Owner: - --  CREATE INDEX idx_decisions_markdown_trgm ON public.decisions USING gin (markdown public.gin_trgm_ops);   -- -- Name: idx_tasks_description_trgm; Type: INDEX; Schema: public; Owner: - --  CREATE INDEX idx_tasks_description_trgm ON public.tasks USING gin (description public.gin_trgm_ops);   -- -- Name: idx_tasks_title_trgm; Type: INDEX; Schema: public; Owner: - --  CREATE INDEX idx_tasks_title_trgm ON public.tasks USING gin (title public.gin_trgm_ops);   -- -- Name: invitations_email_idx; Type: INDEX; Schema: public; Owner: - --  CREATE INDEX invitations_email_idx ON public.invitations USING btree (email);   -- -- Name: invitations_token_hash_key; Type: INDEX; Schema: public; Owner: - --  CREATE UNIQUE INDEX invitations_token_hash_key ON public.invitations USING btree (token_hash);   -- -- Name: members_user_id_idx; Type: INDEX; Schema: public; Owner: - --  CREATE INDEX members_user_id_idx ON public.members USING btree (user_id);   -- -- Name: members_workspace_id_idx; Type: INDEX; Schema: public; Owner: - --  CREATE INDEX members_workspace_id_idx ON public.members USING btree (workspace_id);   -- -- Name: notifications_user_id_workspace_id_idx; Type: INDEX; Schema: public; Owner: - --  CREATE INDEX notifications_user_id_workspace_id_idx ON public.notifications USING btree (user_id, workspace_id);   -- -- Name: notifications_workspace_id_idx; Type: INDEX; Schema: public; Owner: - --  CREATE INDEX notifications_workspace_id_idx ON public.notifications USING btree (workspace_id);   -- -- Name: notifications_workspace_id_user_id_read_idx; Type: INDEX; Schema: public; Owner: - --  CREATE INDEX notifications_workspace_id_user_id_read_idx ON public.notifications USING btree (workspace_id, user_id, read);   -- -- Name: sessions_token_key; Type: INDEX; Schema: public; Owner: - --  CREATE UNIQUE INDEX sessions_token_key ON public.sessions USING btree (token);   -- -- Name: sessions_user_id_idx; Type: INDEX; Schema: public; Owner: - --  CREATE INDEX sessions_user_id_idx ON public.sessions USING btree (user_id);   -- -- Name: subscriptions_stripe_customer_id_idx; Type: INDEX; Schema: public; Owner: - --  CREATE INDEX subscriptions_stripe_customer_id_idx ON public.subscriptions USING btree (stripe_customer_id);   -- -- Name: subscriptions_workspace_id_key; Type: INDEX; Schema: public; Owner: - --  CREATE UNIQUE INDEX subscriptions_workspace_id_key ON public.subscriptions USING btree (workspace_id);   -- -- Name: tasks_assignee_id_idx; Type: INDEX; Schema: public; Owner: - --  CREATE INDEX tasks_assignee_id_idx ON public.tasks USING btree (assignee_id);   -- -- Name: tasks_workspace_id_created_at_idx; Type: INDEX; Schema: public; Owner: - --  CREATE INDEX tasks_workspace_id_created_at_idx ON public.tasks USING btree (workspace_id, created_at);   -- -- Name: tasks_workspace_id_status_idx; Type: INDEX; Schema: public; Owner: - --  CREATE INDEX tasks_workspace_id_status_idx ON public.tasks USING btree (workspace_id, status);   -- -- Name: uq_invitations_pending; Type: INDEX; Schema: public; Owner: - --  CREATE UNIQUE INDEX uq_invitations_pending ON public.invitations USING btree (workspace_id, email) WHERE (accepted_at IS NULL);   -- -- Name: users_email_key; Type: INDEX; Schema: public; Owner: - --  CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email);   -- -- Name: workspaces_owner_id_idx; Type: INDEX; Schema: public; Owner: - --  CREATE INDEX workspaces_owner_id_idx ON public.workspaces USING btree (owner_id);   -- -- Name: workspaces_slug_key; Type: INDEX; Schema: public; Owner: - --  CREATE UNIQUE INDEX workspaces_slug_key ON public.workspaces USING btree (slug);   -- -- Name: accounts accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.accounts     ADD CONSTRAINT accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;   -- -- Name: analytics_events analytics_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.analytics_events     ADD CONSTRAINT analytics_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;   -- -- Name: analytics_events analytics_events_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.analytics_events     ADD CONSTRAINT analytics_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;   -- -- Name: comments comments_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.comments     ADD CONSTRAINT comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE SET NULL;   -- -- Name: comments comments_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.comments     ADD CONSTRAINT comments_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;   -- -- Name: comments comments_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.comments     ADD CONSTRAINT comments_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;   -- -- Name: decision_versions decision_versions_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.decision_versions     ADD CONSTRAINT decision_versions_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE SET NULL;   -- -- Name: decision_versions decision_versions_decision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.decision_versions     ADD CONSTRAINT decision_versions_decision_id_fkey FOREIGN KEY (decision_id) REFERENCES public.decisions(id) ON DELETE CASCADE;   -- -- Name: decision_versions decision_versions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.decision_versions     ADD CONSTRAINT decision_versions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;   -- -- Name: decisions decisions_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.decisions     ADD CONSTRAINT decisions_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE SET NULL;   -- -- Name: decisions decisions_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.decisions     ADD CONSTRAINT decisions_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;   -- -- Name: decisions decisions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.decisions     ADD CONSTRAINT decisions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;   -- -- Name: invitations invitations_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.invitations     ADD CONSTRAINT invitations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;   -- -- Name: members members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.members     ADD CONSTRAINT members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;   -- -- Name: members members_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.members     ADD CONSTRAINT members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;   -- -- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.notifications     ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;   -- -- Name: notifications notifications_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.notifications     ADD CONSTRAINT notifications_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;   -- -- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.sessions     ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;   -- -- Name: subscriptions subscriptions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.subscriptions     ADD CONSTRAINT subscriptions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;   -- -- Name: tasks tasks_assignee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.tasks     ADD CONSTRAINT tasks_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES public.users(id) ON DELETE SET NULL;   -- -- Name: tasks tasks_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.tasks     ADD CONSTRAINT tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;   -- -- Name: tasks tasks_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.tasks     ADD CONSTRAINT tasks_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;   -- -- Name: workspaces workspaces_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: - --  ALTER TABLE ONLY public.workspaces     ADD CONSTRAINT workspaces_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;   -- -- PostgreSQL database dump complete --  \unrestrict DuB0QouDvyyebyUUPZ1OlDz8PxiEdzVlk2GnqoQymvnheZ1cDHpw7W442EsAKwc 

-- ============================================================================
-- RLS 激活与策略（来自 db/rls-activate.sql）
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
ALTER ROLE corps_app SET PASSWORD :'app_password';

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