import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/permissions";
import { getWorkspaceContextV2, runWithWorkspace } from "@/lib/auth";
import { authFailure } from "@/lib/auth-response";
import { apiMsg } from "@/lib/api-messages";

/**
 * 任务关联会话 API（任务 430）
 *
 * POST /v1/workspaces/{wid}/tasks/{id}/conversation — 获取或创建任务关联会话
 *
 * 行为：
 * 1. 若任务已有关联的 Conversation（Conversation.taskId = id），直接返回（200）
 * 2. 若没有，创建一个 type=group、source=task 的 Conversation，
 *    自动将任务指派人 + 创建者 + 当前用户加入为成员
 * 3. 会话标题默认为任务标题
 * 4. 返回 201（新建）或 200（已存在）
 */

/** 用户基本信息投影（会话成员列表复用） */
const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
} as const;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> },
) {
  const { wid, id } = await params;
  const ctx = await getWorkspaceContextV2(req, wid);
  if (!ctx)
    // V2 契约上从不返回 null（见 lib/auth.ts 的 WorkspaceContextV2 文档：
    // "调用方遇到 null 应按 500 处理（fail-closed，不可当作 401 重试）"）。
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  if (!ctx.ok) return authFailure(ctx, req);

  // 角色门禁：lib/permissions.ts 声明 messages 对 viewer 仅 "r"，此前只认证不判角色。
  const deniedRole = await requirePermission(ctx, "messages", "create", req);
  if (deniedRole) return deniedRole;

  const userId = ctx.payload.sub;

  try {
    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 1. 查找任务，验证存在且属于当前工作区
        const task = await tx.task.findUnique({
          where: { id, workspaceId: wid },
          select: { id: true, title: true, assigneeId: true, createdBy: true },
        });
        if (!task) return { status: "not_found" as const };

        // 1.5 get-or-create 必须原子：并发的两次 POST 会各自 findFirst 都查不到，
        // 于是都走 create ——一个任务被建出多条会话。实测（2026-10-05 生产 E2E 的
        // trace.network）一次任务详情页打开就发出 3 个 POST 且 3 个都 201，
        // 隔离库里 78 个任务带着 >1 条会话；后果不只是脏数据：面板显示的会话
        // 与消息实际写入的会话可能不是同一条，用户"发出去的消息自己看不到"。
        // 用事务级 advisory lock 按 taskId 串行化（锁随事务结束自动释放）：
        // 后到的事务会等前一个提交，再 findFirst 就能看到已存在的会话。
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;

        // 2. 查找已关联的 Conversation（taskId = id）
        const existing = await tx.conversation.findFirst({
          where: { taskId: id, workspaceId: wid },
          include: {
            members: {
              include: { user: { select: USER_SELECT } },
              orderBy: { joinedAt: "asc" },
            },
          },
        });
        if (existing) {
          return { status: "exists" as const, conversation: existing };
        }

        // 3. 创建新会话
        // 成员列表：当前用户(owner) + 任务指派人(member) + 任务创建者(member)
        // 去重：同一用户只创建一条成员记录
        const memberSet = new Map<string, "owner" | "member">();
        memberSet.set(userId, "owner");

        if (task.assigneeId && task.assigneeId !== userId) {
          memberSet.set(task.assigneeId, "member");
        }
        if (task.createdBy && task.createdBy !== userId && task.createdBy !== task.assigneeId) {
          memberSet.set(task.createdBy, "member");
        }

        const conversation = await tx.conversation.create({
          data: {
            workspaceId: wid,
            type: "group",
            source: "task",
            taskId: id,
            title: task.title,
            createdBy: userId,
            members: {
              create: Array.from(memberSet.entries()).map(([memberUserId, role]) => ({
                userId: memberUserId,
                role,
              })),
            },
          },
          include: {
            members: {
              include: { user: { select: USER_SELECT } },
              orderBy: { joinedAt: "asc" },
            },
          },
        });

        return { status: "created" as const, conversation };
      },
      userId,
    );

    if (result.status === "not_found") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "taskNotFound"), data: null },
        { status: 404 },
      );
    }

    const created = result.status === "created";
    return NextResponse.json(
      { code: created ? 201 : 200, data: result.conversation },
      { status: created ? 201 : 200 },
    );
  } catch (error) {
    console.error("[POST task conversation] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
