// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * 账户删除的真库集成断言（AC：隐私政策「删除账户」承诺的跨租户安全性）。
 *
 * ## 为什么需要它（单测已经覆盖了分支，但覆盖不了数据库）
 *
 * `web/tests/unit/account-deletion.test.ts` 用 mock 覆盖了 deleteAccount 的全部分支
 * （OAuth 撤销失败、单租户失败继续、残留强制清理、最终 User 删除）。但 mock 证明不了
 * 一件最要命的事：**真库上的级联方向对不对**。账户删除会 `DELETE FROM users`，
 * schema 级联（User → 自有 workspaces → tasks/comments/...）一旦写错方向，
 * 删掉 A 的账户会连 B 的租户数据一起带走 —— 这是不可逆的数据事故，
 * 而 mock 里每次 `workspace.delete` 都"成功返回"，永远发现不了。
 *
 * ## 本文件断言什么
 *
 *  1. deleteAccount(A) 返回 deletedWorkspaces = 1（只删了 A 自己的租户）
 *  2. A 的 user / workspace / task 行全部消失
 *  3. B 的 user / workspace / task 行**逐条仍在**（跨租户零误伤）
 *  4. 删除后以 corps_app（NOSUPERUSER NOBYPASSRLS）直连 + B 的 GUC，
 *     tasks 仍只能看到 B 自己的 1 条 —— RLS 策略未因删除被破坏
 *
 * ## 运行条件（与 rls-engine.test.ts 同口径，缺省跳过）
 *
 *   RLS_SMOKE_OWNER_URL  超级用户/表属主连接串（造夹具 + 查真实落库状态）
 *   RLS_SMOKE_APP_URL    corps_app 连接串（RLS 视角断言）
 *
 * 这两个变量只在 `test-hardened` job 注入；普通 `Test` job 下本文件整体 skip，
 * 不影响既有时长。
 *
 * 注意：`deleteAccount` 走 `@/lib/prisma`（DATABASE_URL），在 test-hardened job
 * 里指向 corps_test 的超级用户 —— 这正是应用层的真实连接语义。RLS 断言另开
 * app 连接，两条通道分开，避免"用超级用户验证 RLS 然后发现它绕过 RLS"这种假绿。
 */

const OWNER_URL = process.env.RLS_SMOKE_OWNER_URL;
const APP_URL = process.env.RLS_SMOKE_APP_URL;
const suite = OWNER_URL && APP_URL ? describe : describe.skip;

// 固定 UUID，与 rls-engine.test.ts 的夹具刻意错开（避免同库串扰）
const UA = "a1111111-1111-4111-8111-000000000001";
const UB = "b2222222-2222-4222-8222-000000000002";
const WA = "c3333333-3333-4333-8333-000000000003";
const WB = "d4444444-4444-4444-8444-000000000004";
const TA = "e5555555-5555-4555-8555-000000000005";
const TB = "f6666666-6666-4666-8666-000000000006";
const EMAIL_A = "acct-del-rls-a@test.local";
const EMAIL_B = "acct-del-rls-b@test.local";
const SLUG_A = "acct-del-rls-a";
const SLUG_B = "acct-del-rls-b";

suite("账户删除：真库级联 + 跨租户隔离", () => {
  // 延迟到 suite 内构造：describe.skip 仍会执行回调顶层代码，
  // 此时 OWNER_URL 可能为 undefined，new PrismaPg 会抛 Invalid URL。
  const owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: OWNER_URL! }) });
  const app = new PrismaClient({ adapter: new PrismaPg({ connectionString: APP_URL! }) });

  beforeAll(async () => {
    // 幂等清场：上一次失败可能残留（按 email / slug 删，级联带走租户数据）
    await owner.$executeRawUnsafe(`delete from users where email in ('${EMAIL_A}','${EMAIL_B}')`);
    // 夹具：两个用户、两个自有租户、各一条任务
    await owner.$executeRawUnsafe(
      `insert into users (id, email) values ('${UA}','${EMAIL_A}'),('${UB}','${EMAIL_B}')`,
    );
    await owner.$executeRawUnsafe(
      `insert into workspaces (id, name, slug, owner_id) values
         ('${WA}','AcctDel-A','${SLUG_A}','${UA}'),
         ('${WB}','AcctDel-B','${SLUG_B}','${UB}')`,
    );
    await owner.$executeRawUnsafe(
      `insert into members (user_id, workspace_id, role) values
         ('${UA}','${WA}','owner'),('${UB}','${WB}','owner')`,
    );
    await owner.$executeRawUnsafe(
      `insert into tasks (id, workspace_id, title) values
         ('${TA}','${WA}','acct-del-a-task'),('${TB}','${WB}','acct-del-b-task')`,
    );
  });

  afterAll(async () => {
    // A 已被 deleteAccount 删除；这里兜底清 B（失败也不掩盖上面的断言）
    await owner
      .$executeRawUnsafe(`delete from users where email in ('${EMAIL_A}','${EMAIL_B}')`)
      .catch(() => undefined);
    await owner.$disconnect();
    await app.$disconnect();
  });

  it("删除 A 账户后：A 的租户数据全清，B 的数据逐条完好且 RLS 仍可读", async () => {
    const { deleteAccount } = await import("@/lib/account-deletion");

    const result = await deleteAccount(UA);
    expect(result.deletedWorkspaces).toBe(1);

    // ── A 侧：彻底消失 ──
    expect(await owner.user.count({ where: { id: UA } })).toBe(0);
    expect(await owner.workspace.count({ where: { id: WA } })).toBe(0);
    expect(await owner.task.count({ where: { id: TA } })).toBe(0);
    expect(await owner.member.count({ where: { userId: UA } })).toBe(0);

    // ── B 侧：逐条仍在（跨租户零误伤）──
    expect(await owner.user.count({ where: { id: UB } })).toBe(1);
    expect(await owner.workspace.count({ where: { id: WB } })).toBe(1);
    expect(await owner.task.count({ where: { id: TB } })).toBe(1);
    expect(await owner.member.count({ where: { userId: UB, workspaceId: WB } })).toBe(1);

    // ── RLS 视角：删除动作没有破坏策略，B 仍只看到自己的 1 条任务 ──
    const seenByB = await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.workspace_id','${WB}',false), set_config('app.user_id','${UB}',false), set_config('app.auth_op','login',false)`,
      );
      return tx.$queryRawUnsafe<{ c: number }[]>(`SELECT count(*)::int AS c FROM tasks`);
    });
    expect(seenByB[0]!.c).toBe(1);
  });
});
