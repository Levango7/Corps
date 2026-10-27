-- ============================================================================
-- db/rls-verify.sql —— 证明「目标库真的开了 RLS」
--
-- 为什么需要它：`scripts/check_rls_exemptions.py` 那 81 张受保护表 / 272 条策略
-- 是**解析 db/rls-activate.sql 文本**得出的——证明的是"脚本会建这些策略"，
-- 不证明"目标库执行过这个脚本"。DEPLOY-VERCEL.md 明确写了这个区别。
-- 本文件是判据的另一半：连上目标库直接读 pg_class / pg_policies。
--
-- 用法（owner 连接串，只读）：
--   psql "$DATABASE_OWNER_URL" -v ON_ERROR_STOP=1 -f db/rls-verify.sql
--
-- 用法（最小权限角色，验 GUC 通路）：
--   psql "$DATABASE_URL" -v workspace_id=<某个真实工作区 uuid> -f db/rls-verify.sql
--   第二部分会以 corps_app 身份验证：不设 GUC 看不到行、设对 GUC 看得到、
--   设错 GUC 还是看不到。三条都符合才算通路正确。
--
-- 期望值（2026-10-28 在 postgres:18.6 + 全量迁移上实测）：
--   rls_on = 81，rls_forced = 81，policies = 272
-- ============================================================================

\echo '=== 1) 引擎层状态（只在 owner 连接上有意义）==='
SELECT
  count(*) FILTER (WHERE c.relrowsecurity)     AS rls_on,
  count(*) FILTER (WHERE c.relforcerowsecurity) AS rls_forced,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') AS policies
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r';

\echo '=== 2) 未被引擎层覆盖的表（应恰好等于 ADR-010 的豁免基线；其余出现=激活没覆盖到）==='
SELECT c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
ORDER BY c.relname;

\echo '=== 3) 受保护但没有策略的表（ENABLE 了却无策略 = 永远读不到，属配置错误）==='
SELECT c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = c.relname
WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
GROUP BY c.relname
HAVING count(p.policyname) = 0
ORDER BY c.relname;

\echo '=== 4) GUC 通路（需 -v workspace_id=<uuid>；未提供则跳过）==='
\if :{?workspace_id}
BEGIN;
-- 不设 GUC：最小权限角色应看到 0 行（不是报错——这正是历史上三次"静默空集"的形态）
SELECT current_user AS conn_role, count(*) AS rows_without_guc FROM messages;
-- 设对 GUC：应看到该工作区的行
SAVEPOINT s1;
SET LOCAL app.workspace_id = :'workspace_id';
SELECT count(*) AS rows_with_matching_guc FROM messages;
ROLLBACK TO s1;
-- 设一个不存在的工作区：应仍为 0（跨租户在引擎层被挡）
SAVEPOINT s2;
SET LOCAL app.workspace_id = '00000000-0000-0000-0000-000000000000';
SELECT count(*) AS rows_with_other_guc FROM messages;
ROLLBACK;
\else
\echo '  （跳过：未提供 -v workspace_id=<uuid>）'
\endif
