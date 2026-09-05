// PATCH /api/v1/workspaces/{wid}/members/{userId} — 改成员角色（owner only）
// 业务规则：被改的人不能是 owner 唯一；admin 不可提升为 owner；不能改 owner 自己
import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";

const updateSchema = z.object({
  role: z.enum(["admin", "member"]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; userId: string }> },
) {
  const { wid, userId } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });
  if (ctx.member.role !== "owner") {
    return NextResponse.json({ code: 403, message: "仅所有者可改成员角色" }, { status: 403 });
  }

  let body: z.infer<typeof updateSchema>;
  try {
    body = updateSchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: e.issues[0]?.message ?? "参数校验失败" },
        { status: 400 },
      );
    }
    return NextResponse.json({ code: 400, message: "请求体无效" }, { status: 400 });
  }

  try {
    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 不能改 owner 自己的角色
        const target = await tx.member.findUnique({
          where: { userId_workspaceId: { userId, workspaceId: wid } },
          select: { role: true, userId: true },
        });
        if (!target) return { kind: "notFound" as const };
        if (target.userId === ctx.payload.sub) {
          return { kind: "selfOwner" as const };
        }
        if (target.role === "owner") {
          return { kind: "ownerImmutable" as const };
        }
        const updated = await tx.member.update({
          where: { userId_workspaceId: { userId, workspaceId: wid } },
          data: { role: body.role },
          select: { userId: true, role: true },
        });
        return { kind: "ok" as const, updated };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json({ code: 404, message: "成员不存在" }, { status: 404 });
    }
    if (result.kind === "selfOwner") {
      return NextResponse.json(
        { code: 400, message: "不能修改自己的角色" },
        { status: 400 },
      );
    }
    if (result.kind === "ownerImmutable") {
      return NextResponse.json(
        { code: 400, message: "不能修改所有者的角色，请先转让所有权" },
        { status: 400 },
      );
    }
    return NextResponse.json({ code: 200, data: result.updated });
  } catch (error) {
    console.error("[PATCH member] error:", error);
    return NextResponse.json({ code: 500, message: "服务器内部错误" }, { status: 500 });
  }
}
