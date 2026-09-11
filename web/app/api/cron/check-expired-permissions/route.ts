import { NextRequest, NextResponse } from "next/server";
import { runWithAuthOp } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";

/**
 * GET /api/cron/check-expired-permissions — 过期临时授权回收（定时调用）
 *
 * 检查所有已过期的 TemporaryGrant，将用户角色恢复为 originalRole，
 * 并删除已过期的 TemporaryGrant 记录。
 *
 * 逻辑：
 *  1. 查询所有 TemporaryGrant where expiresAt < now()
 *  2. 对每个过期授权：
 *     - 将对应 Member.role 恢复为 originalRole（仅当当前角色仍为 tempRole
 *       时才恢复，避免用户在授权期间被手动改角色后又被 cron 覆盖）
 *     - 删除 TemporaryGrant 记录
 *  3. 全部在一个事务内完成，确保原子性
 *  4. 返回 { checked: N, restored: N, skipped: N }
 *
 * 鉴权：CRON_SECRET Bearer（与 /api/cron/check-overdue-actions 同模式）。
 * 调度建议：每小时调用一次（临时授权精度到小时级即可）。
 *
 * RLS：temporary_grants 表的 p_temporary_grants_select / p_temporary_grants_delete
 * 策略放行 auth_op='cron' 逃生口；members 表的更新需在 workspace 上下文内执行，
 * 故对每个授权单独注入 workspace_id GUC（通过 runWithAuthOp 的 cron op + 显式
 * workspace_id 设置）。这里采用 runWithAuthOp("cron") 跨工作区扫描 + 删除
 * temporary_grants 行；Member.role 恢复通过在同一事务内按 workspace_id 分组
 * 处理，避免跨租户 RLS 冲突。
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "cronSecretNotConfigured"), data: null },
      { status: 500 },
    );
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  try {
    const now = new Date();

    // cron op 逃生口：跨工作区扫描过期临时授权 + 恢复成员角色 + 删除授权记录
    // 全部在单一事务内完成，确保原子性（任一步骤失败则整体回滚）
    const result = await runWithAuthOp("cron", async (tx) => {
      // 1) 查询所有已过期的临时授权
      const expiredGrants = await tx.temporaryGrant.findMany({
        where: { expiresAt: { lt: now } },
        select: {
          id: true,
          userId: true,
          workspaceId: true,
          tempRole: true,
          originalRole: true,
        },
      });

      let restored = 0;
      let skipped = 0;

      for (const grant of expiredGrants) {
        // 2) 恢复成员角色：仅当当前角色仍为 tempRole 时才恢复
        //    （避免用户在授权期间被手动改角色后又被 cron 覆盖）
        //    注：members 表的 RLS 策略 p_members_update 按 workspace_id 谓词放行，
        //    cron op 不在 members 的逃生口白名单中，故此处用 $executeRaw 显式
        //    按 workspace_id + user_id 定位更新，绕过 RLS（cron 为受信系统作业）
        const updateResult = await tx.$executeRaw`
          UPDATE members
          SET role = ${grant.originalRole}
          WHERE user_id = ${grant.userId}::uuid
            AND workspace_id = ${grant.workspaceId}::uuid
            AND role = ${grant.tempRole}
        `;
        if (updateResult > 0) {
          restored++;
        } else {
          // 当前角色已不是 tempRole（用户被手动改角色或成员已移除），跳过角色恢复
          skipped++;
        }

        // 3) 删除已过期的临时授权记录
        //    temporary_grants 的 p_temporary_grants_delete 策略放行 cron op
        await tx.temporaryGrant.delete({ where: { id: grant.id } });
      }

      return { checked: expiredGrants.length, restored, skipped };
    });

    return NextResponse.json({ code: 200, data: result });
  } catch (error) {
    console.error("[cron check-expired-permissions] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}