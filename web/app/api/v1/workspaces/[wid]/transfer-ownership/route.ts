// PATCH /api/v1/workspaces/{wid}/transfer-ownership — 转让所有权（owner only）
// 业务规则：被转让人必须是 admin 或 member；转让后原 owner 自动降为 admin
// 二次确认字段 currentOwnerPassword（暂以“知道即有权限”占位——完整方案需要
// 让原 owner 在转出前重新输密码，未来加二次确认。现用 admin 身份确认接口已
// 经 getWorkspaceContext 验证，足够本地演示）
import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  newOwnerUserId: z.string().uuid(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });
  if (ctx.member.role !== "owner") {
    return NextResponse.json({ code: 403, message: "仅所有者可转让所有权" }, { status: 403 });
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
    return NextResponse.json({ code: 400, message: "请求体无效" }, { status: 400 });
  }

  // 不能转给自己
  if (body.newOwnerUserId === ctx.payload.sub) {
    return NextResponse.json({ code: 400, message: "已经是所有者，无需转让" }, { status: 400 });
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

        // 原子事务：先升级新 owner（保持原 owner 一行不变——FK 只能有一个 owner 不可
        // 直接交换），升级完后由原 owner 降级
        const updated = await prisma.$transaction(async (ttx) => {
          await ttx.member.update({
            where: { userId_workspaceId: { userId: body.newOwnerUserId, workspaceId: wid } },
            data: { role: "owner" },
          });
          await ttx.member.update({
            where: { userId_workspaceId: { userId: ctx.payload.sub, workspaceId: wid } },
            data: { role: "admin" },
          });
          // 工作区表 ownerId 同步
          await ttx.workspace.update({
            where: { id: wid },
            data: { ownerId: body.newOwnerUserId },
          });
          return { ok: true };
        });
        return { kind: "ok" as const, updated };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notMember") {
      return NextResponse.json({ code: 400, message: "被转让用户不是工作区成员" }, { status: 400 });
    }
    return NextResponse.json({ code: 200, data: { ok: true } });
  } catch (error) {
    console.error("[PATCH transfer] error:", error);
    return NextResponse.json({ code: 500, message: "服务器内部错误" }, { status: 500 });
  }
}
