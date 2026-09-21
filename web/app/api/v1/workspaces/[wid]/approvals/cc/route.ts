import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

/** 我的抄送列表 query 校验 */
const listCcQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  unread: z.literal("1").optional(),
});

/**
 * GET /v1/workspaces/{wid}/approvals/cc — 当前用户的抄送列表
 * Query: ?page=1&limit=20&unread=1
 * 逻辑：
 *  1. 查询当前用户在当前工作区的所有 ApprovalCcRecord
 *  2. unread=1 时只返回 readAt 为 null 的记录
 *  3. 按 createdAt 倒序
 *  4. include instance（审批实例）的 title、applicant、status
 *  5. 返回分页格式
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string }> },
) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const url = new URL(req.url);
    const parsed = listCcQuerySchema.safeParse({
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      unread: url.searchParams.get("unread") ?? undefined,
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
    const { page, limit, unread } = parsed.data;

    const skip = (page - 1) * limit;
    const where = {
      workspaceId: wid,
      userId: ctx.payload.sub,
      ...(unread === "1" ? { readAt: null } : {}),
    };

    const [items, total] = await runWithWorkspace(
      wid,
      (tx) =>
        Promise.all([
          tx.approvalCcRecord.findMany({
            where,
            include: {
              instance: {
                select: {
                  id: true,
                  title: true,
                  status: true,
                  applicant: { select: { id: true, name: true, email: true } },
                },
              },
            },
            orderBy: [{ createdAt: "desc" }],
            skip,
            take: limit,
          }),
          tx.approvalCcRecord.count({ where }),
        ]),
      ctx.payload.sub,
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
    console.error("[GET approval-cc-list] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}