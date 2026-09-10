import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

/** 分页查询参数校验：page 默认 1，limit 默认 50，最大 100 */
const listMembersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const url = new URL(req.url);
    const parsed = listMembersQuerySchema.safeParse({
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationFailed"), errors: parsed.error.errors, data: null },
        { status: 400 },
      );
    }
    const { page, limit } = parsed.data;
    const skip = (page - 1) * limit;

    const [members, total] = await runWithWorkspace(
      wid,
      async (tx) =>
        Promise.all([
          tx.member.findMany({
            where: { workspaceId: wid },
            include: { user: { select: { id: true, email: true, name: true, image: true } } },
            orderBy: { joinedAt: "asc" },
            skip,
            take: limit,
          }),
          tx.member.count({ where: { workspaceId: wid } }),
        ]),
      ctx.payload.sub,
    );

    return NextResponse.json({
      code: 200,
      data: members.map((m) => ({
        id: m.user.id,
        email: m.user.email,
        name: m.user.name,
        image: m.user.image,
        role: m.role,
        isSelf: m.user.id === ctx.payload.sub,
        joinedAt: m.joinedAt,
      })),
      total,
      page,
      limit,
    });
  } catch (error) {
    console.error("[GET members] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
