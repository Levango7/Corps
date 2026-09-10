// PATCH /api/v1/workspaces/{wid}/transfer-ownership — 转让所有权（owner only）
// 业务规则：被转让人必须是 admin 或 member；转让后原 owner 自动降为 admin
// 安全（M4 修复）：转让所有权前要求原 owner 二次确认密码，防止会话被劫持后
//   恶意转让。使用 better-auth/crypto 的 verifyPassword 校验密码哈希，
//   与登录认证同源同算法（scrypt）。OAuth 用户（无密码）放行——其登录本身
//   已经过外部 provider 二次认证，session 劫持风险等价于密码场景。
import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace, runWithAuthOp } from "@/lib/auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { verifyPassword } from "better-auth/crypto";
import { apiMsg } from "@/lib/api-messages";

const schema = z.object({
  newOwnerUserId: z.string().uuid(),
  // M4 修复：二次确认密码（有密码账户必填，OAuth 账户可省略）
  password: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });
  if (ctx.member.role !== "owner") {
    return NextResponse.json(
      { code: 403, message: apiMsg(req, "onlyOwnerTransfer"), data: null },
      { status: 403 },
    );
  }

  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: e.issues[0]?.message ?? apiMsg(req, "validationFailed"), data: null },
        { status: 400 },
      );
    }
    return NextResponse.json({ code: 400, message: apiMsg(req, "invalidBody"), data: null }, { status: 400 });
  }

  // 不能转给自己
  if (body.newOwnerUserId === ctx.payload.sub) {
    return NextResponse.json({ code: 400, message: apiMsg(req, "alreadyOwner"), data: null }, { status: 400 });
  }

  // M4 修复：二次密码确认——防止会话被劫持后恶意转让所有权
  // 查询当前 owner 的密码哈希（users 表不在 RLS 清单，经 login op 读取）
  const ownerAccount = await runWithAuthOp(
    "login",
    (tx) =>
      tx.user.findUnique({
        where: { id: ctx.payload.sub },
        select: { password: true },
      }),
    ctx.payload.sub,
  );
  if (ownerAccount?.password) {
    // 有密码账户：必须验证密码
    if (!body.password) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "invalidCredentials"), data: null },
        { status: 400 },
      );
    }
    const passwordOk = await verifyPassword({
      hash: ownerAccount.password,
      password: body.password,
    });
    if (!passwordOk) {
      return NextResponse.json(
        { code: 403, message: apiMsg(req, "invalidCredentials"), data: null },
        { status: 403 },
      );
    }
  }
  // OAuth 用户（password 为 null）：放行，其登录已经过外部 provider 认证

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
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "transfereeNotMember"), data: null },
        { status: 400 },
      );
    }
    return NextResponse.json({ code: 200, data: { ok: true } });
  } catch (error) {
    // P2025: 记录不存在（member/workspace 并发删除场景）→ 404
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "workspaceNotFound"), data: null },
        { status: 404 },
      );
    }
    console.error("[PATCH transfer] error:", error);
    return NextResponse.json({ code: 500, message: apiMsg(req, "internalError"), data: null }, { status: 500 });
  }
}
