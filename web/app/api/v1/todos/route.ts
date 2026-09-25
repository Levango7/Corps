// GET /api/v1/todos?workspaceId=xxx&type=all|task|approval|meeting|document&status=pending|completed&limit=50
//
// 跨模块待办聚合：将任务、审批、会议、文档评论中与当前用户相关的待办项
// 统一聚合为标准格式返回，按 dueDate/createdAt 排序。
//
// 聚合来源：
//   1. 任务     — Task where assigneeId = userId AND status != "done"
//   2. 审批     — ApprovalInstance where status = "pending" AND 当前节点审批人 = userId
//   3. 会议     — MeetingParticipant where userId = userId AND meeting.status = "active"
//   4. 文档评论 — DocumentComment where mentions contains userId AND !resolved
//
// 认证模式：getUserId → checkRateLimit → getWorkspaceContext → runWithWorkspace（RLS 事务）
// 安全：通过 workspaceId + userId 过滤确保用户只能看到自己的待办
// 约定：{ code, data, message } 信封

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";

// ─── 类型定义 ──────────────────────────────────────────────────────────────────

/** 待办类型 */
type TodoType = "task" | "approval" | "meeting" | "document";

/** 统一待办状态 */
type TodoStatus = "pending" | "completed";

/** 统一待办项格式 */
interface TodoItem {
  id: string;
  type: TodoType;
  title: string;
  description?: string;
  dueDate?: string;
  priority?: string;
  sourceUrl: string;
  status: TodoStatus;
  createdAt: string;
}

/** 审批节点配置（存储在 ApprovalInstance.nodes JSON 中） */
interface ApprovalNode {
  approverRole?: string;
  approverUserId?: string;
  name: string;
  order: number;
}

// ─── 查询参数 schema ────────────────────────────────────────────────────────────

const listQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  type: z.enum(["all", "task", "approval", "meeting", "document"]).default("all"),
  status: z.enum(["pending", "completed"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// ─── 辅助函数 ──────────────────────────────────────────────────────────────────

/**
 * 判断审批实例当前节点是否需要指定用户审批。
 * ApprovalInstance.nodes 是审批节点配置快照（JSON），currentNode 指向当前节点序号。
 * 若当前节点的 approverUserId 等于 userId，则该用户需要审批此实例。
 */
function isCurrentApprover(nodes: unknown, currentNode: number, userId: string): boolean {
  if (!Array.isArray(nodes)) return false;
  const node = nodes[currentNode] as ApprovalNode | undefined;
  if (!node) return false;
  return node.approverUserId === userId;
}

/**
 * 按待办项排序：优先按 dueDate 升序（最近截止的在前），
 * 无 dueDate 的按 createdAt 降序（最新创建的在前）。
 */
function sortTodos(items: TodoItem[]): TodoItem[] {
  return items.sort((a, b) => {
    // 有 dueDate 的排前面，按截止日期升序
    if (a.dueDate && b.dueDate) {
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    }
    if (a.dueDate && !b.dueDate) return -1;
    if (!a.dueDate && b.dueDate) return 1;
    // 都没有 dueDate，按 createdAt 降序
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

/**
 * GET /api/v1/todos?workspaceId=xxx[&type=all][&status=pending][&limit=50]
 *
 * 返回当前用户在指定工作区的跨模块待办聚合列表。
 */
export async function GET(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流：60s 内最多 60 次
  const limited = await checkRateLimit(req, "todos-list", {
    windowMs: 60_000,
    max: 60,
  });
  if (limited) return limited;

  // 2) 查询参数校验
  const url = new URL(req.url);
  const parsed = listQuerySchema.safeParse({
    workspaceId: url.searchParams.get("workspaceId") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
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
  const { workspaceId, type, status, limit } = parsed.data;

  // 3) 工作区成员资格认证 + 聚合查询
  try {
    const ctx = await getWorkspaceContext(req, workspaceId);
    if (!ctx) {
      return NextResponse.json(
        { code: 401, message: apiMsg(req, "unauthorized"), data: null },
        { status: 401 },
      );
    }

    const currentUserId = ctx.payload.sub;
    const todos: TodoItem[] = [];

    // 并行查询各来源（在同一个 RLS 事务内）
    await runWithWorkspace(
      workspaceId,
      async (tx) => {
        // ── 1. 任务待办 ──
        if (type === "all" || type === "task") {
          const tasks = await tx.task.findMany({
            where: {
              workspaceId,
              assigneeId: currentUserId,
              deletedAt: null,
              ...(status === "pending"
                ? { status: { not: "done" } }
                : status === "completed"
                  ? { status: "done" }
                  : {}),
            },
            select: {
              id: true,
              title: true,
              description: true,
              status: true,
              priority: true,
              dueDate: true,
              createdAt: true,
            },
            take: limit,
          });

          for (const task of tasks) {
            todos.push({
              id: task.id,
              type: "task",
              title: task.title,
              description: task.description ?? undefined,
              dueDate: task.dueDate?.toISOString() ?? undefined,
              priority: task.priority,
              sourceUrl: `/dashboard/tasks/${task.id}`,
              status: task.status === "done" ? "completed" : "pending",
              createdAt: task.createdAt.toISOString(),
            });
          }
        }

        // ── 2. 审批待办 ──
        if (type === "all" || type === "approval") {
          // 审批人信息在 nodes JSON 中，Prisma 无法直接过滤当前节点审批人，
          // 因此先按 status 粗筛实例，再在应用层按 currentNode 的 approverUserId 精筛。
          // status 未指定时不加过滤，返回所有状态的审批实例。
          const approvalWhere: {
            workspaceId: string;
            status?: string | { not: string };
          } = { workspaceId };
          if (status === "pending") {
            approvalWhere.status = "pending";
          } else if (status === "completed") {
            approvalWhere.status = { not: "pending" };
          }

          const instances = await tx.approvalInstance.findMany({
            where: approvalWhere,
            select: {
              id: true,
              title: true,
              description: true,
              status: true,
              currentNode: true,
              nodes: true,
              submittedAt: true,
              createdAt: true,
            },
            take: limit * 2, // 多取一些，应用层过滤当前节点审批人
          });

          for (const inst of instances) {
            // 应用层过滤：当前节点审批人是否为当前用户
            if (!isCurrentApprover(inst.nodes, inst.currentNode, currentUserId)) {
              continue;
            }

            todos.push({
              id: inst.id,
              type: "approval",
              title: inst.title,
              description: inst.description ?? undefined,
              dueDate: undefined, // 审批无截止日期
              priority: undefined, // 审批无优先级
              sourceUrl: `/dashboard/approvals/${inst.id}`,
              status: inst.status === "pending" ? "pending" : "completed",
              createdAt: inst.submittedAt.toISOString(),
            });
          }
        }

        // ── 3. 会议待办 ──
        if (type === "all" || type === "meeting") {
          const participants = await tx.meetingParticipant.findMany({
            where: {
              userId: currentUserId,
              meeting: {
                workspaceId,
                // status 过滤：pending → active 会议，completed → ended 会议
                ...(status === "pending"
                  ? { status: "active" }
                  : status === "completed"
                    ? { status: "ended" }
                    : {}),
              },
            },
            select: {
              id: true,
              meeting: {
                select: {
                  id: true,
                  title: true,
                  description: true,
                  status: true,
                  scheduledAt: true,
                  createdAt: true,
                },
              },
            },
            take: limit,
          });

          for (const p of participants) {
            const meeting = p.meeting;
            todos.push({
              id: meeting.id,
              type: "meeting",
              title: meeting.title,
              description: meeting.description ?? undefined,
              dueDate: meeting.scheduledAt?.toISOString() ?? undefined,
              priority: undefined,
              sourceUrl: `/dashboard/meetings/${meeting.id}`,
              status: meeting.status === "ended" ? "completed" : "pending",
              createdAt: meeting.createdAt.toISOString(),
            });
          }
        }

        // ── 4. 文档评论待办（@提及且未解决）──
        if (type === "all" || type === "document") {
          // Prisma 的 array_contains 过滤 mentions 数组包含当前用户 ID
          const comments = await tx.documentComment.findMany({
            where: {
              workspaceId,
              mentions: { has: currentUserId },
              // status 过滤：pending → 未解决，completed → 已解决
              ...(status === "pending"
                ? { resolved: false }
                : status === "completed"
                  ? { resolved: true }
                  : {}),
            },
            select: {
              id: true,
              body: true,
              resolved: true,
              documentId: true,
              createdAt: true,
            },
            take: limit,
          });

          for (const comment of comments) {
            todos.push({
              id: comment.id,
              type: "document",
              title: comment.body.slice(0, 100), // 评论内容截断作为标题
              description: comment.body.length > 100 ? comment.body.slice(0, 200) : undefined,
              dueDate: undefined,
              priority: undefined,
              sourceUrl: `/dashboard/documents/${comment.documentId}`,
              status: comment.resolved ? "completed" : "pending",
              createdAt: comment.createdAt.toISOString(),
            });
          }
        }
      },
      currentUserId,
    );

    // 排序 + 截断
    const sorted = sortTodos(todos).slice(0, limit);

    return NextResponse.json({ code: 0, data: sorted, message: apiMsg(req, "ok") });
  } catch (error) {
    console.error("[GET todos] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
