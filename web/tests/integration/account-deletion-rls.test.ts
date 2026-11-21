// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * 账户删除的真库落库断言（AC：隐私政策「删除账户」承诺的跨租户安全性）。
 *
 * ## 为什么直接 DELETE users，而不是调用 deleteAccount()
 *
 * `deleteAccount()` 的**分支逻辑**（OAuth 撤销失败、单租户失败继续、残留兜底、
 * 分批短事务、better-auth 清理）已由 `tests/unit/account-deletion.test.ts`
 * 用 mock 全量覆盖（279 行）。
 *
 * mock 覆盖不了、也永远发现不了的是**真库上的级联方向**：schema 里
 * `Workspace.owner` 声明了 `onDelete: Cascade`。这条级联一旦写错方向，
 * 删除 A 的账户会把 B 的租户数据一起带走 —— 不可逆的数据事故；而在 mock 里
 * 每次 `workspace.delete` 都「成功返回」，永远看不见。
 *
 * 所以本用例守的是「User 行删除 → 自有租户级联清空、他人租户逐条完好」这条
 * schema 契约，以及删除动作没有破坏 RLS 策略。这正是只有真库能证明的那部分。
 *
 * ## 另一个硬原因：不能用 @/lib/prisma
 *
 * `deleteAccount()` import `@/lib/prisma`。而 `test-hardened` job 的集成测试步骤
 * 只注入 `RLS_SMOKE_OWNER_URL` / `RLS_SMOKE_APP_URL`，**不注入 DATABASE_URL**
 * （那是给 dev server 用的，不在 vitest 进程 env 里）。全局 prisma 于是回退到
 * `lib/prisma.ts:118` 的 placeholder 连接串并认证失败。本用例用
 * `RLS_SMOKE_OWNER_URL` 自建连接，与该 job 的既有注入契约完全一致。
 *
 * ## 运行条件（与 rls-engine.test.ts 同口径，缺省跳过）
 *
 *   RLS_SMOKE_OWNER_URL  表属主/超级用户连接串（造夹具 + 执行删除 + 查落库状态）
 *   RLS_SMOKE_APP_URL    corps_app 连接串（NOSUPERUSER NOBYPASSRLS，RLS 视角断言）
 *
 * 普通 `Test` job 不注入这两个变量，本文件整体 skip，不影响其时长。
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
    // 幂等清场：上次失败可能残留（按 email 删，级联带走租户数据）
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

    // 前置断言：夹具真的落库了。没有这一步，下面的 0 断言可能只是「本来就没有」。
    expect(await owner.task.count({ where: { id: TA } })).toBe(1);
    expect(await owner.task.count({ where: { id: TB } })).toBe(1);
  });

  afterAll(async () => {
    // A 已在用例内删除；这里兜底清 B（失败也不掩盖上面的断言）
    await owner
      .$executeRawUnsafe(`delete from users where email in ('${EMAIL_A}','${EMAIL_B}')`)
      .catch(() => undefined);
    await owner.$disconnect();
    await app.$disconnect();
  });

  it("删除 A 的 User 行后：A 的租户级联清空，B 的数据逐条完好且 RLS 仍可读", async () => {
    // 与 deleteAccount() 的最终一步等价：删除 User，级联由 schema 决定
    await owner.$executeRawUnsafe(`delete from users where id = '${UA}'`);

    // ── A 侧：整条链消失（user → workspace → tasks/members）──
    expect(await owner.user.count({ where: { id: UA } })).toBe(0);
    expect(await owner.workspace.count({ where: { id: WA } })).toBe(0);
    expect(await owner.task.count({ where: { id: TA } })).toBe(0);
    expect(await owner.member.count({ where: { userId: UA } })).toBe(0);

    // ── B 侧：逐条仍在（跨租户零误伤）──
    expect(await owner.user.count({ where: { id: UB } })).toBe(1);
    expect(await owner.workspace.count({ where: { id: WB } })).toBe(1);
    expect(await owner.task.count({ where: { id: TB } })).toBe(1);
    expect(await owner.member.count({ where: { userId: UB, workspaceId: WB } })).toBe(1);

    // ── RLS 视角：删除动作没有破坏策略 ──
    // B 的 GUC 仍只看到自己 1 条；A 的 GUC 看不到任何任务（租户已不存在）
    const seenByB = await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.workspace_id','${WB}',false), set_config('app.user_id','${UB}',false), set_config('app.auth_op','login',false)`,
      );
      return tx.$queryRawUnsafe<{ c: number }[]>(`SELECT count(*)::int AS c FROM tasks`);
    });
    expect(seenByB[0]!.c).toBe(1);

    const seenByA = await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.workspace_id','${WA}',false), set_config('app.user_id','${UA}',false), set_config('app.auth_op','login',false)`,
      );
      return tx.$queryRawUnsafe<{ c: number }[]>(`SELECT count(*)::int AS c FROM tasks`);
    });
    expect(seenByA[0]!.c).toBe(0);
  });
});
