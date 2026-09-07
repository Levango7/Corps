// PATCH /api/v1/workspaces/{wid}/transfer-ownership — 转让所有权（owner only）
// 业务规则：被转让人必须是 admin 或 member；转让后原 owner 自动降为 admin
// 二次确认字段 currentOwnerPassword（暂以“知道即有权限”占位——完整方案需要
// 让原 owner 在转出前重新输密码，未来加二次确认。现用 admin 身份确认接口已
// 经 getWorkspaceContext 验证，足够本地演示）
import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

const schema = z.object({
  newOwnerUserId: z.string().uuid(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });
  if (ctx.member.role !== "owner") {
    return NextResponse.json({ code: 403, message: apiMsg(req, "onlyOwnerTransfer") }, { status: 403 });
  }

  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: e.issues[0]?.message ?? "参数校验失败" },
        { status: 400 },
      );
    }
    return NextResponse.json({ code: 400, message: apiMsg(req, "invalidBody") }, { status: 400 });
  }

  // 不能转给自己
  if (body.newOwnerUserId === ctx.payload.sub) {
    return NextResponse.json({ code: 400, message: apiMsg(req, "alreadyOwner") }, { status: 400 });
  }

  try {
    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const newOwner = await tx.member.findUnique({
          where: { userId_workspaceId: { userId: body.newOwnerUserId, workspaceId: wid } },
          select: { role: true },
        });
        if (!newOwner) return { kind: "notMember" as const };

        // 已在 runWithWorkspace 事务内（RLS GUC 已注入）：按顺序更新，任何一步
        // 抛错都整体回滚，不需要再包 prisma.$transaction（嵌套事务会被 Prisma 拒绝）。
        await tx.member.update({
          where: { userId_workspaceId: { userId: body.newOwnerUserId, workspaceId: wid } },
          data: { role: "owner" },
        });
        await tx.member.update({
          where: { userId_workspaceId: { userId: ctx.payload.sub, workspaceId: wid } },
          data: { role: "admin" },
        });
        await tx.workspace.update({
          where: { id: wid },
          data: { ownerId: body.newOwnerUserId },
        });
        return { kind: "ok" as const };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notMember") {
      return NextResponse.json({ code: 400, message: apiMsg(req, "transfereeNotMember") }, { status: 400 });
    }
    return NextResponse.json({ code: 200, data: { ok: true } });
  } catch (error) {
    console.error("[PATCH transfer] error:", error);
    return NextResponse.json({ code: 500, message: apiMsg(req, "internalError") }, { status: 500 });
  }
}
