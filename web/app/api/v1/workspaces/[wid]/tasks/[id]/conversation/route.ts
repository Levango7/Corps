import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
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
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

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
