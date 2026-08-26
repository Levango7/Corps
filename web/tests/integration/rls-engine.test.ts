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

  // 幂等确保 corps_app 存在且密码与 APP_URL 一致（等价于 rls-activate.sql 第 1 节）
  const appPassword = decodeURIComponent(new URL(APP_URL!).password);
  const appName = decodeURIComponent(new URL(APP_URL!).username);

  it("无 WHERE 全表查询仅见本租户；跨租户读不可见、UPDATE 影响 0 行", async () => {
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
});
