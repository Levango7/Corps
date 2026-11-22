// GET /api/v1/ai/deliverables/<id>/download?wid=xxx — 交付物文件下载（sidecar 账本流代理）
//
// 认证模式：getUserId → checkRateLimit → getWorkspaceContextV2（进墙）→ runWithWorkspace（RLS）
// 只放行「已完成且有落盘产物」的记录；文件流经 sidecar 账本 download 端点透传
// （文件名由上游 RFC 5987 消毒，corps 不复述任何客户端输入进响应头）。

import { NextRequest, NextResponse } from "next/server";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContextV2, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import { authFailure } from "@/lib/auth-response";
import { LoomUnavailableError, fetchLoomDeliveryDownload } from "@/lib/ai/nexusloom";
import { withRed } from "@/lib/red-metrics";

async function downloadDeliverable(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  const limited = await checkRateLimit(req, "ai-deliverables-download", {
    windowMs: 60_000,
    max: 20,
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
    if (!row || row.status !== "done" || !row.outputPath) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "aiDeliveryNoFile"), data: null },
        { status: 404 },
      );
    }

    const upstream = await fetchLoomDeliveryDownload(row.taskId);
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
        "Content-Disposition":
          upstream.headers.get("content-disposition") ??
          `attachment; filename="deliverable-${row.taskId}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof LoomUnavailableError) {
      if (error.message.includes("HTTP 404")) {
        return NextResponse.json(
          { code: 404, message: apiMsg(req, "aiDeliveryNoFile"), data: null },
          { status: 404 },
        );
      }
      return NextResponse.json(
        { code: 502, message: apiMsg(req, "aiDeliveryUnavailable"), data: null },
        { status: 502 },
      );
    }
    console.error("[GET ai/deliverables/:id/download] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}

export const GET = withRed(downloadDeliverable);
