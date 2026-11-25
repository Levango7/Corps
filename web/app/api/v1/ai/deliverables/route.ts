// GET  /api/v1/ai/deliverables?wid=xxx — 交付任务列表（corps 侧落库记录 + running 态同步）
// POST /api/v1/ai/deliverables        — 提交交付任务（sidecar 入队 + 立即落库）
//
// 认证模式：getUserId → checkRateLimit → getWorkspaceContextV2（进墙）→ runWithWorkspace（RLS）
// 落库形态：提交时以 sidecar task_id 建记录（status=running），列表/详情接口顺带同步状态；
//           交付账本（sidecar）为准，corps 表存元数据与展示态。
//
// 经验来源：2026-11-22 邮箱域接线（新增 route 门禁全链）

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContextV2, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import { authFailure } from "@/lib/auth-response";
import {
  LoomUnavailableError,
  decodeLoomTitle,
  encodeLoomTitle,
  listLoomTasks,
  submitLoomTask,
} from "@/lib/ai/nexusloom";
import { isTerminalDeliverableStatus, syncDeliverableFromLoom } from "@/lib/ai/deliverable-sync";
import { withRed } from "@/lib/red-metrics";

const submitSchema = z.object({
  wid: z.string().uuid(),
  query: z.string().min(1).max(5000),
  title: z.string().min(1).max(150).optional(),
  pipeline: z
    .enum([
      "docgen",
      "docgen-lean",
      "docgen-verified",
      "docgen-render",
      "docgen-review",
      "kb-docgen",
    ])
    .optional(),
});

/** sidecar 异常的统一 502 出口 */
function loomDownResponse(req: NextRequest): NextResponse {
  return NextResponse.json(
    { code: 502, message: apiMsg(req, "aiDeliveryUnavailable"), data: null },
    { status: 502 },
  );
}

/** 提交交付任务：sidecar 入队 + corps 侧立即落库（running 态，taskId 归属明确） */
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
    const taskId = (queued.task_id ?? queued.id ?? null) as string | null;
    if (!taskId) {
      console.error("[POST ai/deliverables] submit returned no task id:", queued);
      return NextResponse.json(
        { code: 502, message: apiMsg(req, "aiDeliveryUnavailable"), data: null },
        { status: 502 },
      );
    }

    // 提交即落库：归属（wid/userId）在提交时已知，后续列表/详情按库展示与同步
    const row = await runWithWorkspace(
      body.wid,
      (tx) =>
        tx.deliverable.create({
          data: {
            workspaceId: body.wid,
            taskId,
            title: decodeLoomTitle(loomTitle).title,
            pipeline: body.pipeline ?? "docgen",
            status: "running",
            createdBy: ctx.payload.sub,
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({
      code: 200,
      data: {
        id: row.id,
        taskId,
        pipeline: row.pipeline,
        status: row.status,
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

/** 单条活动记录的状态同步（sidecar 详情 → 库内刷新；失败留日志，下次再试） */
async function syncRunningTask(
  wid: string,
  userId: string,
  row: {
    id: string;
    taskId: string;
    title: string;
    pipeline: string;
    status: string;
    outputPath: string | null;
    outputSummary: string | null;
    approvalInstanceId: string | null;
    createdBy: string;
  },
): Promise<void> {
  try {
    await syncDeliverableFromLoom({ wid, userId, row });
  } catch (error) {
    // 保留库内状态下次再试，但必须留下真因；此前裸 catch 把 advisory-lock
    // 反序列化错误伪装成持续 running，排障只能盲猜 sidecar。
    console.error(`[deliverables sync] task=${row.taskId} id=${row.id}:`, error);
  }
}

/** 交付任务列表：库内记录为准（多租户隔离），running 态顺带同步 sidecar */
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

    let rows = await runWithWorkspace(
      wid,
      (tx) =>
        tx.deliverable.findMany({
          where: { workspaceId: wid },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
      ctx.payload.sub,
    );

    // 活动态同步（限 5 条防放大；awaiting_approval 也要继续轮询，
    // 否则 sidecar 闸门放行后 corps 会永远停在待审展示态）
    const active = rows.filter((r) => !isTerminalDeliverableStatus(r.status)).slice(0, 5);
    if (active.length > 0) {
      await Promise.all(active.map((r) => syncRunningTask(wid, ctx.payload.sub, r)));
      rows = await runWithWorkspace(
        wid,
        (tx) =>
          tx.deliverable.findMany({
            where: { workspaceId: wid },
            orderBy: { createdAt: "desc" },
            take: 100,
          }),
        ctx.payload.sub,
      );
    }

    // sidecar 全量任务数（供运维对照；不参与展示过滤）
    let sidecarTotal: number | null = null;
    try {
      sidecarTotal = (await listLoomTasks()).length;
    } catch {
      // 不可达时忽略
    }

    return NextResponse.json({
      code: 200,
      data: {
        items: rows.map((r) => ({
          id: r.id,
          taskId: r.taskId,
          title: r.title,
          pipeline: r.pipeline,
          status: r.status,
          createdAt: r.createdAt,
          finishedAt: r.finishedAt,
          outputPath: r.outputPath,
          approvalStatus: r.approvalStatus,
          approvalInstanceId: r.approvalInstanceId,
        })),
        total: rows.length,
        sidecarTotal,
      },
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
