import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import { requirePermission } from "@/lib/permissions";

/**
 * 通讯录联系人 API · /api/v1/workspaces/{wid}/contacts
 *
 * - GET：列出联系人（支持 ?groupId=&search= 过滤、分页 take/skip）
 * - POST：创建联系人（zod 校验 name，可选 email/phone/department/position/notes/groupId）
 */

/** GET 列表 searchParams 校验 */
const listContactsQuerySchema = z.object({
  groupId: z.string().uuid().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * GET /v1/workspaces/{wid}/contacts — 联系人列表
 * Query: ?groupId=<uuid>（按分组过滤）
 *        ?search=<关键词>（姓名/邮箱/电话/部门/职位模糊搜索）
 *        ?page=&limit=（分页）
 * 返回按 name 正序
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
    const parsed = listContactsQuerySchema.safeParse({
      groupId: url.searchParams.get("groupId") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
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
    const { groupId, search, page, limit } = parsed.data;
    const skip = (page - 1) * limit;
    const q = search?.trim() || "";

    const where = {
      workspaceId: wid,
      ...(groupId ? { groupId } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { email: { contains: q, mode: "insensitive" as const } },
              { phone: { contains: q, mode: "insensitive" as const } },
              { department: { contains: q, mode: "insensitive" as const } },
              { position: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await runWithWorkspace(
      wid,
      (tx) =>
        Promise.all([
          tx.contact.findMany({
            where,
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              department: true,
              position: true,
              avatar: true,
              groupId: true,
              updatedAt: true,
            },
            orderBy: [{ name: "asc" }],
            skip,
            take: limit,
          }),
          tx.contact.count({ where }),
        ]),
      ctx.payload.sub,
    );

    return NextResponse.json({
      code: 200,
      data: { items, page, limit, total, hasMore: page * limit < total },
    });
  } catch (error) {
    console.error("[GET contacts] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

const createContactSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().max(255).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  department: z.string().max(100).optional().nullable(),
  position: z.string().max(100).optional().nullable(),
  avatar: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  groupId: z.string().uuid().optional().nullable(),
});

/** POST /v1/workspaces/{wid}/contacts — 新建联系人 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  const denied = await requirePermission(ctx, "contacts", "create", req);
  if (denied) return denied;

  try {
    const validated = createContactSchema.parse(await req.json());

    const contact = await runWithWorkspace(
      wid,
      (tx) =>
        tx.contact.create({
          data: {
            workspaceId: wid,
            name: validated.name,
            email: validated.email ?? null,
            phone: validated.phone ?? null,
            department: validated.department ?? null,
            position: validated.position ?? null,
            avatar: validated.avatar ?? null,
            notes: validated.notes ?? null,
            groupId: validated.groupId ?? null,
            createdBy: ctx.payload.sub,
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 201, data: contact }, { status: 201 });
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
    console.error("[POST contact] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}