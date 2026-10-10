import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/permissions";
import { getWorkspaceContextV2, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { apiMsg } from "@/lib/api-messages";
import { authFailure } from "@/lib/auth-response";

/**
 * GET /v1/workspaces/{wid}/whiteboards — 工作区白板列表
 * Query: ?take=<数量> &skip=<偏移>（分页，按 updatedAt 倒序）
 * 返回 { code, data: { items, total, hasMore } }
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
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
    const parsed = listWbQuerySchema.safeParse({
      take: url.searchParams.get("take") ?? undefined,
      skip: url.searchParams.get("skip") ?? undefined,
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
    const { take, skip } = parsed.data;

    const where = { workspaceId: wid };

    const [items, total] = await runWithWorkspace(wid, (tx) =>
      Promise.all([
        tx.whiteboard.findMany({
          where,
          select: {
            id: true,
            title: true,
            updatedAt: true,
            createdAt: true,
          },
          orderBy: [{ updatedAt: "desc" }],
          skip,
          take,
        }),
        tx.whiteboard.count({ where }),
      ]),
    );

    return NextResponse.json({
      code: 200,
      data: { items, total, hasMore: skip + take < total },
    });
  } catch (error) {
    console.error("[GET whiteboards] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * 列表 searchParams 校验：
 *  - take: 每页数量（默认 50，最大 100）
 *  - skip: 偏移量（默认 0）
 */
const listWbQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(100).default(50),
  skip: z.coerce.number().int().min(0).default(0),
});

/** 创建白板校验：title 必填（1~200 字符），data 可选（字符串或数组，默认空数组） */
const createWbSchema = z.object({
  title: z.string().min(1).max(200),
  data: z.union([z.string(), z.array(z.any())]).optional(),
});

/** POST /v1/workspaces/{wid}/whiteboards — 新建白板 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
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

  // 角色门禁：lib/permissions.ts 声明 whiteboards 对 viewer 仅 "r"，此前只认证不判角色。
  const deniedRole = await requirePermission(ctx, "whiteboards", "create", req);
  if (deniedRole) return deniedRole;

  try {
    const body = await req.json();
    const validated = createWbSchema.parse(body);

    // data 列为 JsonB：字符串则 JSON.parse 为数组，否则默认空数组
    const parsedData: Prisma.InputJsonValue = validated.data
      ? typeof validated.data === "string"
        ? (JSON.parse(validated.data) as Prisma.InputJsonValue)
        : (validated.data as Prisma.InputJsonValue)
      : [];

    const wb = await runWithWorkspace(
      wid,
      (tx) =>
        tx.whiteboard.create({
          data: {
            workspaceId: wid,
            title: validated.title,
            data: parsedData,
            createdBy: ctx.payload.sub,
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 201, data: wb }, { status: 201 });
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
    console.error("[POST whiteboard] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
