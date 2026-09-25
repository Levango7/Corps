// GET /api/v1/todos/count?workspaceId=xxx
//
// 待办计数：返回当前用户在指定工作区的待办总数及按类型分布。
// 仅统计 pending（未完成）待办，completed 不计入。
//
// 认证模式：getUserId → checkRateLimit → getWorkspaceContext → runWithWorkspace（RLS 事务）
// 约定：{ code, data, message } 信封

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";

// ─── 类型定义 ──────────────────────────────────────────────────────────────────

/** 按类型分布的计数 */
interface TodoCountByType {
  task: number;
  approval: number;
  meeting: number;
  document: number;
}

/** 计数响应 */
interface TodoCountResult {
  total: number;
  byType: TodoCountByType;
}

/** 审批节点配置（存储在 ApprovalInstance.nodes JSON 中） */
interface ApprovalNode {
  approverRole?: string;
  approverUserId?: string;
  name: string;
  order: number;
}

// ─── 查询参数 schema ────────────────────────────────────────────────────────────

const countQuerySchema = z.object({
  workspaceId: z.string().uuid(),
});

/**
 * 判断审批实例当前节点是否需要指定用户审批。
 */
function isCurrentApprover(nodes: unknown, currentNode: number, userId: string): boolean {
  if (!Array.isArray(nodes)) return false;
  const node = nodes[currentNode] as ApprovalNode | undefined;
  if (!node) return false;
  return node.approverUserId === userId;
}

/**
 * GET /api/v1/todos/count?workspaceId=xxx
 *
 * 返回当前用户在指定工作区的待办计数。
 */
export async function GET(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流：60s 内最多 60 次
  const limited = await checkRateLimit(req, "todos-count", {
    windowMs: 60_000,
    max: 60,
  });
  if (limited) return limited;

  // 2) 查询参数校验
  const url = new URL(req.url);
  const parsed = countQuerySchema.safeParse({
    workspaceId: url.searchParams.get("workspaceId") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      {
        code: 400,
        message: parsed.error.issues[0]?.message ?? apiMsg(req, "invalidParams"),
        data: null,
      },
      { status: 400 },
    );
  }
  const { workspaceId } = parsed.data;

  // 3) 工作区成员资格认证 + 计数查询
  try {
    const ctx = await getWorkspaceContext(req, workspaceId);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    const currentUserId = ctx.payload.sub;

    const result: TodoCountResult = await runWithWorkspace(
      workspaceId,
      async (tx) => {
        // ── 1. 任务计数（assigneeId = userId AND status != "done"）──
        const taskCount = await tx.task.count({
          where: {
            workspaceId,
            assigneeId: currentUserId,
            deletedAt: null,
            status: { not: "done" },
          },
        });

        // ── 2. 审批计数 ──
        // 审批人信息在 nodes JSON 中，需先查 pending 实例再在应用层过滤。
        // 取 pending 实例（含 nodes + currentNode），过滤当前节点审批人 = userId。
        const pendingInstances = await tx.approvalInstance.findMany({
          where: {
            workspaceId,
            status: "pending",
          },
          select: {
            id: true,
            currentNode: true,
            nodes: true,
          },
        });
        const approvalCount = pendingInstances.filter((inst) =>
          isCurrentApprover(inst.nodes, inst.currentNode, currentUserId),
        ).length;

        // ── 3. 会议计数（meeting.status = "active"）──
        const meetingCount = await tx.meetingParticipant.count({
          where: {
            userId: currentUserId,
            meeting: {
              workspaceId,
              status: "active",
            },
          },
        });

        // ── 4. 文档评论计数（mentions contains userId AND !resolved）──
        const documentCount = await tx.documentComment.count({
          where: {
            workspaceId,
            mentions: { has: currentUserId },
            resolved: false,
          },
        });

        return {
          total: taskCount + approvalCount + meetingCount + documentCount,
          byType: {
            task: taskCount,
            approval: approvalCount,
            meeting: meetingCount,
            document: documentCount,
          },
        };
      },
      currentUserId,
    );

    return NextResponse.json({ code: 0, data: result, message: apiMsg(req, "ok") });
  } catch (error) {
    console.error("[GET todos/count] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
