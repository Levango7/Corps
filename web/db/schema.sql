-- =============================================================================
-- corps · PostgreSQL Schema
-- =============================================================================
-- 本文件由 prisma/schema.prisma 同步生成，作为 DBA 审查与版本控制对照的
-- SQL 镜像。修改 schema.prisma 后请同步更新本文件。
--
-- 生成依据: prisma/schema.prisma (Prisma 6.15 / PostgreSQL)
-- 命名约定: 表/列使用 snake_case（通过 @map 映射），索引使用 pg 默认命名
--           (ix_<table>_<col1>_<col2>...) 以便 EXPLAIN 输出可读。
--
-- [NEW] 标记的索引为本次性能优化新增（Task #77）。
-- =============================================================================

-- PostgreSQL 13+ 内置 gen_random_uuid()；低版本请启用 pgcrypto 扩展。
-- create extension if not exists pgcrypto;

-- =============================================================================
-- 表结构
-- =============================================================================

create table if not exists users (
  id              uuid        primary key default gen_random_uuid(),
  name            varchar(100),
  email           varchar(255) not null unique,
  email_verified  boolean     not null default false,
  avatar_url      text,
  password_hash   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_login_at   timestamptz
);

create table if not exists workspaces (
  id           uuid        primary key default gen_random_uuid(),
  name         varchar(100) not null,
  slug         varchar(50)  not null unique,
  owner_id     uuid        not null references users(id) on delete cascade,
  plan         varchar(20)  not null default 'free',
  seat_limit   integer     not null default 10,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- members: 复合主键 (user_id, workspace_id) 即唯一约束
create table if not exists members (
  user_id       uuid        not null references users(id) on delete cascade,
  workspace_id  uuid        not null references workspaces(id) on delete cascade,
  role          varchar(20) not null default 'member',
  invited_by    uuid,
  joined_at     timestamptz not null default now(),
  invited_at    timestamptz not null default now(),
  primary key (user_id, workspace_id)
);

create table if not exists tasks (
  id            uuid         primary key default gen_random_uuid(),
  workspace_id  uuid         not null references workspaces(id) on delete cascade,
  title         varchar(255) not null,
  description   text,
  status        varchar(20)  not null default 'todo',
  priority      varchar(20)  not null default 'medium',
  assignee_id   uuid         references users(id) on delete set null,
  due_date      timestamptz,
  sort_order    double precision not null default 0,
  created_by    uuid         not null references users(id) on delete cascade,
  created_at    timestamptz  not null default now(),
  updated_at    timestamptz  not null default now()
);

create table if not exists comments (
  id            uuid        primary key default gen_random_uuid(),
  task_id       uuid        not null references tasks(id) on delete cascade,
  workspace_id  uuid        not null references workspaces(id) on delete cascade,
  author_id     uuid        not null references users(id) on delete cascade,
  body          text        not null,
  mentions      text[]      not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists notifications (
  id            uuid         primary key default gen_random_uuid(),
  user_id       uuid         not null references users(id) on delete cascade,
  workspace_id  uuid         not null references workspaces(id) on delete cascade,
  type          varchar(30)  not null,
  entity_id     uuid         not null,
  entity_title  varchar(255) not null,
  read          boolean      not null default false,
  created_at    timestamptz  not null default now()
);

create table if not exists decisions (
  id            uuid        primary key default gen_random_uuid(),
  task_id       uuid        not null references tasks(id) on delete cascade,
  workspace_id  uuid        not null references workspaces(id) on delete cascade,
  markdown      text        not null,
  version       integer     not null default 1,
  author_id     uuid        not null references users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists decision_versions (
  id            uuid        primary key default gen_random_uuid(),
  decision_id   uuid        not null references decisions(id) on delete cascade,
  workspace_id  uuid        not null references workspaces(id) on delete cascade,
  markdown      text        not null,
  version       integer     not null,
  author_id     uuid        not null references users(id) on delete cascade,
  created_at    timestamptz not null default now()
);

create table if not exists sessions (
  id            uuid        primary key default gen_random_uuid(),
  expires_at    timestamptz not null,
  token         text        not null unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  ip_address    varchar(45),
  user_agent    varchar(500),
  user_id       uuid        not null references users(id) on delete cascade
);

create table if not exists accounts (
  id                       uuid        primary key default gen_random_uuid(),
  account_id               text        not null,
  provider_id              text        not null,
  user_id                  uuid        not null references users(id) on delete cascade,
  access_token             text,
  refresh_token            text,
  id_token                 text,
  access_token_expires_at  timestamptz,
  refresh_token_expires_at timestamptz,
  scope                    text,
  password                 text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create table if not exists verifications (
  id          uuid        primary key default gen_random_uuid(),
  identifier  text        not null,
  value       text        not null,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists subscriptions (
  id                  uuid        primary key default gen_random_uuid(),
  workspace_id        uuid        not null references workspaces(id) on delete cascade,
  stripe_customer_id  varchar(255),
  stripe_sub_id       varchar(255),
  quantity            integer     not null default 1,
  status              varchar(20) not null default 'active',
  current_period_end  timestamptz,
  canceled_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (workspace_id)
);

-- =============================================================================
-- 索引
-- =============================================================================
-- 命名约定: ix_<table>_<col1>_<col2>...
-- 单列外键索引由 references 自动创建（PostgreSQL 不会自动为外键建索引，
-- 故此处显式声明）。

-- workspaces
create index if not exists ix_workspaces_slug      on workspaces(slug);
create index if not exists ix_workspaces_owner_id  on workspaces(owner_id);

-- members (复合主键已覆盖 (user_id, workspace_id) 与前缀 user_id)
create index if not exists ix_members_workspace_id on members(workspace_id);
create index if not exists ix_members_user_id      on members(user_id);

-- tasks
create index if not exists ix_tasks_workspace_id_status     on tasks(workspace_id, status);
create index if not exists ix_tasks_workspace_id_created_at on tasks(workspace_id, created_at);
create index if not exists ix_tasks_assignee_id             on tasks(assignee_id);
-- [NEW] 我的任务: 按工作区 + 负责人筛选
create index if not exists ix_tasks_workspace_id_assignee_id on tasks(workspace_id, assignee_id);
-- [NEW] 看板拖拽排序: 按工作区 + sort_order 高效分页
create index if not exists ix_tasks_workspace_id_sort_order  on tasks(workspace_id, sort_order);

-- comments
-- [NEW→合并] 任务详情页按时间顺序加载评论（前缀兼容原 ix_comments_task_id）
create index if not exists ix_comments_task_id_created_at  on comments(task_id, created_at);
create index if not exists ix_comments_workspace_id        on comments(workspace_id);

-- notifications
create index if not exists ix_notifications_user_id_workspace_id       on notifications(user_id, workspace_id);
create index if not exists ix_notifications_workspace_id               on notifications(workspace_id);
create index if not exists ix_notifications_workspace_id_user_id_read  on notifications(workspace_id, user_id, read);
-- [NEW] 通知中心按时间倒序分页（游标分页）
create index if not exists ix_notifications_workspace_id_created_at    on notifications(workspace_id, created_at);

-- decisions
-- [NEW→合并] 任务决策按版本号定位（前缀兼容原 ix_decisions_task_id）
create index if not exists ix_decisions_task_id_version   on decisions(task_id, version);
create index if not exists ix_decisions_workspace_id      on decisions(workspace_id);

-- decision_versions
create index if not exists ix_decision_versions_decision_id  on decision_versions(decision_id);
create index if not exists ix_decision_versions_workspace_id on decision_versions(workspace_id);

-- sessions
-- [NEW→合并] 用户会话 + 过期时间筛选（前缀兼容原 ix_sessions_user_id）
create index if not exists ix_sessions_user_id_expires_at on sessions(user_id, expires_at);

-- accounts
create index if not exists ix_accounts_user_id on accounts(user_id);

-- subscriptions
create index if not exists ix_subscriptions_stripe_customer_id on subscriptions(stripe_customer_id);

-- =============================================================================
-- updated_at 自动维护触发器
-- =============================================================================
-- Prisma @updatedAt 在客户端层维护；为兼容直接 SQL 写入，此处补充触发器。

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
declare t text;
begin
  for t in select unnest(array[
    'users','workspaces','tasks','comments','decisions',
    'sessions','accounts','verifications','subscriptions'
  ])
  loop
    execute format(
      'create trigger trg_%s_updated_at before update on %s ' ||
      'for each row execute function set_updated_at();',
      t, t
    );
  end loop;
end $$;