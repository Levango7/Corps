// GET /api/v1/ai/deliverables/<id>?wid=xxx — 交付任务详情（含输出内容与产出路径）
//
// 认证模式：getUserId → checkRateLimit → getWorkspaceContextV2（进墙）
// sidecar 不可达 → 502 + 明确文案；id 形态白名单校验（防路径拼接注入）

import { NextRequest, NextResponse } from "next/server";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContextV2 } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import { authFailure } from "@/lib/auth-response";
import { LoomUnavailableError, assertSafeLoomId, getLoomTask } from "@/lib/ai/nexusloom";
import { withRed } from "@/lib/red-metrics";

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

    const detail = await getLoomTask(id);
    return NextResponse.json({
      code: 200,
      data: {
        id: detail.id,
        status: detail.status,
        pipeline: detail.pipeline,
        createdAt: detail.created_at,
        finishedAt: detail.finished_at,
        error: detail.error ?? null,
        outputPath: detail.output_path,
        outputContent: detail.output_content,
        result: detail.result,
      },
      message: apiMsg(req, "ok"),
    });
  } catch (error) {
    if (error instanceof LoomUnavailableError) {
      // sidecar 明确回了 404（任务不存在/已淘汰）→ 透传 404；其余不可达 → 502
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
    console.error("[GET ai/deliverables/:id] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}

export const GET = withRed(getDeliverableById);
