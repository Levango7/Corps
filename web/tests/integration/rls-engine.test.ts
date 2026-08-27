import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
/**
 * RLS 引擎级冒烟（AC-04 的数据库层断言）
 *
 * 背景：常规集成测试经应用连接 postgres 超级用户（超级用户绕过 RLS，FORCE 也无效），
 * 无法证明"漏写 WHERE 时由数据库拦截"。本测试以 corps_app（NOSUPERUSER NOBYPASSRLS
 * 最小权限角色，见 db/rls-activate.sql）直连，在引擎层验证租户隔离：
 *   ① 无 WHERE 全表查询只可见本租户行
 *   ② 跨租户 SELECT 不可见
 *   ③ 跨租户 UPDATE 影响 0 行
 *   ④ members 无 GUC 时 UPDATE/DELETE fail-closed（#119 回归：
 *      曾缺 UPDATE/DELETE 策略 → FORCE RLS 下 member.update/delete 恒 P2025→500）
 *   ⑤ members 同租户 GUC 事务内 UPDATE/DELETE 成功；跨租户 UPDATE 影响 0 行
 *   ⑥ subscriptions 无 GUC 直读 fail-closed；同租户 GUC（等价 runWithWorkspace）可读、
 *      跨租户 GUC 不可见（M-1 锚点：修复前 portal createPortal 直连恒空 → 恒 400）
 *
 * 运行条件（缺省跳过，不影响普通 CI）：
 *   RLS_SMOKE_OWNER_URL  超级用户/表属主连接串（用于幂等写入夹具）
 *   RLS_SMOKE_APP_URL    corps_app 连接串
 * 与 db/rls-smoke.sh 等价（后者供 bash 流水线阶段使用）；GUC 经事务内同一连接设置，
 * 规避 Prisma 连接池的会话变量漂移问题。
 */

const OWNER_URL = process.env.RLS_SMOKE_OWNER_URL;
const APP_URL = process.env.RLS_SMOKE_APP_URL;
const suite = OWNER_URL && APP_URL ? describe : describe.skip;

const UA = "11111111-1111-4111-8111-aaaaaaaaaaa1";
const UB = "22222222-2222-4222-8222-bbbbbbbbbbb2";
const WA = "33333333-3333-4333-8333-ccccccccccc3";
const WB = "44444444-4444-4444-8444-dddddddddddd";

suite("RLS 引擎级冒烟（corps_app 直连，AC-04 引擎断言）", () => {
  const owner = new PrismaClient({ datasourceUrl: OWNER_URL! });
  const app = new PrismaClient({ datasourceUrl: APP_URL! });

  afterAll(async () => {
    await owner.$disconnect();
    await app.$disconnect();
  });

  // appPassword/appName 延迟到 it() 内计算：describe.skip 回调仍会执行
  // suite 顶层代码，若在此处 new URL(APP_URL!) 而 APP_URL 为 undefined 会抛
  // TypeError: Invalid URL（CI 未设 RLS_SMOKE_*_URL 时）。

  it("无 WHERE 全表查询仅见本租户；跨租户读不可见、UPDATE 影响 0 行", async () => {
    // 幂等确保 corps_app 存在且密码与 APP_URL 一致（等价于 rls-activate.sql 第 1 节）
    const appPassword = decodeURIComponent(new URL(APP_URL!).password);
    const appName = decodeURIComponent(new URL(APP_URL!).username);
    await owner.$executeRawUnsafe(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${appName}') THEN
           CREATE ROLE ${appName} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
         END IF;
       END $$;`,
    );
    await owner.$executeRawUnsafe(`ALTER ROLE ${appName} WITH LOGIN PASSWORD '${appPassword}'`);

    // ── 夹具（超级用户不受 FORCE RLS 约束；幂等）──
    await owner.$executeRawUnsafe(
      `insert into users (id, email) values ('${UA}','rls-smoke-a@test.local'),('${UB}','rls-smoke-b@test.local') on conflict (email) do nothing`,
    );
    await owner.$executeRawUnsafe(
      `insert into workspaces (id, name, slug, owner_id) values ('${WA}','RLS-Smoke-A','rls-smoke-a','${UA}'),('${WB}','RLS-Smoke-B','rls-smoke-b','${UB}') on conflict (slug) do nothing`,
    );
    await owner.$executeRawUnsafe(
      `insert into members (user_id, workspace_id, role) values ('${UA}','${WA}','owner'),('${UB}','${WB}','owner') on conflict (user_id, workspace_id) do nothing`,
    );
    await owner.$executeRawUnsafe(
      `insert into tasks (id, workspace_id, title) values ('55555555-5555-4555-8555-eeeeeeeeeee5','${WA}','smoke-a-task'),('66666666-6666-4666-8666-ffffffffffff','${WB}','smoke-b-task') on conflict (id) do nothing`,
    );

    // ── 断言（同一事务 = 同一物理连接，GUC 设置对本事务内后续语句生效）──
    await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.workspace_id','${WA}',false), set_config('app.user_id','${UA}',false), set_config('app.auth_op','login',false)`,
      );

      // ① 无 WHERE 全表查询：只可见租户 A 自己的 1 条任务
      const nAll = await tx.$queryRawUnsafe<{ c: number }[]>(
        `SELECT count(*)::int AS c FROM tasks`,
      );
      expect(nAll[0]!.c).toBe(1);

      // ② 跨租户定向读：不可见
      const nB = await tx.$queryRawUnsafe<{ c: number }[]>(
        `SELECT count(*)::int AS c FROM tasks WHERE workspace_id='${WB}'`,
      );
      expect(nB[0]!.c).toBe(0);

      // ③ 跨租户写：影响 0 行（RLS 策略静默过滤，不报错——这正是"漏写 WHERE 也安全"的语义）
      const updated = await tx.$executeRawUnsafe(
        `UPDATE tasks SET title='hacked' WHERE workspace_id='${WB}'`,
      );
      expect(updated).toBe(0);
    });

    // 对照组：超级用户可见两个夹具任务（证明上面 count=1 是 RLS 过滤而非数据缺失）
    const nOwner = await owner.$queryRawUnsafe<{ c: number }[]>(
      `SELECT count(*)::int AS c FROM tasks WHERE workspace_id IN ('${WA}','${WB}')`,
    );
    expect(nOwner[0]!.c).toBe(2);
  });

  it("invitations：无 GUC fail-closed 不可见；auth_op='invite' 事务内按 token 可读（TC-RLS-07 逃生口回归）", async () => {
    const tokenHash = "a1".repeat(32); // 64 位十六进制，模拟 sha256(token)
    const INV_ID = "77777777-7777-4777-8777-eeeeeeeeeee7";
    // 幂等夹具：租户 A 的邀请行（owner 角色不受 FORCE RLS 约束）
    await owner.$executeRawUnsafe(
      `insert into invitations (id, workspace_id, email, token_hash, role, invited_by, expires_at)
       values ('${INV_ID}','${WA}','rls-smoke-invite@test.local','${tokenHash}','member','${UA}', now() + interval '7 days')
       on conflict (token_hash) do nothing`,
    );

    // ① 无 GUC 直读（等价修复前预览路由的 prisma.invitation.findUnique 直连）：
    //    fail-closed 不可见 —— 这正是 TC-RLS-07 恒返 404 的引擎级根因。
    //    显式清空会话级 GUC 残留：前一用例以 set_config(..., false) 设置的 session 级
    //    GUC 会随 Prisma 连接池复用漂移，若不清空 fail-closed 断言不可信。
    await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.workspace_id','',false), set_config('app.user_id','',false), set_config('app.auth_op','',false)`,
      );
      const rows = await tx.$queryRawUnsafe<{ c: number }[]>(
        `SELECT count(*)::int AS c FROM invitations WHERE token_hash='${tokenHash}'`,
      );
      expect(rows[0]!.c).toBe(0);
    });

    // ② app.auth_op='invite' 事务内（等价 runWithAuthOp("invite")）：同一行可读。
    //    先清空残留再仅注入 invite op（事务局部），确保本行可见性纯由逃生口放行，
    //    而非残留 workspace_id 谓词的副作用。
    await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.workspace_id','',false), set_config('app.user_id','',false), set_config('app.auth_op','',false)`,
      );
      await tx.$executeRawUnsafe(`SELECT set_config('app.auth_op','invite',true)`);
      const rows = await tx.$queryRawUnsafe<{ c: number }[]>(
        `SELECT count(*)::int AS c FROM invitations WHERE token_hash='${tokenHash}'`,
      );
      expect(rows[0]!.c).toBe(1);
    });
  });

  it("members：无 GUC UPDATE/DELETE fail-closed；同租户 GUC 事务内成功；跨租户 0 行（TC-RLS-#119 策略缺口回归）", async () => {
    // 幂等夹具：为租户 A 追加一条成员行（UB, WA, role=member）作为 UPDATE/DELETE 靶行。
    // owner 连接不受 FORCE RLS 约束；上一轮断言③ 已删该行时重插成功（保持幂等）。
    await owner.$executeRawUnsafe(
      `insert into members (user_id, workspace_id, role) values ('${UB}','${WA}','member') on conflict (user_id, workspace_id) do nothing`,
    );

    // ① 无 GUC（显式清空会话残留，确保 fail-closed 语义）：
    //    UPDATE/DELETE 均影响 0 行 —— 修复前此场景下 Prisma member.update/delete 恒抛 P2025
    await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.workspace_id','',false), set_config('app.user_id','',false), set_config('app.auth_op','',false)`,
      );
      const upd0 = await tx.$executeRawUnsafe(
        `UPDATE members SET role='admin' WHERE user_id='${UB}' AND workspace_id='${WA}'`,
      );
      expect(upd0).toBe(0);
      const del0 = await tx.$executeRawUnsafe(
        `DELETE FROM members WHERE user_id='${UB}' AND workspace_id='${WA}'`,
      );
      expect(del0).toBe(0);
    });

    // ② 跨租户：GUC 置为租户 B 的 wid，试图变更租户 A 的成员行 → 影响 0 行
    await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.workspace_id','${WB}',true)`);
      const cross = await tx.$executeRawUnsafe(
        `UPDATE members SET role='admin' WHERE user_id='${UB}' AND workspace_id='${WA}'`,
      );
      expect(cross).toBe(0);
    });

    // ③ 同租户 GUC（等价 runWithWorkspace(wid, fn, uid)，即 PATCH/DELETE member
    //    路由的上下文）：角色变更 UPDATE 影响 1 行 → 移除成员 DELETE 影响 1 行
    await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.workspace_id','${WA}',true), set_config('app.user_id','${UA}',true)`,
      );
      const upd = await tx.$executeRawUnsafe(
        `UPDATE members SET role='admin' WHERE user_id='${UB}' AND workspace_id='${WA}'`,
      );
      expect(upd).toBe(1);
      const del = await tx.$executeRawUnsafe(
        `DELETE FROM members WHERE user_id='${UB}' AND workspace_id='${WA}'`,
      );
      expect(del).toBe(1);
    });

    // 对照组：超级用户确认靶行确被③删除（证明 UPDATE 1/DELETE 1 是真实落库，
    // 而非 RLS 静默过滤后的假象）
    const nOwner = await owner.$queryRawUnsafe<{ c: number }[]>(
      `SELECT count(*)::int AS c FROM members WHERE user_id='${UB}' AND workspace_id='${WA}'`,
    );
    expect(nOwner[0]!.c).toBe(0);
  });

  it("subscriptions：无 GUC 直读 fail-closed；同租户 GUC（runWithWorkspace）可读、跨租户不可见（M-1 portal 直连锚点）", async () => {
    // 背景（M-1）：billing portal 的 createPortal 曾在 provider 内 prisma.subscription.findUnique
    // 直连（无 workspace GUC）。加固模式下 subscriptions 表 ENABLE+FORCE RLS
    // （p_subscriptions_rls：workspace 谓词 或 auth_op='webhook'），直连恒空 → 恒 400 no_customer。
    // 本用例在引擎层锚定：设置 app.workspace_id 后本租户订阅可读；未设置则不可见（隔离生效）。
    const SUB_ID = "99999999-8888-4777-8666-555555555551";
    const SUB_CUSTOMER = "cus_rls_anchor_m1";
    // 幂等夹具：租户 A（WA）的一条订阅行（owner 超级用户不受 FORCE RLS 约束）
    await owner.$executeRawUnsafe(
      `insert into subscriptions (id, workspace_id, stripe_customer_id, status, quantity)
       values ('${SUB_ID}','${WA}','${SUB_CUSTOMER}','active',3)
       on conflict (id) do nothing`,
    );

    // ① 无 GUC 直读（等价修复前 createPortal 内 prisma 直连）：fail-closed 不可见。
    //    显式清空会话级 GUC 残留，保证断言纯由"未设置上下文"导致。
    await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.workspace_id','',false), set_config('app.user_id','',false), set_config('app.auth_op','',false)`,
      );
      const rows = await tx.$queryRawUnsafe<{ c: number }[]>(
        `SELECT count(*)::int AS c FROM subscriptions WHERE id='${SUB_ID}'`,
      );
      expect(rows[0]!.c).toBe(0);
    });

    // ② 同租户 GUC（等价路由层修复后的 runWithWorkspace(WA, …)）：订阅行可读。
    await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.workspace_id','',false), set_config('app.user_id','',false), set_config('app.auth_op','',false)`,
      );
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.workspace_id','${WA}',true), set_config('app.user_id','${UA}',true)`,
      );
      const rows = await tx.$queryRawUnsafe<{ c: number; stripe_customer_id: string | null }[]>(
        `SELECT count(*)::int AS c, max(stripe_customer_id) AS stripe_customer_id FROM subscriptions WHERE id='${SUB_ID}'`,
      );
      expect(rows[0]!.c).toBe(1);
      expect(rows[0]!.stripe_customer_id).toBe(SUB_CUSTOMER);
    });

    // ③ 跨租户：GUC 置为租户 B 的 wid，读租户 A 的订阅 → 不可见（隔离不被绕过）
    await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.workspace_id','',false), set_config('app.user_id','',false), set_config('app.auth_op','',false)`,
      );
      await tx.$executeRawUnsafe(`SELECT set_config('app.workspace_id','${WB}',true)`);
      const rows = await tx.$queryRawUnsafe<{ c: number }[]>(
        `SELECT count(*)::int AS c FROM subscriptions WHERE id='${SUB_ID}'`,
      );
      expect(rows[0]!.c).toBe(0);
    });

    // 清理临时夹具（owner 不受 FORCE RLS 约束）
    await owner.$executeRawUnsafe(`DELETE FROM subscriptions WHERE id='${SUB_ID}'`);
  });
});
