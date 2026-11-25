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
import { LoomUnavailableError, getLoomTask } from "@/lib/ai/nexusloom";
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

    // 未终态时同步 sidecar（终态记录不再打 sidecar）
    let sidecar: Awaited<ReturnType<typeof getLoomTask>> | null = null;
    if (row.status === "running") {
      try {
        sidecar = await getLoomTask(row.taskId);
        if (sidecar.status !== row.status) {
          await runWithWorkspace(
            wid,
            (tx) =>
              tx.deliverable.update({
                where: { id: row.id },
                data: {
                  status: sidecar!.status,
                  ...(sidecar!.finished_at
                    ? { finishedAt: new Date(sidecar!.finished_at as unknown as string) }
                    : {}),
                  ...(sidecar!.output_path ? { outputPath: sidecar!.output_path } : {}),
                  outputSummary: (sidecar!.output_content ?? "").slice(0, 2000) || null,
                },
              }),
            ctx.payload.sub,
          );
        }
      } catch (e) {
        if (e instanceof LoomUnavailableError) return loomErrorResponse(req, e);
        // 其他同步异常不阻塞详情读取
      }
    }

    return NextResponse.json({
      code: 200,
      data: {
        id: row.id,
        taskId: row.taskId,
        title: row.title,
        pipeline: row.pipeline,
        status: sidecar?.status ?? row.status,
        createdAt: row.createdAt,
        finishedAt: sidecar?.finished_at ?? row.finishedAt,
        error: sidecar?.error ?? null,
        outputPath: sidecar?.output_path ?? row.outputPath,
        outputContent: sidecar?.output_content ?? row.outputSummary,
        approvalStatus: row.approvalStatus,
        approvedAt: row.approvedAt,
        approvedBy: row.approvedBy,
        approvalNote: row.approvalNote,
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
