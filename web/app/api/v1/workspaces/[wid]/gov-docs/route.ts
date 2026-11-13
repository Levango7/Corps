import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContextV2, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { apiMsg } from "@/lib/api-messages";
import { requirePermission } from "@/lib/permissions";
import { authFailure } from "@/lib/auth-response";
import { withRed } from "@/lib/red-metrics";
import { trackServerEvent } from "@/lib/analytics-server";

/**
 * GET /v1/workspaces/{wid}/gov-docs — 收发文登记列表
 * Query: ?direction=incoming|outgoing（收/发文过滤）
 *        ?status=draft|review|signed|exchanged|archived（状态过滤）
 *        ?page=&limit=（分页，默认 page=1 limit=50）
 * 按 createdAt DESC 排序（最新登记在前）。
 */
async function getGovDocs(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContextV2(req, wid);
  if (!ctx)
    // V2 契约上从不返回 null（见 lib/auth.ts 的 WorkspaceContextV2 文档：
    // "调用方遇到 null 应按 500 处理（fail-closed，不可当作 401 重试）"）。
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  if (!ctx.ok) return authFailure(ctx, req);

  try {
    const url = new URL(req.url);
    const parsed = listQuerySchema.safeParse({
      direction: url.searchParams.get("direction") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        {
          code: 400,
          message: apiMsg(req, "validationFailed"),
          errors: parsed.error.issues,
          data: null,
        },
        { status: 400 },
      );
    }
    const { page, limit } = parsed.data;
    const skip = (page - 1) * limit;

    const where: Prisma.GovDocWhereInput = { workspaceId: wid };
    if (parsed.data.direction) where.direction = parsed.data.direction;
    if (parsed.data.status) where.status = parsed.data.status;

    const [items, total] = await runWithWorkspace(wid, (tx) =>
      Promise.all([
        tx.govDoc.findMany({
          where,
          select: {
            id: true,
            docNo: true,
            title: true,
            direction: true,
            secretLevel: true,
            urgency: true,
            source: true,
            destination: true,
            status: true,
            createdBy: true,
            remarks: true,
            createdAt: true,
            updatedAt: true,
            creator: { select: { id: true, name: true, email: true } },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        tx.govDoc.count({ where }),
      ]),
    );

    return NextResponse.json({
      code: 200,
      data: { items, page, limit, total, hasMore: page * limit < total },
    });
  } catch (error) {
    console.error("[GET gov-docs] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/** 列表查询参数校验 */
const listQuerySchema = z.object({
  direction: z.enum(["incoming", "outgoing"]).optional(),
  status: z.enum(["draft", "review", "signed", "exchanged", "archived"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** 密级取值（等保条款原文核 §8-4 未定，先按四档登记，口径随核后回写） */
const SECRET_LEVELS = ["internal", "secret", "confidential", "topsecret"] as const;
/** 紧急程度 */
const URGENCIES = ["normal", "urgent", "extraurgent"] as const;

/** POST /v1/workspaces/{wid}/gov-docs — 登记收发文 */
const createSchema = z.object({
  docNo: z.string().min(1).max(64).optional(),
  title: z.string().min(1).max(200),
  direction: z.enum(["incoming", "outgoing"]).optional(),
  secretLevel: z.enum(SECRET_LEVELS).optional(),
  urgency: z.enum(URGENCIES).optional(),
  source: z.string().min(1).max(200).optional(),
  destination: z.string().min(1).max(200).optional(),
  remarks: z.string().optional(),
});

async function postGovDocs(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContextV2(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  if (!ctx.ok) return authFailure(ctx, req);

  const denied = await requirePermission(ctx, "govDocs", "create", req);
  if (denied) return denied;

  try {
    const body = await req.json();
    const validated = createSchema.parse(body);

    const govDoc = await runWithWorkspace(
      wid,
      (tx) =>
        tx.govDoc.create({
          data: {
            workspaceId: wid,
            docNo: validated.docNo ?? null,
            title: validated.title,
            direction: validated.direction ?? "incoming",
            secretLevel: validated.secretLevel ?? "internal",
            urgency: validated.urgency ?? "normal",
            source: validated.source ?? null,
            destination: validated.destination ?? null,
            remarks: validated.remarks ?? null,
            createdBy: ctx.payload.sub,
          },
          select: {
            id: true,
            docNo: true,
            title: true,
            direction: true,
            secretLevel: true,
            urgency: true,
            source: true,
            destination: true,
            status: true,
            createdBy: true,
            remarks: true,
            createdAt: true,
            updatedAt: true,
            creator: { select: { id: true, name: true, email: true } },
          },
        }),
      ctx.payload.sub,
    );

    // 事件面（设计文档 §7）：登记成功 = gov_doc_created。props 只带枚举维度，
    // 文号/标题/密级原文不进埋点（analytics_events 与业务表同库同隔离面，但
    // 埋点消费方是漏斗看板，维度越枚举越安全）。
    await trackServerEvent({
      userId: ctx.payload.sub,
      workspaceId: wid,
      name: "gov_doc_created",
      props: { direction: govDoc.direction, secretLevel: govDoc.secretLevel },
    });

    return NextResponse.json({ code: 201, data: govDoc }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          code: 400,
          message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"),
          data: null,
          errors: error.issues,
        },
        { status: 400 },
      );
    }
    console.error("[POST gov-docs] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

// ── RED 指标接线（Rate/Duration）：包装器见 lib/red-metrics.ts。
export const GET = withRed(getGovDocs);
export const POST = withRed(postGovDocs);
