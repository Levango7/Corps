/**
 * POST /v1/workspaces/{wid}/tasks/{id}/decisions/{did}/sync-actions
 *
 * 手动触发决策行动项同步：从决策 Markdown 中解析行动项，与 DB 中已有
 * DecisionActionItem 做 diff（新增/变更/删除），自动创建/更新/标记删除关联 Task。
 *
 * 权限：member 及以上（viewer 不可，与 decisions/extract 对齐）。
 * 决策编辑后前端可自动调用此端点，也可由用户手动触发。
 */
import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { syncActionItems } from "@/lib/decision-action-parser";
import { Prisma } from "@prisma/client";
import { apiMsg } from "@/lib/api-messages";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string; did: string }> },
) {
  const { wid, id, did } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  // member 及以上可触发同步（viewer 不可修改）
  if (!["owner", "admin", "member"].includes(ctx.member.role)) {
    return NextResponse.json(
      { code: 403, message: apiMsg(req, "noPermission"), data: null },
      { status: 403 },
    );
  }

  try {
    const result = await runWithWorkspace(wid, async (tx) => {
      // 读取决策 markdown，校验决策存在且属于该任务 + 工作区
      const decision = await tx.decision.findFirst({
        where: { id: did, taskId: id, workspaceId: wid },
        select: { id: true, markdown: true },
      });
      if (!decision) return { notFound: true as const };

      // 在同一事务内同步行动项
      const syncResult = await syncActionItems(
        tx,
        decision.id,
        decision.markdown,
        wid,
        ctx.payload.sub,
      );
      return { notFound: false as const, syncResult };
    });

    if ("notFound" in result && result.notFound) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "decisionNotFound"), data: null },
        { status: 404 },
      );
    }

    const { syncResult } = result;
    return NextResponse.json({
      code: 200,

      data: {
        created: syncResult.created,
        updated: syncResult.updated,
        removed: syncResult.removed,
        tasks: syncResult.tasks,
      },
    });
  } catch (error) {
    // P2025: 记录不存在（并发删除场景）→ 404
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "decisionNotFound"), data: null },
        { status: 404 },
      );
    }
    console.error("[POST sync-actions] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}