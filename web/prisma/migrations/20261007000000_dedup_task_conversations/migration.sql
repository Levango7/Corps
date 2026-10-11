-- 任务会话去重 + (task_id) 唯一约束
--
-- 起因：任务聊天 get-or-create 的并发竞态。API 层已用 pg_advisory_xact_lock 收口
-- （web/app/api/v1/workspaces/[wid]/tasks/[id]/conversation/route.ts，见
-- tests/integration/task-conversation-idempotent.test.ts），但竞态窗口期间已经落库的
-- 重复会话还在。后果不是"脏数据"这么轻：读取侧 `conversation.findFirst({ where: { taskId } })`
-- 没有 orderBy，命中的会话与消息实际写入的会话可能不是同一条 ⇒ 用户"发出去的消息自己看不到"。
-- 唯一约束是把这条不变量交给数据库，而不是交给代码自觉。
--
-- survivor 规则：同一 task_id 组内 created_at 最早者，并列取 id 字典序最小 —— 确定性，
-- 任何人重跑都得到同一条幸存会话。
--
-- 三条子表都必须**先搬后删**：messages / conversation_members / chat_presences 对
-- conversations 的 FK 全是 ON DELETE CASCADE（实测：select confdeltype from pg_constraint
-- where confrelid='conversations'::regclass ⇒ 三行全是 'c'），顺序颠倒等于删消息。
-- conversation_members 与 chat_presences 各有 (conversation_id,user_id) 唯一约束，
-- 直接 UPDATE 改址会在"同一用户出现在多条重复会话"时撞约束，所以用 INSERT..ON CONFLICT
-- 先把 loser 的行并进 survivor，再整体删除 loser 的行（对 >2 条重复同样成立：
-- GREATEST/LEAST/OR 均满足结合律，结果与行处理顺序无关）。
--
-- 执行角色：必须用表属主/具备 BYPASSRLS 的连接跑（生产即 compose 里的 postgres 超级用户）。
-- 以 corps_app（NOBYPASSRLS）跑时，FORCE RLS 会让本文件的 SELECT/UPDATE/DELETE **全部看见 0 行**
-- ——去重静默 no-op，然后 CREATE UNIQUE INDEX 以 `must be owner of table conversations`
-- 报错终止（实测）。也就是说：不会误删数据，但也完不成；纯 DML 的迁移在这种角色下甚至会
-- "0 行生效却判成功"，这是本仓库所有数据迁移共同的坑。

-- 1) 去重映射：loser → survivor
--    ⚠️ 不能用 TEMP TABLE：Prisma 逐语句执行迁移（实测 TEMP 表在第二条语句就
--    `relation "_dedup_map" does not exist`）——用普通表 + 首尾 DROP 防护，
--    中途失败残留的表由开头的 IF EXISTS 兜底。
DROP TABLE IF EXISTS _dedup_map;
CREATE TABLE _dedup_map AS
WITH ranked AS (
  SELECT id, task_id,
         row_number() OVER (PARTITION BY task_id ORDER BY created_at ASC, id ASC) AS rn
  FROM conversations
  WHERE task_id IS NOT NULL
)
SELECT l.id AS loser_id, s.id AS survivor_id, l.task_id
FROM ranked l
JOIN ranked s ON s.task_id = l.task_id AND s.rn = 1
WHERE l.rn > 1;

-- 2) 消息改址（该表无唯一约束，直接 UPDATE）
UPDATE messages m
   SET conversation_id = d.survivor_id
  FROM _dedup_map d
 WHERE m.conversation_id = d.loser_id;

-- 3) 成员并入 survivor。
--    NULL 语义必须保住：last_read_at 两边都为 NULL 表示"从没读过"，写成
--    GREATEST(COALESCE(...)) 会把它变成 1970 年已读 ⇒ 未读数凭空归零。
INSERT INTO conversation_members AS s
       (id, conversation_id, user_id, role, joined_at, last_read_at, muted, invited_by)
SELECT gen_random_uuid(), d.survivor_id, l.user_id, l.role, l.joined_at, l.last_read_at, l.muted, l.invited_by
  FROM _dedup_map d
  JOIN conversation_members l ON l.conversation_id = d.loser_id
ON CONFLICT (conversation_id, user_id) DO UPDATE
   SET last_read_at = CASE
         WHEN s.last_read_at IS NULL THEN EXCLUDED.last_read_at
         WHEN EXCLUDED.last_read_at IS NULL THEN s.last_read_at
         ELSE GREATEST(s.last_read_at, EXCLUDED.last_read_at)
       END,
       joined_at = LEAST(s.joined_at, EXCLUDED.joined_at),
       muted     = s.muted OR EXCLUDED.muted,
       role      = CASE WHEN s.role = 'owner' THEN s.role ELSE EXCLUDED.role END;

-- 4) 在线状态并入 survivor
INSERT INTO chat_presences AS s (id, conversation_id, task_id, user_id, last_seen)
SELECT gen_random_uuid(), d.survivor_id, COALESCE(l.task_id, d.task_id), l.user_id, l.last_seen
  FROM _dedup_map d
  JOIN chat_presences l ON l.conversation_id = d.loser_id
ON CONFLICT (conversation_id, user_id) DO UPDATE
   SET last_seen = GREATEST(s.last_seen, EXCLUDED.last_seen);

-- 5) survivor 的会话列表排序字段取组内最大值（否则合并后仍显示最早那条的旧时间/空值）
UPDATE conversations c
   SET last_message_at = g.max_last_message_at,
       updated_at      = g.max_updated_at
  FROM (
    SELECT d.survivor_id AS id,
           MAX(x.last_message_at) AS max_last_message_at,
           MAX(x.updated_at)      AS max_updated_at
      FROM _dedup_map d
      JOIN conversations x ON x.task_id = d.task_id
     GROUP BY d.survivor_id
  ) g
 WHERE c.id = g.id;

-- 6) 删除 loser（此时三条子表已无指向它们的行）
DELETE FROM conversations c
  USING _dedup_map d
 WHERE c.id = d.loser_id;

-- 7) 唯一约束落地。Postgres 的唯一索引不约束 NULL ⇒ task_id 为 NULL 的独立 IM 会话不受影响
--    （实测：两条 task_id IS NULL 的会话可并存）。
CREATE UNIQUE INDEX IF NOT EXISTS "uq_conversations_task_id" ON conversations ("task_id");

-- 8) 清理去重映射表；20260921 建的普通索引 conversations_task_id_idx 被上面的
--    唯一索引完全覆盖（PG 用唯一索引一样能服务 task_id 等值查询），留着只会
--    双倍维护写放大。
DROP TABLE _dedup_map;
DROP INDEX IF EXISTS conversations_task_id_idx;
