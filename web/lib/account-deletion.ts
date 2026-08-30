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
  const stats = { ownedTasks: 0, ownedDecisions: 0, messages: 0 };
  for (const w of ownedIds) {
    const s = await withGuc({ workspace_id: w, user_id: userId }, (tx) =>
      Promise.all([
        tx.task.count({ where: { workspaceId: w } }),
        tx.decision.count({ where: { workspaceId: w } }),
        tx.message.count({ where: { workspaceId: w } }),
      ]),
    );
    stats.ownedTasks += s[0];
    stats.ownedDecisions += s[1];
    stats.messages += s[2];
  }

  // 自有工作区的成员数（统计含他人成员行 → provision 系统操作）
  const memberCounts: Record<string, number> = {};
  for (const m of owned) {
    const c = await runWithAuthOp(
      "provision",
      (tx) => tx.member.count({ where: { workspaceId: m.workspace.id } }),
      userId,
    ).catch(() => -1);
    memberCounts[m.workspace.id] = c;
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
 */
export async function deleteAccount(userId: string): Promise<{ deletedWorkspaces: number }> {
  return runWithAuthOp(
    "provision",
    async (tx) => {
      // 1. 撤销日历 OAuth token（尽力而为；DB 行随级联删除）
      const connections = await tx.calendarConnection.findMany({
        where: { userId },
        select: { provider: true, accessToken: true },
      });
      for (const conn of connections) {
        try {
          const { decrypt } = await import("@/lib/crypto");
          const { revokeToken } = await import("./calendar/oauth");
          await revokeToken(conn.provider as "google" | "outlook", decrypt(conn.accessToken));
        } catch {
          // 撤销失败不阻塞删除（记录由路由层做）
        }
      }

      // 2. 统计自有工作区数（删前）
      const ownedCount = await tx.workspace.count({ where: { ownerId: userId } });

      // 3. better-auth 会话/账号清理（User 行删除前，否则 FK 挂住）
      await tx.session.deleteMany({ where: { userId } });
      await tx.account.deleteMany({ where: { userId } });

      // 4. 删除 User —— schema 级联接管全部：
      //    members/messages/chat/connection 等直接行级联；
      //    自有 workspaces 整租户级联（tasks/comments/decisions/... 全链）；
      //    被邀工作区的成员身份行级联删（数据保留）；Task.assignee/creator SetNull
      await tx.user.delete({ where: { id: userId } });

      return { deletedWorkspaces: ownedCount };
    },
    userId,
  );
}
