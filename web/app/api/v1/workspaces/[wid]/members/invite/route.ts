import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkspaceContext } from "@/lib/auth";
import { z } from "zod";

const inviteSchema = z.object({ email: z.string().email() });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string }> }
) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });
  if (!["owner", "admin"].includes(ctx.member.role)) {
    return NextResponse.json({ code: 403, message: "Only owner/admin can invite" }, { status: 403 });
  }

  const { email } = inviteSchema.parse(await req.json());

  const workspace = await prisma.workspace.findUnique({ where: { id: wid } });
  const memberCount = await prisma.member.count({ where: { workspaceId: wid } });

  // AC-08 席位上限：达 seatLimit 时拦截并提示升级
  if (workspace && memberCount >= workspace.seatLimit) {
    return NextResponse.json(
      { code: 402, message: "席位已满，请升级套餐以邀请更多成员", seatLimit: workspace.seatLimit },
      { status: 402 }
    );
  }

  const invitedUser = await prisma.user.findUnique({ where: { email } });
  if (!invitedUser) {
    // MVP：受邀人需已有 corps 账户（闭环 beta）。未注册返回明确提示。
    return NextResponse.json(
      { code: 422, message: "该邮箱尚未注册 corps，请先邀请对方注册" },
      { status: 422 }
    );
  }

  const existing = await prisma.member.findUnique({
    where: { userId_workspaceId: { userId: invitedUser.id, workspaceId: wid } },
  });
  if (existing) {
    return NextResponse.json({ code: 409, message: "该用户已是成员" }, { status: 409 });
  }

  const member = await prisma.member.create({
    data: { userId: invitedUser.id, workspaceId: wid, role: "member", invitedBy: ctx.payload.sub },
    include: { user: { select: { id: true, email: true, name: true, image: true } } },
  });

  return NextResponse.json(
    {
      code: 201,
      data: { id: member.user.id, email: member.user.email, name: member.user.name, role: member.role },
    },
    { status: 201 }
  );
}
