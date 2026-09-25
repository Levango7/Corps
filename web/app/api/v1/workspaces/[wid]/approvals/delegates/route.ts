import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

/** GET 列表 query 校验 */
const listDelegatesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  active: z.literal("1").optional(),
});

/** POST 创建委托 body 校验 */
const createDelegateSchema = z.object({
  delegateToId: z.string().uuid(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  reason: z.string().max(500).optional(),
});

/**
 * GET /v1/workspaces/{wid}/approvals/delegates — 委托设置列表
 * Query: ?page=1&limit=20&active=1
 * 查询当前用户作为 delegatorId 的委托设置（我设置的委托）
 * active=1 时只返回 active=true 且 endAt > now() 的记录
 * 按 createdAt 倒序，include delegateTo 用户信息
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const url = new URL(req.url);
    const parsed = listDelegatesQuerySchema.safeParse({
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      active: url.searchParams.get("active") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        {
          code: 400,
          message: apiMsg(req, "validationFailed"),
          errors: parsed.error.errors,
          data: null,
        },
        { status: 400 },
      );
    }
    const { page, limit, active } = parsed.data;
    const skip = (page - 1) * limit;

    const now = new Date();
    const where = {
      workspaceId: wid,
      delegatorId: ctx.payload.sub,
      ...(active === "1" ? { active: true, endAt: { gt: now } } : {}),
    };

    const [items, total] = await runWithWorkspace(wid, (tx) =>
      Promise.all([
        tx.approvalDelegate.findMany({
          where,
          include: {
            delegateTo: { select: { id: true, name: true, email: true } },
          },
          orderBy: [{ createdAt: "desc" }],
          skip,
          take: limit,
        }),
        tx.approvalDelegate.count({ where }),
      ]),
    );

    return NextResponse.json({
      code: 200,
      data: {
        items,
        page,
        limit,
        total,
        hasMore: page * limit < total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("[GET approval-delegates] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * POST /v1/workspaces/{wid}/approvals/delegates — 创建委托设置
 * Body: { delegateToId, startAt, endAt, reason? }
 * 验证 delegateToId 是工作区成员（不能是自己）
 * 验证 startAt < endAt 且 startAt 不在过去
 * 检查时间重叠：[startAt, endAt] 与已有委托交集则返回 409
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const body = await req.json();
    const validated = createDelegateSchema.parse(body);

    const startAt = new Date(validated.startAt);
    const endAt = new Date(validated.endAt);

    // 验证 startAt < endAt
    if (startAt >= endAt) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationFailed"), data: null },
        { status: 400 },
      );
    }

    // 验证 startAt 不在过去
    if (startAt < new Date()) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationFailed"), data: null },
        { status: 400 },
      );
    }

    // 不能委托给自己
    if (validated.delegateToId === ctx.payload.sub) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationFailed"), data: null },
        { status: 400 },
      );
    }

    // 验证 delegateToId 是工作区成员
    const targetMember = await runWithWorkspace(wid, (tx) =>
      tx.member.findFirst({
        where: { userId: validated.delegateToId, workspaceId: wid },
      }),
    );
    if (!targetMember) {
      return NextResponse.json(
        { code: 403, message: apiMsg(req, "approvalDelegateTargetNotFound"), data: null },
        { status: 403 },
      );
    }

    // 检查时间重叠：查询当前用户已有的 active 委托
    // 两个区间 [A_start, A_end] 和 [B_start, B_end] 重叠的条件是 A_start < B_end && B_start < A_end
    const existingDelegates = await runWithWorkspace(wid, (tx) =>
      tx.approvalDelegate.findMany({
        where: {
          workspaceId: wid,
          delegatorId: ctx.payload.sub,
          active: true,
        },
        select: { startAt: true, endAt: true },
      }),
    );

    const hasOverlap = existingDelegates.some(
      (existing) => startAt < existing.endAt && existing.startAt < endAt,
    );
    if (hasOverlap) {
      return NextResponse.json(
        { code: 409, message: apiMsg(req, "approvalDelegateOverlap"), data: null },
        { status: 409 },
      );
    }

    const delegate = await runWithWorkspace(
      wid,
      (tx) =>
        tx.approvalDelegate.create({
          data: {
            workspaceId: wid,
            delegatorId: ctx.payload.sub,
            delegateToId: validated.delegateToId,
            startAt,
            endAt,
            reason: validated.reason,
            active: true,
          },
          include: {
            delegateTo: { select: { id: true, name: true, email: true } },
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 201, data: delegate }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          code: 400,
          message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"),
          data: null,
          errors: error.errors,
        },
        { status: 400 },
      );
    }
    console.error("[POST approval-delegate] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
