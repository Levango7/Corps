// GET  /api/v1/ai/deliverables?wid=xxx — 交付任务列表（sidecar 全量透传，本机自托管语义）
// POST /api/v1/ai/deliverables        — 提交交付任务（转发 nexusloom Admin API 异步入队）
//
// 认证模式：getUserId → checkRateLimit → getWorkspaceContextV2（进墙）
// sidecar 不可达 → 502 + 明确文案（与 AI 输出解析降级同一档「可重试」语义）
//
// 经验来源：2026-11-22 邮箱域接线（新增 route 五门禁全链）

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContextV2 } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import { authFailure } from "@/lib/auth-response";
import {
  LoomUnavailableError,
  encodeLoomTitle,
  listLoomTasks,
  submitLoomTask,
} from "@/lib/ai/nexusloom";
import { withRed } from "@/lib/red-metrics";

const submitSchema = z.object({
  wid: z.string().uuid(),
  query: z.string().min(1).max(5000),
  title: z.string().min(1).max(150).optional(),
  pipeline: z
    .enum(["docgen", "docgen-lean", "docgen-verified", "docgen-render", "kb-docgen"])
    .optional(),
});

/** sidecar 异常的统一 502 出口（LoomUnavailableError / 网络层失败） */
function loomDownResponse(req: NextRequest): NextResponse {
  return NextResponse.json(
    { code: 502, message: apiMsg(req, "aiDeliveryUnavailable"), data: null },
    { status: 502 },
  );
}

/** 提交交付任务（异步：nexusloom 入队后立即返回任务 id，进度靠轮询） */
async function postDeliverable(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  const limited = await checkRateLimit(req, "ai-deliverables-submit", {
    windowMs: 60_000,
    max: 10,
  });
  if (limited) return limited;

  let body: z.infer<typeof submitSchema>;
  try {
    body = submitSchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        {
          code: 400,
          message: e.issues[0]?.message ?? apiMsg(req, "validationFailed"),
          data: null,
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidBody"), data: null },
      { status: 400 },
    );
  }

  try {
    const ctx = await getWorkspaceContextV2(req, body.wid);
    if (!ctx)
      // V2 契约上从不返回 null（见 lib/auth.ts 的 WorkspaceContextV2 文档：
      // "调用方遇到 null 应按 500 处理（fail-closed，不可当作 401 重试）"）。
      return NextResponse.json(
        { code: 500, message: apiMsg(req, "internalError"), data: null },
        { status: 500 },
      );
    if (!ctx.ok) return authFailure(ctx, req);

    const loomTitle = encodeLoomTitle(body.wid, body.title ?? body.query.slice(0, 80));
    const queued = await submitLoomTask({
      query: body.query,
      title: loomTitle,
      ...(body.pipeline ? { pipeline: body.pipeline } : {}),
    });
    // 入队响应的 id 字段名按 Admin API 实测（task_id 或 id 兼容取）
    const taskId = (queued.task_id ?? queued.id ?? null) as string | null;
    if (!taskId) {
      console.error("[POST ai/deliverables] submit returned no task id:", queued);
      return NextResponse.json(
        { code: 502, message: apiMsg(req, "aiDeliveryUnavailable"), data: null },
        { status: 502 },
      );
    }
    return NextResponse.json({
      code: 200,
      data: {
        taskId,
        pipeline: body.pipeline ?? "docgen",
        status: "queued",
      },
      message: apiMsg(req, "ok"),
    });
  } catch (error) {
    if (error instanceof LoomUnavailableError) return loomDownResponse(req);
    console.error("[POST ai/deliverables] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}

/** 交付任务列表（sidecar 全量透传；本机自托管语义，多租户隔离留第二竖切） */
async function getDeliverables(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  const limited = await checkRateLimit(req, "ai-deliverables-list", {
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

    const tasks = await listLoomTasks();
    return NextResponse.json({
      code: 200,
      data: { items: tasks, total: tasks.length },
      message: apiMsg(req, "ok"),
    });
  } catch (error) {
    if (error instanceof LoomUnavailableError) return loomDownResponse(req);
    console.error("[GET ai/deliverables] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}

export const GET = withRed(getDeliverables);
export const POST = withRed(postDeliverable);
