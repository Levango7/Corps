// GET /api/v1/ai/deliverables/<id>?wid=xxx — 交付任务详情（库内记录 + sidecar 同步）
//
// 认证模式：getUserId → checkRateLimit → getWorkspaceContextV2（进墙）→ runWithWorkspace（RLS）
// 详情：库内记录为准（404=本工作区无此记录，不给跨工作区探测面）；
//       未终态时顺带从 sidecar 同步状态。文件下载在同目录 download 子路由。

import { NextRequest, NextResponse } from "next/server";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContextV2, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import { authFailure } from "@/lib/auth-response";
import { LoomUnavailableError } from "@/lib/ai/nexusloom";
import {
  isTerminalDeliverableStatus,
  syncDeliverableFromLoom,
  type DeliverableSyncResult,
} from "@/lib/ai/deliverable-sync";
import { withRed } from "@/lib/red-metrics";

/** sidecar 明确 404 → 透传；其余不可达 → 502 */
function loomErrorResponse(req: NextRequest, error: LoomUnavailableError): NextResponse {
  if (error.message.includes("HTTP 404")) {
    return NextResponse.json(
      { code: 404, message: apiMsg(req, "aiDeliveryTaskNotFound"), data: null },
      { status: 404 },
    );
  }
  return NextResponse.json(
    { code: 502, message: apiMsg(req, "aiDeliveryUnavailable"), data: null },
    { status: 502 },
  );
}

async function getDeliverableById(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  const limited = await checkRateLimit(req, "ai-deliverables-detail", {
    windowMs: 60_000,
    max: 60,
  });
  if (limited) return limited;

  const url = new URL(req.url);
  const wid = url.searchParams.get("wid") ?? "";
  if (!wid) {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidParams"), data: null },
      { status: 400 },
    );
  }

  try {
    const ctx = await getWorkspaceContextV2(req, wid);
    if (!ctx)
      return NextResponse.json(
        { code: 500, message: apiMsg(req, "internalError"), data: null },
        { status: 500 },
      );
    if (!ctx.ok) return authFailure(ctx, req);

    const row = await runWithWorkspace(
      wid,
      (tx) => tx.deliverable.findFirst({ where: { id, workspaceId: wid } }),
      ctx.payload.sub,
    );
    if (!row) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "aiDeliveryTaskNotFound"), data: null },
        { status: 404 },
      );
    }

    // 未终态时同步 sidecar（终态记录不再打 sidecar）。审批闸门态由共享
    // 同步器映射成 awaiting_approval，并惰性建立 corps 审批实例。
    let synced: DeliverableSyncResult | null = null;
    if (!isTerminalDeliverableStatus(row.status)) {
      try {
        synced = await syncDeliverableFromLoom({ wid, userId: ctx.payload.sub, row });
      } catch (e) {
        if (e instanceof LoomUnavailableError) return loomErrorResponse(req, e);
        // 其他同步异常不阻塞详情读取，但日志必须保留真因，不能静默伪装 running。
        console.error(`[GET ai/deliverables/:id] sync failed id=${row.id}:`, e);
      }
    }

    return NextResponse.json({
      code: 200,
      data: {
        id: row.id,
        taskId: row.taskId,
        title: row.title,
        pipeline: row.pipeline,
        status: synced?.status ?? row.status,
        createdAt: row.createdAt,
        finishedAt: synced?.finishedAt ?? row.finishedAt,
        error: synced?.detail.error ?? null,
        outputPath: synced?.outputPath ?? row.outputPath,
        outputContent: synced?.detail.output_content ?? row.outputSummary,
        approvalStatus: row.approvalStatus,
        approvalNote: row.approvalNote,
        approvalInstanceId: synced?.approvalInstanceId ?? row.approvalInstanceId,
        awaitingApproval: synced?.awaitingApproval ?? null,
      },
      message: apiMsg(req, "ok"),
    });
  } catch (error) {
    if (error instanceof LoomUnavailableError) return loomErrorResponse(req, error);
    console.error("[GET ai/deliverables/:id] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}

export const GET = withRed(getDeliverableById);
