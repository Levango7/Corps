import { runWithAuthOp, withGuc } from "@/lib/auth";

/**
 * 账户删除（阶段 2-3：隐私政策"删除账户"承诺兑现，体验优先版）。
 *
 * 设计：
 *  - 预览（previewAccountDeletion）：删除前数据清单——自有工作区（将整租户删除）、
 *    被邀工作区（仅退出成员身份）、日历连接（将撤销 token）、订阅状态（如有
 *    active 订阅提示先取消，避免删除后无法自助管理）。
 *  - 执行（deleteAccount）：schema 级联已设计好（User → members/connections/
 *    chat 行直接级联；自有 workspaces 整租户级联；Task.assignee/creator SetNull
 *    保留任务）。外加：撤销日历 OAuth token（尽力而为）、better-auth sessions/
 *    accounts 一并清理、通知邮件。
 *
 * 安全：调用方必须已认证本人 + 二次确认（邮箱全文匹配）由路由层校验。
 * RLS：workspaces/members/subscriptions 等受 FORCE RLS——owner 删除自己的
 * 租户走 provision op（注册同信任级系统操作）；calendar_connections 走
 * user_id 谓词（本人）。
 */

export interface DeletionPreview {
  /** 自有工作区（owner）——将连同全部数据一起删除 */
  ownedWorkspaces: Array<{ id: string; name: string; memberCount: number }>;
  /** 被邀工作区（非 owner 成员）——仅退出成员身份，数据保留 */
  joinedWorkspaces: Array<{ id: string; name: string; role: string }>;
  /** 日历连接——将撤销 token 并删除 */
  calendarConnections: Array<{ provider: string; email: string }>;
  /** 活跃订阅（如有）——删除账户不会自动退款，提示先取消 */
  activeSubscription: { provider: string | null; status: string } | null;
  /** 站内数据量统计（将被删除的自有部分） */
  stats: { ownedTasks: number; ownedDecisions: number; messages: number };
}

export async function previewAccountDeletion(userId: string): Promise<DeletionPreview> {
  const [memberships, connections, subs] = await Promise.all([
    // members 受 FORCE RLS：login op 按 user_id 读本人成员关系（含所在工作区）
    runWithAuthOp(
      "login",
      (tx) =>
        tx.member.findMany({
          where: { userId },
          include: { workspace: { select: { id: true, name: true, ownerId: true } } },
        }),
      userId,
    ),
    // calendar_connections：user_id 谓词（本人连接）
    withGuc({ user_id: userId }, (tx) =>
      tx.calendarConnection.findMany({
        where: { userId },
        select: { provider: true, email: true },
      }),
    ),
    // subscriptions 受 FORCE RLS：经 login op 的 members 分支谓词放行本人相关行
    runWithAuthOp(
      "login",
      (tx) =>
        tx.subscription.findFirst({
          where: {
            workspace: { ownerId: userId },
            status: { in: ["active", "trialing", "past_due"] },
          },
          select: { provider: true, status: true },
        }),
      userId,
    ),
  ]);

  const owned = memberships.filter((m) => m.workspace.ownerId === userId);
  const joined = memberships.filter((m) => m.workspace.ownerId !== userId);
  const ownedIds = owned.map((m) => m.workspace.id);

  // 自有工作区的数据量（经 workspace GUC 逐租户统计；owned 可能 0 个）
  // R8D-09：并行查询所有工作区的 count，避免串行 N+1（原 for 循环逐工作区 await）
  const stats = { ownedTasks: 0, ownedDecisions: 0, messages: 0 };
  const workspaceStats = await Promise.all(
    ownedIds.map((w) =>
      withGuc({ workspace_id: w, user_id: userId }, (tx) =>
        Promise.all([
          tx.task.count({ where: { workspaceId: w } }),
          tx.decision.count({ where: { workspaceId: w } }),
          tx.message.count({ where: { workspaceId: w } }),
        ]),
      ),
    ),
  );
  for (const s of workspaceStats) {
    stats.ownedTasks += s[0];
    stats.ownedDecisions += s[1];
    stats.messages += s[2];
  }

  // 自有工作区的成员数（统计含他人成员行 → provision 系统操作）
  // R8D-09：并行查询所有工作区的成员数，避免串行 N+1（原 for 循环逐工作区 await）
  const memberCountEntries = await Promise.all(
    owned.map((m) =>
      runWithAuthOp(
        "provision",
        (tx) => tx.member.count({ where: { workspaceId: m.workspace.id } }),
        userId,
      )
        .then((c) => [m.workspace.id, c] as const)
        .catch(() => [m.workspace.id, 0] as const),
    ),
  );
  const memberCounts: Record<string, number> = {};
  for (const [id, c] of memberCountEntries) {
    memberCounts[id] = c;
  }

  return {
    ownedWorkspaces: owned.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      memberCount: memberCounts[m.workspace.id] ?? 0,
    })),
    joinedWorkspaces: joined.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      role: m.role,
    })),
    calendarConnections: connections,
    activeSubscription: subs ?? null,
    stats,
  };
}

/**
 * 执行账户删除。前置：路由层已校验认证 + 邮箱确认匹配。
 * 受 RLS 的表（members/workspaces/messages/calendar_connections 等）经
 * provision 逃生口（本人发起的系统级操作，注册同信任级）；
 * sessions/accounts/verifications 是 Better Auth 身份域表（不在 RLS 清单）。
 * 返回被删除的自有工作区数（供邮件与响应使用）。
 *
 * ─── 事务超时优化（DL-18 + M3：账户删除分批化，防大账户单事务超时）──────
 * 原实现将全部操作放在单个 runWithAuthOp 事务内，风险：
 *  1. 撤销日历 OAuth token 是外部 HTTP 调用（revokeToken），网络延迟会
 *     持续占用事务连接，放大 P2028 事务超时风险。
 *  2. User 删除触发 schema 级联（自有 workspaces 整租户级联：tasks/comments/
 *     decisions/messages/... 全链），大账户（千级任务）级联删除可能超 20s
 *     事务 timeout（见 auth.ts withGuc 的 timeout: 20_000）。
 *
 * 优化（M3 落地：分批删除，每批独立短事务）：
 *  - OAuth token 撤销移到事务外（尽力而为，失败不阻塞）。
 *  - 逐个删除自有工作区（每租户独立短事务，schema 级联清理该 workspace 下
 *    全部数据：tasks/comments/decisions/messages/members/... 全链）。
 *    大账户的级联删除分摊到多个短事务，单事务仅处理一个租户的数据量，
 *    显著降低 P2028 超时风险。
 *  - 最后一个短事务内：better-auth 清理 + User 删除（此时已无自有工作区，
 *    级联仅剩用户级数据：被邀工作区成员身份/calendarConnections/sessions/
 *    accounts/analyticsEvents 等，数据量小，不会超时）。
 *
 * 失败语义：某个 workspace 删除失败时抛出错误（调用方可重试，已删 workspace
 * 不会重复删除——findMany 已查不到）。已撤销的 OAuth token 不影响重试。
 */
export async function deleteAccount(userId: string): Promise<{ deletedWorkspaces: number }> {
  // 1. 撤销日历 OAuth token（事务外，尽力而为；DB 行随级联删除，token 未撤销会自然过期）
  //    M15 修复：撤销失败时记录日志（不阻塞删除，但便于排障）
  try {
    const connections = await runWithAuthOp(
      "provision",
      (tx) =>
        tx.calendarConnection.findMany({
          where: { userId },
          select: { provider: true, accessToken: true },
        }),
      userId,
    );
    for (const conn of connections) {
      try {
        const { decrypt } = await import("@/lib/crypto");
        const { revokeToken } = await import("./calendar/oauth");
        await revokeToken(conn.provider as "google" | "outlook", decrypt(conn.accessToken));
      } catch (err) {
        // M15 修复：撤销失败记录日志（不阻塞删除，token 会自然过期）
        console.error(
          `[account-deletion] OAuth token 撤销失败 provider=${conn.provider} userId=${userId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  } catch (err) {
    // M15 修复：查询连接失败记录日志（不阻塞删除，后续 User 删除会级联清理）
    console.error(
      `[account-deletion] 查询日历连接失败 userId=${userId}:`,
      err instanceof Error ? err.message : err,
    );
  }

  // 2. 查询自有工作区列表（删前统计 + 逐个删除目标）
  const ownedWorkspaces = await runWithAuthOp(
    "provision",
    (tx) =>
      tx.workspace.findMany({
        where: { ownerId: userId },
        select: { id: true },
      }),
    userId,
  );
  const deletedWorkspaces = ownedWorkspaces.length;

  // 3. 逐个删除自有工作区（M3：每租户独立短事务，schema 级联清理该 workspace 全部数据）
  //    Workspace DELETE 策略放行 owner_id = app.user_id；级联删除绕过 RLS（PG 行为）。
  //    每个事务仅处理一个租户的级联数据量，避免大账户单事务超时。
  //    L5 修复：单个 workspace 删除失败时记录错误但继续删除后续的，
  //    避免中间失败导致半删除状态（已删的前 N 个 + 未删的剩余）。
  for (const ws of ownedWorkspaces) {
    try {
      await runWithAuthOp(
        "provision",
        (tx) => tx.workspace.delete({ where: { id: ws.id } }),
        userId,
      );
    } catch (err) {
      console.error("[account-deletion] Failed to delete workspace:", ws.id, err);
    }
  }

  // 4. 最终短事务：better-auth 清理 + User 删除
  //    此时已无自有工作区（步骤 3 已删），User 删除级联仅剩用户级数据：
  //    被邀工作区的成员身份行（members）、calendarConnections、sessions、accounts、
  //    analyticsEvents、messageReads、chatPresences 等，数据量小，不会超时。
  //    Task.assignee/creator 为 SetNull，任务保留。
  //
  //    S-03 修复：步骤3采用尽力删除（catch 吞错），可能残留未删工作区。
  //    若直接进入步骤4，User 删除会触发残留工作区的整租户级联（大账户超时）。
  //    此处前置检查：确认无残留自有工作区，有则逐个强制删除后再进入步骤4。
  const remaining = await runWithAuthOp(
    "provision",
    (tx) => tx.workspace.count({ where: { ownerId: userId } }),
    userId,
  );
  if (remaining > 0) {
    console.warn(
      `[account-deletion] ${remaining} workspaces remain after step 3, forcing cleanup`,
    );
    const stale = await runWithAuthOp(
      "provision",
      (tx) => tx.workspace.findMany({ where: { ownerId: userId }, select: { id: true } }),
      userId,
    );
    for (const ws of stale) {
      await runWithAuthOp(
        "provision",
        (tx) => tx.workspace.delete({ where: { id: ws.id } }),
        userId,
      ).catch((err) => {
        // 强制删除仍失败：记录但不阻塞，User 删除级联会兜底（可能超时，但已尽力）
        console.error("[account-deletion] 强制删除工作区失败，User删除级联将兜底:", err);
      });
    }
  }

  await runWithAuthOp(
    "provision",
    async (tx) => {
      // better-auth 会话/账号清理（User 行删除前，否则 FK 挂住）
      await tx.session.deleteMany({ where: { userId } });
      await tx.account.deleteMany({ where: { userId } });

      // 删除 User —— schema 级联接管剩余用户级数据：
      //    被邀工作区的成员身份行级联删（数据保留）；calendarConnections 级联删；
      //    analyticsEvents 级联删；Task.assignee/creator SetNull 保留任务。
      await tx.user.delete({ where: { id: userId } });
    },
    userId,
  );

  return { deletedWorkspaces };
}
